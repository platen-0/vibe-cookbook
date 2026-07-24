(function(global) {
  'use strict';

  const MAX_RECIPES = 12;

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
        : (recipeIds[0] || null)
    };
  }

  function addRecipe(workspace, recipeId) {
    const normalized = normalizeWorkspace(workspace);
    if (typeof recipeId !== 'string' || !recipeId.trim()) return normalized;
    if (normalized.recipeIds.includes(recipeId)) {
      return { ...normalized, activeRecipeId: recipeId };
    }
    if (normalized.recipeIds.length >= MAX_RECIPES) return normalized;

    return {
      recipeIds: [...normalized.recipeIds, recipeId],
      activeRecipeId: normalized.activeRecipeId || recipeId
    };
  }

  function removeRecipe(workspace, recipeId) {
    const normalized = normalizeWorkspace(workspace);
    const removedIndex = normalized.recipeIds.indexOf(recipeId);
    const recipeIds = normalized.recipeIds.filter(id => id !== recipeId);

    if (normalized.activeRecipeId !== recipeId) {
      return { recipeIds, activeRecipeId: normalized.activeRecipeId };
    }

    const fallbackIndex = Math.min(Math.max(removedIndex, 0), recipeIds.length - 1);
    return {
      recipeIds,
      activeRecipeId: recipeIds[fallbackIndex] || null
    };
  }

  function selectRecipe(workspace, recipeId) {
    const normalized = normalizeWorkspace(workspace);
    if (!normalized.recipeIds.includes(recipeId)) return normalized;
    return { ...normalized, activeRecipeId: recipeId };
  }

  global.CookingWorkspaceCore = Object.freeze({
    MAX_RECIPES,
    normalizeWorkspace,
    addRecipe,
    removeRecipe,
    selectRecipe
  });
})(globalThis);
