#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const PROJECT_ID = 'vibe-cookbook';
const DATABASE_ROOT =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const DOCUMENT_ROOT = `${DATABASE_ROOT}/documents`;
const APPLY = process.argv.includes('--apply');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? '' : String(process.argv[index + 1] || '').trim();
}

const email = argument('email').toLowerCase();
const kitchenId = argument('kitchen');
const role = argument('role');

if (!email || !kitchenId || !['owner', 'admin', 'member'].includes(role)) {
  throw new Error(
    'Usage: node scripts/set-kitchen-member-role.mjs ' +
    '--email user@example.com --kitchen kitchen-id --role owner|admin|member [--apply]'
  );
}

const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
}).trim();

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
    throw new Error(
      `${options.method || 'GET'} ${url} failed (${response.status}): ${await response.text()}`
    );
  }
  return response.json();
}

function parseValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
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

async function fetchAuthUser(targetEmail) {
  const url = new URL(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet`
  );
  url.searchParams.set('maxResults', '1000');
  const payload = await googleFetch(url);
  const matches = (payload.users || []).filter(
    user => String(user.email || '').toLowerCase() === targetEmail
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Firebase Auth user for ${targetEmail}`);
  }
  return matches[0];
}

async function fetchDocument(relativePath) {
  return parseDocument(await googleFetch(`${DOCUMENT_ROOT}/${relativePath}`));
}

const authUser = await fetchAuthUser(email);
const kitchen = await fetchDocument(`kitchens/${kitchenId}`);
if (kitchen.data.type !== 'shared') {
  throw new Error(`Refusing to change membership on non-shared kitchen ${kitchenId}`);
}

const uid = authUser.localId;
const beforeRole = kitchen.data.memberRoles?.[uid] || null;
const memberIds = [...new Set([...(kitchen.data.memberIds || []), uid])];
const memberRoles = {
  ...(kitchen.data.memberRoles || {}),
  [uid]: role
};
const currentRoleCounts = Object.values(kitchen.data.memberRoles || {}).reduce(
  (counts, memberRole) => ({
    ...counts,
    [memberRole]: (counts[memberRole] || 0) + 1
  }),
  {}
);

const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  email,
  kitchenId,
  kitchenName: kitchen.data.name,
  wasMember: (kitchen.data.memberIds || []).includes(uid),
  previousRole: beforeRole,
  role,
  canonicalOwnerUnchanged: true,
  memberCountBefore: (kitchen.data.memberIds || []).length,
  currentRoleCounts
};

if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

await googleFetch(`${DATABASE_ROOT}/documents:commit`, {
  method: 'POST',
  body: JSON.stringify({
    writes: [{
      update: {
        name:
          `projects/${PROJECT_ID}/databases/(default)/documents/kitchens/${kitchenId}`,
        fields: {
          memberIds: encodeValue(memberIds),
          memberRoles: encodeValue(memberRoles),
          updatedAt: { timestampValue: new Date().toISOString() }
        }
      },
      updateMask: {
        fieldPaths: ['memberIds', 'memberRoles', 'updatedAt']
      },
      currentDocument: {
        updateTime: kitchen.updateTime
      }
    }]
  })
});

const verified = await fetchDocument(`kitchens/${kitchenId}`);
if (
  !verified.data.memberIds?.includes(uid) ||
  verified.data.memberRoles?.[uid] !== role ||
  verified.data.ownerUid !== kitchen.data.ownerUid ||
  (kitchen.data.memberIds || []).some(
    memberUid => !verified.data.memberIds.includes(memberUid)
  ) ||
  Object.entries(kitchen.data.memberRoles || {}).some(
    ([memberUid, memberRole]) => (
      memberUid !== uid && verified.data.memberRoles?.[memberUid] !== memberRole
    )
  )
) {
  throw new Error('Post-update kitchen membership verification failed');
}

console.log(JSON.stringify({
  ...summary,
  verified: true,
  memberCount: verified.data.memberIds.length,
  roleCounts: Object.values(verified.data.memberRoles || {}).reduce(
    (counts, memberRole) => ({
      ...counts,
      [memberRole]: (counts[memberRole] || 0) + 1
    }),
    {}
  )
}, null, 2));
