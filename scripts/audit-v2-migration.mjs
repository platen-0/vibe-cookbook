#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

await import('../cookbook-v2-core.js');
const Core = globalThis.CookbookV2Core;
const sourceArgument = process.argv[2] || 'recipes.json';
const sourcePath = sourceArgument === '-' ? 'stdin' : resolve(sourceArgument);
const payload = JSON.parse(readFileSync(sourceArgument === '-' ? 0 : sourcePath, 'utf8'));
const recipes = Array.isArray(payload) ? payload : payload.recipes || [];

if (!recipes.length) {
  throw new Error(`No recipes found in ${sourcePath}`);
}

const audits = recipes.map(Core.auditLegacyRecipe);
const counts = audits.reduce((result, item) => {
  result[item.status] = (result[item.status] || 0) + 1;
  return result;
}, {});
const tagCounts = recipes.reduce((result, recipe) => {
  for (const tag of recipe.tags || []) result[tag] = (result[tag] || 0) + 1;
  return result;
}, {});
const exceptions = audits.filter(item => item.status !== 'ready');

console.log(JSON.stringify({
  sourcePath,
  recipeCount: recipes.length,
  counts,
  tagCounts: Object.fromEntries(Object.entries(tagCounts).sort()),
  exceptions
}, null, 2));
