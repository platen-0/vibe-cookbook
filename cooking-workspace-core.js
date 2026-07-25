(function(global) {
  'use strict';

  const MAX_RECIPES = 12;
  const VALID_VIEWS = new Set(['recipes', 'ingredients', 'timeline']);

  function uniqueRecipeIds(recipeIds) {
    if (!Array.isArray(recipeIds)) return [];

    return [...new Set(
      recipeIds.filter(id => typeof id === 'string' && id.trim())
    )].slice(0, MAX_RECIPES);
  }

  function normalizeWorkspace(workspace = {}, availableRecipeIds = null) {
    let recipeIds = uniqueRecipeIds(workspace.recipeIds);

    if (availableRecipeIds) {
      const available = new Set(availableRecipeIds);
      recipeIds = recipeIds.filter(id => available.has(id));
    }

    const requestedActiveId = typeof workspace.activeRecipeId === 'string'
      ? workspace.activeRecipeId
      : null;

    return {
      recipeIds,
      activeRecipeId: recipeIds.includes(requestedActiveId)
        ? requestedActiveId
        : (recipeIds[0] || null),
      view: VALID_VIEWS.has(workspace.view) ? workspace.view : 'recipes',
      checkedIngredientIds: uniqueChecklistIds(workspace.checkedIngredientIds),
      checkedStepIds: uniqueChecklistIds(workspace.checkedStepIds),
      planCacheKey: typeof workspace.planCacheKey === 'string'
        ? workspace.planCacheKey.slice(0, 256)
        : null
    };
  }

  function uniqueChecklistIds(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(
      values.filter(value => typeof value === 'string' && value.trim())
    )].slice(0, 500);
  }

  function addRecipe(workspace, recipeId) {
    const normalized = normalizeWorkspace(workspace);
    if (typeof recipeId !== 'string' || !recipeId.trim()) return normalized;
    if (normalized.recipeIds.includes(recipeId)) {
      return { ...normalized, activeRecipeId: recipeId };
    }
    if (normalized.recipeIds.length >= MAX_RECIPES) return normalized;

    return {
      ...normalized,
      recipeIds: [...normalized.recipeIds, recipeId],
      activeRecipeId: normalized.activeRecipeId || recipeId
    };
  }

  function removeRecipe(workspace, recipeId) {
    const normalized = normalizeWorkspace(workspace);
    const removedIndex = normalized.recipeIds.indexOf(recipeId);
    const recipeIds = normalized.recipeIds.filter(id => id !== recipeId);

    if (normalized.activeRecipeId !== recipeId) {
      return { ...normalized, recipeIds, activeRecipeId: normalized.activeRecipeId };
    }

    const fallbackIndex = Math.min(Math.max(removedIndex, 0), recipeIds.length - 1);
    return {
      ...normalized,
      recipeIds,
      activeRecipeId: recipeIds[fallbackIndex] || null
    };
  }

  function selectRecipe(workspace, recipeId) {
    const normalized = normalizeWorkspace(workspace);
    if (!normalized.recipeIds.includes(recipeId)) return normalized;
    return { ...normalized, activeRecipeId: recipeId };
  }

  function selectView(workspace, view) {
    const normalized = normalizeWorkspace(workspace);
    if (!VALID_VIEWS.has(view)) return normalized;
    return { ...normalized, view };
  }

  function toggleChecklistItem(workspace, kind, itemId) {
    const normalized = normalizeWorkspace(workspace);
    const field = kind === 'step' ? 'checkedStepIds' : 'checkedIngredientIds';
    if (typeof itemId !== 'string' || !itemId.trim()) return normalized;
    const current = new Set(normalized[field]);
    if (current.has(itemId)) current.delete(itemId);
    else current.add(itemId);
    return { ...normalized, [field]: [...current].slice(0, 500) };
  }

  global.CookingWorkspaceCore = Object.freeze({
    MAX_RECIPES,
    normalizeWorkspace,
    addRecipe,
    removeRecipe,
    selectRecipe,
    selectView,
    toggleChecklistItem
  });
})(globalThis);
