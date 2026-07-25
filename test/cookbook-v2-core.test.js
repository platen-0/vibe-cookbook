import test from 'node:test';
import assert from 'node:assert/strict';

await import('../cookbook-v2-core.js');
const Core = globalThis.CookbookV2Core;

test('normalizes and validates unique-style usernames without losing Hebrew letters', () => {
  assert.equal(Core.normalizeUsername(' @Tal.Dani '), 'tal.dani');
  assert.equal(Core.validateUsername('טל_דני').valid, true);
  assert.equal(Core.validateUsername('_tal').valid, false);
  assert.equal(Core.validateUsername('ab').valid, false);
});

test('profile onboarding requires both username and first name', () => {
  const valid = Core.validateProfile({ username: 'Einav', firstName: ' עינב ' });
  assert.equal(valid.valid, true);
  assert.equal(valid.value.username, 'einav');
  assert.equal(valid.value.firstName, 'עינב');

  const invalid = Core.validateProfile({ username: 'x', firstName: '' });
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['firstName', 'username']);
});

test('user-bound canonical recipes remain visible through shared kitchens', () => {
  const recipe = {
    id: 'r1',
    ownerUid: 'tal',
    visibility: 'private',
    sharedKitchenIds: ['schreiber']
  };
  assert.equal(Core.canViewRecipe(recipe, { uid: 'tal' }), true);
  assert.equal(
    Core.canViewRecipe(recipe, { uid: 'einav', kitchenRoles: { schreiber: 'member' } }),
    true
  );
  assert.equal(Core.canViewRecipe(recipe, { uid: 'stranger', kitchenRoles: {} }), false);
});

test('owners and shared-kitchen admins can edit while members cannot', () => {
  const recipe = {
    id: 'r1',
    ownerUid: 'tal',
    visibility: 'private',
    sharedKitchenIds: ['schreiber']
  };
  assert.equal(Core.canEditRecipe(recipe, { uid: 'tal' }), true);
  assert.equal(
    Core.canEditRecipe(recipe, { uid: 'einav', kitchenRoles: { schreiber: 'admin' } }),
    true
  );
  assert.equal(
    Core.canEditRecipe(recipe, { uid: 'member', kitchenRoles: { schreiber: 'member' } }),
    false
  );
});

test('favorites behave as a private system filter', () => {
  const recipe = { id: 'r1', ownerUid: 'tal' };
  assert.equal(
    Core.recipeMatchesLibrary(recipe, {
      scope: 'favorites',
      favoriteIds: new Set(['r1'])
    }),
    true
  );
  assert.equal(
    Core.recipeMatchesLibrary(recipe, {
      scope: 'favorites',
      favoriteIds: new Set()
    }),
    false
  );
});

test('share policies resolve exact recipe, category, tag, and all scopes', () => {
  const recipes = [
    { id: 'a', ownerUid: 'tal', category: 'soups', tags: ['quick'] },
    { id: 'b', ownerUid: 'tal', category: 'salads', tags: ['healthy'] },
    { id: 'c', ownerUid: 'einav', category: 'soups', tags: ['quick'] }
  ];
  assert.deepEqual(
    Core.resolvePolicyRecipeIds(
      { ownerUid: 'tal', scopeType: 'recipe', scopeValue: 'a', includeFuture: true },
      recipes
    ),
    ['a']
  );
  assert.deepEqual(
    Core.resolvePolicyRecipeIds(
      { ownerUid: 'tal', scopeType: 'category', scopeValue: 'soups', includeFuture: true },
      recipes
    ),
    ['a']
  );
  assert.deepEqual(
    Core.resolvePolicyRecipeIds(
      { ownerUid: 'tal', scopeType: 'tag', scopeValue: 'healthy', includeFuture: true },
      recipes
    ),
    ['b']
  );
  assert.deepEqual(
    Core.resolvePolicyRecipeIds(
      { ownerUid: 'tal', scopeType: 'all', includeFuture: true },
      recipes
    ),
    ['a', 'b']
  );
});

test('copies become private user-owned recipes and retain provenance', () => {
  const source = {
    id: 'source',
    ownerUid: 'tal',
    name: 'Soup',
    tags: ['quick'],
    author: { username: 'tal' },
    sharedKitchenIds: ['schreiber'],
    visibility: 'public'
  };
  const copy = Core.createRecipeCopy(
    source,
    { uid: 'einav', username: 'einav', firstName: 'עינב', email: 'e@example.com' },
    '2026-07-25T12:00:00.000Z'
  );
  assert.equal(copy.ownerUid, 'einav');
  assert.equal(copy.visibility, 'private');
  assert.deepEqual(copy.sharedKitchenIds, []);
  assert.deepEqual(copy.tags, ['quick']);
  assert.equal(copy.provenance.sourceRecipeId, 'source');
  assert.equal(copy.provenance.sourceUsername, 'tal');
});

test('legacy migration preserves every original tag exactly', () => {
  const recipe = { id: 'r1', name: 'Cake', tags: ['tal', 'quick', 'healthy'] };
  const result = Core.buildLegacyMigration(
    recipe,
    { tal: { uid: 'tal-uid', username: 'tal', firstName: 'טל' } },
    'schreiber'
  );
  assert.equal(result.audit.status, 'ready');
  assert.deepEqual(result.patch.tags, recipe.tags);
  assert.equal(result.patch.ownerUid, 'tal-uid');
  assert.deepEqual(result.patch.sharedKitchenIds, ['schreiber']);
});

test('legacy migration refuses recipes with missing or conflicting uploader tags', () => {
  assert.equal(Core.auditLegacyRecipe({ id: 'a', tags: [] }).status, 'missing-uploader');
  assert.equal(
    Core.auditLegacyRecipe({ id: 'b', tags: ['tal', 'einav'] }).status,
    'conflicting-uploader'
  );
});
