// Sync recipes.json from Firebase Firestore REST API
import { writeFileSync } from 'node:fs';

const PROJECT_ID = 'vibe-cookbook';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/recipes`;

function parseFirestoreValue(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue) {
    return (value.arrayValue.values || []).map(parseFirestoreValue);
  }
  if (value.mapValue) {
    const result = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})
      .sort(([left], [right]) => left.localeCompare(right))) {
      result[k] = parseFirestoreValue(v);
    }
    return result;
  }
  return null;
}

function parseDocument(doc) {
  const recipe = { id: doc.name.split('/').pop() };
  for (const [key, value] of Object.entries(doc.fields || {})
    .sort(([left], [right]) => left.localeCompare(right))) {
    recipe[key] = parseFirestoreValue(value);
  }
  return recipe;
}

async function fetchAll() {
  let recipes = [];
  let pageToken = null;

  do {
    const url = pageToken
      ? `${BASE_URL}?pageSize=300&pageToken=${pageToken}`
      : `${BASE_URL}?pageSize=300`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Firestore sync failed with HTTP ${response.status}`);
    }
    const data = await response.json();

    if (data.documents) {
      recipes = recipes.concat(data.documents.map(parseDocument));
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return recipes;
}

fetchAll().then(recipes => {
  // Sort by date descending
  recipes.sort((a, b) => new Date(b.date) - new Date(a.date));

  const output = { recipes };
  writeFileSync('recipes.json', `${JSON.stringify(output, null, 2)}\n`);

  const withTal = recipes.filter(r => r.tags && r.tags.includes('tal')).length;
  const instagramNamed = recipes.filter(r => r.name && r.name.includes('מתכון מאינסטגרם')).length;

  console.log('Synced ' + recipes.length + ' recipes to recipes.json');
  console.log('With tal tag: ' + withTal);
  console.log('Named Instagram: ' + instagramNamed);
}).catch(console.error);
