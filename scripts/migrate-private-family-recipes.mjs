#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'vibe-cookbook';
const DATABASE_ROOT =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const DOCUMENT_ROOT = `${DATABASE_ROOT}/documents`;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const FAMILY_RECIPE_COUNT = 217;
const FAMILY_OWNER_EMAILS = {
  tal: 'taladani@gmail.com',
  einav: 'egorlin@gmail.com'
};
const REQUIRED_SCHREIBER_EMAILS = [
  FAMILY_OWNER_EMAILS.tal,
  FAMILY_OWNER_EMAILS.einav,
  'eliavschreiber@gmail.com'
];

function accessToken() {
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  if (!token) throw new Error('Google Cloud returned no access token');
  return token;
}

const token = accessToken();

async function googleFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': PROJECT_ID,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(
      `${options.method || 'GET'} ${url} failed (${response.status}): ${await response.text()}`
    );
  }
  return response.status === 204 ? null : response.json();
}

function parseValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(parseValue);
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, child]) => [
        key,
        parseValue(child)
      ])
    );
  }
  return null;
}

function parseDocument(document) {
  return {
    id: document.name.split('/').pop(),
    name: document.name,
    createTime: document.createTime || '',
    updateTime: document.updateTime || '',
    data: Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [
        key,
        parseValue(value)
      ])
    )
  };
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, encodeValue(child)])
      )
    }
  };
}

function encodeFields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      ['createdAt', 'updatedAt'].includes(key)
        ? { timestampValue: value }
        : encodeValue(value)
    ])
  );
}

function documentName(relativePath) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${relativePath}`;
}

async function fetchCollection(collectionPath) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`${DOCUMENT_ROOT}/${collectionPath}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await googleFetch(url);
    documents.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return documents.map(parseDocument);
}

async function fetchDocument(relativePath) {
  const response = await fetch(`${DOCUMENT_ROOT}/${relativePath}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': PROJECT_ID
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET ${relativePath} failed (${response.status}): ${await response.text()}`);
  }
  return parseDocument(await response.json());
}

async function fetchAuthUsers() {
  const users = [];
  let nextPageToken = '';
  do {
    const url = new URL(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet`
    );
    url.searchParams.set('maxResults', '1000');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    const payload = await googleFetch(url);
    users.push(...(payload.users || []));
    nextPageToken = payload.nextPageToken || '';
  } while (nextPageToken);
  return users;
}

function latestBackup() {
  const filenames = readdirSync(REPOSITORY_ROOT)
    .filter(name => /^production-backup-\d{8}T\d{6}Z\.zip$/.test(name))
    .sort()
    .reverse();
  for (const filename of filenames) {
    const archivePath = join(REPOSITORY_ROOT, filename);
    const manifest = JSON.parse(
      execFileSync('unzip', ['-p', archivePath, 'data/manifest.json'], {
        encoding: 'utf8',
        maxBuffer: 2_000_000
      })
    );
    if (manifest.recipeCount !== FAMILY_RECIPE_COUNT) continue;
    const payload = JSON.parse(
      execFileSync('unzip', ['-p', archivePath, 'data/recipes-normalized.json'], {
        encoding: 'utf8',
        maxBuffer: 30_000_000
      })
    );
    if (payload.recipes?.length !== FAMILY_RECIPE_COUNT) continue;
    return { archivePath, manifest, recipes: payload.recipes };
  }
  throw new Error('No production backup contains exactly 217 family recipes');
}

function tagsFingerprint(recipes) {
  return createHash('sha256')
    .update(JSON.stringify(
      recipes
        .map(recipe => [recipe.id, recipe.tags || recipe.data?.tags || []])
        .sort(([left], [right]) => left.localeCompare(right))
    ))
    .digest('hex');
}

function patchWrite(relativePath, data, existingDocument = null) {
  return {
    update: {
      name: documentName(relativePath),
      fields: encodeFields(data)
    },
    updateMask: {
      fieldPaths: Object.keys(data)
    },
    ...(existingDocument ? {
      currentDocument: { updateTime: existingDocument.updateTime }
    } : {})
  };
}

function createWrite(relativePath, data) {
  return {
    update: {
      name: documentName(relativePath),
      fields: encodeFields(data)
    },
    currentDocument: { exists: false }
  };
}

function kitchenAccessWrite(uid, recipeId, now) {
  return {
    update: {
      name: documentName(`users/${uid}/recipeAccess/${recipeId}`),
      fields: encodeFields({
        recipeId,
        active: true,
        allowCopy: true,
        grantKind: 'kitchen',
        updatedAt: now
      })
    },
    updateMask: {
      fieldPaths: [
        'recipeId',
        'active',
        'allowCopy',
        'grantKind',
        'updatedAt'
      ]
    },
    updateTransforms: [{
      fieldPath: 'kitchenIds',
      appendMissingElements: {
        values: [{ stringValue: 'schreiber' }]
      }
    }]
  };
}

async function commitWrites(label, writes, chunkSize = 400) {
  for (let index = 0; index < writes.length; index += chunkSize) {
    const chunk = writes.slice(index, index + chunkSize);
    await googleFetch(`${DATABASE_ROOT}/documents:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes: chunk })
    });
    console.log(`${label}: committed ${Math.min(index + chunk.length, writes.length)}/${writes.length}`);
  }
}

