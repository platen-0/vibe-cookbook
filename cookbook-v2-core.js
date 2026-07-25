(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CookbookV2Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const PROFILE_VERSION = 1;
  const RECIPE_SCHEMA_VERSION = 2;
  const USERNAME_MIN_LENGTH = 3;
  const USERNAME_MAX_LENGTH = 24;
  const USERNAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?$/u;
  const VALID_VISIBILITIES = new Set(['private', 'public']);
  const VALID_KITCHEN_ROLES = new Set(['owner', 'admin', 'member']);
  const VALID_LIBRARY_SCOPES = new Set(['all', 'mine', 'shared', 'favorites', 'kitchen']);
  const VALID_SHARE_SCOPES = new Set(['recipe', 'category', 'tag', 'all']);

  function normalizeText(value) {
    return String(value || '').normalize('NFKC').trim();
  }

  function normalizeUsername(value) {
    return normalizeText(value).replace(/^@+/, '').toLocaleLowerCase('en-US');
  }

  function validateUsername(value) {
    const username = normalizeUsername(value);
    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
      return {
        valid: false,
        username,
        error: `שם המשתמש צריך להכיל ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} תווים`
      };
    }
    if (!USERNAME_PATTERN.test(username)) {
      return {
        valid: false,
        username,
        error: 'אפשר להשתמש באותיות, מספרים, נקודה, מקף או קו תחתון'
      };
    }
    return { valid: true, username, error: '' };
  }

  function normalizeFirstName(value) {
    return normalizeText(value).replace(/\s+/g, ' ');
  }

  function validateProfile(input = {}) {
    const usernameResult = validateUsername(input.username);
    const firstName = normalizeFirstName(input.firstName);
    const errors = {};
    if (!usernameResult.valid) errors.username = usernameResult.error;
    if (!firstName || firstName.length > 30) {
      errors.firstName = firstName
        ? 'השם יכול להכיל עד 30 תווים'
        : 'צריך להוסיף שם פרטי';
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value: {
        username: usernameResult.username,
        usernameNormalized: usernameResult.username,
        firstName,
        profileVersion: PROFILE_VERSION,
        onboardingComplete: Object.keys(errors).length === 0
      }
    };
  }

  function personalKitchenId(uid) {
    return `personal_${String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  function normalizeStringList(value) {
    return [...new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String))];
  }

  function normalizeRecipe(recipe = {}) {
    const visibility = VALID_VISIBILITIES.has(recipe.visibility)
      ? recipe.visibility
      : (recipe.ownerUid ? 'private' : 'public');
    return {
      ...recipe,
      schemaVersion: Number(recipe.schemaVersion) || (recipe.ownerUid ? RECIPE_SCHEMA_VERSION : 1),
      visibility,
      sharedKitchenIds: normalizeStringList(recipe.sharedKitchenIds),
      tags: Array.isArray(recipe.tags) ? [...recipe.tags] : recipe.tags,
      provenance: recipe.provenance || null
    };
  }

  function getRole(kitchenRoles, kitchenId) {
    const role = kitchenRoles && kitchenRoles[kitchenId];
    return VALID_KITCHEN_ROLES.has(role) ? role : null;
  }

  function canViewRecipe(recipeInput, viewer = {}) {
    const recipe = normalizeRecipe(recipeInput);
    if (!recipe.ownerUid) return true;
    if (recipe.visibility === 'public') return true;
    if (!viewer.uid) return false;
    if (recipe.ownerUid === viewer.uid) return true;
    if (viewer.recipeAccessIds && viewer.recipeAccessIds.has(recipe.id)) return true;
    return recipe.sharedKitchenIds.some(kitchenId => Boolean(getRole(viewer.kitchenRoles, kitchenId)));
  }

  function canEditRecipe(recipeInput, viewer = {}) {
    const recipe = normalizeRecipe(recipeInput);
    if (!recipe.ownerUid) return Boolean(viewer.isLegacyEditor);
    if (!viewer.uid) return false;
    if (recipe.ownerUid === viewer.uid) return true;
    return recipe.sharedKitchenIds.some(kitchenId => {
      const role = getRole(viewer.kitchenRoles, kitchenId);
      return role === 'owner' || role === 'admin';
    });
  }

  function canCopyRecipe(recipeInput, viewer = {}) {
    const recipe = normalizeRecipe(recipeInput);
    if (!canViewRecipe(recipe, viewer) || !viewer.uid) return false;
    if (recipe.ownerUid === viewer.uid) return true;
    const directAccess = viewer.recipeAccess?.get?.(recipe.id);
    if (directAccess && directAccess.allowCopy === false) return false;
    if (recipe.sharePermissions?.allowCopy === false) return false;
    return true;
  }

  function recipeMatchesLibrary(recipeInput, options = {}) {
    const recipe = normalizeRecipe(recipeInput);
    const scope = VALID_LIBRARY_SCOPES.has(options.scope) ? options.scope : 'all';
    const uid = options.uid || null;
    const favoriteIds = options.favoriteIds || new Set();
    const legacyOwnerTag = options.legacyOwnerTag || null;
    const isLegacyOwnedByViewer = Boolean(
      !recipe.ownerUid &&
      legacyOwnerTag &&
      recipe.tags.includes(legacyOwnerTag)
    );

    if (scope === 'favorites') return favoriteIds.has(recipe.id);
    if (scope === 'mine') {
      return Boolean(uid && (recipe.ownerUid === uid || isLegacyOwnedByViewer));
    }
    if (scope === 'shared') {
      return Boolean(
        uid &&
        (
          (!recipe.ownerUid && legacyOwnerTag && !isLegacyOwnedByViewer) ||
          (recipe.ownerUid && recipe.ownerUid !== uid)
        ) &&
        (
          !recipe.ownerUid ||
          options.recipeAccessIds?.has(recipe.id) ||
          recipe.sharedKitchenIds.some(id => Boolean(getRole(options.kitchenRoles, id)))
        )
      );
    }
    if (scope === 'kitchen') return recipe.sharedKitchenIds.includes(options.kitchenId);
    return true;
  }

  function matchesSharePolicy(recipeInput, policy = {}) {
    const recipe = normalizeRecipe(recipeInput);
    if (!VALID_SHARE_SCOPES.has(policy.scopeType)) return false;
    if (policy.ownerUid && recipe.ownerUid !== policy.ownerUid) return false;
    if (policy.scopeType === 'all') return true;
    if (policy.scopeType === 'recipe') return recipe.id === policy.scopeValue;
    if (policy.scopeType === 'category') {
      return recipe.category === policy.scopeValue || recipe.mainCategory === policy.scopeValue;
    }
    if (policy.scopeType === 'tag') return (recipe.tags || []).includes(policy.scopeValue);
    return false;
  }

  function resolvePolicyRecipeIds(policy, recipes, createdAt = new Date().toISOString()) {
    return (recipes || [])
      .filter(recipe => matchesSharePolicy(recipe, policy))
      .filter(recipe => {
        if (policy.includeFuture) return true;
        const recipeCreatedAt = recipe.createdAt || recipe.date || '';
        return !recipeCreatedAt || recipeCreatedAt <= (policy.createdAt || createdAt);
      })
      .map(recipe => recipe.id);
  }

  function createRecipeCopy(sourceInput, owner, now = new Date().toISOString()) {
    const source = normalizeRecipe(sourceInput);
    const sourceUsername =
      source.author?.username ||
      source.provenance?.sourceUsername ||
      source.addedBy ||
      'משתמש';
    const copy = {
      ...source,
      id: undefined,
      ownerUid: owner.uid,
      homeKitchenId: owner.personalKitchenId || personalKitchenId(owner.uid),
      sharedKitchenIds: [],
      visibility: 'private',
      author: {
        uid: owner.uid,
        username: owner.username,
        firstName: owner.firstName
      },
      addedBy: owner.email || null,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      provenance: {
        kind: 'copy',
        sourceRecipeId: source.id,
        rootRecipeId: source.provenance?.rootRecipeId || source.id,
        sourceOwnerUid: source.ownerUid || null,
        sourceUsername,
        copiedAt: now
      }
    };
    delete copy._firestore;
    return copy;
  }

  function auditLegacyRecipe(recipe = {}) {
    const tags = new Set(recipe.tags || []);
    const uploaderTags = ['tal', 'einav'].filter(tag => tags.has(tag));
    let status = 'ready';
    let ownerKey = uploaderTags[0] || null;
    if (uploaderTags.length === 0) status = 'missing-uploader';
    if (uploaderTags.length > 1) {
      status = 'conflicting-uploader';
      ownerKey = null;
    }
    return {
      id: recipe.id,
      name: recipe.name || '',
      status,
      ownerKey,
      uploaderTags,
      originalTags: Array.isArray(recipe.tags) ? [...recipe.tags] : [],
      hasOwnerUid: Boolean(recipe.ownerUid)
    };
  }

  function buildLegacyMigration(recipeInput, owners, schreiberKitchenId) {
    const recipe = normalizeRecipe(recipeInput);
    const audit = auditLegacyRecipe(recipe);
    if (audit.status !== 'ready') return { audit, patch: null };
    const owner = owners && owners[audit.ownerKey];
    if (!owner?.uid || !owner?.username || !owner?.firstName) {
      return { audit: { ...audit, status: 'missing-owner-mapping' }, patch: null };
    }
    return {
      audit,
      patch: {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        ownerUid: owner.uid,
        homeKitchenId: personalKitchenId(owner.uid),
        sharedKitchenIds: schreiberKitchenId ? [schreiberKitchenId] : [],
        visibility: 'public',
        author: {
          uid: owner.uid,
          username: owner.username,
          firstName: owner.firstName
        },
        legacyUploaderTag: audit.ownerKey,
        tags: [...audit.originalTags]
      }
    };
  }

  return Object.freeze({
    PROFILE_VERSION,
    RECIPE_SCHEMA_VERSION,
    USERNAME_MIN_LENGTH,
    USERNAME_MAX_LENGTH,
    normalizeUsername,
    validateUsername,
    normalizeFirstName,
    validateProfile,
    personalKitchenId,
    normalizeRecipe,
    canViewRecipe,
    canEditRecipe,
    canCopyRecipe,
    recipeMatchesLibrary,
    matchesSharePolicy,
    resolvePolicyRecipeIds,
    createRecipeCopy,
    auditLegacyRecipe,
    buildLegacyMigration
  });
});
