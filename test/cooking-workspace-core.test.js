import test from 'node:test';
import assert from 'node:assert/strict';
import '../cooking-workspace-core.js';

const {
  MAX_RECIPES,
  normalizeWorkspace,
  addRecipe,
  removeRecipe,
  selectRecipe
} = globalThis.CookingWorkspaceCore;

test('normalizes duplicate, invalid, unavailable, and stale recipe ids', () => {
  assert.deepEqual(
    normalizeWorkspace(
      { recipeIds: ['a', 'a', '', null, 'b'], activeRecipeId: 'missing' },
      ['a', 'b']
    ),
    { recipeIds: ['a', 'b'], activeRecipeId: 'a' }
  );
});

test('adds recipes once and keeps the original active recipe', () => {
  const first = addRecipe({}, 'a');
  assert.deepEqual(first, { recipeIds: ['a'], activeRecipeId: 'a' });
  assert.deepEqual(addRecipe(first, 'b'), {
    recipeIds: ['a', 'b'],
    activeRecipeId: 'a'
  });
  assert.deepEqual(addRecipe(first, 'a'), {
    recipeIds: ['a'],
    activeRecipeId: 'a'
  });
});

test('caps a cooking workspace at the supported recipe limit', () => {
  const recipeIds = Array.from({ length: MAX_RECIPES }, (_, index) => `r-${index}`);
  assert.deepEqual(
    addRecipe({ recipeIds, activeRecipeId: recipeIds[0] }, 'one-too-many').recipeIds,
    recipeIds
  );
});

test('removing the active recipe selects the nearest remaining recipe', () => {
  const workspace = { recipeIds: ['a', 'b', 'c'], activeRecipeId: 'b' };
  assert.deepEqual(removeRecipe(workspace, 'b'), {
    recipeIds: ['a', 'c'],
    activeRecipeId: 'c'
  });
  assert.deepEqual(removeRecipe({ recipeIds: ['a'], activeRecipeId: 'a' }, 'a'), {
    recipeIds: [],
    activeRecipeId: null
  });
});

test('only recipes already in the workspace can become active', () => {
  const workspace = { recipeIds: ['a', 'b'], activeRecipeId: 'a' };
  assert.equal(selectRecipe(workspace, 'b').activeRecipeId, 'b');
  assert.equal(selectRecipe(workspace, 'missing').activeRecipeId, 'a');
});