const backup = latestBackup();
const backupById = new Map(backup.recipes.map(recipe => [recipe.id, recipe]));
const demoPayload = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'recipes.json'), 'utf8'));
const demoRecipes = demoPayload.recipes || [];
assert.equal(demoRecipes.length, 5, 'Expected exactly five demo recipes');
for (const demo of demoRecipes) {
  assert.equal(demo.isDemo, true, `Demo ${demo.id} is not marked as demo`);
  assert.equal(demo.visibility, 'public', `Demo ${demo.id} is not public`);
  assert.equal(demo.ownerUid, 'levashel-demo', `Demo ${demo.id} has an unexpected owner`);
  assert.equal(Boolean(demo.content?.images?.length), true, `Demo ${demo.id} has no image`);
  assert.equal(Boolean(demo.content?.text), true, `Demo ${demo.id} has no recipe text`);
}

const [authUsers, liveRecipes, schreiber] = await Promise.all([
  fetchAuthUsers(),
  fetchCollection('recipes'),
  fetchDocument('kitchens/schreiber')
]);
if (!schreiber) throw new Error('The שרייבר kitchen does not exist');

const authByEmail = new Map(
  authUsers.map(user => [String(user.email || '').toLowerCase(), user])
);
for (const email of REQUIRED_SCHREIBER_EMAILS) {
  if (!authByEmail.has(email)) throw new Error(`No Firebase Auth user found for ${email}`);
}

const familyRecipes = liveRecipes.filter(recipe => !recipe.data.isDemo);
if (familyRecipes.length !== FAMILY_RECIPE_COUNT) {
  throw new Error(`Expected 217 family recipes, found ${familyRecipes.length}`);
}
assert.deepEqual(
  familyRecipes.map(recipe => recipe.id).sort(),
  [...backupById.keys()].sort(),
  'Live family recipe IDs do not match the fresh backup'
);
assert.equal(
  tagsFingerprint(familyRecipes),
  tagsFingerprint(backup.recipes),
  'Live family recipe tags do not match the fresh backup'
);

const ownerCounts = { tal: 0, einav: 0 };
for (const recipe of familyRecipes) {
  const backupRecipe = backupById.get(recipe.id);
  assert.deepEqual(
    recipe.data.tags || [],
    backupRecipe.tags || [],
    `Tags changed for recipe ${recipe.id}`
  );
  const ownerKeys = Object.keys(FAMILY_OWNER_EMAILS).filter(
    key => (recipe.data.tags || []).includes(key)
  );
  assert.equal(ownerKeys.length, 1, `Recipe ${recipe.id} has an ambiguous family owner`);
  const ownerKey = ownerKeys[0];
  const expectedUid = authByEmail.get(FAMILY_OWNER_EMAILS[ownerKey]).localId;
  assert.equal(recipe.data.ownerUid, expectedUid, `Recipe ${recipe.id} has the wrong owner`);
  assert.equal(
    recipe.data.homeKitchenId,
    `personal_${expectedUid}`,
    `Recipe ${recipe.id} has the wrong personal kitchen`
  );
  assert.equal(
    (recipe.data.sharedKitchenIds || []).includes('schreiber'),
    true,
    `Recipe ${recipe.id} is missing from שרייבר`
  );
  ownerCounts[ownerKey] += 1;
}
assert.deepEqual(ownerCounts, { tal: 158, einav: 59 });

const schreiberMemberIds = schreiber.data.memberIds || [];
for (const email of REQUIRED_SCHREIBER_EMAILS) {
  const uid = authByEmail.get(email).localId;
  assert.equal(
    schreiberMemberIds.includes(uid),
    true,
    `${email} is not a member of שרייבר`
  );
}
const eliavUid = authByEmail.get('eliavschreiber@gmail.com').localId;
assert.equal(
  schreiber.data.memberRoles?.[eliavUid],
  'owner',
  'Eliav is not an owner of שרייבר'
);

