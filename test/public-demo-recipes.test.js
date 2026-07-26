import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const payload = JSON.parse(readFileSync('recipes.json', 'utf8'));
const recipes = payload.recipes || [];

test('publishes exactly five original demo recipes in the static fallback', () => {
  assert.equal(recipes.length, 5);
  assert.equal(new Set(recipes.map(recipe => recipe.id)).size, 5);

  for (const recipe of recipes) {
    assert.equal(recipe.isDemo, true);
    assert.equal(recipe.visibility, 'public');
    assert.equal(recipe.ownerUid, 'levashel-demo');
    assert.equal(recipe.sharedKitchenIds.length, 0);
    assert.equal(recipe.tags.includes('tal'), false);
    assert.equal(recipe.tags.includes('einav'), false);
    assert.equal(Boolean(recipe.content?.url), false);
    assert.match(recipe.content?.text || '', /מרכיבים/);
    assert.match(recipe.content?.text || '', /אופן ההכנה/);
  }
});

test('every demo recipe uses a generated project image', () => {
  for (const recipe of recipes) {
    assert.equal(recipe.content.images.length, 1);
    const imagePath = resolve('images', recipe.content.images[0]);
    assert.equal(existsSync(imagePath), true, `${imagePath} is missing`);
    assert.ok(statSync(imagePath).size > 100_000, `${imagePath} is unexpectedly small`);
    assert.deepEqual(
      [...readFileSync(imagePath).subarray(0, 3)],
      [0xff, 0xd8, 0xff],
      `${imagePath} is not a JPEG`
    );
  }
});

test('the signed-out surface introduces the demo catalogue and onboarding action', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /id="public-intro"/);
  assert.match(html, /id="public-intro-signin"/);
  assert.match(html, /חמישה מתכונים להתחלה/);
});

test('demo recipes are clearly labeled on their cards', () => {
  const source = readFileSync('app.js', 'utf8');
  const styles = readFileSync('styles.css', 'utf8');
  assert.match(source, /recipe\.ownerUid === 'levashel-demo'/);
  assert.match(source, /class="recipe-demo-badge"[^>]*>DEMO<\/span>/);
  assert.match(styles, /\.recipe-demo-badge\s*\{/);
});

test('Cookbook v2 never caches a private recipe collection device-wide', () => {
  const source = readFileSync('app.js', 'utf8');
  assert.match(source, /where\('visibility', '==', 'public'\)/);
  assert.match(source, /where\('ownerUid', '==', viewerUid\)/);
  assert.match(
    source,
    /function updateRecipesCache\(\) \{\s+if \(COOKBOOK_V2_ENABLED\) return;/
  );
});

test('startup waits for auth and batches accessible recipe reads', () => {
  const source = readFileSync('app.js', 'utf8');
  assert.match(source, /const initialAuthReady = setupAuth\(\)/);
  assert.match(source, /await initialAuthReady/);
  assert.match(
    source,
    /where\(firebase\.firestore\.FieldPath\.documentId\(\), 'in', chunk\)/
  );
  assert.match(source, /index \+= 30/);
});
