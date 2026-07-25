#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const PROJECT_ID = 'vibe-cookbook';
const DATABASE_ROOT =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const DOCUMENT_ROOT = `${DATABASE_ROOT}/documents`;
const APPLY = process.argv.includes('--apply');
const TARGETS = {
  tal: {
    email: 'taladani@gmail.com',
    username: 'Tal',
    usernameNormalized: 'tal',
    firstName: 'Tal'
  },
  einav: {
    email: 'egorlin@gmail.com',
    username: 'Einav',
    usernameNormalized: 'einav',
    firstName: 'Einav'
  }
};

function accessToken() {
  return execFileSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

const token = accessToken();

async function googleFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': PROJECT_ID,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method || 'GET'} ${url} failed (${response.status}): ${body}`);
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
    createTime: document.createTime,
    updateTime: document.updateTime,
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
    Object.entries(data).map(([key, value]) => [key, encodeValue(value)])
  );
}

function timestampField(value) {
  return { timestampValue: value };
}

function documentPath(relativePath) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${relativePath}`;
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

async function fetchCollection(collection) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`${DOCUMENT_ROOT}/${collection}`);
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function tagsFingerprint(recipes) {
  return createHash('sha256')
    .update(JSON.stringify(
      recipes
        .map(recipe => [recipe.id, recipe.data.tags || []])
        .sort(([left], [right]) => left.localeCompare(right))
    ))
    .digest('hex');
}

function patchWrite(relativePath, data, existingDocument) {
  const fields = encodeFields(data);
  ['createdAt', 'updatedAt'].forEach((field) => {
    if (Object.hasOwn(data, field)) fields[field] = timestampField(data[field]);
  });
  return {
    update: {
      name: documentPath(relativePath),
      fields
    },
    updateMask: {
      fieldPaths: Object.keys(data)
    },
    currentDocument: existingDocument
      ? { updateTime: existingDocument.updateTime }
      : { exists: false }
  };
}

function assertDirectoryAvailable(document, uid, label) {
  if (document && document.data.uid !== uid) {
    throw new Error(`${label} is already assigned to a different user`);
  }
}

const authUsers = await fetchAuthUsers();
const resolved = {};
for (const [key, target] of Object.entries(TARGETS)) {
  const matches = authUsers.filter(
    user => String(user.email || '').toLowerCase() === target.email
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Firebase Auth user for ${target.email}`);
  }
  resolved[key] = {
    ...target,
    uid: matches[0].localId,
    photoURL: matches[0].photoUrl || '',
    displayName: matches[0].displayName || ''
  };
}

const recipes = await fetchCollection('recipes');
if (recipes.length !== 217) {
  throw new Error(`Expected 217 production recipes, found ${recipes.length}`);
}

const beforeTagsFingerprint = tagsFingerprint(recipes);
const recipeGroups = { tal: [], einav: [] };
for (const recipe of recipes) {
  const tags = recipe.data.tags || [];
  const ownerKeys = ['tal', 'einav'].filter(tag => tags.includes(tag));
  if (ownerKeys.length !== 1) {
    throw new Error(`Recipe ${recipe.id} has ${ownerKeys.length} uploader tags`);
  }
  const ownerKey = ownerKeys[0];
  const currentOwner = recipe.data.ownerUid;
  if (currentOwner && currentOwner !== resolved[ownerKey].uid) {
    throw new Error(`Recipe ${recipe.id} is already owned by an unexpected user`);
  }
  recipeGroups[ownerKey].push(recipe);
}
if (recipeGroups.tal.length !== 158 || recipeGroups.einav.length !== 59) {
  throw new Error(
    `Unexpected owner split: Tal ${recipeGroups.tal.length}, Einav ${recipeGroups.einav.length}`
  );
}

const existing = {};
for (const [key, target] of Object.entries(resolved)) {
  existing[`user-${key}`] = await fetchDocument(`users/${target.uid}`);
  existing[`username-${key}`] = await fetchDocument(
    `usernames/${target.usernameNormalized}`
  );
  existing[`email-${key}`] = await fetchDocument(
    `emailDirectory/${sha256(target.email)}`
  );
  existing[`personal-${key}`] = await fetchDocument(`kitchens/personal_${target.uid}`);
  assertDirectoryAvailable(
    existing[`username-${key}`],
    target.uid,
    `Username ${target.username}`
  );
  assertDirectoryAvailable(
    existing[`email-${key}`],
    target.uid,
    `Email ${target.email}`
  );
}
existing.schreiber = await fetchDocument('kitchens/schreiber');
if (
  existing.schreiber &&
  existing.schreiber.data.ownerUid &&
  existing.schreiber.data.ownerUid !== resolved.tal.uid
) {
  throw new Error('The existing schreiber kitchen has an unexpected owner');
}