const existingDemoIds = new Set(
  liveRecipes.filter(recipe => recipe.data.isDemo).map(recipe => recipe.id)
);
for (const id of existingDemoIds) {
  if (!demoRecipes.some(recipe => recipe.id === id)) {
    throw new Error(`Unexpected public demo recipe already exists: ${id}`);
  }
}

const now = new Date().toISOString();
const accessWrites = schreiberMemberIds.flatMap(uid =>
  familyRecipes.map(recipe => kitchenAccessWrite(uid, recipe.id, now))
);
let existingActiveAccessGrants = 0;
let missingActiveAccessGrants = 0;
for (const uid of schreiberMemberIds) {
  const grants = await fetchCollection(`users/${uid}/recipeAccess`);
  const activeIds = new Set(
    grants
      .filter(grant => grant.data.active !== false)
      .map(grant => grant.id)
  );
  for (const recipe of familyRecipes) {
    if (activeIds.has(recipe.id)) existingActiveAccessGrants += 1;
    else missingActiveAccessGrants += 1;
  }
}
const demoWrites = [];
for (const demo of demoRecipes) {
  const existing = liveRecipes.find(recipe => recipe.id === demo.id);
  if (!existing) {
    demoWrites.push(createWrite(`recipes/${demo.id}`, demo));
    continue;
  }
  assert.equal(existing.data.isDemo, true, `${demo.id} exists but is not a demo`);
  assert.equal(existing.data.visibility, 'public', `${demo.id} is not public`);
  assert.equal(existing.data.name, demo.name, `${demo.id} has unexpected content`);
}
const kitchenWrite = patchWrite(
  'kitchens/schreiber',
  { recipeIds: familyRecipes.map(recipe => recipe.id).sort() },
  schreiber
);
const visibilityWrites = familyRecipes
  .filter(recipe => recipe.data.visibility !== 'private')
  .map(recipe => patchWrite(
    `recipes/${recipe.id}`,
    { visibility: 'private' },
    recipe
  ));

const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  backup: backup.archivePath,
  backupFetchedAt: backup.manifest.fetchedAt,
  familyRecipeCount: familyRecipes.length,
  ownerCounts,
  originalTagsFingerprint: tagsFingerprint(familyRecipes),
  schreiberMemberCount: schreiberMemberIds.length,
  accessGrantWrites: accessWrites.length,
  existingActiveAccessGrants,
  missingActiveAccessGrants,
  demoCreates: demoWrites.length,
  visibilityUpdates: visibilityWrites.length,
  resultingPublicDemoCount: demoRecipes.length
};

if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

// Grants and public demos land before visibility changes, keeping the live app
// readable throughout the migration.
await commitWrites('Schreiber access grants', accessWrites);
await commitWrites('Public demo recipes', demoWrites);
await commitWrites('Schreiber recipe index', [kitchenWrite]);
await commitWrites('Private family visibility', visibilityWrites);

const verifiedRecipes = await fetchCollection('recipes');
const verifiedFamily = verifiedRecipes.filter(recipe => !recipe.data.isDemo);
const verifiedDemos = verifiedRecipes.filter(recipe => recipe.data.isDemo);
assert.equal(verifiedFamily.length, FAMILY_RECIPE_COUNT);
assert.equal(verifiedDemos.length, 5);
assert.equal(
  verifiedFamily.every(recipe => recipe.data.visibility === 'private'),
  true,
  'At least one family recipe is still public'
);
assert.equal(
  verifiedDemos.every(recipe => recipe.data.visibility === 'public'),
  true,
  'At least one demo recipe is not public'
);
assert.equal(
  tagsFingerprint(verifiedFamily),
  tagsFingerprint(backup.recipes),
  'Recipe tags changed during migration'
);

const verifiedKitchen = await fetchDocument('kitchens/schreiber');
assert.deepEqual(
  [...(verifiedKitchen.data.recipeIds || [])].sort(),
  familyRecipes.map(recipe => recipe.id).sort(),
  'The שרייבר recipe index is incomplete'
);

for (const uid of schreiberMemberIds) {
  const grants = await fetchCollection(`users/${uid}/recipeAccess`);
  const activeIds = new Set(
    grants
      .filter(grant => grant.data.active !== false)
      .map(grant => grant.id)
  );
  for (const recipe of familyRecipes) {
    assert.equal(
      activeIds.has(recipe.id),
      true,
      `User ${uid} is missing access to recipe ${recipe.id}`
    );
  }
}

console.log(JSON.stringify({
  ...summary,
  verified: true,
  verifiedRecipeCount: verifiedRecipes.length,
  verifiedPrivateFamilyCount: verifiedFamily.length,
  verifiedPublicDemoCount: verifiedDemos.length,
  verifiedTagsFingerprint: tagsFingerprint(verifiedFamily)
}, null, 2));
