#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const PROJECT_ID = 'vibe-cookbook';
const DATABASE_ROOT =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const DOCUMENT_ROOT = `${DATABASE_ROOT}/documents`;
const DOCUMENT_NAME_ROOT =
  `projects/${PROJECT_ID}/databases/(default)/documents`;
const APPLY = process.argv.includes('--apply');

const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
}).trim();

async function googleFetch(url, options = {}, allowMissing = false) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': PROJECT_ID,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `${options.method || 'GET'} ${url} failed (${response.status}): ${await response.text()}`
    );
  }
  return response.json();
}

function parseValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
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
    data: Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [
        key,
        parseValue(value)
      ])
    )
  };
}

function encodeValue(value) {
  if (typeof value === 'string') return { stringValue: value };
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

function fields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, encodeValue(value)])
  );
}

async function fetchCollection(relativePath) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`${DOCUMENT_ROOT}/${relativePath}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await googleFetch(url);
    documents.push(...(payload.documents || []).map(parseDocument));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return documents;
}

function normalizeKitchenName(name) {
  return String(name || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function directoryKey(normalizedName) {
  return createHash('sha256').update(normalizedName).digest('hex');
}

const sharedKitchens = (await fetchCollection('kitchens'))
  .filter(kitchen => kitchen.data.type === 'shared');
const planned = [];
const keys = new Map();

for (const kitchen of sharedKitchens) {
  const normalizedName = normalizeKitchenName(kitchen.data.name);
  if (!normalizedName) throw new Error(`Kitchen ${kitchen.id} has no usable name`);
  const key = directoryKey(normalizedName);
  if (keys.has(key) && keys.get(key) !== kitchen.id) {
    throw new Error(
      `Kitchen name collision: ${keys.get(key)} and ${kitchen.id} normalize identically`
    );
  }
  keys.set(key, kitchen.id);
  const existing = await googleFetch(
    `${DOCUMENT_ROOT}/kitchenDirectory/${key}`,
    {},
    true
  );
  if (existing) {
    const existingData = parseDocument(existing).data;
    if (existingData.kitchenId !== kitchen.id) {
      throw new Error(`Directory key ${key} already belongs to ${existingData.kitchenId}`);
    }
  }
  const adminUids = [...new Set([
    kitchen.data.ownerUid,
    ...Object.entries(kitchen.data.memberRoles || {})
      .filter(([, role]) => role === 'owner' || role === 'admin')
      .map(([uid]) => uid)
  ].filter(Boolean))];
  planned.push({ kitchen, normalizedName, key, adminUids });
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  sharedKitchens: planned.map(item => ({
    id: item.kitchen.id,
    name: item.kitchen.data.name,
    directoryKey: item.key,
    adminCount: item.adminUids.length
  }))
}, null, 2));

if (!APPLY) {
  console.log('Dry run only. Re-run with --apply to write the directory.');
  process.exit(0);
}

const now = new Date().toISOString();
const writes = planned.flatMap(item => [
  {
    update: {
      name: `${DOCUMENT_NAME_ROOT}/kitchens/${item.kitchen.id}`,
      fields: fields({
        directoryKey: item.key,
        nameNormalized: item.normalizedName,
        updatedAt: now
      })
    },
    updateMask: {
      fieldPaths: ['directoryKey', 'nameNormalized', 'updatedAt']
    }
  },
  {
    update: {
      name: `${DOCUMENT_NAME_ROOT}/kitchenDirectory/${item.key}`,
      fields: fields({
        kitchenId: item.kitchen.id,
        kitchenName: item.kitchen.data.name,
        normalizedName: item.normalizedName,
        ownerUid: item.kitchen.data.ownerUid,
        adminUids: item.adminUids,
        updatedAt: now
      })
    },
    updateMask: {
      fieldPaths: [
        'kitchenId',
        'kitchenName',
        'normalizedName',
        'ownerUid',
        'adminUids',
        'updatedAt'
      ]
    }
  }
]);

await googleFetch(`${DATABASE_ROOT}/documents:commit`, {
  method: 'POST',
  body: JSON.stringify({ writes })
});

console.log(`Updated ${planned.length} shared kitchen director${planned.length === 1 ? 'y' : 'ies'}.`);
