import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('LLM artifacts are content-addressed, versioned, and stored without expiry', () => {
  const worker = readFileSync('worker/src/index.js', 'utf8');
  assert.match(worker, /translation-v1/);
  assert.match(worker, /extraction-v1/);
  assert.match(worker, /image-analysis-v1/);
  assert.match(worker, /cooking-plan-v1/);
  assert.match(worker, /await env\.RECIPE_INTELLIGENCE\.put\(key, JSON\.stringify\(value\)\)/);
  assert.doesNotMatch(worker, /expirationTtl/);
});

test('rerunning extraction stores a candidate instead of replacing saved text', () => {
  const source = readFileSync('app.js', 'utf8');
  assert.match(source, /if \(storedText\.trim\(\)\) \{/);
  assert.match(source, /'intelligence\.extractionCandidate': candidate/);
  assert.match(source, /source: 'human-approved'/);
  assert.match(source, /source: 'human'/);
  assert.match(source, /הטקסט השמור לא השתנה/);
});

test('extraction updates local UI only after Firestore confirms the write', () => {
  const source = readFileSync('app.js', 'utf8');
  const extractionStart = source.indexOf('async function extractRecipeFromUrl()');
  const extractionEnd = source.indexOf('// Extract recipe content from parsed HTML', extractionStart);
  const extraction = source.slice(extractionStart, extractionEnd);
  const transaction = extraction.indexOf('const outcome = await db.runTransaction');
  const localMutation = extraction.indexOf('recipe.content.text = recipeText');

  assert.ok(transaction >= 0);
  assert.ok(localMutation > transaction);
  assert.match(extraction, /await reconcileRecipeFromServer\(recipe\.id\)/);
  assert.match(extraction, /הטקסט לא נשמר/);
});

test('kitchen role repair reconciles recipe editors without touching recipe tags', () => {
  const source = readFileSync('scripts/set-kitchen-member-role.mjs', 'utf8');
  assert.match(source, /function userShouldEditRecipe/);
  assert.match(source, /Recipe editor reconciliation/);
  assert.match(source, /fieldPaths: \['editorUids', 'updatedAt'\]/);
  assert.doesNotMatch(source, /fieldPaths: \['editorUids', 'updatedAt', 'tags'\]/);
});

test('translation precedence is personal, canonical human, then generated', () => {
  const source = readFileSync('app.js', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.match(source, /const humanTranslation = personalTranslation \|\| canonicalTranslation/);
  assert.match(source, /collection\('recipeOverrides'\)/);
  assert.match(source, /'intelligence\.translations\.en': correction/);
  assert.match(html, /הפעלה נוספת של התרגום לא תחליף אותו/);
});

test('human text edits create append-only revisions with protection metadata', () => {
  const source = readFileSync('app.js', 'utf8');
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.match(source, /addRecipeRevisionToBatch/);
  assert.match(source, /protected: true/);
  assert.match(rules, /humanTextPrecedenceIsPreserved/);
  assert.match(rules, /allow update, delete: if false/);
});
