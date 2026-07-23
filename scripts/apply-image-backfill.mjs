#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'vibe-cookbook';
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const IMAGE_ROOT = join(REPOSITORY_ROOT, 'images', 'recipes');
const REPORT_PATH = join(tmpdir(), 'vibe-cookbook-image-backfill-apply-report.json');
const PUBLIC_BASE = 'https://platen-0.github.io/vibe-cookbook/';
const IMAGE_VERSION = '6abda99fa985';
const CONCURRENCY = 4;
const APPLY = process.argv.includes('--apply');

function latestBackupPath() {
  const candidates = readdirSync(REPOSITORY_ROOT)
    .filter((name) => /^production-backup-\d{8}T\d{6}Z\.zip$/.test(name))
    .sort()
    .reverse();
  if (!candidates.length) throw new Error('No timestamped production backup was found');
  return join(REPOSITORY_ROOT, candidates[0]);
}

function readRecipesFromBackup(archivePath) {
  const json = execFileSync(
    'unzip',
    ['-p', archivePath, 'data/recipes-normalized.json'],
    { encoding: 'utf8', maxBuffer: 20_000_000 }
  );
  const payload = JSON.parse(json);
  if (!Array.isArray(payload.recipes) || payload.recipes.length !== 213) {
    throw new Error('Backup does not contain the expected 213 recipes');
  }
  return payload.recipes;
}

function parseFirestoreValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if (value.arrayValue) {
    return (value.arrayValue.values || []).map(parseFirestoreValue);
  }
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, child]) => [
        key,
        parseFirestoreValue(child)
      ])
    );
  }
  return null;
}

function parseDocument(document) {
  return {
    id: document.name.split('/').pop(),
    ...Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [
        key,
        parseFirestoreValue(value)
      ])
    )
  };
}

function withoutBackfillField(recipe) {
  const clone = structuredClone(recipe);
  delete clone._firestore;
  if (clone.content) delete clone.content.uploadedImages;
  return clone;
}

function imageUrl(recipeId) {
  return (
    `${PUBLIC_BASE}images/recipes/${encodeURIComponent(recipeId)}.jpg` +
    `?v=${IMAGE_VERSION}`
  );
}

function accessToken() {
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  if (!token) throw new Error('Google Cloud returned no access token');
  return token;
}

async function firestoreRequest(path, token, options = {}) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
      `/databases/(default)/documents/${path}`,
    {
      ...options,
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Firestore HTTP ${response.status}: ${payload.error?.message || 'unknown error'}`);
  }
  return payload;
}

async function inspectOrApply(entry, token) {
  const currentDocument = await firestoreRequest(
    `recipes/${encodeURIComponent(entry.id)}`,
    token
  );
  const current = parseDocument(currentDocument);
  const expectedUrl = imageUrl(entry.id);

  try {
    assert.deepEqual(
      withoutBackfillField(current),
      withoutBackfillField(entry.backupRecipe)
    );
  } catch {
    return {
      ...entry,
      status: 'conflict',
      reason: 'live recipe differs from the fresh backup outside uploadedImages'
    };
  }

  if (current.content?.uploadedImages?.[0] === expectedUrl) {
    assert.deepEqual(
      current.tags || [],
      entry.backupRecipe.tags || [],
      `Recipe ${entry.id} tags changed`
    );
    return { ...entry, status: 'already-applied', imageUrl: expectedUrl };
  }

  if (!APPLY) {
    return { ...entry, status: 'ready', imageUrl: expectedUrl };
  }

  const query = new URLSearchParams();
  query.append('updateMask.fieldPaths', 'content.uploadedImages');
  query.append('currentDocument.updateTime', currentDocument.updateTime);
  const patchedDocument = await firestoreRequest(
    `recipes/${encodeURIComponent(entry.id)}?${query}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          content: {
            mapValue: {
              fields: {
                uploadedImages: {
                  arrayValue: {
                    values: [{ stringValue: expectedUrl }]
                  }
                }
              }
            }
          }
        }
      })
    }
  );
  const patched = parseDocument(patchedDocument);

  assert.deepEqual(
    withoutBackfillField(patched),
    withoutBackfillField(entry.backupRecipe),
    `Recipe ${entry.id} changed outside content.uploadedImages`
  );
  assert.deepEqual(
    patched.tags || [],
    entry.backupRecipe.tags || [],
    `Recipe ${entry.id} tags changed`
  );
  assert.equal(
    patched.content?.uploadedImages?.[0],
    expectedUrl,
    `Recipe ${entry.id} did not receive the expected image URL`
  );

  return {
    id: entry.id,
    name: entry.name,
    status: 'applied',
    imageUrl: expectedUrl,
    updateTime: patchedDocument.updateTime
  };
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        results[index] = {
          id: items[index].id,
          name: items[index].name,
          status: 'failed',
          reason: error.message
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

if (!existsSync(IMAGE_ROOT)) throw new Error('No prepared image directory was found');

const backupPath = latestBackupPath();
const recipes = readRecipesFromBackup(backupPath);
const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
const imageIds = readdirSync(IMAGE_ROOT)
  .filter((name) => name.endsWith('.jpg'))
  .map((name) => basename(name, '.jpg'))
  .sort();

if (imageIds.length !== 133) {
  throw new Error(`Expected 133 prepared images, found ${imageIds.length}`);
}

const entries = imageIds.map((id) => {
  const backupRecipe = recipesById.get(id);
  if (!backupRecipe) throw new Error(`Image ${id}.jpg has no matching backup recipe`);
  if (
    backupRecipe.content?.uploadedImages?.length ||
    (backupRecipe.content?.images || []).some((path) => !String(path).endsWith('.docx'))
  ) {
    throw new Error(`Recipe ${id} already had a card image in the backup`);
  }
  return { id, name: backupRecipe.name, backupRecipe };
});

const token = accessToken();
const results = await mapConcurrent(entries, CONCURRENCY, (entry) =>
  inspectOrApply(entry, token)
);
const summary = results.reduce(
  (totals, result) => {
    totals[result.status] = (totals[result.status] || 0) + 1;
    return totals;
  },
  { total: results.length, mode: APPLY ? 'apply' : 'dry-run' }
);
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  backupPath,
  publicBase: PUBLIC_BASE,
  imageVersion: IMAGE_VERSION,
  summary,
  results: results.map(({ backupRecipe, ...result }) => result)
};
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ reportPath: REPORT_PATH, summary }, null, 2));

if (summary.conflict || summary.failed) process.exitCode = 1;
