// Tal's Cookbook App with Firebase
(function() {
  'use strict';

  // Firebase Configuration
  const firebaseConfig = {
    apiKey: "AIzaSyDawvg5dJ7FR6Qj5x4IuVSdcHtEP_QLPwE",
    authDomain: "vibe-cookbook.firebaseapp.com",
    projectId: "vibe-cookbook",
    storageBucket: "vibe-cookbook.firebasestorage.app",
    messagingSenderId: "181961247796",
    appId: "1:181961247796:web:55566cec73fc89fb654e61"
  };

  // Initialize Firebase
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  // Fix for Safari/iOS PWA timeout issue
  // See: https://github.com/firebase/firebase-js-sdk/issues/8017
  // useFetchStreams: false falls back to XMLHttpRequest instead of fetch streams
  // experimentalForceLongPolling: true avoids WebChannel issues on iOS
  db.settings({
    experimentalForceLongPolling: true,
    useFetchStreams: false
  });

  // Skip persistence entirely - it causes issues in private browsing
  // and we want fresh data from Firestore anyway
  // Firestore will still work, just without offline caching

  // Storage removed - requires paid Firebase plan
  const auth = firebase.auth();
  const IMPORTER_URL = (
    window.COOKBOOK_CONFIG?.importerUrl ||
    (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? 'http://localhost:8787' : '')
  ).replace(/\/$/, '');

  // Allowed email addresses that can edit recipes
  const ALLOWED_EDITORS = [
    'taladani@gmail.com',
    'eliavschreiber@gmail.com',
    'dschreiber@gmail.com',
    'gidonschreiber@gmail.com',
    'egorlin@gmail.com'
  ];

  // Auth state
  let currentUser = null;
  let canEdit = false;

  // State
  let recipes = [];
  let categories = [];
  let currentMainCategory = 'all';
  let currentSubCategory = 'all';
  let currentTags = [];
  let searchQuery = '';
  let currentRecipeId = null;
  let currentFormTab = 'link';
  let isInitialized = false;
  let isOfflineMode = false; // True when using fallback data (recipes.json)
  let importDraft = null;
  let importScreenshots = [];
  let importSelectedTags = [];
  let importTagsTouched = false;
  let selectedRecipeImage = null;
  let editingRecipeImage = null;

  // Main category hierarchy
  const MAIN_CATEGORIES = [
    { id: 'breakfast', name: 'ארוחת בוקר', icon: '🌅' },
    { id: 'lunch-dinner', name: 'צהריים וערב', icon: '🍽️' },
    { id: 'dessert', name: 'קינוח', icon: '🍰' },
    { id: 'snacks', name: 'חטיפים ונשנושים', icon: '🥨' },
    { id: 'baby', name: 'אוכל לתינוקות', icon: '👶' }
  ];

  // Sub-categories mapped to main categories
  const SUB_CATEGORIES = {
    'breakfast': [
      { id: 'pancakes', name: 'פנקייקים ווופלים', icon: '🥞' },
      { id: 'granola', name: 'גרנולה ודגנים', icon: '🥣' },
      { id: 'eggs', name: 'ביצים ואומלטים', icon: '🍳' },
      { id: 'yeast-breakfast', name: 'מאפים מתוקים', icon: '🥐' }
    ],
    'lunch-dinner': [
      { id: 'main', name: 'מנות עיקריות', icon: '🍲' },
      { id: 'soups', name: 'מרקים', icon: '🥣' },
      { id: 'salads', name: 'סלטים ותוספות', icon: '🥗' },
      { id: 'savory', name: 'מאפים מלוחים', icon: '🥧' },
      { id: 'pasta', name: 'פסטות', icon: '🍝' },
      { id: 'spreads', name: 'ממרחים ורטבים', icon: '🫙' }
    ],
    'dessert': [
      { id: 'desserts', name: 'עוגות וקינוחים', icon: '🎂' },
      { id: 'cookies', name: 'עוגיות', icon: '🍪' },
      { id: 'yeast', name: 'מאפי שמרים', icon: '🥐' },
      { id: 'muffins', name: 'מאפינס', icon: '🧁' }
    ],
    'snacks': [
      { id: 'sweet-snacks', name: 'חטיפים מתוקים', icon: '🍫' },
      { id: 'savory-snacks', name: 'חטיפים מלוחים', icon: '🥨' }
    ],
    'baby': [
      { id: 'baby-meals', name: 'ארוחות לתינוקות', icon: '🍼' },
      { id: 'baby-snacks', name: 'חטיפים לתינוקות', icon: '🍌' }
    ]
  };

  // Legacy categories mapping to new structure
  const LEGACY_CATEGORY_MAP = {
    'desserts': { main: 'dessert', sub: 'desserts' },
    'cookies': { main: 'dessert', sub: 'cookies' },
    'main': { main: 'lunch-dinner', sub: 'main' },
    'baby': { main: 'baby', sub: 'baby-meals' },
    'breakfast': { main: 'breakfast', sub: 'pancakes' },
    'yeast': { main: 'dessert', sub: 'yeast' },
    'soups': { main: 'lunch-dinner', sub: 'soups' },
    'salads': { main: 'lunch-dinner', sub: 'salads' },
    'muffins': { main: 'dessert', sub: 'muffins' },
    'savory': { main: 'lunch-dinner', sub: 'savory' },
    'spreads': { main: 'lunch-dinner', sub: 'spreads' }
  };

  // All sub-categories flattened for backward compatibility
  const CATEGORIES = Object.values(SUB_CATEGORIES).flat();

  // Tags definition
  const AVAILABLE_TAGS = [
    { id: 'tal', name: 'Tal', icon: '👩‍🍳', color: '#e91e63', alwaysShow: true },
    { id: 'einav', name: 'Einav', icon: '👩‍🍳', color: '#2196f3', alwaysShow: true },
    { id: 'vegetarian', name: 'צמחוני', icon: '🥬', color: '#22c55e' },
    { id: 'vegan', name: 'טבעוני', icon: '🌱', color: '#16a34a' },
    { id: 'gluten-free', name: 'ללא גלוטן', icon: '🌾', color: '#eab308' },
    { id: 'dairy-free', name: 'ללא חלב', icon: '🥛', color: '#06b6d4' },
    { id: 'parve', name: 'פרווה', icon: '✡️', color: '#8b5cf6' },
    { id: 'quick', name: 'מהיר', icon: '⚡', color: '#f97316' },
    { id: 'kid-friendly', name: 'לילדים', icon: '👶', color: '#ec4899' },
    { id: 'healthy', name: 'בריא', icon: '💚', color: '#10b981' },
    { id: 'comfort-food', name: 'אוכל נוחות', icon: '🏠', color: '#f59e0b' },
    { id: 'special-occasion', name: 'לאירועים', icon: '🎉', color: '#a855f7' }
  ];

  // Email to tag mapping for auto-tagging
  const EMAIL_TO_TAG = {
    'taladani@gmail.com': 'tal',
    'egorlin@gmail.com': 'einav'
  };

  // DOM Elements
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search');
  const categoriesNav = document.getElementById('categories-nav');
  const recipesContainer = document.getElementById('recipes-container');
  const recipeCount = document.getElementById('recipe-count');
  const modal = document.getElementById('recipe-modal');
  const modalBody = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');
  const modalDelete = document.getElementById('modal-delete');
  const addModal = document.getElementById('add-modal');
  const addModalClose = document.getElementById('add-modal-close');
  const addRecipeBtn = document.getElementById('add-recipe-btn');
  const addRecipeForm = document.getElementById('add-recipe-form');
  const cancelAddBtn = document.getElementById('cancel-add');
  const deleteModal = document.getElementById('delete-modal');
  const cancelDeleteBtn = document.getElementById('cancel-delete');
  const confirmDeleteBtn = document.getElementById('confirm-delete');
  const transcriptionModal = document.getElementById('transcription-modal');
  const transcriptionModalClose = document.getElementById('transcription-modal-close');
  const cancelTranscriptionBtn = document.getElementById('cancel-transcription');
  const saveTranscriptionBtn = document.getElementById('save-transcription');
  const transcriptionText = document.getElementById('transcription-text');
  const settingsModal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModalClose = document.getElementById('settings-modal-close');
  const cancelSettingsBtn = document.getElementById('cancel-settings');
  const saveSettingsBtn = document.getElementById('save-settings');
  const analyzeRecipeBtn = document.getElementById('analyze-recipe');
  const socialImportHelper = document.getElementById('social-import-helper');
  const socialScreenshotsInput = document.getElementById('social-screenshots');
  const screenshotPreviews = document.getElementById('screenshot-previews');
  const importProgress = document.getElementById('import-progress');
  const importReview = document.getElementById('import-review');
  const importInlineNotice = document.getElementById('import-inline-notice');
  const imageCandidatesSection = document.getElementById('image-candidates-section');
  const imageCandidates = document.getElementById('image-candidates');
  const recipeImageInput = document.getElementById('recipe-image-upload');
  const selectedImagePreview = document.getElementById('selected-image-preview');
  const importTagsSelector = document.getElementById('import-tags-selector');
  const importServiceStatus = document.getElementById('import-service-status');
  const editImageModal = document.getElementById('edit-image-modal');
  const editImageModalClose = document.getElementById('edit-image-modal-close');
  const editRecipeImageInput = document.getElementById('edit-recipe-image-upload');
  const editImagePreview = document.getElementById('edit-image-preview');
  const saveEditImageBtn = document.getElementById('save-edit-image');
  const cancelEditImageBtn = document.getElementById('cancel-edit-image');
  const editTagsModal = document.getElementById('edit-tags-modal');
  const editTagsModalClose = document.getElementById('edit-tags-modal-close');
  const cancelEditTagsBtn = document.getElementById('cancel-edit-tags');
  const saveEditTagsBtn = document.getElementById('save-edit-tags');
  const tagsEditor = document.getElementById('tags-editor');
  const editCategoryModal = document.getElementById('edit-category-modal');
  const editCategoryModalClose = document.getElementById('edit-category-modal-close');
  const cancelEditCategoryBtn = document.getElementById('cancel-edit-category');
  const saveEditCategoryBtn = document.getElementById('save-edit-category');
  const editCategorySelect = document.getElementById('edit-category-select');
  const editRecipeNameInput = document.getElementById('edit-recipe-name');
  const manageCategoriesModal = document.getElementById('manage-categories-modal');
  const manageCategoriesModalClose = document.getElementById('manage-categories-modal-close');
  const closeManageCategoriesBtn = document.getElementById('close-manage-categories');
  const loading = document.getElementById('loading');
  const toastContainer = document.getElementById('toast-container');
  const authBtn = document.getElementById('auth-btn');
  const authModal = document.getElementById('auth-modal');
  const authModalClose = document.getElementById('auth-modal-close');
  const googleSigninBtn = document.getElementById('google-signin-btn');
  const signoutBtn = document.getElementById('signout-btn');

  // Track selected tags for the editor
  let editingRecipeTags = [];

  // Type icons and labels
  const typeInfo = {
    video: { icon: '🎬', label: 'סרטון' },
    link: { icon: '🔗', label: 'קישור' },
    text: { icon: '📝', label: 'מתכון' },
    photo: { icon: '📷', label: 'תמונה' }
  };

  // Auth functions
  function setupAuth() {
    // Listen for auth state changes
    auth.onAuthStateChanged((user) => {
      currentUser = user;
      canEdit = user && ALLOWED_EDITORS.includes(user.email);
      updateAuthUI();
      updateEditButtonsVisibility();
    });
  }

  function updateAuthUI() {
    const signedOutDiv = document.getElementById('auth-signed-out');
    const signedInDiv = document.getElementById('auth-signed-in');

    if (currentUser) {
      signedOutDiv.style.display = 'none';
      signedInDiv.style.display = 'block';

      document.getElementById('auth-user-photo').src = currentUser.photoURL || '';
      document.getElementById('auth-user-name').textContent = currentUser.displayName || 'משתמש';
      document.getElementById('auth-user-email').textContent = currentUser.email;

      const permissionStatus = document.getElementById('auth-permission-status');
      if (canEdit) {
        permissionStatus.className = 'auth-permission-status has-permission';
        permissionStatus.textContent = '✓ יש לך הרשאה לערוך מתכונים';
      } else {
        permissionStatus.className = 'auth-permission-status no-permission';
        permissionStatus.textContent = '⚠️ אין לך הרשאה לערוך מתכונים. פני למנהל המערכת.';
      }

      authBtn.classList.add('signed-in');
      authBtn.textContent = '✓';
    } else {
      signedOutDiv.style.display = 'block';
      signedInDiv.style.display = 'none';
      authBtn.classList.remove('signed-in');
      authBtn.textContent = '👤';
    }
  }

  function updateEditButtonsVisibility() {
    // Add recipe button
    const addBtn = document.getElementById('add-recipe-btn');
    if (addBtn) addBtn.classList.toggle('hidden', !canEdit);

    // Delete button in modal
    const deleteBtn = document.getElementById('modal-delete');
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !canEdit);

    // Categories settings section (only for editors)
    const categoriesSection = document.getElementById('categories-settings-section');
    if (categoriesSection) categoriesSection.classList.toggle('hidden', !canEdit);
  }

  async function signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
      closeAuthModal();
      showToast('התחברת בהצלחה!', 'success');
    } catch (error) {
      console.error('Sign in failed:', error);
      showToast('שגיאה בהתחברות', 'error');
    }
  }

  async function signOut() {
    try {
      await auth.signOut();
      closeAuthModal();
      showToast('התנתקת בהצלחה', 'success');
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  }

  function openAuthModal() {
    authModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeAuthModal() {
    authModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Initialize
  async function init() {
    showLoading(true);
    categories = CATEGORIES;

    // Setup theme first (before any UI renders)
    initTheme();
    setupThemeToggle();

    // Setup auth (non-blocking)
    setupAuth();

    // Setup UI immediately
    renderCategories();
    populateCategorySelect();
    setupEventListeners();
    renderImportTagSelector();

    // Try to load from localStorage cache first for instant display
    // Note: localStorage may not be available in private browsing mode
    let cached = null;
    let cacheAge = Infinity;

    try {
      cached = localStorage.getItem('recipes_cache');
      const cacheTime = localStorage.getItem('recipes_cache_time');
      cacheAge = cacheTime ? Date.now() - parseInt(cacheTime) : Infinity;
    } catch (e) {
      // localStorage not available (private browsing mode)
      console.log('localStorage not available:', e.message);
    }

    if (cached && cacheAge < 5 * 60 * 1000) { // Cache valid for 5 minutes
      try {
        recipes = JSON.parse(cached);
        if (recipes && recipes.length > 0) {
          renderTagFilters();
          renderRecipes();
          showLoading(false);

          // Refresh from Firestore in background
          loadRecipesFromFirestore().then(() => {
            renderTagFilters();
            renderRecipes();
          }).catch(error => {
            console.error('Background Firestore refresh failed:', error);
            // Show stale data warning since we're displaying cached data
            showStaleBanner();
          });

          isInitialized = true;
          return;
        }
      } catch (e) {
        console.error('Cache parse error:', e);
      }
    }

    // No valid cache, load from Firestore
    try {
      await loadRecipesFromFirestore();
      renderTagFilters();
      renderRecipes();
      isInitialized = true;
    } catch (error) {
      console.error('Failed to load from Firestore:', error);

      // Try expired cache as last resort (better than nothing)
      if (cached) {
        try {
          recipes = JSON.parse(cached);
          if (recipes && recipes.length > 0) {
            console.log('Using expired cache as fallback');
            showStaleBanner();
            renderTagFilters();
            renderRecipes();
            showLoading(false);
            isInitialized = true;
            return;
          }
        } catch (e) {}
      }

      // Try recipes.json as final fallback
      try {
        const response = await fetch('recipes.json');
        if (response.ok) {
          const data = await response.json();
          if (data.recipes && data.recipes.length > 0) {
            console.log('Using recipes.json as fallback');
            recipes = data.recipes;
            isOfflineMode = true;
            canEdit = false; // Disable editing in offline mode
            showOfflineBanner();
            renderTagFilters();
            renderRecipes();
            showLoading(false);
            isInitialized = true;
            return;
          }
        }
      } catch (e) {
        console.error('Failed to load recipes.json fallback:', e);
      }

      // No fallback available - show error
      recipesContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">😕</div>
          <p class="empty-state-text">לא הצלחנו לטעון את המתכונים. נסו לרענן את הדף.</p>
        </div>
      `;
    }

    showLoading(false);
  }

  // Load recipes from Firestore with caching
  async function loadRecipesFromFirestore() {
    // Diagnostic logging for Safari/iOS debugging
    const startTime = Date.now();
    console.log('[Firestore] Starting load...');
    console.log('[Firestore] Navigator:', navigator.userAgent);
    console.log('[Firestore] Online:', navigator.onLine);

    try {
      // Use a simple query without orderBy to avoid index requirements
      const snapshot = await db.collection('recipes').get();
      const elapsed = Date.now() - startTime;
      console.log(`[Firestore] Query completed in ${elapsed}ms`);

      if (snapshot.empty) {
        console.warn('[Firestore] Returned empty snapshot');
        throw new Error('No recipes in Firestore');
      }

      // Check if data came from cache or server
      const fromCache = snapshot.metadata.fromCache;
      console.log(`[Firestore] Data source: ${fromCache ? 'CACHE' : 'SERVER'}`);

      recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`[Firestore] Loaded ${recipes.length} recipes`);

      // Sort client-side (faster than waiting for Firestore index)
      recipes.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });

      // Cache for next load
      updateRecipesCache();
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[Firestore] Failed after ${elapsed}ms:`, error.code, error.message);
      console.error('[Firestore] Full error:', error);
      throw error;
    }
  }

  // Update localStorage cache after any mutation
  function updateRecipesCache() {
    try {
      localStorage.setItem('recipes_cache', JSON.stringify(recipes));
      localStorage.setItem('recipes_cache_time', Date.now().toString());
    } catch (e) {
      // localStorage might be full or unavailable, ignore
    }
  }

  // Show/hide loading
  function showLoading(show) {
    loading.classList.toggle('active', show);
    recipesContainer.style.display = show ? 'none' : 'grid';
  }

  // Show offline mode warning banner
  function showOfflineBanner() {
    // Remove existing banner if any
    const existingBanner = document.querySelector('.offline-banner');
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.innerHTML = `
      <div class="offline-banner-content">
        <span class="offline-banner-icon">⚠️</span>
        <div class="offline-banner-text">
          <strong>מצב לא מקוון</strong>
          <span>מציג נתונים ישנים. שינויים לא יישמרו ולא ישותפו.</span>
        </div>
        <button class="offline-banner-retry" onclick="location.reload()">נסה שוב</button>
      </div>
    `;

    // Insert after header
    const header = document.querySelector('.app-header');
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(banner, header.nextSibling);
    } else {
      document.querySelector('.app-container').prepend(banner);
    }
  }

  // Show stale data warning banner (when background refresh fails)
  function showStaleBanner() {
    // Remove existing banner if any
    const existingBanner = document.querySelector('.offline-banner');
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.innerHTML = `
      <div class="offline-banner-content">
        <span class="offline-banner-icon">⚠️</span>
        <div class="offline-banner-text">
          <strong>נתונים מהמטמון</strong>
          <span>לא הצלחנו להתחבר לשרת. ייתכן שהנתונים לא מעודכנים.</span>
        </div>
        <button class="offline-banner-retry" onclick="location.reload()">נסה שוב</button>
      </div>
    `;

    // Insert after header
    const header = document.querySelector('.app-header');
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(banner, header.nextSibling);
    } else {
      document.querySelector('.app-container').prepend(banner);
    }
  }

  // Show toast notification
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // Render main categories
  function renderCategories() {
    categoriesNav.innerHTML = `
      <button class="category-btn main-cat ${currentMainCategory === 'all' ? 'active' : ''}" data-main-category="all">
        <span class="category-icon">📚</span>
        <span class="category-name">הכל</span>
      </button>
    `;

    MAIN_CATEGORIES.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `category-btn main-cat ${currentMainCategory === cat.id ? 'active' : ''}`;
      btn.dataset.mainCategory = cat.id;
      btn.innerHTML = `
        <span class="category-icon">${cat.icon}</span>
        <span class="category-name">${cat.name}</span>
      `;
      categoriesNav.appendChild(btn);
    });

    renderSubCategories();
  }

  // Render sub-categories based on selected main category
  function renderSubCategories() {
    let subCatNav = document.getElementById('sub-categories-nav');

    if (currentMainCategory === 'all') {
      if (subCatNav) subCatNav.style.display = 'none';
      return;
    }

    if (!subCatNav) {
      subCatNav = document.createElement('nav');
      subCatNav.className = 'sub-categories-nav';
      subCatNav.id = 'sub-categories-nav';
      categoriesNav.after(subCatNav);
    }

    subCatNav.style.display = 'flex';
    subCatNav.innerHTML = `
      <button class="sub-category-btn ${currentSubCategory === 'all' ? 'active' : ''}" data-sub-category="all">
        הכל
      </button>
    `;

    const subCats = SUB_CATEGORIES[currentMainCategory] || [];
    subCats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `sub-category-btn ${currentSubCategory === cat.id ? 'active' : ''}`;
      btn.dataset.subCategory = cat.id;
      btn.innerHTML = `${cat.icon} ${cat.name}`;
      subCatNav.appendChild(btn);
    });
  }

  // Get main category for a recipe (handles legacy mapping)
  function getRecipeMainCategory(recipe) {
    const legacyMapping = LEGACY_CATEGORY_MAP[recipe.category];
    if (legacyMapping) return legacyMapping.main;
    return recipe.mainCategory || 'lunch-dinner';
  }

  // Get sub category for a recipe
  function getRecipeSubCategory(recipe) {
    const legacyMapping = LEGACY_CATEGORY_MAP[recipe.category];
    if (legacyMapping) return legacyMapping.sub;
    return recipe.category;
  }

  // Auto-tag recipes based on content
  function autoTagRecipe(recipe) {
    const tags = [];
    const name = (recipe.name || '').toLowerCase();
    const text = (recipe.content?.text || '').toLowerCase();
    const transcription = (recipe.content?.transcription || '').toLowerCase();
    const notes = (recipe.notes || '').toLowerCase();
    const combined = `${name} ${text} ${transcription} ${notes}`;

    // Vegetarian indicators
    const vegetarianKeywords = ['צמחוני', 'ירקות', 'גבינה', 'ביצה', 'חלבי', 'גבינות', 'טופו', 'פטריות'];
    const meatKeywords = ['עוף', 'בשר', 'פרגית', 'סלמון', 'דג', 'הודו', 'אסאדו', 'שניצל', 'קציצות בשר', 'בולונז'];

    const hasMeat = meatKeywords.some(k => combined.includes(k));
    const hasVegetarian = vegetarianKeywords.some(k => combined.includes(k));

    if (!hasMeat && hasVegetarian) tags.push('vegetarian');

    // Vegan indicators
    const veganKeywords = ['טבעוני', 'vegan', 'ללא מוצרי חלב', 'שמנת צמחית', 'חלב שקדים', 'חלב קוקוס'];
    if (veganKeywords.some(k => combined.includes(k))) tags.push('vegan');

    // Gluten-free
    const glutenFreeKeywords = ['ללא גלוטן', 'gluten free', 'gluten-free', 'שיבולת שועל ללא גלוטן'];
    if (glutenFreeKeywords.some(k => combined.includes(k))) tags.push('gluten-free');

    // Parve (dairy-free but not vegan)
    const parveKeywords = ['פרווה', 'parve', 'pareve'];
    if (parveKeywords.some(k => combined.includes(k))) tags.push('parve');

    // Kid-friendly (baby food category or mentions kids)
    if (recipe.mainCategory === 'baby' || recipe.category === 'baby' || recipe.category === 'baby-meals' || recipe.category === 'baby-snacks' || combined.includes('ילדים') || combined.includes('תינוק')) {
      tags.push('kid-friendly');
    }

    // Quick recipes
    const quickKeywords = ['מהיר', 'קל', '10 דקות', '15 דקות', 'פשוט'];
    if (quickKeywords.some(k => combined.includes(k))) tags.push('quick');

    // Healthy
    const healthyKeywords = ['בריא', 'קינואה', 'עדשים', 'סלט', 'ירקות', 'דל קלוריות'];
    if (healthyKeywords.some(k => combined.includes(k)) && !combined.includes('שוקולד')) {
      tags.push('healthy');
    }

    return tags;
  }

  // Render tag filter pills - show tags with recipes OR tags marked as alwaysShow
  function renderTagFilters() {
    const container = document.getElementById('tags-filter-pills');
    if (!container) return;

    // Count recipes per tag
    const tagCounts = {};
    AVAILABLE_TAGS.forEach(tag => tagCounts[tag.id] = 0);

    recipes.forEach(recipe => {
      const recipeTags = recipe.tags || autoTagRecipe(recipe);
      recipeTags.forEach(tagId => {
        if (tagCounts[tagId] !== undefined) {
          tagCounts[tagId]++;
        }
      });
    });

    // Show tags that have at least one recipe OR are marked as alwaysShow
    const tagsToShow = AVAILABLE_TAGS.filter(tag => tagCounts[tag.id] > 0 || tag.alwaysShow);

    container.innerHTML = tagsToShow.map(tag => `
      <button class="tag-filter-pill ${currentTags.includes(tag.id) ? 'active' : ''}"
              data-tag="${tag.id}"
              style="--tag-color: ${tag.color}">
        ${tag.icon} ${tag.name} <span class="tag-count">(${tagCounts[tag.id]})</span>
      </button>
    `).join('');
  }

  // Populate category select in form with hierarchical groups
  function populateCategorySelect() {
    const select = document.getElementById('recipe-category');
    let html = '';

    MAIN_CATEGORIES.forEach(mainCat => {
      const subCats = SUB_CATEGORIES[mainCat.id] || [];
      if (subCats.length > 0) {
        html += `<optgroup label="${mainCat.icon} ${mainCat.name}">`;
        subCats.forEach(subCat => {
          html += `<option value="${subCat.id}" data-main="${mainCat.id}">${subCat.icon} ${subCat.name}</option>`;
        });
        html += `</optgroup>`;
      }
    });

    select.innerHTML = html;
  }

  // Get filtered recipes
  function getFilteredRecipes() {
    return recipes.filter(recipe => {
      // Main category match
      let mainCatMatch = currentMainCategory === 'all';
      if (!mainCatMatch) {
        const recipeMainCat = getRecipeMainCategory(recipe);
        mainCatMatch = recipeMainCat === currentMainCategory;
      }

      // Sub category match
      let subCatMatch = currentSubCategory === 'all';
      if (!subCatMatch && mainCatMatch) {
        const recipeSubCat = getRecipeSubCategory(recipe);
        subCatMatch = recipeSubCat === currentSubCategory;
      }

      // Tag match
      let tagMatch = currentTags.length === 0;
      if (!tagMatch) {
        const recipeTags = recipe.tags || autoTagRecipe(recipe);
        tagMatch = currentTags.every(tag => recipeTags.includes(tag));
      }

      // Search match
      let searchMatch = true;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const nameMatch = recipe.name?.toLowerCase().includes(query);
        const notesMatch = recipe.notes?.toLowerCase().includes(query);
        const textMatch = recipe.content?.text?.toLowerCase().includes(query);
        const transcriptionMatch = recipe.content?.transcription?.toLowerCase().includes(query);
        searchMatch = nameMatch || notesMatch || textMatch || transcriptionMatch;
      }

      return mainCatMatch && subCatMatch && tagMatch && searchMatch;
    });
  }

  // Render recipes
  function renderRecipes() {
    const filtered = getFilteredRecipes();

    // Build category name for display
    let categoryName = '';
    if (currentMainCategory === 'all') {
      categoryName = 'הכל';
    } else {
      const mainCat = MAIN_CATEGORIES.find(c => c.id === currentMainCategory);
      categoryName = mainCat?.name || '';
      if (currentSubCategory !== 'all') {
        const subCat = (SUB_CATEGORIES[currentMainCategory] || []).find(c => c.id === currentSubCategory);
        if (subCat) categoryName = subCat.name;
      }
    }
    recipeCount.textContent = `${filtered.length} מתכונים ${categoryName ? 'ב' + categoryName : ''}`;

    if (filtered.length === 0) {
      recipesContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <p class="empty-state-text">לא נמצאו מתכונים</p>
        </div>
      `;
      return;
    }

    recipesContainer.innerHTML = filtered.map(recipe => {
      // Get main category and sub-category for display
      const mainCatId = getRecipeMainCategory(recipe);
      const subCatId = getRecipeSubCategory(recipe);
      const mainCat = MAIN_CATEGORIES.find(c => c.id === mainCatId);
      const subCat = CATEGORIES.find(c => c.id === subCatId) ||
                     CATEGORIES.find(c => c.id === recipe.category);

      const type = typeInfo[recipe.type] || typeInfo.link;
      const hasLocalImage = recipe.content?.images && recipe.content.images.length > 0;
      const hasUploadedImage = recipe.content?.uploadedImages && recipe.content.uploadedImages.length > 0;
      const localImageFile = hasLocalImage ? recipe.content.images[0] : null;
      const uploadedImageUrl = hasUploadedImage ? recipe.content.uploadedImages[0] : null;
      const isDocx = localImageFile && localImageFile.endsWith('.docx');

      // Get tags
      const recipeTags = recipe.tags || autoTagRecipe(recipe);
      const tagHtml = recipeTags.slice(0, 3).map(tagId => {
        const tag = AVAILABLE_TAGS.find(t => t.id === tagId);
        return tag ? `<span class="recipe-tag-pill" style="background: ${tag.color}20; color: ${tag.color};" title="${tag.name}">${tag.icon}</span>` : '';
      }).join('');

      // Build category display: "Main > Sub" format
      const categoryDisplay = mainCat && subCat
        ? `${mainCat.icon} ${mainCat.name} › ${subCat.name}`
        : (subCat ? `${subCat.icon} ${subCat.name}` : '');

      let imageHtml;
      if (uploadedImageUrl) {
        imageHtml = `<img src="${uploadedImageUrl}" alt="${recipe.name}" class="recipe-image" loading="lazy" onerror="this.classList.add('placeholder'); this.outerHTML='<div class=\\'recipe-image placeholder\\'>${mainCat?.icon || '🍽️'}</div>';">`;
      } else if (hasLocalImage && !isDocx) {
        imageHtml = `<img src="images/${localImageFile}" alt="${recipe.name}" class="recipe-image" loading="lazy" onerror="this.classList.add('placeholder'); this.outerHTML='<div class=\\'recipe-image placeholder\\'>${mainCat?.icon || '🍽️'}</div>';">`;
      } else {
        imageHtml = `<div class="recipe-image placeholder">${mainCat?.icon || subCat?.icon || '🍽️'}</div>`;
      }

      return `
        <article class="recipe-card" data-id="${recipe.id}">
          ${imageHtml}
          <div class="recipe-info">
            <h2 class="recipe-name">${recipe.name}</h2>
            <div class="recipe-meta">
              <span class="recipe-tag type-${recipe.type}">${type.icon} ${type.label}</span>
              <span class="recipe-tag category-hierarchy">${categoryDisplay}</span>
            </div>
            ${tagHtml ? `<div class="recipe-tags">${tagHtml}</div>` : ''}
          </div>
        </article>
      `;
    }).join('');
  }

  // Open recipe modal
  function openRecipe(id) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return;

    currentRecipeId = id;
    const category = categories.find(c => c.id === recipe.category);
    const date = formatDate(recipe.date);

    let contentHtml = '';

    // Uploaded Images (from Firebase Storage)
    if (recipe.content?.uploadedImages && recipe.content.uploadedImages.length > 0) {
      const images = recipe.content.uploadedImages;
      if (images.length === 1) {
        contentHtml += `<img src="${images[0]}" alt="${recipe.name}" class="modal-image">`;
      } else {
        contentHtml += `
          <div class="images-gallery">
            ${images.map(img => `<img src="${img}" alt="${recipe.name}">`).join('')}
          </div>
        `;
      }
    }

    // Local Images
    if (recipe.content?.images && recipe.content.images.length > 0) {
      const images = recipe.content.images.filter(img => !img.endsWith('.docx'));
      if (images.length === 1) {
        contentHtml += `<img src="images/${images[0]}" alt="${recipe.name}" class="modal-image">`;
      } else if (images.length > 1) {
        contentHtml += `
          <div class="images-gallery">
            ${images.map(img => `<img src="images/${img}" alt="${recipe.name}">`).join('')}
          </div>
        `;
      }
    }

    // Video embed or external link card
    if ((recipe.type === 'video' || recipe.type === 'link') && recipe.content?.url) {
      contentHtml += getVideoEmbed(recipe.content);
    }

    // Text content (unified: check both text and transcription fields for backward compatibility)
    const recipeText = recipe.content?.text || recipe.content?.transcription;
    if (recipeText) {
      contentHtml += `
        <div class="transcription-box" style="width: 100%; margin-bottom: 12px;">
          <h4>📝 טקסט המתכון</h4>
          <p>${escapeHtml(recipeText)}</p>
          ${canEdit ? `<button class="add-transcription-btn" data-action="edit-transcription" style="margin-top: 12px; background: #64748b;">
            ✏️ ערוך טקסט
          </button>` : ''}
        </div>
      `;
    }

    // Action buttons container (only show edit buttons if user can edit)
    contentHtml += `<div class="recipe-action-buttons">`;

    // Show add text buttons only if no text exists
    if (!recipeText) {
      // Show extract button for link-type recipes without text
      if (canEdit && recipe.type === 'link' && recipe.content?.url) {
        contentHtml += `
          <button class="extract-recipe-btn" data-action="extract-recipe">
            🔄 חלץ מתכון מהאתר
          </button>
        `;
      }
      if (canEdit) {
        contentHtml += `
          <button class="add-transcription-btn" data-action="add-transcription">
            📝 הוסף טקסט מתכון
          </button>
        `;
      }
    }

    // Edit tags button (only if can edit)
    if (canEdit) {
      contentHtml += `
        <button class="add-image-btn" data-action="edit-image">
          ▧ ${recipe.content?.uploadedImages?.length ? 'החלף תמונה' : 'הוסף תמונה'}
        </button>
        <button class="edit-tags-btn" data-action="edit-tags">
          🏷️ ערוך תגיות
        </button>
        <button class="edit-category-btn" data-action="edit-category">
          ✏️ ערוך פרטים
        </button>
      `;
    }

    contentHtml += `</div>`;

    // Display current tags
    const recipeTags = recipe.tags || autoTagRecipe(recipe);
    if (recipeTags.length > 0) {
      contentHtml += `
        <div class="recipe-tags-display">
          <span class="tags-label">תגיות:</span>
          ${recipeTags.map(tagId => {
            const tag = AVAILABLE_TAGS.find(t => t.id === tagId);
            return tag ? `<span class="tag-display-pill" style="background: ${tag.color}20; color: ${tag.color};">${tag.icon} ${tag.name}</span>` : '';
          }).join('')}
        </div>
      `;
    }

    // Notes
    if (recipe.notes) {
      contentHtml += `
        <div class="modal-notes">
          <div class="modal-notes-label">הערות:</div>
          <p>${escapeHtml(recipe.notes)}</p>
        </div>
      `;
    }

    // Link button - only show if not already shown in video embed / external card
    // For video types like instagram/youtube or external recipe sites, the button is already in the embed
    const url = recipe.content?.url;
    const isVideoEmbed = url && (url.includes('instagram.com') || url.includes('youtube.com') || url.includes('youtu.be'));
    const isExternalSite = url && !isVideoEmbed && !url.includes('facebook.com') && !url.includes('tiktok.com') && (recipe.type === 'video' || recipe.type === 'link');

    // Only show link button for video fallbacks (facebook, tiktok) or if no embed was shown
    if (recipe.content?.url && !isVideoEmbed && !isExternalSite) {
      contentHtml += `
        <a href="${recipe.content.url}" target="_blank" rel="noopener" class="open-link-btn">
          🔗 פתח קישור מקורי
        </a>
      `;
    }

    modalBody.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">${recipe.name}</h2>
        <p class="modal-date">${category?.icon || ''} ${category?.name || ''} • ${date}</p>
      </div>
      ${contentHtml}
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Known recipe websites with branding
  const KNOWN_RECIPE_SITES = {
    'oogio.net': { name: 'אוגיו', icon: '🍳', color: '#e74c3c' },
    'heninthekitchen.com': { name: 'תרנגולת במטבח', icon: '🐔', color: '#f39c12' },
    'lichtenstadt.com': { name: 'ליכטנשטט', icon: '👨‍🍳', color: '#9b59b6' },
    'carine.co.il': { name: 'קארין גורן', icon: '🧁', color: '#e91e63' },
    'bakery365.co.il': { name: 'בייקרי 365', icon: '🥐', color: '#795548' },
    'hashulchan.co.il': { name: 'השולחן', icon: '🍽️', color: '#2196f3' },
    'foodish.co.il': { name: 'פודיש', icon: '🥗', color: '#4caf50' },
    '10dakot.co.il': { name: '10 דקות', icon: '⏱️', color: '#ff5722' },
    'sweetmeat.co.il': { name: 'סוויט מיט', icon: '🍖', color: '#8d6e63' },
    'gilmoran.com': { name: 'גיל מורן', icon: '🎂', color: '#673ab7' },
    'thekitchn.com': { name: 'The Kitchn', icon: '🏠', color: '#00bcd4' },
    'seriouseats.com': { name: 'Serious Eats', icon: '🔬', color: '#f44336' },
    'bonappetit.com': { name: 'Bon Appétit', icon: '✨', color: '#ffeb3b' },
    'allrecipes.com': { name: 'Allrecipes', icon: '📖', color: '#ff9800' },
    'tasty.co': { name: 'Tasty', icon: '🎬', color: '#1abc9c' },
    'delish.com': { name: 'Delish', icon: '😋', color: '#e91e63' }
  };

  // Get domain from URL
  function getDomainFromUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  // Get recipe site info
  function getRecipeSiteInfo(url) {
    const domain = getDomainFromUrl(url);
    if (!domain) return null;

    // Check for exact match
    if (KNOWN_RECIPE_SITES[domain]) {
      return { ...KNOWN_RECIPE_SITES[domain], domain };
    }

    // Check for partial match (subdomains)
    for (const [siteDomain, info] of Object.entries(KNOWN_RECIPE_SITES)) {
      if (domain.includes(siteDomain)) {
        return { ...info, domain };
      }
    }

    return { domain, name: domain, icon: '🔗', color: '#6b7280' };
  }

  // Get video embed HTML
  function getVideoEmbed(content) {
    const url = content.url;

    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (ytMatch) {
      return `
        <div class="video-container horizontal">
          <iframe src="https://www.youtube.com/embed/${ytMatch[1]}"
                  allowfullscreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
          </iframe>
        </div>
      `;
    }

    // Instagram - show embed with fallback
    if (url.includes('instagram.com')) {
      const cleanUrl = url.split('?')[0];
      return `
        <div class="video-container">
          <iframe src="${cleanUrl}embed/"
                  allowfullscreen
                  scrolling="no"
                  allowtransparency="true">
          </iframe>
        </div>
        <a href="${url}" target="_blank" rel="noopener" class="open-link-btn">
          📱 פתח באינסטגרם
        </a>
      `;
    }

    // Facebook - fallback only (no embed)
    if (url.includes('facebook.com')) {
      return `
        <div class="video-fallback">
          <div class="video-fallback-icon">📺</div>
          <p>סרטון מפייסבוק</p>
          <a href="${url}" target="_blank" rel="noopener" class="open-link-btn">
            📱 פתח בפייסבוק
          </a>
        </div>
      `;
    }

    // TikTok - fallback
    if (url.includes('tiktok.com')) {
      return `
        <div class="video-fallback">
          <div class="video-fallback-icon">🎵</div>
          <p>סרטון מטיקטוק</p>
          <a href="${url}" target="_blank" rel="noopener" class="open-link-btn">
            📱 פתח בטיקטוק
          </a>
        </div>
      `;
    }

    // Check for known recipe websites
    const siteInfo = getRecipeSiteInfo(url);
    if (siteInfo && !siteInfo.domain.includes('instagram') && !siteInfo.domain.includes('youtube') && !siteInfo.domain.includes('facebook') && !siteInfo.domain.includes('tiktok')) {
      return `
        <div class="external-recipe-card" style="--site-color: ${siteInfo.color}">
          <div class="external-recipe-header">
            <span class="external-recipe-icon">${siteInfo.icon}</span>
            <div class="external-recipe-source">
              <span class="external-recipe-site-name">${siteInfo.name}</span>
              <span class="external-recipe-domain">${siteInfo.domain}</span>
            </div>
          </div>
          <div class="external-recipe-body">
            <p class="external-recipe-hint">
              💡 לחצי על הכפתור למטה כדי לצפות במתכון המלא באתר המקור.
              <br>
              <span class="hint-secondary">תוכלי להעתיק את המתכון ולהדביק אותו בשדה "העלאת טקסט ידנית" כדי שהוא יהיה זמין לחיפוש.</span>
            </p>
          </div>
          <a href="${url}" target="_blank" rel="noopener" class="external-recipe-btn">
            🔗 פתח מתכון באתר ${siteInfo.name}
          </a>
        </div>
      `;
    }

    // Generic fallback for videos
    return `
      <div class="video-fallback">
        <div class="video-fallback-icon">🎬</div>
        <p>סרטון</p>
        <a href="${url}" target="_blank" rel="noopener" class="open-link-btn">
          📱 פתח לצפייה
        </a>
      </div>
    `;
  }

  // Close modal
  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    currentRecipeId = null;
  }

  // Close add modal
  function closeAddModal() {
    addModal.classList.remove('active');
    document.body.style.overflow = '';
    addRecipeForm.reset();
    resetImportState();
  }

  // Open add recipe modal
  function openAddModal() {
    if (!canEdit) {
      showToast('אין לך הרשאה להוסיף מתכונים. התחבר עם חשבון מורשה.', 'error');
      openAuthModal();
      return;
    }
    resetImportState();
    addModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Delete recipe
  async function deleteRecipe(id) {
    if (!canEdit) {
      showToast('אין לך הרשאה למחוק מתכונים. התחבר עם חשבון מורשה.', 'error');
      return;
    }

    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return;

    document.getElementById('delete-recipe-name').textContent = recipe.name;
    deleteModal.classList.add('active');
  }

  async function confirmDelete() {
    if (!currentRecipeId) return;

    try {
      await db.collection('recipes').doc(currentRecipeId).delete();
      recipes = recipes.filter(r => r.id !== currentRecipeId);
      updateRecipesCache(); // Sync cache with Firestore
      renderRecipes();
      showToast('המתכון נמחק', 'success');
      closeModal();
      deleteModal.classList.remove('active');
    } catch (error) {
      console.error('Delete failed:', error);
      showToast('שגיאה במחיקת המתכון', 'error');
    }
  }

  // Add new recipe
  async function addRecipe(formData) {
    const submitBtn = document.getElementById('submit-add');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');

    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    submitBtn.disabled = true;

    try {
      const autoTags = Array.isArray(formData.tags)
        ? [...new Set(formData.tags)]
        : autoTagRecipe({
            name: formData.name,
            content: formData.content,
            notes: formData.notes
          });

      // Add user-specific tag based on who is adding the recipe
      if (currentUser && EMAIL_TO_TAG[currentUser.email]) {
        const userTag = EMAIL_TO_TAG[currentUser.email];
        if (!autoTags.includes(userTag)) {
          autoTags.unshift(userTag); // Add user tag at the beginning
        }
      }

      // Reserve the Firestore ID before uploading so the image path is stable.
      const docRef = db.collection('recipes').doc();
      if (formData.image) {
        const storedImage = await uploadRecipeImage(docRef.id, formData.image);
        formData.content.uploadedImages = [storedImage.url];
      }

      const newRecipe = {
        name: formData.name,
        category: formData.category,
        mainCategory: formData.mainCategory || null,
        type: formData.type,
        date: new Date().toISOString().split('T')[0],
        content: formData.content,
        notes: formData.notes || '',
        tags: autoTags,
        addedBy: currentUser?.email || null
      };

      await docRef.set(newRecipe);
      newRecipe.id = docRef.id;

      // Update local state
      recipes.unshift(newRecipe);
      updateRecipesCache(); // Sync cache with Firestore
      renderTagFilters();
      renderRecipes();

      showToast('המתכון נוסף בהצלחה!', 'success');
      closeAddModal();
    } catch (error) {
      console.error('Add recipe failed:', error);
      showToast('שגיאה בהוספת המתכון', 'error');
    }

    btnText.style.display = 'inline';
    btnLoading.style.display = 'none';
    submitBtn.disabled = false;
  }

  // Detect video type from URL
  function detectVideoType(url) {
    if (!url) return null;
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('facebook.com')) return 'facebook';
    if (url.includes('tiktok.com')) return 'tiktok';
    return null;
  }

  // Auto-categorize based on name
  function autoCategorize(name) {
    const text = name.toLowerCase();
    const keywords = {
      desserts: ['עוגה', 'עוגת', 'טארט', 'פאי', 'בראוניז', 'סופלה', 'פודינג', 'פודנט', 'קרמבו', 'מוס', 'פרלינה', 'אלפחורס'],
      cookies: ['עוגיות', 'עוגיה', 'ביסקוויט', 'כדורי', 'חיתוכיות'],
      main: ['עוף', 'פרגית', 'פרגיות', 'סלמון', 'דג', 'קציצות', 'אסאדו', 'בשר', 'שניצל', 'בולונז'],
      baby: ['תינוק', 'תינוקות', 'ילדים'],
      breakfast: ['פנקייק', 'גרנולה', 'ארוחת בוקר', 'חביתה', 'יוגורט'],
      yeast: ['שמרים', 'חלות', 'חלה', 'ג\'חנון', 'לחמניות', 'סינבון', 'בצק', 'פיצה', 'קובנה', 'רוגלך'],
      soups: ['מרק', 'מרקים'],
      salads: ['סלט', 'סלטים', 'אורז', 'פסטה', 'קוסקוס', 'קינואה', 'פתיתים', 'ירקות'],
      muffins: ['מאפינס', 'מאפין'],
      savory: ['קיש', 'לביבות', 'בורקס', 'פיתה', 'מקלות'],
      spreads: ['חמאת', 'ממרח', 'רוטב', 'טחינה']
    };

    for (const [category, words] of Object.entries(keywords)) {
      for (const word of words) {
        if (text.includes(word)) {
          return category;
        }
      }
    }

    return 'desserts'; // default
  }

  function resetImportState() {
    importDraft = null;
    importScreenshots = [];
    importTagsTouched = false;
    selectedRecipeImage = null;
    currentFormTab = 'link';

    const personTag = currentUser ? EMAIL_TO_TAG[currentUser.email] : null;
    importSelectedTags = personTag ? [personTag] : [];

    addModal.querySelectorAll('.form-tab').forEach(tab => {
      const isLink = tab.dataset.tab === 'link';
      tab.classList.toggle('active', isLink);
      tab.setAttribute('aria-selected', isLink ? 'true' : 'false');
    });
    addModal.querySelectorAll('.form-tab-content').forEach(content => {
      content.classList.toggle('active', content.dataset.tab === 'link');
    });

    importProgress.hidden = true;
    importReview.hidden = true;
    importInlineNotice.hidden = true;
    imageCandidatesSection.hidden = true;
    socialImportHelper.hidden = true;
    document.getElementById('category-suggestion').hidden = true;
    document.getElementById('recipe-text-link').value = '';
    screenshotPreviews.innerHTML = '';
    imageCandidates.innerHTML = '';
    socialScreenshotsInput.value = '';
    recipeImageInput.value = '';
    selectedImagePreview.hidden = true;
    document.getElementById('selected-image').removeAttribute('src');
    setImportStep(1);
    setAnalyzeLoading(false);
    renderImportTagSelector();
  }

  function renderImportTagSelector() {
    if (!importTagsSelector) return;
    importTagsSelector.innerHTML = AVAILABLE_TAGS.map(tag => `
      <button
        type="button"
        class="import-tag-option ${importSelectedTags.includes(tag.id) ? 'selected' : ''}"
        data-tag="${escapeHtml(tag.id)}"
        style="--tag-color: ${escapeHtml(tag.color)}"
        aria-pressed="${importSelectedTags.includes(tag.id)}"
      >
        <span aria-hidden="true">${tag.icon}</span>
        ${escapeHtml(tag.name)}
      </button>
    `).join('');
  }

  function updateSocialImportVisibility() {
    const url = document.getElementById('recipe-url').value.trim().toLowerCase();
    const isSocial =
      url.includes('instagram.com') ||
      url.includes('facebook.com') ||
      url.includes('fb.watch');
    socialImportHelper.hidden = !isSocial;
  }

  async function analyzeNewRecipe() {
    const url = document.getElementById('recipe-url').value.trim();
    const socialText = document.getElementById('social-recipe-text').value.trim();

    if (!url && !socialText && importScreenshots.length === 0) {
      showToast('הוסיפי קישור, טקסט או צילום מסך', 'error');
      return;
    }
    if (!currentUser || !canEdit) {
      showToast('יש להתחבר עם חשבון מורשה כדי לחלץ מתכון', 'error');
      openAuthModal();
      return;
    }
    if (!IMPORTER_URL) {
      showImportNotice('שירות הייבוא עדיין לא מחובר. אפשר להמשיך בהזנה ידנית.');
      showToast('שירות הייבוא עדיין לא הוגדר', 'error');
      return;
    }

    setAnalyzeLoading(true);
    setImportProgress('קורא את המקור…', 'מאתר טקסט ותמונות');
    importReview.hidden = true;
    importInlineNotice.hidden = true;

    try {
      const result = await callImporter('/extract', {
        url,
        socialText,
        screenshots: importScreenshots.map(item => item.dataUrl),
        categories: categories.map(category => ({
          id: category.id,
          name: category.name
        })),
        tags: AVAILABLE_TAGS.map(tag => ({
          id: tag.id,
          name: tag.name
        }))
      });

      if (!result.draft) {
        updateSocialImportVisibility();
        socialImportHelper.hidden = false;
        showImportNotice(result.warning || 'לא נמצא מספיק טקסט. אפשר להדביק אותו או לצרף צילום מסך.');
        return;
      }

      importDraft = result.draft;
      applyImportDraft(result);
      setImportStep(2);
      showToast('הטיוטה מוכנה לבדיקה', 'success');
    } catch (error) {
      console.error('Smart import failed:', error);
      showImportNotice(error.message || 'החילוץ לא הצליח. אפשר לנסות שוב או להזין ידנית.');
      showToast(error.message || 'שגיאה בחילוץ המתכון', 'error');
    } finally {
      setAnalyzeLoading(false);
      importProgress.hidden = true;
    }
  }

  function applyImportDraft(result) {
    const draft = result.draft;
    document.getElementById('recipe-name-link').value = draft.title || '';
    document.getElementById('recipe-text-link').value = draft.recipeText || '';
    document.getElementById('import-confidence').textContent =
      draft.confidence >= 0.8 ? 'ביטחון גבוה' : draft.confidence >= 0.55 ? 'כדאי לעבור על הפרטים' : 'נדרשת בדיקה';

    if (draft.suggestedCategoryId) {
      const categorySelect = document.getElementById('recipe-category');
      const option = [...categorySelect.options].find(item => item.value === draft.suggestedCategoryId);
      if (option) {
        categorySelect.value = draft.suggestedCategoryId;
        const suggestion = document.getElementById('category-suggestion');
        suggestion.textContent = `הצעה: ${option.textContent.trim()}`;
        suggestion.hidden = false;
      }
    }

    const deterministicTags = autoTagRecipe({
      name: draft.title,
      content: { text: draft.recipeText },
      notes: ''
    });
    const personTag = currentUser ? EMAIL_TO_TAG[currentUser.email] : null;
    importSelectedTags = [...new Set([
      ...(personTag ? [personTag] : []),
      ...deterministicTags,
      ...(draft.suggestedTags || [])
    ])];
    renderImportTagSelector();
    renderImageCandidates(result.imageCandidates || []);
    importReview.hidden = false;

    if (draft.extractionNotes) {
      showImportNotice(draft.extractionNotes);
    }
    importReview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderImageCandidates(candidates) {
    const safeCandidates = candidates.filter(candidate => {
      try {
        const url = new URL(candidate.url);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    });

    imageCandidates.innerHTML = safeCandidates.map((candidate, index) => `
      <button
        type="button"
        class="image-candidate"
        data-url="${escapeHtml(candidate.url)}"
        aria-label="בחירת תמונה ${index + 1}"
      >
        <img src="${escapeHtml(candidate.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      </button>
    `).join('');
    imageCandidatesSection.hidden = safeCandidates.length === 0;

    if (safeCandidates.length > 0) {
      selectRemoteRecipeImage(safeCandidates[0].url);
    }
  }

  function selectRemoteRecipeImage(url) {
    selectedRecipeImage = {
      sourceUrl: url,
      dataUrl: '',
      name: 'תמונה מהקישור',
      bytes: 0
    };
    imageCandidates.querySelectorAll('.image-candidate').forEach(candidate => {
      candidate.classList.toggle('selected', candidate.dataset.url === url);
      candidate.setAttribute('aria-pressed', candidate.dataset.url === url ? 'true' : 'false');
    });
    showSelectedImage(url, 'תמונה מהקישור', 'תישמר יחד עם המתכון');
  }

  async function handleRecipeImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const image = await compressImageFile(file, {
        maxDimension: 1_600,
        maxBytes: 900_000,
        quality: 0.84
      });
      selectedRecipeImage = {
        dataUrl: image.dataUrl,
        sourceUrl: '',
        name: image.name,
        bytes: image.bytes
      };
      imageCandidates.querySelectorAll('.image-candidate').forEach(candidate => {
        candidate.classList.remove('selected');
        candidate.setAttribute('aria-pressed', 'false');
      });
      showSelectedImage(image.dataUrl, image.name, formatFileSize(image.bytes));
    } catch (error) {
      console.error('Image preparation failed:', error);
      recipeImageInput.value = '';
      showToast(error.message || 'לא הצלחנו להכין את התמונה', 'error');
    }
  }

  async function handleSocialScreenshots(event) {
    const files = [...(event.target.files || [])].slice(0, 2);
    if (!files.length) return;

    try {
      importScreenshots = [];
      for (const file of files) {
        importScreenshots.push(await compressImageFile(file, {
          maxDimension: 1_800,
          maxBytes: 2_800_000,
          quality: 0.88
        }));
      }
      renderScreenshotPreviews();
    } catch (error) {
      console.error('Screenshot preparation failed:', error);
      showToast(error.message || 'לא הצלחנו להכין את צילום המסך', 'error');
    }
  }

  function renderScreenshotPreviews() {
    screenshotPreviews.innerHTML = importScreenshots.map((item, index) => `
      <div class="screenshot-preview">
        <img src="${item.dataUrl}" alt="צילום מסך ${index + 1}">
        <button type="button" data-remove-screenshot="${index}" aria-label="הסרת צילום מסך ${index + 1}">&times;</button>
      </div>
    `).join('');
  }

  function clearSelectedRecipeImage() {
    selectedRecipeImage = null;
    recipeImageInput.value = '';
    selectedImagePreview.hidden = true;
    document.getElementById('selected-image').removeAttribute('src');
    imageCandidates.querySelectorAll('.image-candidate').forEach(candidate => {
      candidate.classList.remove('selected');
      candidate.setAttribute('aria-pressed', 'false');
    });
  }

  function showSelectedImage(src, name, detail) {
    document.getElementById('selected-image').src = src;
    document.getElementById('selected-image-name').textContent = name;
    document.getElementById('selected-image-size').textContent = detail;
    selectedImagePreview.hidden = false;
  }

  async function compressImageFile(file, options) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('אפשר להעלות תמונת JPEG, PNG או WebP');
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('התמונה גדולה מדי');
    }

    const source = await loadImageSource(file);
    let scale = Math.min(1, options.maxDimension / Math.max(source.width, source.height));
    let quality = options.quality;
    let blob;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fdf8f3';
      context.fillRect(0, 0, width, height);
      context.drawImage(source.drawable, 0, 0, width, height);
      blob = await canvasToBlob(canvas, 'image/webp', quality);
      if (blob.size <= options.maxBytes) break;
      scale *= 0.82;
      quality = Math.max(0.64, quality - 0.06);
    }

    source.cleanup();
    if (!blob || blob.size > options.maxBytes) {
      throw new Error('לא הצלחנו לכווץ את התמונה לגודל המתאים');
    }

    return {
      dataUrl: await blobToDataUrl(blob),
      name: file.name.replace(/\.[^.]+$/, '') + '.webp',
      bytes: blob.size
    };
  }

  async function loadImageSource(file) {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close()
      };
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('לא ניתן לקרוא את התמונה'));
      image.src = objectUrl;
    });
    return {
      drawable: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl)
    };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('לא ניתן לעבד את התמונה'));
      }, type, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('לא ניתן לקרוא את התמונה'));
      reader.readAsDataURL(blob);
    });
  }

  async function callImporter(path, body) {
    if (!IMPORTER_URL) throw new Error('שירות הייבוא עדיין לא הוגדר');
    if (!currentUser) throw new Error('יש להתחבר כדי להשתמש בשירות הייבוא');
    const token = await currentUser.getIdToken();
    const response = await fetch(`${IMPORTER_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'שירות הייבוא לא זמין');
    return result;
  }

  async function uploadRecipeImage(recipeId, image) {
    return callImporter('/images', {
      recipeId,
      ...(image.dataUrl ? { dataUrl: image.dataUrl } : { sourceUrl: image.sourceUrl })
    });
  }

  function openEditImageModal() {
    if (!canEdit || !currentRecipeId) return;
    editingRecipeImage = null;
    editRecipeImageInput.value = '';
    editImagePreview.hidden = true;
    saveEditImageBtn.disabled = true;
    editImageModal.classList.add('active');
  }

  function closeEditImageModal() {
    editImageModal.classList.remove('active');
    editingRecipeImage = null;
    editRecipeImageInput.value = '';
    editImagePreview.hidden = true;
    saveEditImageBtn.disabled = true;
  }

  async function handleEditRecipeImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      editingRecipeImage = await compressImageFile(file, {
        maxDimension: 1_600,
        maxBytes: 900_000,
        quality: 0.84
      });
      document.getElementById('edit-selected-image').src = editingRecipeImage.dataUrl;
      document.getElementById('edit-selected-image-name').textContent = editingRecipeImage.name;
      document.getElementById('edit-selected-image-size').textContent = formatFileSize(editingRecipeImage.bytes);
      editImagePreview.hidden = false;
      saveEditImageBtn.disabled = false;
    } catch (error) {
      console.error('Edit image preparation failed:', error);
      editRecipeImageInput.value = '';
      showToast(error.message || 'לא הצלחנו להכין את התמונה', 'error');
    }
  }

  async function saveEditedRecipeImage() {
    if (!currentRecipeId || !editingRecipeImage || !canEdit) return;
    const recipeId = currentRecipeId;
    const recipe = recipes.find(item => item.id === recipeId);
    if (!recipe) return;

    const btnText = saveEditImageBtn.querySelector('.btn-text');
    const btnLoading = saveEditImageBtn.querySelector('.btn-loading');
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    saveEditImageBtn.disabled = true;

    try {
      const stored = await uploadRecipeImage(recipeId, editingRecipeImage);
      if (!recipe.content) recipe.content = {};
      recipe.content.uploadedImages = [stored.url];
      await db.collection('recipes').doc(recipeId).update({
        'content.uploadedImages': [stored.url]
      });
      updateRecipesCache();
      renderRecipes();
      closeEditImageModal();
      openRecipe(recipeId);
      showToast('התמונה נשמרה בהצלחה', 'success');
    } catch (error) {
      console.error('Save recipe image failed:', error);
      showToast(error.message || 'שגיאה בשמירת התמונה', 'error');
    } finally {
      btnText.style.display = 'inline';
      btnLoading.style.display = 'none';
      saveEditImageBtn.disabled = !editingRecipeImage;
    }
  }

  function getSelectedCategoryMain() {
    return document.getElementById('recipe-category').selectedOptions[0]?.dataset.main || null;
  }

  function setAnalyzeLoading(isLoading) {
    analyzeRecipeBtn.disabled = isLoading;
    analyzeRecipeBtn.querySelector('.analyze-label').hidden = isLoading;
    analyzeRecipeBtn.querySelector('.analyze-loading').hidden = !isLoading;
  }

  function setImportProgress(title, detail) {
    document.getElementById('import-progress-title').textContent = title;
    document.getElementById('import-progress-detail').textContent = detail;
    importProgress.hidden = false;
  }

  function setImportStep(step) {
    addModal.querySelectorAll('.import-steps li').forEach((item, index) => {
      item.classList.toggle('active', index + 1 === step);
      item.classList.toggle('complete', index + 1 < step);
    });
  }

  function showImportNotice(message) {
    importInlineNotice.textContent = message;
    importInlineNotice.hidden = !message;
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    return bytes < 1_000_000
      ? `${Math.round(bytes / 1_000)} KB`
      : `${(bytes / 1_000_000).toFixed(1)} MB`;
  }

  async function checkImportService() {
    if (!importServiceStatus) return;
    const title = importServiceStatus.querySelector('strong');
    const detail = importServiceStatus.querySelector('small');
    importServiceStatus.classList.remove('ready', 'error');

    if (!IMPORTER_URL) {
      importServiceStatus.classList.add('error');
      title.textContent = 'שירות הייבוא עדיין לא חובר';
      detail.textContent = 'נדרש URL של Cloudflare Worker בקובץ ההגדרות';
      return;
    }

    title.textContent = 'בודק את שירות הייבוא…';
    detail.textContent = 'חילוץ טקסט ושמירת תמונות';
    try {
      const response = await fetch(`${IMPORTER_URL}/health`);
      const health = await response.json();
      if (!response.ok || !health.ok || !health.openaiConfigured || !health.imageStorageConfigured) {
        throw new Error('Service is not fully configured');
      }
      importServiceStatus.classList.add('ready');
      title.textContent = 'שירות הייבוא מחובר';
      detail.textContent = 'OpenAI ושמירת התמונות מוכנים';
    } catch {
      importServiceStatus.classList.add('error');
      title.textContent = 'שירות הייבוא לא זמין';
      detail.textContent = 'הזנה ידנית ממשיכה לעבוד כרגיל';
    }
  }

  // Format date
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Legacy Firebase Storage URLs still display; new images are served by GitHub Pages.

  // Setup event listeners
  function setupEventListeners() {
    // Main category buttons
    categoriesNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.category-btn');
      if (!btn) return;

      const mainCat = btn.dataset.mainCategory;
      if (mainCat !== undefined) {
        currentMainCategory = mainCat;
        currentSubCategory = 'all';
        renderCategories();
        renderRecipes();
      }
    });

    // Sub category buttons (using event delegation on document)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.sub-category-btn');
      if (!btn) return;

      const subCat = btn.dataset.subCategory;
      if (subCat !== undefined) {
        currentSubCategory = subCat;
        document.querySelectorAll('.sub-category-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRecipes();
      }
    });

    // Tag filter buttons
    document.getElementById('tags-filter-pills')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.tag-filter-pill');
      if (!btn) return;

      const tagId = btn.dataset.tag;
      if (currentTags.includes(tagId)) {
        currentTags = currentTags.filter(t => t !== tagId);
      } else {
        currentTags.push(tagId);
      }
      renderTagFilters();
      renderRecipes();
    });

    // Recipe cards
    recipesContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.recipe-card');
      if (card) {
        openRecipe(card.dataset.id);
      }
    });

    // Search
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const value = e.target.value;
      clearSearchBtn.classList.toggle('visible', value.length > 0);

      searchTimeout = setTimeout(() => {
        searchQuery = value;
        renderRecipes();
      }, 200);
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.classList.remove('visible');
      renderRecipes();
      searchInput.focus();
    });

    // Recipe modal
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Delete button
    modalDelete.addEventListener('click', () => {
      if (currentRecipeId) deleteRecipe(currentRecipeId);
    });

    cancelDeleteBtn.addEventListener('click', () => {
      deleteModal.classList.remove('active');
    });

    confirmDeleteBtn.addEventListener('click', confirmDelete);

    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) {
        deleteModal.classList.remove('active');
      }
    });

    // Add recipe
    addRecipeBtn.addEventListener('click', openAddModal);
    addModalClose.addEventListener('click', closeAddModal);
    cancelAddBtn.addEventListener('click', closeAddModal);

    addModal.addEventListener('click', (e) => {
      if (e.target === addModal) closeAddModal();
    });

    // Form tabs
    addModal.querySelectorAll('.form-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        addModal.querySelectorAll('.form-tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        addModal.querySelectorAll('.form-tab-content').forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        currentFormTab = tab.dataset.tab;
        addModal.querySelector(`.form-tab-content[data-tab="${currentFormTab}"]`).classList.add('active');
      });
    });

    // Auto-categorize on name input
    document.getElementById('recipe-name-link').addEventListener('input', (e) => {
      const category = autoCategorize(e.target.value);
      document.getElementById('recipe-category').value = category;
    });

    document.getElementById('recipe-name-text').addEventListener('input', (e) => {
      const category = autoCategorize(e.target.value);
      document.getElementById('recipe-category').value = category;
    });

    document.getElementById('recipe-url').addEventListener('input', updateSocialImportVisibility);
    analyzeRecipeBtn.addEventListener('click', analyzeNewRecipe);
    socialScreenshotsInput.addEventListener('change', handleSocialScreenshots);
    recipeImageInput.addEventListener('change', handleRecipeImage);
    document.getElementById('remove-selected-image').addEventListener('click', clearSelectedRecipeImage);

    imageCandidates.addEventListener('click', (e) => {
      const candidate = e.target.closest('.image-candidate');
      if (!candidate) return;
      selectRemoteRecipeImage(candidate.dataset.url);
    });

    screenshotPreviews.addEventListener('click', (e) => {
      const removeButton = e.target.closest('[data-remove-screenshot]');
      if (!removeButton) return;
      importScreenshots.splice(Number(removeButton.dataset.removeScreenshot), 1);
      renderScreenshotPreviews();
    });

    importTagsSelector.addEventListener('click', (e) => {
      const button = e.target.closest('.import-tag-option');
      if (!button) return;
      importTagsTouched = true;
      const tagId = button.dataset.tag;
      importSelectedTags = importSelectedTags.includes(tagId)
        ? importSelectedTags.filter(tag => tag !== tagId)
        : [...importSelectedTags, tagId];
      renderImportTagSelector();
    });

    // Form submit
    addRecipeForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      let formData;

      if (currentFormTab === 'link') {
        const url = document.getElementById('recipe-url').value.trim();
        const name = document.getElementById('recipe-name-link').value.trim();
        const text = document.getElementById('recipe-text-link').value.trim();

        if (!url) {
          showToast('נא להזין קישור', 'error');
          return;
        }

        const videoType = detectVideoType(url);

        formData = {
          name: name || 'מתכון חדש',
          category: document.getElementById('recipe-category').value,
          mainCategory: getSelectedCategoryMain(),
          type: videoType ? 'video' : 'link',
          content: {
            url: url,
            videoType: videoType,
            ...(text ? { text } : {})
          },
          notes: document.getElementById('recipe-notes').value.trim(),
          tags: importTagsTouched || importDraft ? [...importSelectedTags] : undefined,
          image: selectedRecipeImage
        };
      } else if (currentFormTab === 'text') {
        const name = document.getElementById('recipe-name-text').value.trim();
        const text = document.getElementById('recipe-text').value.trim();

        if (!name || !text) {
          showToast('נא למלא שם ותוכן המתכון', 'error');
          return;
        }

        formData = {
          name: name,
          category: document.getElementById('recipe-category').value,
          mainCategory: getSelectedCategoryMain(),
          type: 'text',
          content: {
            text: text
          },
          notes: document.getElementById('recipe-notes').value.trim(),
          tags: importTagsTouched ? [...importSelectedTags] : undefined,
          image: selectedRecipeImage
        };
      }

      await addRecipe(formData);
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (settingsModal.classList.contains('active')) {
          closeSettingsModal();
        } else if (editImageModal.classList.contains('active')) {
          closeEditImageModal();
        } else if (editTagsModal.classList.contains('active')) {
          closeEditTagsModal();
        } else if (transcriptionModal.classList.contains('active')) {
          closeTranscriptionModal();
        } else if (deleteModal.classList.contains('active')) {
          deleteModal.classList.remove('active');
        } else if (addModal.classList.contains('active')) {
          closeAddModal();
        } else if (modal.classList.contains('active')) {
          closeModal();
        }
      }
    });

    // Image gallery click to fullscreen
    modalBody.addEventListener('click', (e) => {
      if (e.target.tagName === 'IMG' && e.target.closest('.images-gallery')) {
        window.open(e.target.src, '_blank');
      }
    });

    // Action buttons in recipe modal (transcription, image, tags)
    modalBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'add-transcription' || action === 'edit-transcription') {
        openTranscriptionModal();
      } else if (action === 'edit-image') {
        openEditImageModal();
      } else if (action === 'edit-tags') {
        openEditTagsModal();
      } else if (action === 'edit-category') {
        openEditCategoryModal();
      } else if (action === 'extract-recipe') {
        extractRecipeFromUrl();
      }
    });

    editImageModalClose.addEventListener('click', closeEditImageModal);
    cancelEditImageBtn.addEventListener('click', closeEditImageModal);
    editRecipeImageInput.addEventListener('change', handleEditRecipeImage);
    saveEditImageBtn.addEventListener('click', saveEditedRecipeImage);
    editImageModal.addEventListener('click', (e) => {
      if (e.target === editImageModal) closeEditImageModal();
    });

    // Transcription modal
    transcriptionModalClose.addEventListener('click', closeTranscriptionModal);
    cancelTranscriptionBtn.addEventListener('click', closeTranscriptionModal);
    saveTranscriptionBtn.addEventListener('click', saveTranscription);

    transcriptionModal.addEventListener('click', (e) => {
      if (e.target === transcriptionModal) closeTranscriptionModal();
    });

    // Edit tags modal
    editTagsModalClose.addEventListener('click', closeEditTagsModal);
    cancelEditTagsBtn.addEventListener('click', closeEditTagsModal);
    saveEditTagsBtn.addEventListener('click', saveEditedTags);

    editTagsModal.addEventListener('click', (e) => {
      if (e.target === editTagsModal) closeEditTagsModal();
    });

    // Edit category modal
    editCategoryModalClose.addEventListener('click', closeEditCategoryModal);
    cancelEditCategoryBtn.addEventListener('click', closeEditCategoryModal);
    saveEditCategoryBtn.addEventListener('click', saveEditedCategory);

    editCategoryModal.addEventListener('click', (e) => {
      if (e.target === editCategoryModal) closeEditCategoryModal();
    });

    // Manage categories modal
    manageCategoriesModalClose.addEventListener('click', closeManageCategoriesModal);
    closeManageCategoriesBtn.addEventListener('click', closeManageCategoriesModal);

    manageCategoriesModal.addEventListener('click', (e) => {
      if (e.target === manageCategoriesModal) closeManageCategoriesModal();
    });

    // Add main category button
    document.getElementById('add-main-category-btn')?.addEventListener('click', addNewMainCategory);

    // Category manager buttons (delegated)
    document.getElementById('categories-manager')?.addEventListener('click', (e) => {
      const addSubBtn = e.target.closest('.add-sub-category-btn');
      if (addSubBtn) {
        const mainCatId = addSubBtn.dataset.mainCategory;
        addNewSubCategory(mainCatId);
        return;
      }

      const deleteSubBtn = e.target.closest('.delete-sub-category-btn');
      if (deleteSubBtn) {
        const subId = deleteSubBtn.dataset.subId;
        const mainId = deleteSubBtn.dataset.mainId;
        deleteSubCategory(mainId, subId);
        return;
      }

      const deleteMainBtn = e.target.closest('.delete-main-category-btn');
      if (deleteMainBtn) {
        const mainCatId = deleteMainBtn.dataset.mainCategory;
        deleteMainCategory(mainCatId);
        return;
      }
    });

    // Settings modal
    settingsBtn.addEventListener('click', openSettingsModal);
    settingsModalClose.addEventListener('click', closeSettingsModal);
    cancelSettingsBtn.addEventListener('click', closeSettingsModal);
    saveSettingsBtn.addEventListener('click', saveSettings);

    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });

    // Open manage categories from settings
    document.getElementById('open-manage-categories')?.addEventListener('click', () => {
      closeSettingsModal();
      openManageCategoriesModal();
    });

    // Auth modal
    authBtn.addEventListener('click', openAuthModal);
    authModalClose.addEventListener('click', closeAuthModal);
    googleSigninBtn.addEventListener('click', signInWithGoogle);
    signoutBtn.addEventListener('click', signOut);

    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });
  }

  // Transcription modal functions
  function openTranscriptionModal() {
    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe) return;

    // Pre-fill with existing text (check both fields for backward compatibility)
    transcriptionText.value = recipe.content?.text || recipe.content?.transcription || '';

    transcriptionModal.classList.add('active');
  }

  function closeTranscriptionModal() {
    transcriptionModal.classList.remove('active');
    transcriptionText.value = '';
  }

  async function saveTranscription() {
    if (!currentRecipeId) return;

    if (!canEdit) {
      showToast('אין לך הרשאה לערוך מתכונים', 'error');
      return;
    }

    const text = transcriptionText.value.trim();
    if (!text) {
      showToast('נא להזין טקסט', 'error');
      return;
    }

    const saveBtn = saveTranscriptionBtn;
    const btnText = saveBtn.querySelector('.btn-text');
    const btnLoading = saveBtn.querySelector('.btn-loading');

    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    saveBtn.disabled = true;

    try {
      // Update in Firestore (use content.text as the unified field)
      const recipe = recipes.find(r => r.id === currentRecipeId);
      if (!recipe.content) recipe.content = {};
      recipe.content.text = text;

      await db.collection('recipes').doc(currentRecipeId).update({
        'content.text': text
      });

      updateRecipesCache(); // Sync cache with Firestore
      showToast('הטקסט נשמר בהצלחה!', 'success');
      closeTranscriptionModal();

      // Refresh the recipe modal
      openRecipe(currentRecipeId);
    } catch (error) {
      console.error('Save text failed:', error);
      showToast('שגיאה בשמירת הטקסט', 'error');
    }

    btnText.style.display = 'inline';
    btnLoading.style.display = 'none';
    saveBtn.disabled = false;
  }

  // Edit tags modal functions
  function openEditTagsModal() {
    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe) return;

    // Get current tags (either saved or auto-generated)
    editingRecipeTags = [...(recipe.tags || autoTagRecipe(recipe))];

    // Render the tags editor
    tagsEditor.innerHTML = AVAILABLE_TAGS.map(tag => `
      <div class="tag-editor-item ${editingRecipeTags.includes(tag.id) ? 'selected' : ''}"
           data-tag-id="${tag.id}"
           style="--tag-color: ${tag.color}">
        <span class="tag-icon">${tag.icon}</span>
        <span class="tag-name">${tag.name}</span>
      </div>
    `).join('');

    // Add click handlers for tags
    tagsEditor.querySelectorAll('.tag-editor-item').forEach(item => {
      item.addEventListener('click', () => {
        const tagId = item.dataset.tagId;
        if (editingRecipeTags.includes(tagId)) {
          editingRecipeTags = editingRecipeTags.filter(t => t !== tagId);
          item.classList.remove('selected');
        } else {
          editingRecipeTags.push(tagId);
          item.classList.add('selected');
        }
      });
    });

    editTagsModal.classList.add('active');
  }

  function closeEditTagsModal() {
    editTagsModal.classList.remove('active');
    editingRecipeTags = [];
  }

  async function saveEditedTags() {
    if (!currentRecipeId) return;

    if (!canEdit) {
      showToast('אין לך הרשאה לערוך מתכונים', 'error');
      return;
    }

    const saveBtn = saveEditTagsBtn;
    const btnText = saveBtn.querySelector('.btn-text');
    const btnLoading = saveBtn.querySelector('.btn-loading');

    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    saveBtn.disabled = true;

    try {
      // Update in Firestore
      const recipe = recipes.find(r => r.id === currentRecipeId);
      recipe.tags = [...editingRecipeTags];

      await db.collection('recipes').doc(currentRecipeId).update({
        tags: editingRecipeTags
      });

      updateRecipesCache(); // Sync cache with Firestore
      showToast('התגיות נשמרו בהצלחה!', 'success');
      closeEditTagsModal();

      // Refresh the recipe modal and recipes list
      openRecipe(currentRecipeId);
      renderRecipes();
    } catch (error) {
      console.error('Save tags failed:', error);
      showToast('שגיאה בשמירת התגיות', 'error');
    }

    btnText.style.display = 'inline';
    btnLoading.style.display = 'none';
    saveBtn.disabled = false;
  }

  // Recipe extraction function
  async function extractRecipeFromUrl() {
    if (!currentRecipeId || !canEdit) return;

    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe || !recipe.content?.url) return;

    const url = recipe.content.url;
    const extractBtn = document.querySelector('.extract-recipe-btn');

    if (extractBtn) {
      extractBtn.disabled = true;
      extractBtn.textContent = '⏳ מחלץ...';
    }

    try {
      const result = await callImporter('/extract', {
        url,
        socialText: '',
        screenshots: [],
        categories: categories.map(category => ({ id: category.id, name: category.name })),
        tags: AVAILABLE_TAGS.map(tag => ({ id: tag.id, name: tag.name }))
      });
      const recipeText = result.draft?.recipeText?.trim();

      if (recipeText && recipeText.length > 50) {
        // This action intentionally updates text only. Existing tags are preserved exactly.
        if (!recipe.content) recipe.content = {};
        recipe.content.text = recipeText;

        await db.collection('recipes').doc(currentRecipeId).update({
          'content.text': recipeText
        });

        updateRecipesCache(); // Sync cache with Firestore
        showToast('המתכון חולץ בהצלחה!', 'success');
        openRecipe(currentRecipeId); // Refresh modal
      } else {
        throw new Error(result.warning || 'לא נמצא מספיק טקסט. אפשר להוסיף אותו ידנית.');
      }
    } catch (error) {
      console.error('Extraction failed:', error);
      showToast(error.message || 'שגיאה בחילוץ המתכון. נסה העלאה ידנית.', 'error');
    } finally {
      if (extractBtn) {
        extractBtn.disabled = false;
        extractBtn.textContent = '🔄 חלץ מתכון מהאתר';
      }
    }
  }

  // Extract recipe content from parsed HTML
  function extractRecipeContent(doc, url) {
    let text = '';

    // Try structured recipe data first (JSON-LD)
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const recipeData = findRecipeInJsonLd(data);
        if (recipeData) {
          text = formatRecipeFromJsonLd(recipeData);
          if (text) return text;
        }
      } catch (e) {
        // Continue to next method
      }
    }

    // Site-specific selectors
    const domain = getDomainFromUrl(url);

    // Common recipe selectors for different sites
    const selectors = getRecipeSelectors(domain);

    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element) {
        text = cleanRecipeText(element.innerText || element.textContent);
        if (text.length > 100) return text;
      }
    }

    // Fallback: try to find ingredient and instruction lists
    const ingredients = [];
    const instructions = [];

    // Look for ingredient patterns
    const ingredientElements = doc.querySelectorAll('[class*="ingredient"], [class*="Ingredient"], li[itemprop="recipeIngredient"]');
    ingredientElements.forEach(el => {
      const text = (el.innerText || el.textContent).trim();
      if (text && text.length > 2 && text.length < 200) {
        ingredients.push(text);
      }
    });

    // Look for instruction patterns
    const instructionElements = doc.querySelectorAll('[class*="instruction"], [class*="Instruction"], [class*="direction"], [class*="step"], li[itemprop="recipeInstructions"]');
    instructionElements.forEach(el => {
      const text = (el.innerText || el.textContent).trim();
      if (text && text.length > 10) {
        instructions.push(text);
      }
    });

    if (ingredients.length > 0 || instructions.length > 0) {
      if (ingredients.length > 0) {
        text = 'מרכיבים:\n' + ingredients.join('\n') + '\n\n';
      }
      if (instructions.length > 0) {
        text += 'הוראות הכנה:\n' + instructions.join('\n');
      }
      return text;
    }

    // Last resort: get main content
    const mainContent = doc.querySelector('article, main, .content, .post-content, .entry-content');
    if (mainContent) {
      return cleanRecipeText(mainContent.innerText || mainContent.textContent);
    }

    return '';
  }

  // Find recipe data in JSON-LD (handles nested structures)
  function findRecipeInJsonLd(data) {
    if (!data) return null;

    if (Array.isArray(data)) {
      for (const item of data) {
        const result = findRecipeInJsonLd(item);
        if (result) return result;
      }
      return null;
    }

    if (typeof data === 'object') {
      if (data['@type'] === 'Recipe' || (Array.isArray(data['@type']) && data['@type'].includes('Recipe'))) {
        return data;
      }

      // Check @graph
      if (data['@graph']) {
        return findRecipeInJsonLd(data['@graph']);
      }
    }

    return null;
  }

  // Format recipe from JSON-LD structured data
  function formatRecipeFromJsonLd(recipe) {
    let text = '';

    // Description
    if (recipe.description) {
      text += recipe.description + '\n\n';
    }

    // Prep/Cook time
    const times = [];
    if (recipe.prepTime) times.push(`זמן הכנה: ${formatDuration(recipe.prepTime)}`);
    if (recipe.cookTime) times.push(`זמן בישול: ${formatDuration(recipe.cookTime)}`);
    if (recipe.totalTime) times.push(`זמן כולל: ${formatDuration(recipe.totalTime)}`);
    if (times.length > 0) {
      text += times.join(' | ') + '\n\n';
    }

    // Servings
    if (recipe.recipeYield) {
      text += `מנות: ${Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield}\n\n`;
    }

    // Ingredients
    if (recipe.recipeIngredient && recipe.recipeIngredient.length > 0) {
      text += 'מרכיבים:\n';
      recipe.recipeIngredient.forEach(ing => {
        text += `• ${ing}\n`;
      });
      text += '\n';
    }

    // Instructions
    if (recipe.recipeInstructions) {
      text += 'הוראות הכנה:\n';
      const instructions = Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : [recipe.recipeInstructions];

      instructions.forEach((step, idx) => {
        if (typeof step === 'string') {
          text += `${idx + 1}. ${step}\n`;
        } else if (step.text) {
          text += `${idx + 1}. ${step.text}\n`;
        } else if (step['@type'] === 'HowToSection' && step.itemListElement) {
          text += `\n${step.name || ''}:\n`;
          step.itemListElement.forEach((subStep, subIdx) => {
            const stepText = typeof subStep === 'string' ? subStep : subStep.text;
            if (stepText) text += `${subIdx + 1}. ${stepText}\n`;
          });
        }
      });
    }

    return text.trim();
  }

  // Format ISO duration to readable format
  function formatDuration(duration) {
    if (!duration) return '';
    // PT30M -> 30 דקות, PT1H30M -> שעה ו-30 דקות
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return duration;

    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);

    const parts = [];
    if (hours > 0) parts.push(`${hours} שעות`);
    if (minutes > 0) parts.push(`${minutes} דקות`);

    return parts.join(' ו-') || duration;
  }

  // Get site-specific selectors
  function getRecipeSelectors(domain) {
    const siteSelectors = {
      'oogio.net': ['.wprm-recipe-container', '.recipe-container', '.entry-content'],
      'heninthekitchen.com': ['.recipe-content', '.entry-content', 'article'],
      'lichtenstadt.com': ['.recipe-card', '.entry-content', 'article'],
      'carine.co.il': ['.recipe-content', '.entry-content', '.post-content'],
      'bakery365.co.il': ['.recipe-section', '.recipe-content', '.entry-content'],
      'hashulchan.co.il': ['.recipe-content', '.article-content'],
      'foodish.co.il': ['.recipe-body', '.entry-content'],
      'gilmoran.com': ['.recipe-content', '.entry-content'],
      '10dakot.co.il': ['.recipe-content', '.entry-content']
    };

    // Common selectors that work on most recipe sites
    const commonSelectors = [
      '.wprm-recipe-container',
      '.recipe-content',
      '.recipe-container',
      '[itemtype*="Recipe"]',
      '.tasty-recipes',
      '.mv-recipe',
      '.entry-content .recipe',
      'article .recipe'
    ];

    return [...(siteSelectors[domain] || []), ...commonSelectors];
  }

  // Clean extracted text
  function cleanRecipeText(text) {
    if (!text) return '';

    return text
      .replace(/\s+/g, ' ')        // Normalize whitespace
      .replace(/\n\s*\n/g, '\n\n') // Remove excessive newlines
      .replace(/^\s+|\s+$/g, '')   // Trim
      .replace(/Share.*?Facebook|Tweet|Pinterest|Print|Email/gi, '') // Remove social buttons
      .replace(/\d+ תגובות?/g, '') // Remove comment counts
      .replace(/קראו עוד|המשך קריאה/g, '') // Remove "read more"
      .trim();
  }

  // Settings modal functions
  function openSettingsModal() {
    // Update theme buttons state
    updateThemeButtons();
    checkImportService();

    settingsModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeSettingsModal() {
    settingsModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function saveSettings() {
    showToast('ההגדרות נשמרו', 'success');
    closeSettingsModal();
  }

  // Theme toggle functions
  function initTheme() {
    let savedTheme = 'auto';
    try {
      savedTheme = localStorage.getItem('theme') || 'auto';
    } catch (e) {
      // localStorage not available (private browsing)
    }
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    html.classList.remove('dark-mode', 'light-mode');

    if (theme === 'dark') {
      html.classList.add('dark-mode');
    } else if (theme === 'light') {
      html.classList.add('light-mode');
    }
    // 'auto' = no class, uses prefers-color-scheme

    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      // localStorage not available (private browsing)
    }
    updateThemeButtons();
  }

  function updateThemeButtons() {
    let savedTheme = 'auto';
    try {
      savedTheme = localStorage.getItem('theme') || 'auto';
    } catch (e) {
      // localStorage not available (private browsing)
    }
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === savedTheme);
    });
  }

  function setupThemeToggle() {
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.theme);
      });
    });
  }

  // Edit recipe details modal functions
  function openEditCategoryModal() {
    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe) return;

    // Pre-fill the recipe name
    editRecipeNameInput.value = recipe.name || '';

    // Populate the select with hierarchical categories
    let html = '';
    MAIN_CATEGORIES.forEach(mainCat => {
      const subCats = SUB_CATEGORIES[mainCat.id] || [];
      if (subCats.length > 0) {
        html += `<optgroup label="${mainCat.icon} ${mainCat.name}">`;
        subCats.forEach(subCat => {
          const selected = recipe.category === subCat.id ? 'selected' : '';
          html += `<option value="${subCat.id}" data-main="${mainCat.id}" ${selected}>${subCat.icon} ${subCat.name}</option>`;
        });
        html += `</optgroup>`;
      }
    });
    editCategorySelect.innerHTML = html;

    editCategoryModal.classList.add('active');
  }

  function closeEditCategoryModal() {
    editCategoryModal.classList.remove('active');
  }

  async function saveEditedCategory() {
    if (!currentRecipeId) return;

    if (!canEdit) {
      showToast('אין לך הרשאה לערוך מתכונים', 'error');
      return;
    }

    const newName = editRecipeNameInput.value.trim();
    if (!newName) {
      showToast('יש להזין שם למתכון', 'error');
      return;
    }

    const saveBtn = saveEditCategoryBtn;
    const btnText = saveBtn.querySelector('.btn-text');
    const btnLoading = saveBtn.querySelector('.btn-loading');

    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    saveBtn.disabled = true;

    try {
      const newCategory = editCategorySelect.value;
      const selectedOption = editCategorySelect.selectedOptions[0];
      const newMainCategory = selectedOption?.dataset.main;

      // Update in Firestore
      const recipe = recipes.find(r => r.id === currentRecipeId);
      recipe.name = newName;
      recipe.category = newCategory;
      if (newMainCategory) {
        recipe.mainCategory = newMainCategory;
      }

      await db.collection('recipes').doc(currentRecipeId).update({
        name: newName,
        category: newCategory,
        mainCategory: newMainCategory || null
      });

      updateRecipesCache(); // Sync cache with Firestore
      showToast('הפרטים עודכנו בהצלחה!', 'success');
      closeEditCategoryModal();

      // Refresh the recipe modal and recipes list
      openRecipe(currentRecipeId);
      renderRecipes();
    } catch (error) {
      console.error('Save recipe details failed:', error);
      showToast('שגיאה בשמירת הפרטים', 'error');
    }

    btnText.style.display = 'inline';
    btnLoading.style.display = 'none';
    saveBtn.disabled = false;
  }

  // Manage categories modal functions
  function openManageCategoriesModal() {
    renderCategoriesManager();
    manageCategoriesModal.classList.add('active');
  }

  function closeManageCategoriesModal() {
    manageCategoriesModal.classList.remove('active');
  }

  function renderCategoriesManager() {
    const container = document.getElementById('categories-manager');
    if (!container) return;

    let html = '';
    MAIN_CATEGORIES.forEach(mainCat => {
      const subCats = SUB_CATEGORIES[mainCat.id] || [];
      html += `
        <div class="category-manager-section" data-main-category="${mainCat.id}">
          <div class="category-manager-header">
            <span class="category-manager-icon">${mainCat.icon}</span>
            <span class="category-manager-name">${mainCat.name}</span>
            <button class="delete-main-category-btn" data-main-category="${mainCat.id}" title="מחק קטגוריה">🗑️</button>
          </div>
          <div class="sub-categories-list">
            ${subCats.map(sub => `
              <div class="sub-category-item" data-sub-id="${sub.id}" data-main-id="${mainCat.id}">
                <span>${sub.icon} ${sub.name}</span>
                <button class="delete-sub-category-btn" data-sub-id="${sub.id}" data-main-id="${mainCat.id}" title="מחק">×</button>
              </div>
            `).join('')}
          </div>
          <div class="add-sub-category-row">
            <input type="text" class="sub-category-name-input" placeholder="שם תת-קטגוריה" data-main="${mainCat.id}">
            <input type="text" class="sub-category-icon-input" placeholder="🍽️" maxlength="2" data-main="${mainCat.id}" style="width: 50px;">
            <button class="btn btn-small add-sub-category-btn" data-main-category="${mainCat.id}">+</button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  async function addNewMainCategory() {
    if (!canEdit) {
      showToast('אין לך הרשאה לערוך קטגוריות', 'error');
      return;
    }

    const nameInput = document.getElementById('new-main-category-name');
    const iconInput = document.getElementById('new-main-category-icon');

    const name = nameInput.value.trim();
    const icon = iconInput.value.trim() || '📁';

    if (!name) {
      showToast('נא להזין שם לקטגוריה', 'error');
      return;
    }

    // Generate ID from name
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

    if (MAIN_CATEGORIES.find(c => c.id === id)) {
      showToast('קטגוריה עם שם זה כבר קיימת', 'error');
      return;
    }

    // Add to local arrays
    MAIN_CATEGORIES.push({ id, name, icon });
    SUB_CATEGORIES[id] = [];

    // Save to Firestore
    try {
      await db.collection('settings').doc('categories').set({
        mainCategories: MAIN_CATEGORIES,
        subCategories: SUB_CATEGORIES
      }, { merge: true });

      showToast('הקטגוריה נוספה בהצלחה!', 'success');
      nameInput.value = '';
      iconInput.value = '';

      // Refresh UI
      renderCategoriesManager();
      renderCategories();
      populateCategorySelect();
    } catch (error) {
      console.error('Add category failed:', error);
      showToast('שגיאה בהוספת הקטגוריה', 'error');
    }
  }

  async function addNewSubCategory(mainCatId) {
    if (!canEdit) {
      showToast('אין לך הרשאה לערוך קטגוריות', 'error');
      return;
    }

    const nameInput = document.querySelector(`.sub-category-name-input[data-main="${mainCatId}"]`);
    const iconInput = document.querySelector(`.sub-category-icon-input[data-main="${mainCatId}"]`);

    const name = nameInput.value.trim();
    const icon = iconInput.value.trim() || '🍽️';

    if (!name) {
      showToast('נא להזין שם לתת-קטגוריה', 'error');
      return;
    }

    // Generate ID from name
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

    if (!SUB_CATEGORIES[mainCatId]) {
      SUB_CATEGORIES[mainCatId] = [];
    }

    if (SUB_CATEGORIES[mainCatId].find(c => c.id === id)) {
      showToast('תת-קטגוריה עם שם זה כבר קיימת', 'error');
      return;
    }

    // Add to local array
    SUB_CATEGORIES[mainCatId].push({ id, name, icon });

    // Update CATEGORIES array
    categories = Object.values(SUB_CATEGORIES).flat();

    // Save to Firestore
    try {
      await db.collection('settings').doc('categories').set({
        mainCategories: MAIN_CATEGORIES,
        subCategories: SUB_CATEGORIES
      }, { merge: true });

      showToast('תת-הקטגוריה נוספה בהצלחה!', 'success');
      nameInput.value = '';
      iconInput.value = '';

      // Refresh UI
      renderCategoriesManager();
      renderCategories();
      populateCategorySelect();
    } catch (error) {
      console.error('Add sub-category failed:', error);
      showToast('שגיאה בהוספת תת-הקטגוריה', 'error');
    }
  }

  async function deleteSubCategory(mainCatId, subCatId) {
    if (!canEdit) {
      showToast('אין לך הרשאה לערוך קטגוריות', 'error');
      return;
    }

    // Check if any recipes use this category
    const recipesInCategory = recipes.filter(r => r.category === subCatId);
    if (recipesInCategory.length > 0) {
      showToast(`לא ניתן למחוק - יש ${recipesInCategory.length} מתכונים בקטגוריה זו`, 'error');
      return;
    }

    if (!confirm('למחוק את תת-הקטגוריה?')) return;

    // Remove from local array
    SUB_CATEGORIES[mainCatId] = SUB_CATEGORIES[mainCatId].filter(c => c.id !== subCatId);

    // Update CATEGORIES array
    categories = Object.values(SUB_CATEGORIES).flat();

    // Save to Firestore
    try {
      await db.collection('settings').doc('categories').set({
        mainCategories: MAIN_CATEGORIES,
        subCategories: SUB_CATEGORIES
      }, { merge: true });

      showToast('תת-הקטגוריה נמחקה', 'success');

      // Refresh UI
      renderCategoriesManager();
      renderCategories();
      populateCategorySelect();
    } catch (error) {
      console.error('Delete sub-category failed:', error);
      showToast('שגיאה במחיקת תת-הקטגוריה', 'error');
    }
  }

  async function deleteMainCategory(mainCatId) {
    if (!canEdit) {
      showToast('אין לך הרשאה לערוך קטגוריות', 'error');
      return;
    }

    // Check if any recipes use any sub-category in this main category
    const subCats = SUB_CATEGORIES[mainCatId] || [];
    const subCatIds = subCats.map(s => s.id);
    const recipesInCategory = recipes.filter(r => subCatIds.includes(r.category));

    if (recipesInCategory.length > 0) {
      showToast(`לא ניתן למחוק - יש ${recipesInCategory.length} מתכונים בקטגוריה זו`, 'error');
      return;
    }

    const mainCat = MAIN_CATEGORIES.find(c => c.id === mainCatId);
    if (!confirm(`למחוק את הקטגוריה "${mainCat?.name}"?`)) return;

    // Remove from local arrays
    const index = MAIN_CATEGORIES.findIndex(c => c.id === mainCatId);
    if (index > -1) {
      MAIN_CATEGORIES.splice(index, 1);
    }
    delete SUB_CATEGORIES[mainCatId];

    // Update CATEGORIES array
    categories = Object.values(SUB_CATEGORIES).flat();

    // Save to Firestore
    try {
      await db.collection('settings').doc('categories').set({
        mainCategories: MAIN_CATEGORIES,
        subCategories: SUB_CATEGORIES
      });

      showToast('הקטגוריה נמחקה', 'success');

      // Refresh UI
      renderCategoriesManager();
      renderCategories();
      populateCategorySelect();
    } catch (error) {
      console.error('Delete main category failed:', error);
      showToast('שגיאה במחיקת הקטגוריה', 'error');
    }
  }

  // Start app
  document.addEventListener('DOMContentLoaded', init);
})();
