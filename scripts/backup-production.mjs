#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'vibe-cookbook';
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIRESTORE_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
  '/databases/(default)/documents/recipes';

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
    ),
    _firestore: {
      createTime: document.createTime || '',
      updateTime: document.updateTime || ''
    }
  };
}

async function fetchAllDocuments() {
  const documents = [];
  let pageToken = '';

  do {
    const url = new URL(FIRESTORE_URL);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Firestore backup failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    documents.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  if (documents.length === 0) {
    throw new Error('Firestore returned no recipes; refusing to create an empty backup');
  }
  return documents;
}

function countTags(recipes) {
  const totals = {};
  for (const recipe of recipes) {
    for (const tag of recipe.tags || []) {
      totals[tag] = (totals[tag] || 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))
  );
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const fetchedAt = new Date();
const timestamp = fetchedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputName = `production-backup-${timestamp}.zip`;
const outputPath = join(REPOSITORY_ROOT, outputName);
const stagingRoot = mkdtempSync(join(tmpdir(), 'vibe-cookbook-backup-'));
const dataRoot = join(stagingRoot, 'data');

try {
  mkdirSync(dataRoot, { recursive: true });

  const rawDocuments = await fetchAllDocuments();
  const recipes = rawDocuments.map(parseDocument).sort((left, right) =>
    String(left.id).localeCompare(String(right.id))
  );

  const rawPath = join(dataRoot, 'firestore-raw.json');
  const normalizedPath = join(dataRoot, 'recipes-normalized.json');
  writeFileSync(
    rawPath,
    `${JSON.stringify({ documents: rawDocuments }, null, 2)}\n`,
    { mode: 0o600 }
  );
  writeFileSync(
    normalizedPath,
    `${JSON.stringify({ recipes }, null, 2)}\n`,
    { mode: 0o600 }
  );

  const configRoot = join(dataRoot, 'firebase-config');
  mkdirSync(configRoot, { recursive: true });
  for (const filename of ['firebase.json', 'firestore.rules', 'firestore.indexes.json']) {
    const source = join(REPOSITORY_ROOT, filename);
    if (existsSync(source)) cpSync(source, join(configRoot, filename));
  }

  const imagesSource = join(REPOSITORY_ROOT, 'images');
  if (existsSync(imagesSource)) {
    cpSync(imagesSource, join(dataRoot, 'images'), { recursive: true });
  }

  const tagCounts = countTags(recipes);
  const manifest = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    collection: 'recipes',
    fetchedAt: fetchedAt.toISOString(),
    recipeCount: recipes.length,
    tagCounts,
    recipesWithSourceUrl: recipes.filter((recipe) => recipe.content?.url).length,
    recipesWithCardImage: recipes.filter(
      (recipe) =>
        recipe.content?.uploadedImages?.length ||
        (recipe.content?.images || []).some((path) => !String(path).endsWith('.docx'))
    ).length,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8'
    }).trim(),
    files: {
      'firestore-raw.json': sha256(rawPath),
      'recipes-normalized.json': sha256(normalizedPath)
    }
  };
  writeFileSync(
    join(dataRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );

  execFileSync('zip', ['-q', '-r', outputPath, basename(dataRoot)], {
    cwd: stagingRoot
  });

  console.log(
    JSON.stringify(
      {
        outputPath,
        sha256: sha256(outputPath),
        recipeCount: recipes.length,
        tagCounts
      },
      null,
      2
    )
  );
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