const now = new Date().toISOString();
const writes = [];
for (const [key, target] of Object.entries(resolved)) {
  const personalKitchenId = `personal_${target.uid}`;
  const userExisting = existing[`user-${key}`];
  const personalExisting = existing[`personal-${key}`];
  writes.push(patchWrite(`users/${target.uid}`, {
    username: target.username,
    usernameNormalized: target.usernameNormalized,
    firstName: target.firstName,
    tagName: target.firstName,
    email: target.email,
    photoURL: target.photoURL,
    personalKitchenId,
    onboardingComplete: true,
    ...(userExisting ? {} : { createdAt: now }),
    updatedAt: now
  }, userExisting));
  writes.push(patchWrite(`usernames/${target.usernameNormalized}`, {
    uid: target.uid,
    username: target.username,
    firstName: target.firstName,
    updatedAt: now
  }, existing[`username-${key}`]));
  writes.push(patchWrite(`emailDirectory/${sha256(target.email)}`, {
    uid: target.uid,
    updatedAt: now
  }, existing[`email-${key}`]));
  writes.push(patchWrite(`kitchens/${personalKitchenId}`, {
    name: 'המטבח שלי',
    type: 'personal',
    ownerUid: target.uid,
    memberIds: [target.uid],
    memberRoles: { [target.uid]: 'owner' },
    ...(personalExisting ? {} : { createdAt: now }),
    updatedAt: now
  }, personalExisting));
}

writes.push(patchWrite('kitchens/schreiber', {
  name: 'שרייבר',
  nameNormalized: 'שרייבר',
  type: 'shared',
  ownerUid: resolved.tal.uid,
  memberIds: [resolved.tal.uid, resolved.einav.uid],
  memberRoles: {
    [resolved.tal.uid]: 'owner',
    [resolved.einav.uid]: 'admin'
  },
  createdBy: resolved.tal.uid,
  ...(existing.schreiber ? {} : { createdAt: now }),
  updatedAt: now
}, existing.schreiber));

for (const [ownerKey, ownerRecipes] of Object.entries(recipeGroups)) {
  const owner = resolved[ownerKey];
  for (const recipe of ownerRecipes) {
    const sharedKitchenIds = [...new Set([
      ...(recipe.data.sharedKitchenIds || []),
      'schreiber'
    ])];
    const editorUids = [...new Set([
      ...(recipe.data.editorUids || []),
      resolved.tal.uid,
      resolved.einav.uid
    ])];
    writes.push(patchWrite(`recipes/${recipe.id}`, {
      ownerUid: owner.uid,
      homeKitchenId: `personal_${owner.uid}`,
      sharedKitchenIds,
      editorUids,
      visibility: recipe.data.visibility || 'public',
      author: {
        uid: owner.uid,
        username: owner.username,
        firstName: owner.firstName
      },
      schemaVersion: 2,
      updatedAt: now
    }, recipe));
  }
}

if (writes.length > 500) {
  throw new Error(`Migration requires ${writes.length} writes; refusing a non-atomic migration`);
}

const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  recipeCount: recipes.length,
  ownerCounts: {
    Tal: recipeGroups.tal.length,
    Einav: recipeGroups.einav.length
  },
  usernames: ['Tal', 'Einav'],
  kitchen: 'שרייבר',
  visibility: 'preserved or public',
  tagsFingerprint: beforeTagsFingerprint,
  writeCount: writes.length
};

if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

await googleFetch(`${DATABASE_ROOT}/documents:commit`, {
  method: 'POST',
  body: JSON.stringify({ writes })
});

const verifiedRecipes = await fetchCollection('recipes');
const verifiedGroups = {
  Tal: verifiedRecipes.filter(recipe => recipe.data.ownerUid === resolved.tal.uid).length,
  Einav: verifiedRecipes.filter(recipe => recipe.data.ownerUid === resolved.einav.uid).length
};
if (
  verifiedRecipes.length !== 217 ||
  verifiedGroups.Tal !== 158 ||
  verifiedGroups.Einav !== 59 ||
  tagsFingerprint(verifiedRecipes) !== beforeTagsFingerprint
) {
  throw new Error('Post-migration verification failed');
}

console.log(JSON.stringify({
  ...summary,
  verified: true,
  verifiedRecipeCount: verifiedRecipes.length,
  verifiedOwnerCounts: verifiedGroups,
  verifiedTagsFingerprint: tagsFingerprint(verifiedRecipes)
}, null, 2));
