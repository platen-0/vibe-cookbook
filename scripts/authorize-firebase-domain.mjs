#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const PROJECT_ID = 'vibe-cookbook';
const APPLY = process.argv.includes('--apply');
const requestedDomains = process.argv
  .filter(argument => argument.startsWith('--domain='))
  .map(argument => argument.slice('--domain='.length).trim().toLowerCase())
  .filter(Boolean);

if (!requestedDomains.length) {
  throw new Error(
    'Usage: node scripts/authorize-firebase-domain.mjs ' +
    '--domain=example.com [--domain=www.example.com] [--apply]'
  );
}

const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
}).trim();
const configUrl =
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`;

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

const before = await googleFetch(configUrl);
const authorizedDomains = [...new Set([
  ...(before.authorizedDomains || []),
  ...requestedDomains
])].sort();

const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  requestedDomains,
  alreadyAuthorized: requestedDomains.filter(domain =>
    (before.authorizedDomains || []).includes(domain)
  ),
  authorizedDomainCountBefore: (before.authorizedDomains || []).length,
  authorizedDomainCountAfter: authorizedDomains.length
};

if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

await googleFetch(
  `${configUrl}?updateMask=authorizedDomains`,
  {
    method: 'PATCH',
    body: JSON.stringify({ authorizedDomains })
  }
);

const verified = await googleFetch(configUrl);
if (
  requestedDomains.some(domain =>
    !(verified.authorizedDomains || []).includes(domain)
  )
) {
  throw new Error('Firebase authorized-domain verification failed');
}

console.log(JSON.stringify({
  ...summary,
  verified: true
}, null, 2));
