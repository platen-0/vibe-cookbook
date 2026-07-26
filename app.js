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
  const IS_LOCAL_COOKING_PREVIEW = (
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
    new URLSearchParams(window.location.search).has('cooking-preview')
  );
  const URL_PARAMS = new URLSearchParams(window.location.search);
  const COOKBOOK_V2_ENABLED = Boolean(
    window.COOKBOOK_CONFIG?.features?.cookbookV2 ||
    (
      /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
      URL_PARAMS.has('v2-preview')
    )
  );
  const IS_LOCAL_V2_MOCK_PREVIEW = (
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
    URL_PARAMS.has('v2-preview') &&
    URL_PARAMS.has('mock-user')
  );
  const IS_LOCAL_PUBLIC_DEMO_PREVIEW = (
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
    URL_PARAMS.has('demo-preview')
  );
  const IS_LOCAL_INTELLIGENCE_PREVIEW = (
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
    URL_PARAMS.has('intelligence-preview')
  );

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
  let userProfile = null;
  let userKitchens = [];
  let kitchenRoles = {};
  let favoriteIds = new Set();
  let recipeAccessIds = new Set();
  let recipeAccess = new Map();
  let hiddenDemoRecipeIds = new Set();
  let pendingInvitations = [];
  let pendingAccessRequests = [];
  let privateImageUrls = new Map();
  let privateImageRefreshKey = '';
  let v2Unsubscribers = [];
  let recipeLoadRequestId = 0;
  let recipeReloadTimer = null;
  let currentLibraryScope = 'all';
  let selectedLibraryKitchenId = '';
  let favoritesFilterActive = false;
  let isEditingProfile = false;
  let appLanguage = 'he';
  let translationCache = new Map();
  let translationLoadingIds = new Set();
  let personalRecipeOverrides = new Map();
  let activeTranslationByRecipe = new Map();

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
  let recipeImageAnalysisRequest = 0;
  let editingRecipeImage = null;
  let cookingWorkspace = CookingWorkspaceCore.normalizeWorkspace({});
  let cookingWorkspaceUnsubscribe = null;
  let cookingPlan = null;
  let cookingPlanLoading = false;
  let cookingPlanError = '';
  let isCookingWorkspaceOpen = false;
  let cookingSwipeStart = null;
  let cookingReturnFocus = null;
  let hasSeededCookingPreview = false;
  let pendingSharedRecipeId = URL_PARAMS.get('recipe') || '';

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

  const ENGLISH_CATEGORY_NAMES = {
    breakfast: 'Breakfast',
    'lunch-dinner': 'Lunch & dinner',
    dessert: 'Dessert',
    snacks: 'Snacks',
    baby: 'Baby food',
    pancakes: 'Pancakes & waffles',
    granola: 'Granola & cereals',
    eggs: 'Eggs & omelets',
    'yeast-breakfast': 'Sweet pastries',
    main: 'Main dishes',
    soups: 'Soups',
    salads: 'Salads & sides',
    savory: 'Savory pastries',
    pasta: 'Pasta',
    spreads: 'Spreads & sauces',
    desserts: 'Cakes & desserts',
    cookies: 'Cookies',
    yeast: 'Yeast pastries',
    muffins: 'Muffins',
    'sweet-snacks': 'Sweet snacks',
    'savory-snacks': 'Savory snacks',
    'baby-meals': 'Baby meals',
    'baby-snacks': 'Baby snacks'
  };

  const ENGLISH_TAG_NAMES = {
    tal: 'Tal',
    einav: 'Einav',
    vegetarian: 'Vegetarian',
    vegan: 'Vegan',
    'gluten-free': 'Gluten-free',
    'dairy-free': 'Dairy-free',
    parve: 'Parve',
    quick: 'Quick',
    'kid-friendly': 'Kid-friendly',
    healthy: 'Healthy',
    'comfort-food': 'Comfort food',
    'special-occasion': 'Special occasion'
  };

  const UI_COPY = {
    he: {
      eyebrow: 'שומרים, משתפים ומבשלים',
      title: 'ספר המתכונים שלך',
      settings: 'הגדרות',
      signIn: 'התחברות',
      account: 'אזור אישי',
      search: 'חיפוש לפי שם, מרכיב או תגית...',
      all: 'הכול',
      mine: 'המטבח שלי',
      shared: 'שותף איתי',
      kitchen: 'מטבח',
      allKitchens: 'כל המטבחים',
      filterTags: 'סינון לפי תגיות:',
      favorites: 'מועדפים',
      addRecipe: 'הוסף מתכון',
      recipes: 'מתכונים',
      loadingRecipes: 'טוען מתכונים…',
      recipe: 'מתכון',
      text: 'מתכון',
      link: 'קישור',
      video: 'סרטון',
      photo: 'תמונה',
      cookingNow: 'לבישול עכשיו',
      cookingActive: 'בבישול עכשיו',
      publicIntroEyebrow: 'חמישה מתכונים להתחלה',
      publicIntroTitle: 'הספר הציבורי הוא רק טעימה',
      publicIntroBody: 'אחרי ההתחברות מחכה לך מטבח אישי, ואפשר להצטרף למטבחים משותפים עם משפחה וחברים.',
      publicIntroAction: 'פתיחת המטבח שלי',
      publicIntroSteps: [
        'שמירת מתכון מקישור, תמונה או טקסט',
        'ממשק נוח לבישול מספר מתכונים במקביל',
        'שיתוף ספרי מתכונים עם חברים ומשפחה'
      ]
    },
    en: {
      eyebrow: 'Save, share, and cook',
      title: 'Your recipe book',
      settings: 'Settings',
      signIn: 'Sign in',
      account: 'My account',
      search: 'Search by name, ingredient, or tag…',
      all: 'All',
      mine: 'My kitchen',
      shared: 'Shared with me',
      kitchen: 'Kitchen',
      allKitchens: 'All kitchens',
      filterTags: 'Filter by tags:',
      favorites: 'Favorites',
      addRecipe: 'Add recipe',
      recipes: 'recipes',
      loadingRecipes: 'Loading recipes…',
      recipe: 'Recipe',
      text: 'Recipe',
      link: 'Link',
      video: 'Video',
      photo: 'Photo',
      cookingNow: 'Cook now',
      cookingActive: 'Cooking now',
      publicIntroEyebrow: 'Five recipes to begin',
      publicIntroTitle: 'The public collection is just a taste',
      publicIntroBody: 'Sign in for your private recipe book and the kitchens you share with family and friends.',
      publicIntroAction: 'Open my kitchen',
      publicIntroSteps: [
        'Save from a link, photo, or note',
        'Follow several recipes as you cook',
        'Share a kitchen, not a password'
      ]
    }
  };

  function ui(key) {
    return UI_COPY[appLanguage]?.[key] || UI_COPY.he[key] || key;
  }

  function localizedCategoryName(category) {
    if (!category) return '';
    return appLanguage === 'en'
      ? (ENGLISH_CATEGORY_NAMES[category.id] || category.name)
      : category.name;
  }

  function localizedTagName(tag) {
    return appLanguage === 'en'
      ? (ENGLISH_TAG_NAMES[tag.id] || tag.name)
      : tag.name;
  }

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
  const modalShare = document.getElementById('modal-share');
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
  const translationEditModal = document.getElementById('translation-edit-modal');
  const translationEditClose = document.getElementById('translation-edit-close');
  const translationEditCancel = document.getElementById('translation-edit-cancel');
  const translationEditSave = document.getElementById('translation-edit-save');
  const translationTitleInput = document.getElementById('translation-title');
  const translationTextInput = document.getElementById('translation-text');
  const translationSaveCanonical = document.getElementById('translation-save-canonical');
  const translationScopeChoice = document.getElementById('translation-scope-choice');
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
  const libraryToolbar = document.getElementById('library-toolbar');
  const libraryKitchenSelect = document.getElementById('library-kitchen-select');
  const publicIntro = document.getElementById('public-intro');
  const publicIntroSignin = document.getElementById('public-intro-signin');
  const onboardingModal = document.getElementById('onboarding-modal');
  const onboardingForm = document.getElementById('onboarding-form');
  const onboardingFirstName = document.getElementById('onboarding-first-name');
  const onboardingUsername = document.getElementById('onboarding-username');
  const onboardingSubmit = document.getElementById('onboarding-submit');
  const createKitchenModal = document.getElementById('create-kitchen-modal');
  const createKitchenForm = document.getElementById('create-kitchen-form');
  const requestKitchenAccessModal = document.getElementById('request-kitchen-access-modal');
  const requestKitchenAccessForm = document.getElementById('request-kitchen-access-form');
  const inviteKitchenModal = document.getElementById('invite-kitchen-modal');
  const inviteKitchenForm = document.getElementById('invite-kitchen-form');
  const shareRecipeModal = document.getElementById('share-recipe-modal');
  const shareRecipeForm = document.getElementById('share-recipe-form');
  const cookingFab = document.getElementById('cooking-fab');
  const cookingFabCount = document.getElementById('cooking-fab-count');
  const cookingWorkspaceElement = document.getElementById('cooking-workspace');
  const cookingWorkspaceClose = document.getElementById('cooking-workspace-close');
  const cookingRecipeRail = document.getElementById('cooking-recipe-rail');
  const cookingStage = document.getElementById('cooking-stage');
  const cookingClearBtn = document.getElementById('cooking-clear-btn');
  const cookingClearConfirm = document.getElementById('cooking-clear-confirm');
  const cookingClearCancel = document.getElementById('cooking-clear-cancel');
  const cookingClearConfirmBtn = document.getElementById('cooking-clear-confirm-btn');
  const cookingViewSwitcher = document.getElementById('cooking-view-switcher');

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
    if (IS_LOCAL_V2_MOCK_PREVIEW) {
      const onboardingPreview = URL_PARAMS.has('onboarding-preview');
      currentUser = {
        uid: 'tal-preview',
        email: 'taladani@gmail.com',
        displayName: 'טל דני',
        photoURL: '',
        getIdToken: async () => 'preview-token'
      };
      userProfile = {
        username: onboardingPreview ? '' : 'tal',
        usernameNormalized: onboardingPreview ? '' : 'tal',
        firstName: onboardingPreview ? '' : 'טל',
        onboardingComplete: !onboardingPreview,
        personalKitchenId: 'personal_tal-preview'
      };
      userKitchens = [
        {
          id: 'personal_tal-preview',
          name: 'המטבח שלי',
          type: 'personal',
          ownerUid: 'tal-preview',
          memberIds: ['tal-preview'],
          memberRoles: { 'tal-preview': 'owner' }
        },
        {
          id: 'schreiber',
          name: 'שרייבר',
          type: 'shared',
          ownerUid: 'tal-preview',
          memberIds: ['tal-preview', 'einav-preview'],
          memberRoles: { 'tal-preview': 'owner', 'einav-preview': 'admin' }
        }
      ];
      kitchenRoles = {
        'personal_tal-preview': 'owner',
        schreiber: 'owner'
      };
      canEdit = !onboardingPreview;
      updateAuthUI();
      updateEditButtonsVisibility();
      renderV2Chrome();
      if (onboardingPreview) {
        requestAnimationFrame(() => openOnboardingModal(false));
      }
      return Promise.resolve();
    }

    if (IS_LOCAL_COOKING_PREVIEW || IS_LOCAL_V2_MOCK_PREVIEW) {
      currentUser = {
        uid: 'local-cooking-preview',
        email: 'preview@local.test',
        displayName: 'תצוגה מקדימה'
      };
      canEdit = false;
      updateAuthUI();
      updateEditButtonsVisibility();
      return Promise.resolve();
    }

    // Resolve the first auth event before the initial Firestore query. This
    // prevents a signed-out load racing a signed-in load on hard refresh.
    return new Promise(resolveInitialAuth => {
      let isInitialAuthEvent = true;

      auth.onAuthStateChanged(async (user) => {
        const initialEvent = isInitialAuthEvent;
        isInitialAuthEvent = false;
        currentUser = user;
        canEdit = user && ALLOWED_EDITORS.includes(user.email);
        userProfile = null;
        stopV2Subscriptions();
        updateAuthUI();
        updateEditButtonsVisibility();
        subscribeToCookingWorkspace(user);

        if (!initialEvent) {
          recipeLoadRequestId += 1;
          recipes = [];
          showLoading(true);
        }

        try {
          if (COOKBOOK_V2_ENABLED) await initializeV2ForUser(user);

          if (!initialEvent && !IS_LOCAL_COOKING_PREVIEW && !IS_LOCAL_V2_MOCK_PREVIEW) {
            await loadRecipesFromFirestore();
            renderTagFilters();
            renderRecipes();
            isInitialized = true;
            if (currentUser && userProfile?.onboardingComplete) subscribeToV2Data();
          }
        } catch (error) {
          console.error('Failed to refresh recipes for the signed-in state:', error);
        } finally {
          if (initialEvent) {
            resolveInitialAuth();
          } else {
            showLoading(false);
          }
        }
      }, error => {
        console.error('Failed to resolve authentication state:', error);
        resolveInitialAuth();
      });
    });
  }

  function updateAuthUI() {
    const signedOutDiv = document.getElementById('auth-signed-out');
    const signedInDiv = document.getElementById('auth-signed-in');
    const authLabel = authBtn.querySelector('.header-action-label');

    if (currentUser) {
      if (publicIntro) publicIntro.hidden = true;
      signedOutDiv.style.display = 'none';
      signedInDiv.style.display = 'block';

      const fallbackInitial = (
        userProfile?.firstName ||
        currentUser.displayName ||
        currentUser.email ||
        'מ'
      ).trim().charAt(0);
      const fallbackAvatar = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
          <rect width="96" height="96" rx="48" fill="#eee8dd"/>
          <text x="48" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="600" fill="#95472f">${fallbackInitial}</text>
        </svg>
      `)}`;
      document.getElementById('auth-user-photo').src = currentUser.photoURL || fallbackAvatar;
      document.getElementById('auth-user-name').textContent = currentUser.displayName || 'משתמש';
      document.getElementById('auth-user-email').textContent = currentUser.email;

      const permissionStatus = document.getElementById('auth-permission-status');
      if (COOKBOOK_V2_ENABLED && userProfile?.onboardingComplete) {
        permissionStatus.className = 'auth-permission-status v2-profile-status';
        permissionStatus.textContent = 'המתכונים שלך נשמרים במטבח האישי';
      } else if (canEdit) {
        permissionStatus.className = 'auth-permission-status has-permission';
        permissionStatus.textContent = '✓ יש לך הרשאה לערוך מתכונים';
      } else {
        permissionStatus.className = 'auth-permission-status no-permission';
        permissionStatus.textContent = '⚠️ אין לך הרשאה לערוך מתכונים. פני למנהל המערכת.';
      }

      authBtn.classList.add('signed-in');
      const accountLabel = appLanguage === 'en'
        ? 'My account'
        : (COOKBOOK_V2_ENABLED ? 'אזור אישי' : 'החשבון שלי');
      if (authLabel) authLabel.textContent = accountLabel;
      authBtn.title = accountLabel;
      authBtn.setAttribute(
        'aria-label',
        `פתיחת החשבון של ${currentUser.displayName || currentUser.email || 'המשתמש'}`
      );
    } else {
      if (publicIntro) publicIntro.hidden = false;
      signedOutDiv.style.display = 'block';
      signedInDiv.style.display = 'none';
      authBtn.classList.remove('signed-in');
      if (authLabel) authLabel.textContent = ui('signIn');
      authBtn.title = ui('signIn');
      authBtn.setAttribute('aria-label', ui('signIn'));
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
    if (categoriesSection) {
      categoriesSection.classList.toggle(
        'hidden',
        !currentUser || !ALLOWED_EDITORS.includes(currentUser.email)
      );
    }
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
    if (COOKBOOK_V2_ENABLED) renderV2Chrome();
    authModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeAuthModal() {
    authModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Cookbook v2: user-bound recipes, personal libraries, and shared kitchens.
  function stopV2Subscriptions({ resetData = true } = {}) {
    if (recipeReloadTimer) {
      window.clearTimeout(recipeReloadTimer);
      recipeReloadTimer = null;
    }
    v2Unsubscribers.forEach(unsubscribe => {
      try { unsubscribe(); } catch (error) {}
    });
    v2Unsubscribers = [];
    if (!resetData) return;
    userKitchens = [];
    kitchenRoles = {};
    favoriteIds = new Set();
    recipeAccessIds = new Set();
    recipeAccess = new Map();
    pendingInvitations = [];
    pendingAccessRequests = [];
    hiddenDemoRecipeIds = new Set();
    personalRecipeOverrides = new Map();
    activeTranslationByRecipe = new Map();
    privateImageUrls = new Map();
    privateImageRefreshKey = '';
  }

  function getViewerContext() {
    return {
      uid: currentUser?.uid || null,
      isLegacyEditor: Boolean(currentUser && ALLOWED_EDITORS.includes(currentUser.email)),
      kitchenRoles,
      favoriteIds,
      recipeAccessIds,
      recipeAccess
    };
  }

  function canEditRecipeNow(recipe) {
    if (!COOKBOOK_V2_ENABLED) return canEdit;
    return CookbookV2Core.canEditRecipe(recipe, getViewerContext());
  }

  function isSystemEditor() {
    return Boolean(currentUser && ALLOWED_EDITORS.includes(currentUser.email));
  }

  function canCopyRecipeNow(recipe) {
    return COOKBOOK_V2_ENABLED && CookbookV2Core.canCopyRecipe(recipe, getViewerContext());
  }

  function isDemoRecipe(recipe) {
    const authorUsername = String(recipe?.author?.username || '').toLowerCase();
    return Boolean(
      recipe?.isDemo ||
      recipe?.ownerUid === 'levashel-demo' ||
      authorUsername === 'levashel'
    );
  }

  async function sha256Text(value) {
    const bytes = new TextEncoder().encode(String(value || '').trim().toLowerCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function sha256Content(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function recipeSourceText(recipe) {
    return recipe?.content?.text || recipe?.content?.transcription || '';
  }

  function isHumanProtectedText(recipe) {
    return ['human', 'human-approved'].includes(recipe?.content?.textMeta?.source);
  }

  async function initializeV2ForUser(user) {
    if (!COOKBOOK_V2_ENABLED) return;
    libraryToolbar.hidden = !user;
    if (!user) {
      currentLibraryScope = 'all';
      selectedLibraryKitchenId = '';
      favoritesFilterActive = false;
      closeOnboardingModal();
      renderV2Chrome();
      renderTagFilters();
      if (isInitialized) renderRecipes();
      return;
    }

    try {
      const snapshot = await db.collection('users').doc(user.uid).get();
      userProfile = snapshot.exists ? snapshot.data() : null;
      hiddenDemoRecipeIds = new Set(userProfile?.hiddenDemoRecipeIds || []);
    } catch (error) {
      console.error('Failed to load v2 profile:', error);
      showToast('לא הצלחנו לטעון את האזור האישי', 'error');
      return;
    }

    canEdit = Boolean(userProfile?.onboardingComplete);
    updateAuthUI();
    updateEditButtonsVisibility();
    renderV2Chrome();

    if (!userProfile?.onboardingComplete) {
      openOnboardingModal(false);
      return;
    }

    refreshPrivateImageUrls();
  }

  function openOnboardingModal(editing = false) {
    if (!currentUser) return;
    isEditingProfile = editing;
    const inferredFirstName = (currentUser.displayName || '').trim().split(/\s+/)[0] || '';
    onboardingFirstName.value = userProfile?.firstName || inferredFirstName;
    onboardingUsername.value = userProfile?.username || '';
    document.getElementById('onboarding-title').textContent = editing
      ? 'עדכון הפרטים שלך'
      : 'איך נכיר אותך במטבח?';
    onboardingSubmit.querySelector('.btn-text').textContent = editing
      ? 'שמירת שינויים'
      : 'יצירת המטבח שלי';
    document.getElementById('onboarding-first-name-error').textContent = '';
    document.getElementById('onboarding-username-error').textContent = '';
    onboardingModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => onboardingFirstName.focus());
  }

  function closeOnboardingModal() {
    onboardingModal?.classList.remove('active');
    if (!document.querySelector('.modal.active')) document.body.style.overflow = '';
  }

  async function saveV2Profile(event) {
    event.preventDefault();
    if (!currentUser) return;

    const validation = CookbookV2Core.validateProfile({
      firstName: onboardingFirstName.value,
      username: onboardingUsername.value
    });
    document.getElementById('onboarding-first-name-error').textContent =
      validation.errors.firstName || '';
    document.getElementById('onboarding-username-error').textContent =
      validation.errors.username || '';
    if (!validation.valid) return;

    const submitText = onboardingSubmit.querySelector('.btn-text');
    const submitLoading = onboardingSubmit.querySelector('.btn-loading');
    onboardingSubmit.disabled = true;
    submitText.hidden = true;
    submitLoading.hidden = false;

    const profile = validation.value;
    const userRef = db.collection('users').doc(currentUser.uid);
    const usernameRef = db.collection('usernames').doc(profile.usernameNormalized);
    const personalId = CookbookV2Core.personalKitchenId(currentUser.uid);
    const kitchenRef = db.collection('kitchens').doc(personalId);
    const emailNormalized = String(currentUser.email || '').trim().toLowerCase();
    const emailHash = await sha256Text(emailNormalized);
    const emailDirectoryRef = db.collection('emailDirectory').doc(emailHash);
    const previousUsername = userProfile?.usernameNormalized || '';

    try {
      await db.runTransaction(async transaction => {
        const usernameSnapshot = await transaction.get(usernameRef);
        const previousRef = previousUsername && previousUsername !== profile.usernameNormalized
          ? db.collection('usernames').doc(previousUsername)
          : null;
        const previousSnapshot = previousRef
          ? await transaction.get(previousRef)
          : null;
        if (
          usernameSnapshot.exists &&
          usernameSnapshot.data().uid !== currentUser.uid
        ) {
          const error = new Error('username-taken');
          error.code = 'username-taken';
          throw error;
        }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        transaction.set(usernameRef, {
          uid: currentUser.uid,
          username: profile.username,
          firstName: profile.firstName,
          updatedAt: now
        });
        transaction.set(emailDirectoryRef, {
          uid: currentUser.uid,
          updatedAt: now
        });
        transaction.set(userRef, {
          ...profile,
          email: emailNormalized,
          photoURL: currentUser.photoURL || '',
          personalKitchenId: personalId,
          updatedAt: now,
          createdAt: userProfile?.createdAt || now
        }, { merge: true });
        transaction.set(kitchenRef, {
          name: 'המטבח שלי',
          type: 'personal',
          ownerUid: currentUser.uid,
          memberIds: [currentUser.uid],
          memberRoles: { [currentUser.uid]: 'owner' },
          updatedAt: now,
          createdAt: userProfile?.createdAt || now
        }, { merge: true });

        if (previousRef && previousSnapshot) {
          if (previousSnapshot.exists && previousSnapshot.data().uid === currentUser.uid) {
            transaction.delete(previousRef);
          }
        }
      });

      userProfile = {
        ...userProfile,
        ...profile,
        email: emailNormalized,
        photoURL: currentUser.photoURL || '',
        personalKitchenId: personalId
      };
      canEdit = true;
      closeOnboardingModal();
      updateAuthUI();
      updateEditButtonsVisibility();
      subscribeToV2Data();
      await loadRecipesFromFirestore();
      renderTagFilters();
      renderRecipes();
      refreshPrivateImageUrls();
      showToast(isEditingProfile ? 'הפרופיל עודכן' : 'המטבח האישי שלך מוכן', 'success');
    } catch (error) {
      console.error('Profile save failed:', error);
      if (error.code === 'username-taken' || error.message === 'username-taken') {
        document.getElementById('onboarding-username-error').textContent =
          'שם המשתמש הזה כבר תפוס';
        onboardingUsername.focus();
      } else {
        showToast('לא הצלחנו לשמור את הפרופיל', 'error');
      }
    } finally {
      onboardingSubmit.disabled = false;
      submitText.hidden = false;
      submitLoading.hidden = true;
    }
  }

  function subscribeToV2Data() {
    stopV2Subscriptions({ resetData: false });
    if (!currentUser || !userProfile?.onboardingComplete) return;

    const handleSubscriptionError = label => error => {
      console.error(`${label} subscription failed:`, error);
    };

    const scheduleRecipeReload = () => {
      if (recipeReloadTimer) window.clearTimeout(recipeReloadTimer);
      recipeReloadTimer = window.setTimeout(async () => {
        recipeReloadTimer = null;
        try {
          await loadRecipesFromFirestore();
          renderTagFilters();
          renderRecipes();
        } catch (error) {
          console.error('Accessible recipe refresh failed:', error);
        }
      }, 120);
    };

    v2Unsubscribers.push(
      db.collection('users').doc(currentUser.uid).collection('favorites')
        .onSnapshot(snapshot => {
          favoriteIds = new Set(snapshot.docs.map(doc => doc.id));
          renderTagFilters();
          renderRecipes();
        }, handleSubscriptionError('Favorites'))
    );

    v2Unsubscribers.push(
      db.collection('users').doc(currentUser.uid).collection('recipeAccess')
        .onSnapshot(snapshot => {
          const nextRecipeAccess = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
          const nextRecipeAccessIds = new Set([...nextRecipeAccess.entries()]
            .filter(([, access]) => access.active !== false)
            .map(([recipeId]) => recipeId));
          const accessibleIdsChanged = (
            nextRecipeAccessIds.size !== recipeAccessIds.size ||
            [...nextRecipeAccessIds].some(recipeId => !recipeAccessIds.has(recipeId))
          );
          recipeAccess = nextRecipeAccess;
          recipeAccessIds = nextRecipeAccessIds;
          renderRecipes();
          if (accessibleIdsChanged) scheduleRecipeReload();
        }, handleSubscriptionError('Recipe access'))
    );

    v2Unsubscribers.push(
      db.collection('kitchens').where('memberIds', 'array-contains', currentUser.uid)
        .onSnapshot(snapshot => {
          userKitchens = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          kitchenRoles = Object.fromEntries(
            userKitchens.map(kitchen => [
              kitchen.id,
              kitchen.memberRoles?.[currentUser.uid] || (
                kitchen.ownerUid === currentUser.uid ? 'owner' : 'member'
              )
            ])
          );
          renderV2Chrome();
          renderRecipes();
        }, handleSubscriptionError('Kitchens'))
    );

    const invitationMap = new Map();
    const updateInvitations = (source, snapshot) => {
      for (const [key, invitation] of invitationMap) {
        if (invitation._source === source) invitationMap.delete(key);
      }
      snapshot.docs.forEach(doc => invitationMap.set(doc.id, {
        id: doc.id,
        ...doc.data(),
        _source: source
      }));
      pendingInvitations = [...invitationMap.values()].filter(
        invitation => invitation.status === 'pending'
      );
      renderV2Chrome();
    };

    v2Unsubscribers.push(
      db.collection('invitations')
        .where('targetUid', '==', currentUser.uid)
        .where('status', '==', 'pending')
        .onSnapshot(
          snapshot => updateInvitations('uid', snapshot),
          handleSubscriptionError('UID invitations')
        )
    );

    const emailNormalized = String(currentUser.email || '').trim().toLowerCase();
    if (emailNormalized) {
      v2Unsubscribers.push(
        db.collection('invitations')
          .where('targetEmail', '==', emailNormalized)
          .where('status', '==', 'pending')
          .onSnapshot(
            snapshot => updateInvitations('email', snapshot),
            handleSubscriptionError('Email invitations')
        )
      );
    }

    v2Unsubscribers.push(
      db.collection('kitchenAccessRequests')
        .where('recipientUids', 'array-contains', currentUser.uid)
        .onSnapshot(snapshot => {
          pendingAccessRequests = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(request => request.status === 'pending');
          renderV2Chrome();
        }, handleSubscriptionError('Kitchen access requests'))
    );
  }

  async function refreshPrivateImageUrls() {
    if (!COOKBOOK_V2_ENABLED || !currentUser || !IMPORTER_URL) return;
    const images = recipes.flatMap(recipe =>
      (recipe.content?.privateImageKeys || []).map(key => ({
        recipeId: recipe.id,
        key
      }))
    );
    if (!images.length) return;
    const refreshKey = images.map(item => `${item.recipeId}:${item.key}`).sort().join('|');
    if (refreshKey === privateImageRefreshKey) return;
    privateImageRefreshKey = refreshKey;
    try {
      const nextUrls = new Map();
      for (let index = 0; index < images.length; index += 50) {
        const result = await callImporter('/private-images/sign', {
          images: images.slice(index, index + 50)
        });
        Object.entries(result.urls || {}).forEach(([key, url]) => nextUrls.set(key, url));
      }
      privateImageUrls = nextUrls;
      renderRecipes();
      if (currentRecipeId && modal.classList.contains('active')) openRecipe(currentRecipeId);
    } catch (error) {
      privateImageRefreshKey = '';
      console.error('Private image signing failed:', error);
    }
  }

  function renderV2Chrome() {
    if (!COOKBOOK_V2_ENABLED) return;
    libraryToolbar.hidden = !currentUser || !userProfile?.onboardingComplete;

    document.querySelectorAll('[data-library-scope]').forEach(button => {
      const active = button.dataset.libraryScope === currentLibraryScope;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (libraryKitchenSelect) {
      const sharedKitchens = userKitchens.filter(kitchen => kitchen.type === 'shared');
      libraryKitchenSelect.innerHTML = `
        <option value="">${ui('allKitchens')}</option>
        ${sharedKitchens.map(kitchen => `
          <option value="${escapeHtml(kitchen.id)}">${escapeHtml(kitchen.name)}</option>
        `).join('')}
      `;
      libraryKitchenSelect.value = sharedKitchens.some(
        kitchen => kitchen.id === selectedLibraryKitchenId
      ) ? selectedLibraryKitchenId : '';
    }

    if (!currentUser) return;
    document.getElementById('auth-user-name').textContent =
      userProfile?.firstName || currentUser.displayName || 'משתמש';
    document.getElementById('account-greeting').textContent =
      `שלום ${userProfile?.firstName || ''}`.trim();
    document.getElementById('auth-username').textContent =
      userProfile?.username ? `@${userProfile.username}` : 'הפרופיל עדיין לא הושלם';

    const kitchenList = document.getElementById('account-kitchen-list');
    if (kitchenList) {
      kitchenList.innerHTML = userKitchens.length
        ? userKitchens.map(kitchen => {
            const role = kitchenRoles[kitchen.id];
            const canInvite = kitchen.type === 'shared' && (role === 'owner' || role === 'admin');
            const roleLabel = kitchen.type === 'personal'
              ? 'פרטי · בבעלותך'
              : ({ owner: 'בעלים', admin: 'מנהל/ת', member: 'חבר/ה' }[role] || 'חבר/ה');
            return `
              <div class="account-kitchen-item">
                <div class="account-kitchen-copy">
                  <strong>${escapeHtml(kitchen.name)}</strong>
                  <span>${roleLabel}</span>
                </div>
                <div class="account-kitchen-actions">
                  ${kitchen.type === 'shared' ? `
                    <button type="button" data-action="open-kitchen" data-kitchen-id="${escapeHtml(kitchen.id)}">פתיחה</button>
                  ` : ''}
                  ${canInvite ? `
                    <button type="button" data-action="invite-kitchen" data-kitchen-id="${escapeHtml(kitchen.id)}">הזמנה</button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')
        : '<div class="account-kitchen-item"><div class="account-kitchen-copy"><strong>המטבח האישי</strong><span>מכינים אותו עכשיו…</span></div></div>';
    }

    const accessRequestSection = document.getElementById('account-access-requests-section');
    const accessRequestList = document.getElementById('account-access-request-list');
    if (accessRequestSection && accessRequestList) {
      const managedSharedKitchens = userKitchens.filter(kitchen =>
        kitchen.type === 'shared' &&
        ['owner', 'admin'].includes(kitchenRoles[kitchen.id])
      );
      accessRequestSection.hidden = pendingAccessRequests.length === 0;
      accessRequestList.innerHTML = pendingAccessRequests.map(request => {
        const fixedKitchen = request.targetKitchenId
          ? managedSharedKitchens.find(kitchen => kitchen.id === request.targetKitchenId)
          : null;
        const kitchenOptions = fixedKitchen
          ? `<option value="${escapeHtml(fixedKitchen.id)}">${escapeHtml(fixedKitchen.name)}</option>`
          : managedSharedKitchens.map(kitchen => `
              <option value="${escapeHtml(kitchen.id)}">${escapeHtml(kitchen.name)}</option>
            `).join('');
        const requesterLabel = request.requesterUsername
          ? `@${request.requesterUsername}`
          : (request.requesterEmail || request.requesterName || 'משתמש/ת');
        return `
          <div class="account-invitation-item account-access-request-item" data-request-id="${escapeHtml(request.id)}">
            <div class="account-invitation-copy">
              <strong>${escapeHtml(request.requesterName || requesterLabel)} מבקש/ת להצטרף</strong>
              <span>${escapeHtml(requesterLabel)}${request.targetKitchenName ? ` · ${escapeHtml(request.targetKitchenName)}` : ''}</span>
              <label class="access-request-kitchen-choice">
                <span>הזמנה אל</span>
                <select data-access-kitchen ${kitchenOptions ? '' : 'disabled'}>
                  ${kitchenOptions || '<option value="">אין מטבח משותף בניהולך</option>'}
                </select>
              </label>
            </div>
            <div class="account-invitation-actions">
              <button type="button" data-action="decline-access-request" data-request-id="${escapeHtml(request.id)}">דחייה</button>
              <button type="button" data-action="approve-access-request" data-request-id="${escapeHtml(request.id)}" ${kitchenOptions ? '' : 'disabled'}>אישור</button>
            </div>
          </div>
        `;
      }).join('');
    }

    const invitationSection = document.getElementById('account-invitations-section');
    const invitationList = document.getElementById('account-invitation-list');
    if (invitationSection && invitationList) {
      invitationSection.hidden = pendingInvitations.length === 0;
      invitationList.innerHTML = pendingInvitations.map(invitation => `
        <div class="account-invitation-item">
          <div class="account-invitation-copy">
            <strong>${escapeHtml(invitation.title || invitation.kitchenName || 'שיתוף מתכונים')}</strong>
            <span>מאת @${escapeHtml(invitation.inviterUsername || 'משתמש')}</span>
          </div>
          <div class="account-invitation-actions">
            <button type="button" data-action="decline-invitation" data-invitation-id="${escapeHtml(invitation.id)}">דחייה</button>
            <button type="button" data-action="accept-invitation" data-invitation-id="${escapeHtml(invitation.id)}">אישור</button>
          </div>
        </div>
      `).join('');
    }
  }

  async function toggleFavorite(recipeId) {
    if (!currentUser || !userProfile?.onboardingComplete) {
      showToast('התחברו כדי לשמור מועדפים', 'info');
      openAuthModal();
      return;
    }
    const ref = db.collection('users').doc(currentUser.uid).collection('favorites').doc(recipeId);
    const wasFavorite = favoriteIds.has(recipeId);
    if (wasFavorite) favoriteIds.delete(recipeId);
    else favoriteIds.add(recipeId);
    renderTagFilters();
    renderRecipes();
    try {
      if (wasFavorite) {
        await ref.delete();
      } else {
        await ref.set({
          recipeId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (error) {
      if (wasFavorite) favoriteIds.add(recipeId);
      else favoriteIds.delete(recipeId);
      renderTagFilters();
      renderRecipes();
      console.error('Favorite update failed:', error);
      showToast('לא הצלחנו לעדכן את המועדפים', 'error');
    }
  }

  function openCreateKitchenModal() {
    createKitchenForm.reset();
    createKitchenModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => document.getElementById('create-kitchen-name').focus());
  }

  function closeCreateKitchenModal() {
    createKitchenModal.classList.remove('active');
    if (!document.querySelector('.modal.active')) document.body.style.overflow = '';
  }

  async function createSharedKitchen(event) {
    event.preventDefault();
    if (!currentUser || !userProfile?.onboardingComplete) return;
    const name = document.getElementById('create-kitchen-name').value.trim();
    if (!name) {
      showToast('צריך להוסיף שם למטבח', 'error');
      return;
    }
    const nameNormalized = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const directoryKey = await sha256Text(nameNormalized);
    const ref = db.collection('kitchens').doc();
    const directoryRef = db.collection('kitchenDirectory').doc(directoryKey);
    try {
      await db.runTransaction(async transaction => {
        const directorySnapshot = await transaction.get(directoryRef);
        if (directorySnapshot.exists) throw new Error('kitchen-name-taken');
        const now = firebase.firestore.FieldValue.serverTimestamp();
        transaction.set(ref, {
          name,
          nameNormalized,
          directoryKey,
          type: 'shared',
          ownerUid: currentUser.uid,
          memberIds: [currentUser.uid],
          memberRoles: { [currentUser.uid]: 'owner' },
          createdBy: currentUser.uid,
          createdAt: now,
          updatedAt: now
        });
        transaction.set(directoryRef, {
          kitchenId: ref.id,
          kitchenName: name,
          normalizedName: nameNormalized,
          ownerUid: currentUser.uid,
          adminUids: [currentUser.uid],
          createdAt: now,
          updatedAt: now
        });
      });
      closeCreateKitchenModal();
      showToast(`המטבח ${name} נוצר`, 'success');
    } catch (error) {
      console.error('Kitchen creation failed:', error);
      showToast(
        error.message === 'kitchen-name-taken'
          ? 'כבר קיים מטבח בשם הזה — נסו שם מעט שונה'
          : 'לא הצלחנו ליצור את המטבח',
        'error'
      );
    }
  }

  function openRequestKitchenAccessModal() {
    requestKitchenAccessForm.reset();
    requestKitchenAccessModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      document.getElementById('request-kitchen-access-target').focus();
    });
  }

  function closeRequestKitchenAccessModal() {
    requestKitchenAccessModal.classList.remove('active');
    if (!document.querySelector('.modal.active')) document.body.style.overflow = '';
  }

  async function resolveAccessRequestTarget(rawTarget) {
    const target = String(rawTarget || '').trim();
    if (!target) throw new Error('missing-target');

    const normalizedKitchenName = target
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase();
    const directoryKey = await sha256Text(normalizedKitchenName);
    const kitchenDirectory = await db.collection('kitchenDirectory').doc(directoryKey).get();
    if (kitchenDirectory.exists) {
      const directory = kitchenDirectory.data();
      if (
        (directory.adminUids || []).includes(currentUser.uid) ||
        userKitchens.some(kitchen => kitchen.id === directory.kitchenId)
      ) {
        throw new Error('self-request');
      }
      return {
        targetKind: 'kitchen',
        targetKitchenId: directory.kitchenId,
        targetKitchenName: directory.kitchenName,
        directoryKey,
        recipientUids: directory.adminUids || []
      };
    }

    const userTarget = await resolveInviteTarget(target);
    if (!userTarget.targetUid) throw new Error('user-not-found');
    if (userTarget.targetUid === currentUser.uid) throw new Error('self-request');
    return {
      targetKind: 'user',
      targetUid: userTarget.targetUid,
      targetUsername: userTarget.targetUsername || null,
      targetEmail: userTarget.targetEmail || null,
      recipientUids: [userTarget.targetUid]
    };
  }

  async function requestKitchenAccess(event) {
    event.preventDefault();
    if (!currentUser || !userProfile?.onboardingComplete) return;
    const submit = document.getElementById('request-kitchen-access-submit');
    submit.disabled = true;
    try {
      const target = await resolveAccessRequestTarget(
        document.getElementById('request-kitchen-access-target').value
      );
      if (!target.recipientUids.length) throw new Error('no-admins');
      const requestIdentity = target.targetKind === 'kitchen'
        ? `kitchen:${target.directoryKey}`
        : `user:${target.targetUid}`;
      const requestId = await sha256Text(`${currentUser.uid}:${requestIdentity}`);
      const requestRef = db.collection('kitchenAccessRequests').doc(requestId);
      const existing = await requestRef.get();
      if (existing.exists && existing.data().status === 'pending') {
        throw new Error('already-pending');
      }
      if (existing.exists && existing.data().status === 'approved') {
        throw new Error('already-approved');
      }
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const payload = {
        ...target,
        requesterUid: currentUser.uid,
        requesterName: userProfile.firstName || currentUser.displayName || '',
        requesterUsername: userProfile.username || '',
        requesterEmail: String(currentUser.email || '').trim().toLowerCase(),
        status: 'pending',
        createdAt: now,
        updatedAt: now
      };
      if (existing.exists) {
        await requestRef.update({
          ...payload,
          resolverUid: firebase.firestore.FieldValue.delete(),
          resolvedAt: firebase.firestore.FieldValue.delete(),
          resolvedKitchenId: firebase.firestore.FieldValue.delete(),
          invitationId: firebase.firestore.FieldValue.delete()
        });
      } else {
        await requestRef.set(payload);
      }
      closeRequestKitchenAccessModal();
      showToast('בקשת הגישה נשלחה', 'success');
    } catch (error) {
      console.error('Kitchen access request failed:', error);
      const messages = {
        'missing-target': 'צריך להזין שם מטבח, שם משתמש או אימייל',
        'user-not-found': 'לא מצאנו מטבח או משתמש בהתאמה מדויקת',
        'self-request': 'כבר יש לך גישה ליעד הזה',
        'no-admins': 'לא מצאנו מנהל שאפשר לשלוח אליו את הבקשה',
        'already-pending': 'כבר מחכה בקשת גישה שלך',
        'already-approved': 'הבקשה הזו כבר אושרה'
      };
      showToast(messages[error.message] || 'לא הצלחנו לשלוח את הבקשה', 'error');
    } finally {
      submit.disabled = false;
    }
  }

  async function approveKitchenAccessRequest(requestId, kitchenId) {
    const accessRequest = pendingAccessRequests.find(item => item.id === requestId);
    const kitchen = userKitchens.find(item => item.id === kitchenId);
    if (
      !accessRequest ||
      !kitchen ||
      kitchen.type !== 'shared' ||
      !['owner', 'admin'].includes(kitchenRoles[kitchen.id])
    ) {
      showToast('אין הרשאה לאשר את הבקשה למטבח הזה', 'error');
      return;
    }
    if (
      accessRequest.targetKitchenId &&
      accessRequest.targetKitchenId !== kitchen.id
    ) {
      showToast('הבקשה נשלחה למטבח אחר', 'error');
      return;
    }

    try {
      const requestRef = db.collection('kitchenAccessRequests').doc(requestId);
      const kitchenRef = db.collection('kitchens').doc(kitchen.id);
      const recipeIds = [...new Set(kitchen.recipeIds || [])];
      if (recipeIds.length > 498) throw new Error('kitchen-too-large');
      const batch = db.batch();
      batch.update(kitchenRef, {
        memberIds: firebase.firestore.FieldValue.arrayUnion(accessRequest.requesterUid),
        [`memberRoles.${accessRequest.requesterUid}`]: 'member',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.update(requestRef, {
        status: 'approved',
        resolverUid: currentUser.uid,
        resolvedKitchenId: kitchen.id,
        resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      recipeIds.forEach(recipeId => {
        batch.set(
          db.collection('users').doc(accessRequest.requesterUid)
            .collection('recipeAccess').doc(recipeId),
          {
            recipeId,
            active: true,
            allowCopy: true,
            grantKind: 'kitchen',
            kitchenId: kitchen.id,
            sourceAccessRequestId: requestId,
            grantedByUid: currentUser.uid,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });
      await batch.commit();
      showToast('הבקשה אושרה והגישה למטבח נפתחה', 'success');
    } catch (error) {
      console.error('Kitchen access approval failed:', error);
      showToast(
        error.message === 'kitchen-too-large'
          ? 'המטבח גדול מדי לאישור ישיר כרגע'
          : 'לא הצלחנו לאשר את הבקשה',
        'error'
      );
    }
  }

  async function declineKitchenAccessRequest(requestId) {
    try {
      await db.collection('kitchenAccessRequests').doc(requestId).update({
        status: 'declined',
        resolverUid: currentUser.uid,
        resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast('בקשת הגישה נדחתה', 'info');
    } catch (error) {
      console.error('Kitchen access decline failed:', error);
      showToast('לא הצלחנו לעדכן את הבקשה', 'error');
    }
  }

  function openInviteKitchenModal(kitchenId) {
    const kitchen = userKitchens.find(item => item.id === kitchenId);
    if (!kitchen) return;
    document.getElementById('invite-kitchen-id').value = kitchen.id;
    document.getElementById('invite-kitchen-description').textContent =
      `הזמנה למטבח ${kitchen.name}`;
    inviteKitchenForm.reset();
    document.getElementById('invite-kitchen-id').value = kitchen.id;
    inviteKitchenModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeInviteKitchenModal() {
    inviteKitchenModal.classList.remove('active');
    if (!document.querySelector('.modal.active')) document.body.style.overflow = '';
  }

  async function resolveInviteTarget(rawTarget) {
    const target = String(rawTarget || '').trim();
    if (!target) throw new Error('missing-target');
    if (target.includes('@') && !target.startsWith('@')) {
      const targetEmail = target.toLowerCase();
      const emailHash = await sha256Text(targetEmail);
      const directory = await db.collection('emailDirectory').doc(emailHash).get();
      return {
        kind: 'email',
        targetUid: directory.exists ? directory.data().uid : null,
        targetEmail,
        targetUsername: null
      };
    }
    const username = CookbookV2Core.normalizeUsername(target);
    const directory = await db.collection('usernames').doc(username).get();
    if (!directory.exists) throw new Error('user-not-found');
    return {
      kind: 'username',
      targetUid: directory.data().uid,
      targetEmail: null,
      targetUsername: username
    };
  }

  async function inviteToKitchen(event) {
    event.preventDefault();
    const kitchenId = document.getElementById('invite-kitchen-id').value;
    const kitchen = userKitchens.find(item => item.id === kitchenId);
    if (!kitchen) return;
    const role = document.getElementById('invite-kitchen-role').value;
    try {
      const target = await resolveInviteTarget(
        document.getElementById('invite-kitchen-recipient').value
      );
      if (target.targetUid === currentUser.uid) throw new Error('self-invite');
      await db.collection('invitations').add({
        type: 'kitchen',
        title: `הזמנה למטבח ${kitchen.name}`,
        kitchenId,
        kitchenName: kitchen.name,
        role: role === 'admin' ? 'admin' : 'member',
        inviterUid: currentUser.uid,
        inviterUsername: userProfile.username,
        ...target,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeInviteKitchenModal();
      showToast('ההזמנה נשלחה', 'success');
    } catch (error) {
      console.error('Kitchen invitation failed:', error);
      const message = error.message === 'user-not-found'
        ? 'לא מצאנו את שם המשתמש הזה'
        : error.message === 'self-invite'
          ? 'אין צורך להזמין את עצמך'
          : 'לא הצלחנו לשלוח את ההזמנה';
      showToast(message, 'error');
    }
  }

  function populateShareScopeValues() {
    const scopeType = document.getElementById('share-scope-type').value;
    const group = document.getElementById('share-scope-value-group');
    const select = document.getElementById('share-scope-value');
    const futureWrap = document.getElementById('share-future-wrap');
    group.hidden = scopeType === 'recipe' || scopeType === 'all';
    futureWrap.hidden = scopeType === 'recipe';
    if (scopeType === 'category') {
      select.innerHTML = MAIN_CATEGORIES.map(category => `
        <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>
      `).join('');
    } else if (scopeType === 'tag') {
      select.innerHTML = AVAILABLE_TAGS.map(tag => `
        <option value="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</option>
      `).join('');
    }
  }

  function openShareRecipeModal(recipeId) {
    const recipe = recipes.find(item => item.id === recipeId);
    if (!recipe || !canEditRecipeNow(recipe)) return;
    shareRecipeForm.reset();
    document.getElementById('share-source-recipe-id').value = recipeId;
    document.getElementById('share-allow-copy').checked = true;
    populateShareScopeValues();
    shareRecipeModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeShareRecipeModal() {
    shareRecipeModal.classList.remove('active');
    if (!document.querySelector('.modal.active')) document.body.style.overflow = '';
  }

  function resolveKitchenTarget(rawTarget) {
    const target = String(rawTarget || '').trim().toLocaleLowerCase();
    return userKitchens.find(kitchen =>
      kitchen.type === 'shared' &&
      (
        kitchen.id.toLocaleLowerCase() === target ||
        String(kitchen.name || '').trim().toLocaleLowerCase() === target
      )
    ) || null;
  }

  async function writeAccessGrants(recipeIds, targetUids, policyId, allowCopy) {
    const writes = [];
    for (const uid of targetUids) {
      for (const recipeId of recipeIds) {
        writes.push({
          ref: db.collection('users').doc(uid).collection('recipeAccess').doc(recipeId),
          data: {
            recipeId,
            policyIds: firebase.firestore.FieldValue.arrayUnion(policyId),
            primaryPolicyId: policyId,
            allowCopy,
            active: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }
        });
      }
    }
    for (let index = 0; index < writes.length; index += 400) {
      const batch = db.batch();
      writes.slice(index, index + 400).forEach(write => {
        batch.set(write.ref, write.data, { merge: true });
      });
      await batch.commit();
    }
  }

  async function claimJoinedKitchenRecipes(recipeIds, kitchenId, invitationId) {
    if (!currentUser || !recipeIds?.length) return;
    const writes = recipeIds.map(recipeId => ({
      ref: db.collection('users').doc(currentUser.uid)
        .collection('recipeAccess').doc(recipeId),
      data: {
        recipeId,
        active: true,
        allowCopy: true,
        grantKind: 'kitchen',
        kitchenId,
        invitationId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    }));
    for (let index = 0; index < writes.length; index += 400) {
      const batch = db.batch();
      writes.slice(index, index + 400).forEach(write => {
        batch.set(write.ref, write.data, { merge: true });
      });
      await batch.commit();
    }
  }

  async function applyFutureSharePoliciesToRecipe(recipe) {
    if (!currentUser || recipe.ownerUid !== currentUser.uid) return;
    try {
      const snapshot = await db.collection('sharePolicies')
        .where('ownerUid', '==', currentUser.uid)
        .get();
      const policies = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(policy =>
          policy.active !== false &&
          policy.includeFuture === true &&
          CookbookV2Core.matchesSharePolicy(recipe, policy)
        );
      for (const policy of policies) {
        if (policy.targetType === 'kitchen' && policy.targetId) {
          const kitchen = userKitchens.find(item => item.id === policy.targetId);
          if (!kitchen) continue;
          const kitchenEditorUids = Object.entries(kitchen.memberRoles || {})
            .filter(([, role]) => role === 'owner' || role === 'admin')
            .map(([uid]) => uid);
          const recipeUpdate = {
            sharedKitchenIds: firebase.firestore.FieldValue.arrayUnion(kitchen.id)
          };
          if (kitchenEditorUids.length) {
            recipeUpdate.editorUids =
              firebase.firestore.FieldValue.arrayUnion(...kitchenEditorUids);
          }
          await db.collection('recipes').doc(recipe.id).update(recipeUpdate);
          await db.collection('kitchens').doc(kitchen.id).update({
            recipeIds: firebase.firestore.FieldValue.arrayUnion(recipe.id),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await writeAccessGrants(
            [recipe.id],
            kitchen.memberIds || [],
            policy.id,
            policy.permissions?.allowCopy !== false
          );
        } else if (policy.targetUid) {
          await writeAccessGrants(
            [recipe.id],
            [policy.targetUid],
            policy.id,
            policy.permissions?.allowCopy !== false
          );
        }
      }
    } catch (error) {
      console.error('Future share policy application failed:', error);
      showToast('המתכון נשמר, אבל שיתוף עתידי אחד דורש בדיקה', 'info');
    }
  }

  async function shareRecipes(event) {
    event.preventDefault();
    const sourceRecipeId = document.getElementById('share-source-recipe-id').value;
    const sourceRecipe = recipes.find(recipe => recipe.id === sourceRecipeId);
    if (!sourceRecipe || !canEditRecipeNow(sourceRecipe)) return;

    const rawTarget = document.getElementById('share-target').value.trim();
    const scopeType = document.getElementById('share-scope-type').value;
    const scopeValue = scopeType === 'recipe'
      ? sourceRecipeId
      : scopeType === 'all'
        ? null
        : document.getElementById('share-scope-value').value;
    const includeFuture = scopeType !== 'recipe' &&
      document.getElementById('share-include-future').checked;
    const allowCopy = document.getElementById('share-allow-copy').checked;
    const kitchenTarget = resolveKitchenTarget(rawTarget);

    try {
      const target = kitchenTarget
        ? { targetType: 'kitchen', targetId: kitchenTarget.id }
        : { targetType: 'user', ...(await resolveInviteTarget(rawTarget)) };
      const policyRef = db.collection('sharePolicies').doc();
      const policy = {
        ownerUid: currentUser.uid,
        ownerUsername: userProfile.username,
        targetType: target.targetType,
        targetId: target.targetId || target.targetUid || null,
        targetUid: target.targetUid || null,
        targetEmail: target.targetEmail || null,
        targetUsername: target.targetUsername || null,
        scopeType,
        scopeValue,
        includeFuture,
        permissions: { view: true, allowCopy },
        active: true,
        createdAt: new Date().toISOString()
      };
      const recipeIds = CookbookV2Core.resolvePolicyRecipeIds(policy, recipes);

      await policyRef.set({
        ...policy,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      if (kitchenTarget) {
        const batch = db.batch();
        const kitchenEditorUids = Object.entries(kitchenTarget.memberRoles || {})
          .filter(([, role]) => role === 'owner' || role === 'admin')
          .map(([uid]) => uid);
        recipeIds.forEach(recipeId => {
          batch.update(db.collection('recipes').doc(recipeId), {
            sharedKitchenIds: firebase.firestore.FieldValue.arrayUnion(kitchenTarget.id),
            editorUids: firebase.firestore.FieldValue.arrayUnion(...kitchenEditorUids),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        if (recipeIds.length) {
          batch.update(db.collection('kitchens').doc(kitchenTarget.id), {
            recipeIds: firebase.firestore.FieldValue.arrayUnion(...recipeIds),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await batch.commit();
        }
        await writeAccessGrants(
          recipeIds,
          kitchenTarget.memberIds || [],
          policyRef.id,
          allowCopy
        );
      } else if (target.targetUid) {
        await writeAccessGrants(recipeIds, [target.targetUid], policyRef.id, allowCopy);
      } else {
        await db.collection('invitations').add({
          type: 'recipe-share',
          title: scopeType === 'recipe' ? sourceRecipe.name : 'שיתוף אוסף מתכונים',
          sharePolicyId: policyRef.id,
          inviterUid: currentUser.uid,
          inviterUsername: userProfile.username,
          targetUid: null,
          targetEmail: target.targetEmail,
          status: 'pending',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      closeShareRecipeModal();
      showToast(`שותפו ${recipeIds.length} מתכונים`, 'success');
    } catch (error) {
      console.error('Recipe share failed:', error);
      showToast(
        error.message === 'user-not-found'
          ? 'לא מצאנו את שם המשתמש הזה'
          : 'לא הצלחנו להשלים את השיתוף',
        'error'
      );
    }
  }

  async function acceptInvitation(invitationId) {
    const invitation = pendingInvitations.find(item => item.id === invitationId);
    if (!invitation || !currentUser) return;
    try {
      if (invitation.type === 'kitchen') {
        const kitchenRef = db.collection('kitchens').doc(invitation.kitchenId);
        await db.runTransaction(async transaction => {
          const kitchenSnapshot = await transaction.get(kitchenRef);
          if (!kitchenSnapshot.exists) throw new Error('missing-kitchen');
          const kitchen = kitchenSnapshot.data();
          transaction.update(kitchenRef, {
            memberIds: [...new Set([...(kitchen.memberIds || []), currentUser.uid])],
            [`memberRoles.${currentUser.uid}`]: invitation.role === 'admin' ? 'admin' : 'member',
            lastAcceptedInvitationId: invitationId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          transaction.update(db.collection('invitations').doc(invitationId), {
            status: 'accepted',
            acceptedByUid: currentUser.uid,
            acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        const joinedKitchen = await kitchenRef.get();
        if (
          invitation.role === 'admin' &&
          joinedKitchen.data()?.directoryKey
        ) {
          await db.collection('kitchenDirectory')
            .doc(joinedKitchen.data().directoryKey)
            .update({
              adminUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        await claimJoinedKitchenRecipes(
          joinedKitchen.data()?.recipeIds || [],
          invitation.kitchenId,
          invitationId
        );
        await loadRecipesFromFirestore();
        renderTagFilters();
        renderRecipes();
      } else if (invitation.type === 'recipe-share' && invitation.sharePolicyId) {
        const policySnapshot = await db.collection('sharePolicies')
          .doc(invitation.sharePolicyId)
          .get();
        if (!policySnapshot.exists) throw new Error('missing-policy');
        const policy = { id: policySnapshot.id, ...policySnapshot.data() };
        const recipeIds = CookbookV2Core.resolvePolicyRecipeIds(policy, recipes);
        await writeAccessGrants(
          recipeIds,
          [currentUser.uid],
          policySnapshot.id,
          policy.permissions?.allowCopy !== false
        );
        await db.collection('invitations').doc(invitationId).update({
          status: 'accepted',
          acceptedByUid: currentUser.uid,
          acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      showToast('ההזמנה אושרה', 'success');
    } catch (error) {
      console.error('Invitation acceptance failed:', error);
      showToast('לא הצלחנו לאשר את ההזמנה', 'error');
    }
  }

  async function declineInvitation(invitationId) {
    try {
      await db.collection('invitations').doc(invitationId).update({
        status: 'declined',
        declinedByUid: currentUser.uid,
        declinedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast('ההזמנה נדחתה', 'info');
    } catch (error) {
      console.error('Invitation decline failed:', error);
      showToast('לא הצלחנו לעדכן את ההזמנה', 'error');
    }
  }

  async function copyRecipeToPersonalKitchen(recipeId) {
    const source = recipes.find(recipe => recipe.id === recipeId);
    if (!source || !canCopyRecipeNow(source) || !userProfile) return;
    const copy = CookbookV2Core.createRecipeCopy(source, {
      uid: currentUser.uid,
      username: userProfile.username,
      firstName: userProfile.firstName,
      email: currentUser.email,
      personalKitchenId: userProfile.personalKitchenId
    });
    const ref = db.collection('recipes').doc();
    delete copy.id;
    try {
      await ref.set({
        ...copy,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      recipes.unshift({ id: ref.id, ...copy });
      updateRecipesCache();
      renderTagFilters();
      renderRecipes();
      closeModal();
      showToast(`נוצר עותק אישי מ־@${source.author?.username || 'המקור'}`, 'success');
    } catch (error) {
      console.error('Recipe copy failed:', error);
      showToast('לא הצלחנו ליצור עותק', 'error');
    }
  }

  // Live cooking workspace
  function subscribeToCookingWorkspace(user) {
    if (IS_LOCAL_COOKING_PREVIEW || IS_LOCAL_V2_MOCK_PREVIEW) return;

    if (cookingWorkspaceUnsubscribe) {
      cookingWorkspaceUnsubscribe();
      cookingWorkspaceUnsubscribe = null;
    }

    cookingWorkspace = CookingWorkspaceCore.normalizeWorkspace({});
    cookingPlan = null;
    cookingPlanError = '';
    updateCookingUI();

    if (!user) {
      closeCookingWorkspace();
      return;
    }

    cookingWorkspaceUnsubscribe = db
      .collection('cookingWorkspaces')
      .doc(user.uid)
      .onSnapshot((snapshot) => {
        cookingWorkspace = CookingWorkspaceCore.normalizeWorkspace(
          snapshot.exists ? snapshot.data() : {}
        );
        updateCookingUI();
      }, (error) => {
        console.error('Cooking workspace sync failed:', error);
        showToast('לא הצלחנו לסנכרן את הבישול עכשיו', 'error');
      });
  }

  function getAvailableCookingWorkspace() {
    const availableRecipeIds = recipes.map(recipe => recipe.id);
    return CookingWorkspaceCore.normalizeWorkspace(cookingWorkspace, availableRecipeIds);
  }

  function getCookingRecipes() {
    const availableWorkspace = getAvailableCookingWorkspace();
    return availableWorkspace.recipeIds
      .map(id => recipes.find(recipe => recipe.id === id))
      .filter(Boolean);
  }

  async function persistCookingWorkspace(nextWorkspace, successMessage = '') {
    if (!currentUser) {
      showToast('כדי לשמור בישול עכשיו צריך להתחבר', 'info');
      openAuthModal();
      return false;
    }

    if (isOfflineMode) {
      showToast('בישול עכשיו אינו זמין במצב לא מקוון', 'error');
      return false;
    }

    const previousWorkspace = cookingWorkspace;
    cookingWorkspace = CookingWorkspaceCore.normalizeWorkspace(nextWorkspace);
    updateCookingUI();

    if (IS_LOCAL_COOKING_PREVIEW || IS_LOCAL_V2_MOCK_PREVIEW) {
      if (successMessage) showToast(successMessage, 'success');
      return true;
    }

    try {
      await db.collection('cookingWorkspaces').doc(currentUser.uid).set({
        recipeIds: cookingWorkspace.recipeIds,
        activeRecipeId: cookingWorkspace.activeRecipeId,
        view: cookingWorkspace.view,
        checkedIngredientIds: cookingWorkspace.checkedIngredientIds,
        checkedStepIds: cookingWorkspace.checkedStepIds,
        planCacheKey: cookingWorkspace.planCacheKey,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (successMessage) showToast(successMessage, 'success');
      return true;
    } catch (error) {
      console.error('Failed to save cooking workspace:', error);
      cookingWorkspace = previousWorkspace;
      updateCookingUI();
      showToast('לא הצלחנו לשמור את השינוי', 'error');
      return false;
    }
  }

  async function toggleCookingRecipe(recipeId) {
    if (!currentUser) {
      showToast('התחברו כדי להוסיף מתכונים לבישול עכשיו', 'info');
      openAuthModal();
      return;
    }

    const isIncluded = cookingWorkspace.recipeIds.includes(recipeId);
    const nextWorkspace = invalidateCookingPlan(isIncluded
      ? CookingWorkspaceCore.removeRecipe(cookingWorkspace, recipeId)
      : CookingWorkspaceCore.addRecipe(cookingWorkspace, recipeId));

    if (!isIncluded && nextWorkspace.recipeIds.length === cookingWorkspace.recipeIds.length) {
      showToast(`אפשר לבשל עד ${CookingWorkspaceCore.MAX_RECIPES} מתכונים יחד`, 'info');
      return;
    }

    await persistCookingWorkspace(
      nextWorkspace,
      isIncluded ? 'המתכון הוסר מבישול עכשיו' : 'המתכון נוסף לבישול עכשיו'
    );
  }

  async function selectCookingRecipe(recipeId) {
    const nextWorkspace = CookingWorkspaceCore.selectRecipe(cookingWorkspace, recipeId);
    if (nextWorkspace.activeRecipeId === cookingWorkspace.activeRecipeId) return;
    await persistCookingWorkspace(nextWorkspace);
  }

  async function removeCookingRecipe(recipeId) {
    const nextWorkspace = invalidateCookingPlan(
      CookingWorkspaceCore.removeRecipe(cookingWorkspace, recipeId)
    );
    const saved = await persistCookingWorkspace(nextWorkspace, 'המתכון הוסר מבישול עכשיו');
    if (saved && nextWorkspace.recipeIds.length === 0) closeCookingWorkspace();
  }

  async function clearCookingWorkspace() {
    if (!currentUser) return;

    const previousWorkspace = cookingWorkspace;
    cookingWorkspace = CookingWorkspaceCore.normalizeWorkspace({});
    cookingPlan = null;
    cookingPlanError = '';
    cookingClearConfirm.hidden = true;
    updateCookingUI();
    closeCookingWorkspace();

    if (IS_LOCAL_COOKING_PREVIEW || IS_LOCAL_V2_MOCK_PREVIEW) {
      showToast('המטבח נקי ומוכן לפעם הבאה', 'success');
      return;
    }

    try {
      await db.collection('cookingWorkspaces').doc(currentUser.uid).delete();
      showToast('המטבח נקי ומוכן לפעם הבאה', 'success');
    } catch (error) {
      console.error('Failed to clear cooking workspace:', error);
      cookingWorkspace = previousWorkspace;
      updateCookingUI();
      showToast('לא הצלחנו לנקות את המטבח', 'error');
    }
  }

  function getRecipePrimaryImage(recipe) {
    const privateKey = recipe.content?.privateImageKeys?.find(Boolean);
    const privateUrl = privateKey ? privateImageUrls.get(privateKey) : '';
    if (privateUrl) return privateUrl;
    const uploadedImage = recipe.content?.uploadedImages?.find(Boolean);
    if (uploadedImage) return uploadedImage;

    const localImage = recipe.content?.images?.find(image => image && !image.endsWith('.docx'));
    return localImage ? `images/${localImage}` : '';
  }

  function getCookingRecipeMedia(recipe) {
    const imageUrl = getRecipePrimaryImage(recipe);
    const imageHtml = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(recipe.name || 'מתכון')}" class="cooking-hero-image">`
      : '';
    const sourceHtml = recipe.type === 'video' && recipe.content?.url
      ? getVideoEmbed(recipe.content)
      : '';

    if (!imageHtml && !sourceHtml) {
      const mainCategory = MAIN_CATEGORIES.find(category => category.id === getRecipeMainCategory(recipe));
      return `
        <div class="cooking-media-placeholder" aria-hidden="true">
          <span>${mainCategory?.icon || '🍽️'}</span>
        </div>
      `;
    }

    return `${imageHtml}${sourceHtml}`;
  }

  function invalidateCookingPlan(workspace) {
    cookingPlan = null;
    cookingPlanError = '';
    return {
      ...workspace,
      checkedIngredientIds: [],
      checkedStepIds: [],
      planCacheKey: null
    };
  }

  function buildMockCookingPlan() {
    const selected = getCookingRecipes();
    const structuredRecipes = selected.map(recipe => {
      const lines = String(recipe.content?.text || recipe.content?.transcription || '')
        .split('\n')
        .map(line => line.replace(/^[•\-\d.)\s]+/, '').trim())
        .filter(line => line.length > 3)
        .slice(0, 6);
      return {
        recipeId: recipe.id,
        name: recipe.name,
        ingredients: lines.slice(0, 3).map((text, index) => ({
          id: `ingredient-${recipe.id}-${index}`,
          text
        })),
        steps: lines.slice(3, 6).map((text, index) => ({
          id: `step-${recipe.id}-${index}`,
          text,
          durationMinutes: 0,
          active: true
        }))
      };
    });
    return {
      recipes: structuredRecipes,
      combinedIngredients: structuredRecipes.flatMap(recipe =>
        recipe.ingredients.map((ingredient, index) => ({
          id: `combined-${recipe.recipeId}-${index}`,
          display: ingredient.text,
          normalizedName: ingredient.text,
          sourceIds: [ingredient.id],
          sourceRecipeIds: [recipe.recipeId],
          note: ''
        }))
      ),
      timeline: structuredRecipes.flatMap(recipe =>
        recipe.steps.map((step, index) => ({
          id: `timeline-${recipe.recipeId}-${index}`,
          recipeId: recipe.recipeId,
          recipeName: recipe.name,
          stepId: step.id,
          text: step.text,
          startsAfterMinutes: index * 5,
          durationMinutes: step.durationMinutes,
          active: step.active,
          note: 'יש לאשר זמן לפי המתכון המקורי'
        }))
      ),
      warnings: ['תצוגת בדיקה מקומית — התוכנית החיה תיווצר מהמתכונים באמצעות ניתוח חכם.'],
      cacheKey: 'local-preview'
    };
  }

  async function ensureCookingPlan() {
    if (cookingPlan || cookingPlanLoading || !getCookingRecipes().length) return;
    cookingPlanLoading = true;
    cookingPlanError = '';
    renderCookingWorkspace();
    try {
      const result = IS_LOCAL_V2_MOCK_PREVIEW
        ? buildMockCookingPlan()
        : await callImporter('/cooking-plan', {
            recipes: getCookingRecipes().map(recipe => ({
              id: recipe.id,
              name: recipe.name || '',
              text: recipe.content?.text || recipe.content?.transcription || ''
            }))
          });
      cookingPlan = result;
      cookingWorkspace = CookingWorkspaceCore.normalizeWorkspace({
        ...cookingWorkspace,
        planCacheKey: result.cacheKey || null
      });
      if (!IS_LOCAL_V2_MOCK_PREVIEW) {
        await persistCookingWorkspace(cookingWorkspace);
      }
    } catch (error) {
      console.error('Cooking plan failed:', error);
      cookingPlanError = error.message || 'לא הצלחנו להכין את סביבת הבישול';
    } finally {
      cookingPlanLoading = false;
      renderCookingWorkspace();
    }
  }

  async function selectCookingView(view) {
    const next = CookingWorkspaceCore.selectView(cookingWorkspace, view);
    await persistCookingWorkspace(next);
    if (view !== 'recipes') ensureCookingPlan();
  }

  async function toggleCookingChecklist(kind, itemId) {
    const next = CookingWorkspaceCore.toggleChecklistItem(cookingWorkspace, kind, itemId);
    await persistCookingWorkspace(next);
  }

  function renderCookingPlanStatus() {
    if (cookingPlanLoading) {
      return `
        <div class="cooking-plan-state" role="status">
          <span class="cooking-plan-loader" aria-hidden="true"></span>
          <h3>מסדרים את המטבח</h3>
          <p>קוראים את כל המתכונים ומכינים רשימה ותזמון משותפים.</p>
        </div>
      `;
    }
    if (cookingPlanError) {
      return `
        <div class="cooking-plan-state">
          <h3>התוכנית לא נטענה</h3>
          <p>${escapeHtml(cookingPlanError)}</p>
          <button type="button" data-action="retry-cooking-plan">ניסיון נוסף</button>
        </div>
      `;
    }
    return '';
  }

  function renderCombinedIngredients() {
    const status = renderCookingPlanStatus();
    if (status || !cookingPlan) return status;
    const recipeNames = Object.fromEntries(
      getCookingRecipes().map(recipe => [recipe.id, recipe.name || 'מתכון'])
    );
    const checked = new Set(cookingWorkspace.checkedIngredientIds);
    const items = cookingPlan.combinedIngredients || [];
    return `
      <section class="cooking-plan-view cooking-ingredients-view">
        <header class="cooking-plan-heading">
          <span>רשימה אחת לכל מה שמבשלים</span>
          <h3>מרכיבים משולבים</h3>
          <p>מרכיבים אוחדו רק כשהכמות והיחידה התאימו בבירור. סימון נשמר לחשבון שלך.</p>
        </header>
        ${items.length ? `
          <div class="cooking-checklist">
            ${items.map(item => {
              const isChecked = checked.has(item.id);
              const sources = (item.sourceRecipeIds || [])
                .map(id => recipeNames[id])
                .filter(Boolean)
                .join(' · ');
              return `
                <label class="cooking-check-item ${isChecked ? 'checked' : ''}">
                  <input
                    type="checkbox"
                    data-action="toggle-cooking-check"
                    data-check-kind="ingredient"
                    data-check-id="${escapeHtml(item.id)}"
                    ${isChecked ? 'checked' : ''}
                  >
                  <span class="cooking-check-mark" aria-hidden="true"></span>
                  <span class="cooking-check-copy">
                    <strong>${escapeHtml(item.display)}</strong>
                    ${sources ? `<small>${escapeHtml(sources)}</small>` : ''}
                    ${item.note ? `<em>${escapeHtml(item.note)}</em>` : ''}
                  </span>
                </label>
              `;
            }).join('')}
          </div>
        ` : '<p class="cooking-plan-empty">לא נמצאו שורות מרכיבים שאפשר להציג בבטחה.</p>'}
        ${(cookingPlan.warnings || []).length ? `
          <div class="cooking-plan-warnings">
            ${cookingPlan.warnings.map(warning => `<p>${escapeHtml(warning)}</p>`).join('')}
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderCookingTimeline() {
    const status = renderCookingPlanStatus();
    if (status || !cookingPlan) return status;
    const checked = new Set(cookingWorkspace.checkedStepIds);
    const items = cookingPlan.timeline || [];
    return `
      <section class="cooking-plan-view cooking-timeline-view">
        <header class="cooking-plan-heading">
          <span>סדר עבודה מוצע</span>
          <h3>ציר בישול משותף</h3>
          <p>עבודה פעילה אינה חופפת; זמני המתנה ואפייה יכולים להתקדם במקביל.</p>
        </header>
        ${items.length ? `
          <ol class="cooking-timeline">
            ${items.map(item => {
              const isChecked = checked.has(item.stepId);
              const timeLabel = item.startsAfterMinutes > 0
                ? `בעוד ${item.startsAfterMinutes} דק׳`
                : 'מתחילים עכשיו';
              const duration = item.durationMinutes > 0
                ? `${item.durationMinutes} דק׳`
                : 'ללא זמן מפורש';
              return `
                <li class="${isChecked ? 'checked' : ''}">
                  <label>
                    <input
                      type="checkbox"
                      data-action="toggle-cooking-check"
                      data-check-kind="step"
                      data-check-id="${escapeHtml(item.stepId)}"
                      ${isChecked ? 'checked' : ''}
                    >
                    <span class="cooking-check-mark" aria-hidden="true"></span>
                    <span class="cooking-timeline-time">${timeLabel}</span>
                    <span class="cooking-timeline-copy">
                      <small>${escapeHtml(item.recipeName || '')} · ${item.active ? 'עבודה פעילה' : 'זמן פסיבי'} · ${duration}</small>
                      <strong>${escapeHtml(item.text)}</strong>
                      ${item.note ? `<em>${escapeHtml(item.note)}</em>` : ''}
                    </span>
                  </label>
                </li>
              `;
            }).join('')}
          </ol>
        ` : '<p class="cooking-plan-empty">אין מספיק מידע מפורש כדי לבנות ציר זמן.</p>'}
        ${(cookingPlan.warnings || []).length ? `
          <div class="cooking-plan-warnings">
            ${cookingPlan.warnings.map(warning => `<p>${escapeHtml(warning)}</p>`).join('')}
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderCookingWorkspace() {
    const availableWorkspace = getAvailableCookingWorkspace();
    const cookingRecipes = getCookingRecipes();

    document.querySelectorAll('[data-cooking-view]').forEach(button => {
      const active = button.dataset.cookingView === availableWorkspace.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    cookingViewSwitcher.hidden = cookingRecipes.length === 0;
    cookingRecipeRail.hidden = availableWorkspace.view !== 'recipes';

    if (!cookingRecipes.length) {
      cookingRecipeRail.innerHTML = '';
      cookingStage.innerHTML = `
        <div class="cooking-empty-state">
          <span class="cooking-empty-rule" aria-hidden="true"></span>
          <h3>המטבח מחכה למתכון הראשון</h3>
          <p>חזרו לספר והוסיפו מתכון באמצעות “הוספה לבישול עכשיו”.</p>
          <button type="button" data-action="close-cooking">חזרה לספר המתכונים</button>
        </div>
      `;
      return;
    }

    if (availableWorkspace.view === 'ingredients') {
      cookingStage.innerHTML = renderCombinedIngredients();
      return;
    }

    if (availableWorkspace.view === 'timeline') {
      cookingStage.innerHTML = renderCookingTimeline();
      return;
    }

    const activeRecipe = cookingRecipes.find(
      recipe => recipe.id === availableWorkspace.activeRecipeId
    ) || cookingRecipes[0];
    const activeIndex = cookingRecipes.findIndex(recipe => recipe.id === activeRecipe.id);

    cookingRecipeRail.innerHTML = cookingRecipes.map((recipe, index) => {
      const imageUrl = getRecipePrimaryImage(recipe);
      const isActive = recipe.id === activeRecipe.id;
      const mainCategory = MAIN_CATEGORIES.find(category => category.id === getRecipeMainCategory(recipe));
      const thumbHtml = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="">`
        : `<span class="cooking-rail-placeholder" aria-hidden="true">${mainCategory?.icon || '🍽️'}</span>`;

      return `
        <button
          class="cooking-rail-item ${isActive ? 'active' : ''}"
          type="button"
          data-cooking-recipe-id="${escapeHtml(recipe.id)}"
          aria-current="${isActive ? 'true' : 'false'}"
          aria-label="מעבר למתכון ${index + 1}: ${escapeHtml(recipe.name || '')}"
        >
          <span class="cooking-rail-thumb">${thumbHtml}</span>
          <span class="cooking-rail-name">${escapeHtml(recipe.name || 'מתכון')}</span>
          <span class="cooking-rail-index">${index + 1}</span>
        </button>
      `;
    }).join('');

    const recipeText = activeRecipe.content?.text || activeRecipe.content?.transcription;
    const category = categories.find(item => item.id === getRecipeSubCategory(activeRecipe));
    const sourceLink = activeRecipe.content?.url
      ? `
        <a class="cooking-source-link" href="${escapeHtml(activeRecipe.content.url)}" target="_blank" rel="noopener">
          <span>למקור המתכון</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
        </a>
      `
      : '';

    cookingStage.innerHTML = `
      <article
        class="cooking-recipe ${recipeText ? 'has-recipe-text' : 'without-recipe-text'}"
        data-active-recipe-id="${escapeHtml(activeRecipe.id)}"
      >
        <header class="cooking-recipe-header">
          <div>
            <span class="cooking-recipe-position">${activeIndex + 1} מתוך ${cookingRecipes.length}</span>
            <h3>${escapeHtml(activeRecipe.name || 'מתכון')}</h3>
            ${category ? `<p>${category.icon || ''} ${escapeHtml(category.name || '')}</p>` : ''}
          </div>
          <button
            class="cooking-remove-btn"
            type="button"
            data-action="remove-cooking-recipe"
            data-recipe-id="${escapeHtml(activeRecipe.id)}"
            aria-label="הסרת ${escapeHtml(activeRecipe.name || 'המתכון')} מבישול עכשיו"
          >
            הסרה
          </button>
        </header>

        <div class="cooking-recipe-layout">
          <aside class="cooking-media-column">
            ${getCookingRecipeMedia(activeRecipe)}
          </aside>
          <section class="cooking-copy-column">
            <div class="cooking-copy-heading">
              <span>המתכון</span>
              ${sourceLink}
            </div>
            ${recipeText
              ? `<div class="cooking-recipe-text">${escapeHtml(recipeText)}</div>`
              : `
                <div class="cooking-no-text">
                  <h4>אין עדיין טקסט למתכון הזה</h4>
                  <p>אפשר לבשל מהסרטון או מהקישור למקור שמופיעים לצד המתכון.</p>
                </div>
              `
            }
            ${activeRecipe.notes
              ? `
                <aside class="cooking-notes">
                  <span>הערה</span>
                  <p>${escapeHtml(activeRecipe.notes)}</p>
                </aside>
              `
              : ''
            }
          </section>
        </div>
      </article>
    `;
    cookingStage.scrollTop = 0;

    requestAnimationFrame(() => {
      cookingRecipeRail
        .querySelector('.cooking-rail-item.active')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }

  function updateCookingControls() {
    const selectedIds = new Set(cookingWorkspace.recipeIds);
    document.querySelectorAll('[data-action="toggle-cooking"]').forEach((button) => {
      const isSelected = selectedIds.has(button.dataset.recipeId);
      button.classList.toggle('selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
      button.title = isSelected
        ? (appLanguage === 'en' ? 'Remove from cooking now' : 'הסרה מבישול עכשיו')
        : (appLanguage === 'en' ? 'Add to cooking now' : 'הוספה לבישול עכשיו');
      const label = button.querySelector('.cooking-action-label');
      if (label) label.textContent = isSelected ? ui('cookingActive') : ui('cookingNow');
    });
  }

  function updateCookingUI() {
    const availableWorkspace = getAvailableCookingWorkspace();
    const count = availableWorkspace.recipeIds.length;

    cookingFabCount.textContent = String(count);
    cookingFab.hidden = !currentUser || count === 0 || isCookingWorkspaceOpen;
    cookingFab.setAttribute('aria-expanded', String(isCookingWorkspaceOpen));
    document.body.classList.toggle(
      'has-cooking-fab',
      Boolean(currentUser && count > 0 && !isCookingWorkspaceOpen)
    );
    cookingClearBtn.hidden = count === 0;
    updateCookingControls();

    if (isCookingWorkspaceOpen) renderCookingWorkspace();
  }

  function openCookingWorkspace() {
    if (!currentUser) {
      showToast('התחברו כדי לפתוח את הבישול עכשיו', 'info');
      openAuthModal();
      return;
    }

    if (!getCookingRecipes().length) return;

    cookingReturnFocus = document.activeElement;
    isCookingWorkspaceOpen = true;
    cookingClearConfirm.hidden = true;
    cookingWorkspaceElement.inert = false;
    cookingWorkspaceElement.classList.add('active');
    cookingWorkspaceElement.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cooking-workspace-open');
    document.body.style.overflow = 'hidden';
    updateCookingUI();
    if (cookingWorkspace.view !== 'recipes') ensureCookingPlan();
    cookingStage.focus({ preventScroll: true });
  }

  function closeCookingWorkspace() {
    const wasOpen = isCookingWorkspaceOpen;
    const returnFocus = cookingReturnFocus;
    isCookingWorkspaceOpen = false;
    cookingWorkspaceElement.classList.remove('active');
    cookingWorkspaceElement.setAttribute('aria-hidden', 'true');
    cookingWorkspaceElement.inert = true;
    document.body.classList.remove('cooking-workspace-open');
    document.body.style.overflow = '';
    cookingClearConfirm.hidden = true;
    updateCookingUI();
    cookingReturnFocus = null;

    if (wasOpen && returnFocus && !returnFocus.hidden && document.contains(returnFocus)) {
      returnFocus.focus({ preventScroll: true });
    }
  }

  function moveBetweenCookingRecipes(direction) {
    const availableWorkspace = getAvailableCookingWorkspace();
    const currentIndex = availableWorkspace.recipeIds.indexOf(availableWorkspace.activeRecipeId);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= availableWorkspace.recipeIds.length) return;
    selectCookingRecipe(availableWorkspace.recipeIds[nextIndex]);
  }

  // Initialize
  async function init() {
    showLoading(true);
    categories = CATEGORIES;

    // Setup theme first (before any UI renders)
    initTheme();
    setupThemeToggle();
    initLanguage();
    setupLanguageToggle();

    // Start auth resolution while the static UI is prepared.
    const initialAuthReady = setupAuth();

    // Setup UI immediately
    renderCategories();
    populateCategorySelect();
    setupEventListeners();
    renderImportTagSelector();

    // Query the correct viewer's library once instead of racing a public load
    // against the restored signed-in session.
    await initialAuthReady;

    // Try to load from localStorage cache first for instant display
    // Note: localStorage may not be available in private browsing mode
    let cached = null;
    let cacheAge = Infinity;

    try {
      if (COOKBOOK_V2_ENABLED) {
        // A shared browser must never expose one user's private library to the
        // next signed-out session through a device-wide recipe cache.
        localStorage.removeItem('recipes_cache');
        localStorage.removeItem('recipes_cache_time');
      } else {
        cached = localStorage.getItem('recipes_cache');
        const cacheTime = localStorage.getItem('recipes_cache_time');
        cacheAge = cacheTime ? Date.now() - parseInt(cacheTime) : Infinity;
      }
    } catch (e) {
      // localStorage not available (private browsing mode)
      console.log('localStorage not available:', e.message);
    }

    if (cached && cacheAge < 5 * 60 * 1000) { // Cache valid for 5 minutes
      try {
        recipes = JSON.parse(cached);
        applyLocalV2PreviewMetadata();
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
      if (COOKBOOK_V2_ENABLED && currentUser && userProfile?.onboardingComplete) {
        subscribeToV2Data();
      }
    } catch (error) {
      console.error('Failed to load from Firestore:', error);

      // Try expired cache as last resort (better than nothing)
      if (cached) {
        try {
          recipes = JSON.parse(cached);
          applyLocalV2PreviewMetadata();
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
            applyLocalV2PreviewMetadata();
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

  async function fetchRecipeDocumentsIndividually(recipeIds) {
    const documents = await Promise.all((recipeIds || []).map(async recipeId => {
      try {
        const snapshot = await db.collection('recipes').doc(recipeId).get();
        return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
      } catch (error) {
        // A grant may have been revoked between reading recipeAccess and the
        // recipe itself. Skip only that stale grant; surface real failures.
        if (error.code !== 'permission-denied' && error.code !== 'not-found') throw error;
        return null;
      }
    }));
    return documents.filter(Boolean);
  }

  async function fetchRecipeDocumentsById(recipeIds) {
    const ids = [...new Set((recipeIds || []).filter(Boolean))];
    if (!ids.length) return [];

    const chunks = [];
    for (let index = 0; index < ids.length; index += 30) {
      chunks.push(ids.slice(index, index + 30));
    }

    const chunkResults = await Promise.all(chunks.map(async chunk => {
      try {
        const snapshot = await db.collection('recipes')
          .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
          .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (error) {
        // A stale grant can reject a whole batched query. Retain the previous
        // per-document fallback only for that exceptional chunk.
        if (error.code === 'permission-denied' || error.code === 'not-found') {
          return fetchRecipeDocumentsIndividually(chunk);
        }
        throw error;
      }
    }));

    return chunkResults.flat();
  }

  // Load only the public catalogue plus recipes the current user may read.
  async function loadRecipesFromFirestore() {
    const requestId = ++recipeLoadRequestId;
    const viewerUid = COOKBOOK_V2_ENABLED ? (currentUser?.uid || '') : '';
    const startTime = Date.now();
    console.log(`[Firestore] Starting ${viewerUid ? 'private' : 'public'} recipe load...`);

    try {
      let loadedRecipes;

      if (IS_LOCAL_PUBLIC_DEMO_PREVIEW && !viewerUid) {
        const response = await fetch('recipes.json');
        const payload = await response.json();
        loadedRecipes = payload.recipes || [];
      } else if (!COOKBOOK_V2_ENABLED) {
        const snapshot = await db.collection('recipes').get();
        if (snapshot.empty) throw new Error('No recipes in Firestore');
        loadedRecipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } else {
        const publicPromise = db.collection('recipes')
          .where('visibility', '==', 'public')
          .get();
        const ownerPromise = viewerUid
          ? db.collection('recipes').where('ownerUid', '==', viewerUid).get()
          : Promise.resolve(null);
        const accessPromise = viewerUid
          ? db.collection('users').doc(viewerUid).collection('recipeAccess').get()
          : Promise.resolve(null);

        const [publicSnapshot, ownerSnapshot, accessSnapshot] = await Promise.all([
          publicPromise,
          ownerPromise,
          accessPromise
        ]);
        const ownerRecipes = ownerSnapshot
          ? ownerSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          : [];
        const ownedIds = new Set(ownerRecipes.map(recipe => recipe.id));
        const accessIds = accessSnapshot
          ? accessSnapshot.docs
              .filter(doc => doc.data().active !== false)
              .map(doc => doc.id)
              .filter(recipeId => !ownedIds.has(recipeId))
          : [];
        const accessedRecipes = await fetchRecipeDocumentsById(accessIds);
        const byId = new Map();
        [
          ...publicSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
          ...ownerRecipes,
          ...accessedRecipes
        ].forEach(recipe => byId.set(recipe.id, recipe));
        loadedRecipes = [...byId.values()];

        recipeAccess = new Map(
          (accessSnapshot?.docs || []).map(doc => [doc.id, doc.data()])
        );
        recipeAccessIds = new Set(
          [...recipeAccess.entries()]
            .filter(([, access]) => access.active !== false)
            .map(([recipeId]) => recipeId)
        );
      }

      if (
        requestId !== recipeLoadRequestId ||
        (COOKBOOK_V2_ENABLED && viewerUid !== (currentUser?.uid || ''))
      ) {
        return;
      }

      const elapsed = Date.now() - startTime;
      console.log(`[Firestore] Accessible recipe load completed in ${elapsed}ms`);

      if (!loadedRecipes.length) throw new Error('No accessible recipes in Firestore');
      recipes = loadedRecipes;
      applyLocalV2PreviewMetadata();
      console.log(`[Firestore] Loaded ${recipes.length} recipes`);

      // Sort client-side (faster than waiting for Firestore index)
      recipes.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });

      // Cache for next load
      updateRecipesCache();
      refreshPrivateImageUrls();
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[Firestore] Failed after ${elapsed}ms:`, error.code, error.message);
      console.error('[Firestore] Full error:', error);
      throw error;
    }
  }

  // Update localStorage cache after any mutation
  function updateRecipesCache() {
    if (COOKBOOK_V2_ENABLED) return;
    try {
      localStorage.setItem('recipes_cache', JSON.stringify(recipes));
      localStorage.setItem('recipes_cache_time', Date.now().toString());
    } catch (e) {
      // localStorage might be full or unavailable, ignore
    }
  }

  function applyLocalV2PreviewMetadata() {
    if (!IS_LOCAL_V2_MOCK_PREVIEW) return;
    recipes = recipes.map((recipe, index) => {
      if (IS_LOCAL_INTELLIGENCE_PREVIEW && index === 0) {
        const existingText = recipeSourceText(recipe);
        return {
          ...recipe,
          isDemo: false,
          ownerUid: 'tal-preview',
          homeKitchenId: 'personal_tal-preview',
          sharedKitchenIds: ['schreiber'],
          editorUids: ['tal-preview'],
          visibility: 'private',
          author: { uid: 'tal-preview', username: 'tal', firstName: 'טל' },
          content: {
            ...(recipe.content || {}),
            textMeta: { source: 'human', protected: true }
          },
          intelligence: {
            ...(recipe.intelligence || {}),
            extractionCandidate: {
              text: `${existingText}\n\nהצעה חדשה: להוסיף בסיום מעט קליפת לימון טרייה.`,
              artifactKey: 'local-preview-artifact',
              pipelineVersion: 'extraction-v1'
            }
          }
        };
      }
      if (recipe.ownerUid) return recipe;
      const ownerKey = (recipe.tags || []).includes('einav') ? 'einav' : 'tal';
      const ownerUid = ownerKey === 'einav' ? 'einav-preview' : 'tal-preview';
      return {
        ...recipe,
        schemaVersion: CookbookV2Core.RECIPE_SCHEMA_VERSION,
        ownerUid,
        homeKitchenId: `personal_${ownerUid}`,
        sharedKitchenIds: ['schreiber'],
        editorUids: ['tal-preview', 'einav-preview'],
        visibility: 'public',
        author: {
          uid: ownerUid,
          username: ownerKey,
          firstName: ownerKey === 'einav' ? 'עינב' : 'טל'
        }
      };
    });
    favoriteIds = new Set(recipes.slice(0, 4).map(recipe => recipe.id));
  }

  // Show/hide loading
  function showLoading(show) {
    loading.classList.toggle('active', show);
    recipesContainer.style.display = show ? 'none' : 'grid';
    if (show) recipeCount.textContent = ui('loadingRecipes');
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
        <span class="category-name">${ui('all')}</span>
      </button>
    `;

    MAIN_CATEGORIES.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `category-btn main-cat ${currentMainCategory === cat.id ? 'active' : ''}`;
      btn.dataset.mainCategory = cat.id;
      btn.innerHTML = `
        <span class="category-icon">${cat.icon}</span>
        <span class="category-name">${localizedCategoryName(cat)}</span>
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
        ${ui('all')}
      </button>
    `;

    const subCats = SUB_CATEGORIES[currentMainCategory] || [];
    subCats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `sub-category-btn ${currentSubCategory === cat.id ? 'active' : ''}`;
      btn.dataset.subCategory = cat.id;
      btn.innerHTML = `${cat.icon} ${localizedCategoryName(cat)}`;
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

    // Legacy uploader tags remain useful inside signed-in family libraries, but
    // a new public visitor should only see filters represented by demo recipes.
    const tagsToShow = AVAILABLE_TAGS.filter(
      tag => tagCounts[tag.id] > 0 || (tag.alwaysShow && currentUser)
    );

    const favoritesPill = COOKBOOK_V2_ENABLED && currentUser
      ? `
        <button
          class="tag-filter-pill system-favorite ${favoritesFilterActive ? 'active' : ''}"
          data-system-filter="favorites"
          aria-pressed="${favoritesFilterActive}"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3 2.7 5.48 6.05.88-4.38 4.27 1.03 6.03L12 16.82l-5.4 2.84 1.03-6.03-4.38-4.27 6.05-.88L12 3Z"/>
          </svg>
          ${ui('favorites')} <span class="tag-count">(${favoriteIds.size})</span>
        </button>
      `
      : '';

    container.innerHTML = favoritesPill + tagsToShow.map(tag => `
      <button class="tag-filter-pill ${currentTags.includes(tag.id) ? 'active' : ''}"
              data-tag="${tag.id}"
              style="--tag-color: ${tag.color}">
        ${tag.icon} ${localizedTagName(tag)} <span class="tag-count">(${tagCounts[tag.id]})</span>
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
      if (
        currentUser &&
        isDemoRecipe(recipe) &&
        hiddenDemoRecipeIds.has(recipe.id)
      ) {
        return false;
      }

      if (
        COOKBOOK_V2_ENABLED &&
        !CookbookV2Core.canViewRecipe(recipe, getViewerContext())
      ) {
        return false;
      }

      const libraryMatch = !COOKBOOK_V2_ENABLED || CookbookV2Core.recipeMatchesLibrary(
        recipe,
        {
          scope: selectedLibraryKitchenId ? 'kitchen' : currentLibraryScope,
          kitchenId: selectedLibraryKitchenId,
          uid: currentUser?.uid,
          legacyOwnerTag: currentUser ? EMAIL_TO_TAG[currentUser.email] : null,
          favoriteIds,
          recipeAccessIds,
          kitchenRoles
        }
      );

      if (!libraryMatch) return false;
      if (favoritesFilterActive && !favoriteIds.has(recipe.id)) return false;

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

    if (
      (IS_LOCAL_COOKING_PREVIEW || IS_LOCAL_V2_MOCK_PREVIEW) &&
      !hasSeededCookingPreview &&
      recipes.length >= 3
    ) {
      cookingWorkspace = CookingWorkspaceCore.normalizeWorkspace({
        recipeIds: recipes.slice(0, 3).map(recipe => recipe.id),
        activeRecipeId: recipes[0].id
      });
      hasSeededCookingPreview = true;
    }

    // Build category name for display
    let categoryName = '';
    if (currentMainCategory === 'all') {
      categoryName = ui('all');
    } else {
      const mainCat = MAIN_CATEGORIES.find(c => c.id === currentMainCategory);
      categoryName = localizedCategoryName(mainCat);
      if (currentSubCategory !== 'all') {
        const subCat = (SUB_CATEGORIES[currentMainCategory] || []).find(c => c.id === currentSubCategory);
        if (subCat) categoryName = localizedCategoryName(subCat);
      }
    }
    recipeCount.textContent = appLanguage === 'en'
      ? `${filtered.length} ${ui('recipes')}${categoryName ? ` in ${categoryName}` : ''}`
      : `${filtered.length} מתכונים ${categoryName ? 'ב' + categoryName : ''}`;

    if (filtered.length === 0) {
      recipesContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <p class="empty-state-text">${appLanguage === 'en' ? 'No recipes found' : 'לא נמצאו מתכונים'}</p>
        </div>
      `;
      updateCookingUI();
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
      const privateImageKey = recipe.content?.privateImageKeys?.find(Boolean);
      const privateImageUrl = privateImageKey ? privateImageUrls.get(privateImageKey) : '';
      const localImageFile = hasLocalImage ? recipe.content.images[0] : null;
      const uploadedImageUrl = hasUploadedImage ? recipe.content.uploadedImages[0] : null;
      const isDocx = localImageFile && localImageFile.endsWith('.docx');

      // Get tags
      const recipeTags = recipe.tags || autoTagRecipe(recipe);
      const visibleTags = recipeTags
        .map(tagId => AVAILABLE_TAGS.find(tag => tag.id === tagId))
        .filter(Boolean);
      const tagHtml = visibleTags.slice(0, 2).map(tag => {
        return `<span class="recipe-tag-pill" title="${escapeHtml(localizedTagName(tag))}">${escapeHtml(localizedTagName(tag))}</span>`;
      }).join('') + (visibleTags.length > 2
        ? `<span class="recipe-tag-more">+${visibleTags.length - 2}</span>`
        : '');
      const authorUsername = recipe.author?.username || '';
      const demoRecipe = isDemoRecipe(recipe);
      const demoBadgeHtml = demoRecipe
        ? '<span class="recipe-demo-badge" aria-label="Demo recipe">DEMO</span>'
        : '';
      const originHtml = COOKBOOK_V2_ENABLED && authorUsername
        ? `<div class="recipe-origin-line">מאת @${escapeHtml(authorUsername)}</div>`
        : '';
      const provenanceHtml = COOKBOOK_V2_ENABLED && recipe.provenance?.kind === 'copy'
        ? `<div class="recipe-provenance">עותק מ־@${escapeHtml(recipe.provenance.sourceUsername || 'המקור')}</div>`
        : '';
      const favoriteHtml = COOKBOOK_V2_ENABLED && currentUser
        ? `
          <button
            class="favorite-button ${favoriteIds.has(recipe.id) ? 'active' : ''}"
            type="button"
            data-action="toggle-favorite"
            data-recipe-id="${escapeHtml(recipe.id)}"
            aria-pressed="${favoriteIds.has(recipe.id)}"
            aria-label="${favoriteIds.has(recipe.id) ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}"
            title="${favoriteIds.has(recipe.id) ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m12 3 2.7 5.48 6.05.88-4.38 4.27 1.03 6.03L12 16.82l-5.4 2.84 1.03-6.03-4.38-4.27 6.05-.88L12 3Z"/>
            </svg>
          </button>
        `
        : '';

      // Build category display: "Main > Sub" format
      const categoryDisplay = mainCat && subCat
        ? `${localizedCategoryName(mainCat)} · ${localizedCategoryName(subCat)}`
        : (subCat ? localizedCategoryName(subCat) : '');

      let imageHtml;
      if (privateImageUrl) {
        imageHtml = `<img src="${escapeHtml(privateImageUrl)}" alt="${escapeHtml(recipe.name || '')}" class="recipe-image" loading="lazy">`;
      } else if (uploadedImageUrl) {
        imageHtml = `<img src="${uploadedImageUrl}" alt="${recipe.name}" class="recipe-image" loading="lazy" onerror="this.classList.add('placeholder'); this.outerHTML='<div class=\\'recipe-image placeholder\\'>${mainCat?.icon || '🍽️'}</div>';">`;
      } else if (hasLocalImage && !isDocx) {
        imageHtml = `<img src="images/${localImageFile}" alt="${recipe.name}" class="recipe-image" loading="lazy" onerror="this.classList.add('placeholder'); this.outerHTML='<div class=\\'recipe-image placeholder\\'>${mainCat?.icon || '🍽️'}</div>';">`;
      } else {
        imageHtml = `<div class="recipe-image placeholder">${mainCat?.icon || subCat?.icon || '🍽️'}</div>`;
      }

      return `
        <article class="recipe-card ${COOKBOOK_V2_ENABLED ? 'has-v2-controls' : ''} ${demoRecipe ? 'recipe-card-demo' : ''}" data-id="${escapeHtml(recipe.id)}">
          ${imageHtml}
          ${demoBadgeHtml}
          ${favoriteHtml}
          <button
            class="cooking-card-add"
            type="button"
            data-action="toggle-cooking"
            data-recipe-id="${escapeHtml(recipe.id)}"
            aria-pressed="false"
            title="${appLanguage === 'en' ? 'Add to cooking now' : 'הוספה לבישול עכשיו'}"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path class="cooking-icon-pot" d="M5 11.5h14M7 11.5v-1a5 5 0 0 1 10 0v1M4 11.5v1.25A5.25 5.25 0 0 0 9.25 18h5.5A5.25 5.25 0 0 0 20 12.75V11.5M12 5.5V4"/>
              <path class="cooking-icon-check" d="m7.5 12.5 3 3 6-7"/>
            </svg>
            <span class="cooking-action-label">${ui('cookingNow')}</span>
          </button>
          <div class="recipe-info">
            <h2 class="recipe-name">${escapeHtml(recipe.name || '')}</h2>
            ${originHtml}
            <div class="recipe-meta">
              <span class="recipe-tag type-${recipe.type}">${ui(recipe.type) || type.label}</span>
              <span class="recipe-tag category-hierarchy">${categoryDisplay}</span>
            </div>
            ${tagHtml ? `<div class="recipe-tags">${tagHtml}</div>` : ''}
            ${provenanceHtml}
          </div>
        </article>
      `;
    }).join('');
    updateCookingUI();
    openPendingSharedRecipe();
  }

  function openPendingSharedRecipe() {
    if (!pendingSharedRecipeId || currentRecipeId) return;
    const recipe = recipes.find(item => item.id === pendingSharedRecipeId);
    if (!recipe || hiddenDemoRecipeIds.has(recipe.id)) return;
    pendingSharedRecipeId = '';
    requestAnimationFrame(() => openRecipe(recipe.id));
  }

  // Open recipe modal
  function openRecipe(id) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return;

    currentRecipeId = id;
    const recipeCanEdit = canEditRecipeNow(recipe);
    const category = categories.find(c => c.id === recipe.category);
    const date = formatDate(recipe.date);

    let contentHtml = '';

    // Video cards keep their extracted thumbnail in the grid, but lead with
    // the playable embed when opened so the still image is not repeated.
    if (recipe.type !== 'video') {
      const privateImageKeys = recipe.content?.privateImageKeys || [];
      const privateImages = privateImageKeys
        .map(key => privateImageUrls.get(key))
        .filter(Boolean);
      if (privateImages.length === 1) {
        contentHtml += `<img src="${escapeHtml(privateImages[0])}" alt="${escapeHtml(recipe.name || '')}" class="modal-image">`;
      } else if (privateImages.length > 1) {
        contentHtml += `
          <div class="images-gallery">
            ${privateImages.map(image => `<img src="${escapeHtml(image)}" alt="${escapeHtml(recipe.name || '')}">`).join('')}
          </div>
        `;
      }

      if (recipe.content?.uploadedImages && recipe.content.uploadedImages.length > 0) {
        const images = recipe.content.uploadedImages;
        if (images.length === 1) {
          contentHtml += `<img src="${escapeHtml(images[0])}" alt="${escapeHtml(recipe.name || '')}" class="modal-image">`;
        } else {
          contentHtml += `
            <div class="images-gallery">
              ${images.map(img => `<img src="${escapeHtml(img)}" alt="${escapeHtml(recipe.name || '')}">`).join('')}
            </div>
          `;
        }
      }

      if (recipe.content?.images && recipe.content.images.length > 0) {
        const images = recipe.content.images.filter(img => !img.endsWith('.docx'));
        if (images.length === 1) {
          contentHtml += `<img src="images/${escapeHtml(images[0])}" alt="${escapeHtml(recipe.name || '')}" class="modal-image">`;
        } else if (images.length > 1) {
          contentHtml += `
            <div class="images-gallery">
              ${images.map(img => `<img src="images/${escapeHtml(img)}" alt="${escapeHtml(recipe.name || '')}">`).join('')}
            </div>
          `;
        }
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
        <div class="transcription-box recipe-reading-box" style="width: 100%; margin-bottom: 12px;">
          <div class="recipe-reading-header">
            <h4 id="recipe-text-heading">${appLanguage === 'en' ? 'Recipe text' : 'טקסט המתכון'}</h4>
            ${isHumanProtectedText(recipe)
              ? '<span class="human-lock-badge">עריכה אנושית מוגנת</span>'
              : ''}
            <div class="recipe-language-toggle" role="group" aria-label="${appLanguage === 'en' ? 'Recipe language' : 'שפת המתכון'}">
              <button type="button" class="${appLanguage === 'he' ? 'active' : ''}" data-action="set-recipe-language" data-language="he" aria-pressed="${appLanguage === 'he'}">
                ${appLanguage === 'en' ? 'Original' : 'מקור'}
              </button>
              <button type="button" class="${appLanguage === 'en' ? 'active' : ''}" data-action="set-recipe-language" data-language="en" aria-pressed="${appLanguage === 'en'}">
                English
              </button>
            </div>
          </div>
          <p id="recipe-text-content" dir="auto">${escapeHtml(recipeText)}</p>
          <div class="recipe-translation-status" id="recipe-translation-status" aria-live="polite"></div>
          <button
            type="button"
            class="intelligence-text-action"
            id="edit-translation-btn"
            data-action="edit-translation"
            hidden
          >תיקון התרגום</button>
          ${recipeCanEdit ? `<button class="recipe-modal-action add-transcription-btn" data-action="edit-transcription" style="margin-top: 12px;">
            עריכת טקסט
          </button>` : ''}
        </div>
      `;
    }

    const extractionCandidate = recipe.intelligence?.extractionCandidate;
    if (recipeCanEdit && extractionCandidate?.text) {
      contentHtml += `
        <section class="generation-review" aria-labelledby="generation-review-title">
          <div class="generation-review-heading">
            <div>
              <span class="generation-review-eyebrow">הצעה חדשה — הטקסט השמור לא השתנה</span>
              <h3 id="generation-review-title">בדיקת חילוץ מחדש</h3>
            </div>
            <span class="human-lock-badge">עריכה אנושית מוגנת</span>
          </div>
          <div class="generation-compare">
            <article>
              <span>הטקסט השמור</span>
              <pre>${escapeHtml(recipeText || 'אין עדיין טקסט שמור')}</pre>
            </article>
            <article class="candidate">
              <span>החילוץ החדש</span>
              <pre>${escapeHtml(extractionCandidate.text)}</pre>
            </article>
          </div>
          <div class="generation-review-actions">
            <button type="button" class="recipe-v2-action" data-action="dismiss-extraction-candidate">
              שמירת הטקסט הקיים
            </button>
            <button type="button" class="recipe-modal-action generation-apply" data-action="apply-extraction-candidate">
              החלפה בחילוץ החדש
            </button>
          </div>
        </section>
      `;
    }

    // Action buttons container (only show edit buttons if user can edit)
    contentHtml += `<div class="recipe-action-buttons">`;

    contentHtml += `
      <button
        class="recipe-modal-action modal-cooking-btn"
        data-action="toggle-cooking"
        data-recipe-id="${escapeHtml(recipe.id)}"
        aria-pressed="false"
        title="הוספה לבישול עכשיו"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path class="cooking-icon-pot" d="M5 11.5h14M7 11.5v-1a5 5 0 0 1 10 0v1M4 11.5v1.25A5.25 5.25 0 0 0 9.25 18h5.5A5.25 5.25 0 0 0 20 12.75V11.5M12 5.5V4"/>
          <path class="cooking-icon-check" d="m7.5 12.5 3 3 6-7"/>
        </svg>
        <span class="cooking-action-label">לבישול עכשיו</span>
      </button>
    `;

    // Extraction is available for both website links and social/video posts.
    // Keep it visible when text already exists so a weak extraction can be rerun.
    if (
      recipeCanEdit &&
      recipe.content?.url &&
      (recipe.type === 'link' || recipe.type === 'video')
    ) {
      const extractionSource = recipe.type === 'video' ? 'מהפוסט' : 'מהאתר';
      const extractionAction = recipeText ? 'חלץ מחדש' : 'חלץ מתכון';
      const extractionLabel = `${extractionAction} ${extractionSource}`;
      contentHtml += `
        <button
          class="recipe-modal-action extract-recipe-btn"
          data-action="extract-recipe"
          data-idle-label="${extractionLabel}"
          title="${recipe.type === 'video'
            ? 'בדיקת תיאור הפוסט והתגובה הראשונה של היוצר'
            : 'בדיקת עמוד המקור המלא'}"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a7.5 7.5 0 1 0 .45 7.2M19 8V3.5M19 8h-4.5"/></svg>
          ${extractionLabel}
        </button>
      `;
    }

    // Show manual add-text button only if no text exists
    if (!recipeText) {
      if (recipeCanEdit) {
        contentHtml += `
          <button class="recipe-modal-action add-transcription-btn" data-action="add-transcription">
            הוספת טקסט מתכון
          </button>
        `;
      }
    }

    // Edit tags button (only if can edit)
    if (recipeCanEdit) {
      contentHtml += `
        <button class="recipe-modal-action add-image-btn" data-action="edit-image">
          ${(recipe.content?.uploadedImages?.length || recipe.content?.privateImageKeys?.length) ? 'החלפת תמונה' : 'הוספת תמונה'}
        </button>
        <button class="recipe-modal-action edit-tags-btn" data-action="edit-tags">
          עריכת תגיות
        </button>
        <button class="recipe-modal-action edit-category-btn" data-action="edit-category">
          עריכת פרטים
        </button>
      `;
    }

    contentHtml += `</div>`;

    if (COOKBOOK_V2_ENABLED && currentUser) {
      const isOwner = recipe.ownerUid === currentUser.uid;
      const sourceUsername = recipe.provenance?.sourceUsername || '';
      if (sourceUsername) {
        contentHtml += `
          <div class="recipe-provenance">עותק מ־@${escapeHtml(sourceUsername)}</div>
        `;
      }
      contentHtml += `
        <div class="recipe-v2-actions">
          ${recipeCanEdit ? `
            <button
              type="button"
              class="recipe-v2-action"
              data-action="share-recipe"
              data-recipe-id="${escapeHtml(recipe.id)}"
            >שיתוף</button>
          ` : ''}
          ${!isOwner && canCopyRecipeNow(recipe) ? `
            <button
              type="button"
              class="recipe-v2-action"
              data-action="copy-recipe"
              data-recipe-id="${escapeHtml(recipe.id)}"
            >יצירת עותק במטבח שלי</button>
          ` : ''}
        </div>
      `;
    }

    // Display current tags
    const recipeTags = recipe.tags || autoTagRecipe(recipe);
    if (recipeTags.length > 0) {
      contentHtml += `
        <div class="recipe-tags-display">
            <span class="tags-label">${appLanguage === 'en' ? 'Tags:' : 'תגיות:'}</span>
          ${recipeTags.map(tagId => {
            const tag = AVAILABLE_TAGS.find(t => t.id === tagId);
            return tag ? `<span class="tag-display-pill">${escapeHtml(localizedTagName(tag))}</span>` : '';
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

    const canRemoveDemo = Boolean(currentUser && isDemoRecipe(recipe));
    modalDelete.classList.toggle('hidden', !recipeCanEdit && !canRemoveDemo);
    modalDelete.title = canRemoveDemo && !recipeCanEdit
      ? 'הסרה מהמתכונים שלי'
      : 'מחיקת המתכון';
    modalDelete.setAttribute('aria-label', modalDelete.title);
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    updateCookingControls();
    if (recipeText && appLanguage === 'en') {
      showRecipeLanguage(recipe.id, 'en');
    }
  }

  async function showRecipeLanguage(recipeId, language) {
    const recipe = recipes.find(item => item.id === recipeId);
    const textElement = document.getElementById('recipe-text-content');
    const titleElement = modalBody.querySelector('.modal-title');
    const statusElement = document.getElementById('recipe-translation-status');
    const editTranslationButton = document.getElementById('edit-translation-btn');
    if (!recipe || !textElement || currentRecipeId !== recipeId) return;

    document.querySelectorAll('.recipe-language-toggle button').forEach(button => {
      const active = button.dataset.language === language;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const sourceText = recipe.content?.text || recipe.content?.transcription || '';
    if (language !== 'en') {
      textElement.textContent = sourceText;
      textElement.dir = 'auto';
      if (titleElement) titleElement.textContent = recipe.name || '';
      if (statusElement) statusElement.textContent = '';
      if (editTranslationButton) editTranslationButton.hidden = true;
      return;
    }

    if (!currentUser) {
      showToast(appLanguage === 'en' ? 'Sign in to translate recipes' : 'התחברו כדי לתרגם מתכונים', 'info');
      openAuthModal();
      return;
    }

    const sourceHash = await sha256Content(`${recipe.name || ''}\n${sourceText}`);
    const personalOverride = await loadPersonalRecipeOverride(recipeId);
    if (currentRecipeId !== recipeId) return;
    const personalTranslation = personalOverride?.translations?.en;
    const canonicalTranslation = recipe.intelligence?.translations?.en;
    const humanTranslation = personalTranslation || canonicalTranslation;
    if (humanTranslation?.text) {
      activeTranslationByRecipe.set(recipeId, humanTranslation);
      textElement.textContent = humanTranslation.text;
      textElement.dir = 'ltr';
      if (titleElement) titleElement.textContent = humanTranslation.title || recipe.name || '';
      if (statusElement) {
        statusElement.textContent = humanTranslation.sourceHash &&
          humanTranslation.sourceHash !== sourceHash
          ? 'המקור השתנה מאז התיקון האנושי. התיקון נשמר ולא הוחלף.'
          : (personalTranslation ? 'התיקון האישי שלך' : 'תרגום שתוקן ונשמר');
      }
      if (editTranslationButton) editTranslationButton.hidden = false;
      return;
    }

    const cached = translationCache.get(recipeId);
    if (cached) {
      activeTranslationByRecipe.set(recipeId, cached);
      textElement.textContent = cached.text || sourceText;
      textElement.dir = 'ltr';
      if (titleElement) titleElement.textContent = cached.title || recipe.name || '';
      if (statusElement) statusElement.textContent = '';
      if (editTranslationButton) editTranslationButton.hidden = false;
      return;
    }
    if (translationLoadingIds.has(recipeId)) return;

    translationLoadingIds.add(recipeId);
    textElement.classList.add('translation-loading');
    if (statusElement) {
      statusElement.textContent = appLanguage === 'en'
        ? 'Translating carefully…'
        : 'מתרגמים בקפידה…';
    }
    try {
      const translation = IS_LOCAL_V2_MOCK_PREVIEW
        ? {
            title: `${recipe.name || 'Recipe'} — English preview`,
            text: 'English preview\n\nThe production service translates every ingredient, quantity, temperature, and instruction while preserving the original structure.'
          }
        : await callImporter('/translate', {
            recipeId,
            title: recipe.name || '',
            text: sourceText
          });
      translationCache.set(recipeId, translation);
      activeTranslationByRecipe.set(recipeId, translation);
      if (currentRecipeId === recipeId) {
        textElement.textContent = translation.text || sourceText;
        textElement.dir = 'ltr';
        if (titleElement) titleElement.textContent = translation.title || recipe.name || '';
        if (statusElement) {
          statusElement.textContent = translation.cached
            ? (appLanguage === 'en' ? 'Saved translation' : 'תרגום שמור')
            : '';
        }
        if (editTranslationButton) editTranslationButton.hidden = false;
      }
    } catch (error) {
      console.error('Recipe translation failed:', error);
      if (statusElement) {
        statusElement.textContent = appLanguage === 'en'
          ? 'Translation is unavailable right now.'
          : 'התרגום אינו זמין כרגע.';
      }
      showToast(
        appLanguage === 'en' ? 'Could not translate this recipe' : 'לא הצלחנו לתרגם את המתכון',
        'error'
      );
    } finally {
      translationLoadingIds.delete(recipeId);
      textElement.classList.remove('translation-loading');
    }
  }

  async function loadPersonalRecipeOverride(recipeId) {
    if (!currentUser || !COOKBOOK_V2_ENABLED) return null;
    if (IS_LOCAL_V2_MOCK_PREVIEW) {
      return personalRecipeOverrides.get(recipeId) || null;
    }
    if (personalRecipeOverrides.has(recipeId)) {
      return personalRecipeOverrides.get(recipeId);
    }
    try {
      const snapshot = await db.collection('users').doc(currentUser.uid)
        .collection('recipeOverrides').doc(recipeId).get();
      const value = snapshot.exists ? snapshot.data() : null;
      personalRecipeOverrides.set(recipeId, value);
      return value;
    } catch (error) {
      console.error('Personal recipe override load failed:', error);
      return null;
    }
  }

  function openTranslationEditModal() {
    const recipe = recipes.find(item => item.id === currentRecipeId);
    const translation = activeTranslationByRecipe.get(currentRecipeId);
    if (!recipe || !translation || !currentUser) return;
    translationTitleInput.value = translation.title || recipe.name || '';
    translationTextInput.value = translation.text || '';
    const canSaveCanonical = canEditRecipeNow(recipe);
    translationScopeChoice.hidden = !canSaveCanonical;
    translationSaveCanonical.checked = canSaveCanonical;
    translationEditModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => translationTitleInput.focus());
  }

  function closeTranslationEditModal() {
    translationEditModal.classList.remove('active');
    translationTitleInput.value = '';
    translationTextInput.value = '';
    if (!document.querySelector('.modal.active')) document.body.style.overflow = '';
  }

  function addRecipeRevisionToBatch(batch, recipe, kind, value) {
    const revisionRef = db.collection('recipes').doc(recipe.id)
      .collection('revisions').doc();
    batch.set(revisionRef, {
      kind,
      value,
      editorUid: currentUser.uid,
      editorEmail: currentUser.email || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function saveTranslationCorrection() {
    const recipe = recipes.find(item => item.id === currentRecipeId);
    const title = translationTitleInput.value.trim();
    const text = translationTextInput.value.trim();
    if (!recipe || !currentUser || !text) {
      showToast('נא להזין את טקסט התרגום', 'error');
      return;
    }

    const sourceHash = await sha256Content(
      `${recipe.name || ''}\n${recipeSourceText(recipe)}`
    );
    const correction = {
      title: title || recipe.name || '',
      text,
      targetLanguage: 'en',
      source: 'human',
      sourceHash,
      editedByUid: currentUser.uid,
      editedByUsername: userProfile?.username || '',
      editedAt: new Date().toISOString()
    };
    const saveCanonical = canEditRecipeNow(recipe) && translationSaveCanonical.checked;
    const textNode = translationEditSave.querySelector('.btn-text');
    const loadingNode = translationEditSave.querySelector('.btn-loading');
    translationEditSave.disabled = true;
    textNode.hidden = true;
    loadingNode.hidden = false;

    try {
      if (saveCanonical) {
        const batch = db.batch();
        addRecipeRevisionToBatch(
          batch,
          recipe,
          'translation-en',
          recipe.intelligence?.translations?.en || null
        );
        batch.update(db.collection('recipes').doc(recipe.id), {
          'intelligence.translations.en': correction
        });
        const personal = personalRecipeOverrides.get(recipe.id);
        if (personal?.translations?.en) {
          batch.set(
            db.collection('users').doc(currentUser.uid)
              .collection('recipeOverrides').doc(recipe.id),
            {
              'translations.en': firebase.firestore.FieldValue.delete(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
        await batch.commit();
        recipe.intelligence = recipe.intelligence || {};
        recipe.intelligence.translations = recipe.intelligence.translations || {};
        recipe.intelligence.translations.en = correction;
        if (personal?.translations) {
          const translations = { ...personal.translations };
          delete translations.en;
          personalRecipeOverrides.set(recipe.id, { ...personal, translations });
        }
      } else {
        await db.collection('users').doc(currentUser.uid)
          .collection('recipeOverrides').doc(recipe.id).set({
            translations: { en: correction },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        const existing = personalRecipeOverrides.get(recipe.id) || {};
        personalRecipeOverrides.set(recipe.id, {
          ...existing,
          translations: {
            ...(existing.translations || {}),
            en: correction
          }
        });
      }
      activeTranslationByRecipe.set(recipe.id, correction);
      closeTranslationEditModal();
      await showRecipeLanguage(recipe.id, 'en');
      showToast(saveCanonical ? 'התיקון נשמר לכל מי שרואה את המתכון' : 'התיקון האישי נשמר', 'success');
    } catch (error) {
      console.error('Translation correction save failed:', error);
      showToast('לא הצלחנו לשמור את התיקון', 'error');
    } finally {
      translationEditSave.disabled = false;
      textNode.hidden = false;
      loadingNode.hidden = true;
    }
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

  async function shareCurrentRecipe() {
    const recipe = recipes.find(item => item.id === currentRecipeId);
    if (!recipe) return;

    const shareUrl = new URL(window.location.origin + window.location.pathname);
    shareUrl.searchParams.set('recipe', recipe.id);
    const shareData = {
      title: recipe.name || 'Levashel',
      text: `${recipe.name || 'מתכון'} · Levashel`,
      url: shareUrl.toString()
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(shareData.url);
      showToast('הקישור למתכון הועתק', 'success');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('Recipe share failed:', error);
        showToast('לא הצלחנו לשתף את המתכון', 'error');
      }
    }
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
    const recipe = recipes.find(r => r.id === id);
    const canRemoveDemo = Boolean(currentUser && isDemoRecipe(recipe));
    if (!recipe || (!canEditRecipeNow(recipe) && !canRemoveDemo)) {
      showToast('אין לך הרשאה למחוק מתכונים. התחבר עם חשבון מורשה.', 'error');
      return;
    }

    document.getElementById('delete-recipe-name').textContent = recipe.name;
    const title = document.getElementById('delete-dialog-title');
    const note = document.getElementById('delete-dialog-note');
    if (canRemoveDemo && !canEditRecipeNow(recipe)) {
      title.textContent = 'להסיר את מתכון ההדגמה?';
      note.textContent = 'המתכון יוסר רק מהתצוגה שלך. עותק ההדגמה המשותף לא יימחק.';
      note.hidden = false;
      confirmDeleteBtn.textContent = 'הסרה';
    } else {
      title.textContent = 'למחוק את המתכון?';
      note.textContent = '';
      note.hidden = true;
      confirmDeleteBtn.textContent = 'מחק';
    }
    deleteModal.classList.add('active');
  }

  async function confirmDelete() {
    if (!currentRecipeId) return;
    const recipe = recipes.find(item => item.id === currentRecipeId);
    const removeDemo = Boolean(
      currentUser &&
      isDemoRecipe(recipe) &&
      !canEditRecipeNow(recipe)
    );
    if (!recipe || (!canEditRecipeNow(recipe) && !removeDemo)) return;

    try {
      if (removeDemo) {
        await db.collection('users').doc(currentUser.uid).set({
          hiddenDemoRecipeIds: firebase.firestore.FieldValue.arrayUnion(currentRecipeId),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        hiddenDemoRecipeIds.add(currentRecipeId);
        userProfile = {
          ...(userProfile || {}),
          hiddenDemoRecipeIds: [...hiddenDemoRecipeIds]
        };
        renderRecipes();
        showToast('מתכון ההדגמה הוסר מהתצוגה שלך', 'success');
        closeModal();
        deleteModal.classList.remove('active');
        return;
      }

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
        const storedImage = await uploadRecipeImage(
          docRef.id,
          formData.image,
          COOKBOOK_V2_ENABLED
        );
        if (storedImage.protected && storedImage.privateKey) {
          formData.content.privateImageKeys = [storedImage.privateKey];
          privateImageUrls.set(storedImage.privateKey, storedImage.url);
        } else {
          formData.content.uploadedImages = [storedImage.url];
        }
      }
      if (formData.content?.text) {
        formData.content.textMeta = {
          source: importDraft ? 'human-approved' : 'human',
          protected: true,
          editedByUid: currentUser?.uid || '',
          editedByUsername: userProfile?.username || '',
          editedAt: new Date().toISOString()
        };
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
        addedBy: currentUser?.email || null,
        ...(COOKBOOK_V2_ENABLED && userProfile?.onboardingComplete ? {
          schemaVersion: CookbookV2Core.RECIPE_SCHEMA_VERSION,
          ownerUid: currentUser.uid,
          homeKitchenId: userProfile.personalKitchenId,
          sharedKitchenIds: [],
          visibility: 'private',
          author: {
            uid: currentUser.uid,
            username: userProfile.username,
            firstName: userProfile.firstName
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } : {})
      };

      await docRef.set(newRecipe);
      newRecipe.id = docRef.id;
      if (COOKBOOK_V2_ENABLED) await applyFutureSharePoliciesToRecipe(newRecipe);

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
    recipeImageAnalysisRequest += 1;
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
        recipeId: recipe.id,
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
      const [image, analysisImage] = await Promise.all([
        compressImageFile(file, {
          maxDimension: 1_600,
          maxBytes: 900_000,
          quality: 0.84
        }),
        compressImageFile(file, {
          maxDimension: 2_400,
          maxBytes: 2_500_000,
          quality: 0.9
        })
      ]);
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
      await analyzeUploadedRecipeImage(analysisImage, selectedRecipeImage);
    } catch (error) {
      console.error('Image preparation failed:', error);
      recipeImageInput.value = '';
      showToast(error.message || 'לא הצלחנו להכין את התמונה', 'error');
    }
  }

  async function analyzeUploadedRecipeImage(analysisImage, selectedImage) {
    if (!currentUser || !canEdit || !IMPORTER_URL) return;

    const requestId = ++recipeImageAnalysisRequest;
    document.getElementById('selected-image-size').textContent = 'בודק אם יש בתמונה מתכון…';

    try {
      const result = await callImporter('/analyze-image', {
        dataUrl: analysisImage.dataUrl,
        categories: categories.map(category => ({ id: category.id, name: category.name })),
        tags: AVAILABLE_TAGS.map(tag => ({ id: tag.id, name: tag.name }))
      });
      if (requestId !== recipeImageAnalysisRequest || selectedRecipeImage !== selectedImage) return;

      if (result.recipeFound && result.draft?.recipeText) {
        applyImageRecipeDraft(result.draft);
        document.getElementById('selected-image-size').textContent = 'זוהה טקסט של מתכון';
        showToast('טקסט המתכון חולץ מהתמונה', 'success');
        return;
      }

      const classificationLabel = {
        food_photo: 'צילום מנה',
        other_text: 'לא זוהה טקסט של מתכון',
        other: 'תמונה נבחרה'
      }[result.classification] || 'תמונה נבחרה';
      document.getElementById('selected-image-size').textContent =
        `${classificationLabel} · ${formatFileSize(selectedImage.bytes)}`;
    } catch (error) {
      if (requestId !== recipeImageAnalysisRequest || selectedRecipeImage !== selectedImage) return;
      console.error('Recipe image analysis failed:', error);
      document.getElementById('selected-image-size').textContent = formatFileSize(selectedImage.bytes);
    }
  }

  function applyImageRecipeDraft(draft) {
    const nameInput = document.getElementById(
      currentFormTab === 'link' ? 'recipe-name-link' : 'recipe-name-text'
    );
    const textInput = document.getElementById(
      currentFormTab === 'link' ? 'recipe-text-link' : 'recipe-text'
    );
    if (!nameInput.value.trim()) nameInput.value = draft.title || '';
    if (!textInput.value.trim()) textInput.value = draft.recipeText;

    if (draft.suggestedCategoryId) {
      const categorySelect = document.getElementById('recipe-category');
      const option = [...categorySelect.options].find(
        item => item.value === draft.suggestedCategoryId
      );
      if (option) {
        categorySelect.value = draft.suggestedCategoryId;
        const suggestion = document.getElementById('category-suggestion');
        suggestion.textContent = `הצעה מהתמונה: ${option.textContent.trim()}`;
        suggestion.hidden = false;
      }
    }

    const personTag = currentUser ? EMAIL_TO_TAG[currentUser.email] : null;
    importSelectedTags = [...new Set([
      ...importSelectedTags,
      ...(personTag ? [personTag] : []),
      ...(draft.suggestedTags || [])
    ])];
    importTagsTouched = true;
    renderImportTagSelector();
    setImportStep(2);
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
    recipeImageAnalysisRequest += 1;
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
      context.fillStyle = '#f7f4ed';
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

  async function uploadRecipeImage(recipeId, image, isPrivate = false) {
    return callImporter('/images', {
      recipeId,
      private: Boolean(isPrivate),
      ...(image.dataUrl ? { dataUrl: image.dataUrl } : { sourceUrl: image.sourceUrl })
    });
  }

  function openEditImageModal() {
    if (!currentRecipeId) return;
    const recipe = recipes.find(item => item.id === currentRecipeId);
    if (!recipe || !canEditRecipeNow(recipe)) return;
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
    if (!currentRecipeId || !editingRecipeImage) return;
    const recipeId = currentRecipeId;
    const recipe = recipes.find(item => item.id === recipeId);
    if (!recipe || !canEditRecipeNow(recipe)) return;

    const btnText = saveEditImageBtn.querySelector('.btn-text');
    const btnLoading = saveEditImageBtn.querySelector('.btn-loading');
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    saveEditImageBtn.disabled = true;

    try {
      const usePrivateStorage = COOKBOOK_V2_ENABLED && recipe.visibility !== 'public';
      const stored = await uploadRecipeImage(recipeId, editingRecipeImage, usePrivateStorage);
      if (!recipe.content) recipe.content = {};
      if (stored.protected && stored.privateKey) {
        recipe.content.privateImageKeys = [stored.privateKey];
        recipe.content.uploadedImages = [];
        privateImageUrls.set(stored.privateKey, stored.url);
        await db.collection('recipes').doc(recipeId).update({
          'content.privateImageKeys': [stored.privateKey],
          'content.uploadedImages': []
        });
      } else {
        recipe.content.uploadedImages = [stored.url];
        await db.collection('recipes').doc(recipeId).update({
          'content.uploadedImages': [stored.url]
        });
      }
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

      if (btn.dataset.systemFilter === 'favorites') {
        favoritesFilterActive = !favoritesFilterActive;
        renderTagFilters();
        renderRecipes();
        return;
      }

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
      const favoriteButton = e.target.closest('[data-action="toggle-favorite"]');
      if (favoriteButton) {
        e.stopPropagation();
        toggleFavorite(favoriteButton.dataset.recipeId);
        return;
      }

      const cookingButton = e.target.closest('[data-action="toggle-cooking"]');
      if (cookingButton) {
        e.stopPropagation();
        toggleCookingRecipe(cookingButton.dataset.recipeId);
        return;
      }

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
    modalShare.addEventListener('click', shareCurrentRecipe);

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
        if (isCookingWorkspaceOpen) {
          closeCookingWorkspace();
        } else if (settingsModal.classList.contains('active')) {
          closeSettingsModal();
        } else if (editImageModal.classList.contains('active')) {
          closeEditImageModal();
        } else if (editTagsModal.classList.contains('active')) {
          closeEditTagsModal();
        } else if (transcriptionModal.classList.contains('active')) {
          closeTranscriptionModal();
        } else if (translationEditModal.classList.contains('active')) {
          closeTranslationEditModal();
        } else if (deleteModal.classList.contains('active')) {
          deleteModal.classList.remove('active');
        } else if (addModal.classList.contains('active')) {
          closeAddModal();
        } else if (modal.classList.contains('active')) {
          closeModal();
        }
      } else if (isCookingWorkspaceOpen && e.key === 'ArrowLeft') {
        moveBetweenCookingRecipes(1);
      } else if (isCookingWorkspaceOpen && e.key === 'ArrowRight') {
        moveBetweenCookingRecipes(-1);
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
      } else if (action === 'apply-extraction-candidate') {
        applyExtractionCandidate();
      } else if (action === 'dismiss-extraction-candidate') {
        dismissExtractionCandidate();
      } else if (action === 'edit-translation') {
        openTranslationEditModal();
      } else if (action === 'toggle-cooking') {
        toggleCookingRecipe(btn.dataset.recipeId);
      } else if (action === 'share-recipe') {
        openShareRecipeModal(btn.dataset.recipeId);
      } else if (action === 'copy-recipe') {
        copyRecipeToPersonalKitchen(btn.dataset.recipeId);
      } else if (action === 'set-recipe-language') {
        showRecipeLanguage(currentRecipeId, btn.dataset.language);
      }
    });

    cookingFab.addEventListener('click', openCookingWorkspace);
    cookingWorkspaceClose.addEventListener('click', closeCookingWorkspace);
    cookingClearBtn.addEventListener('click', () => {
      cookingClearConfirm.hidden = false;
      cookingClearConfirm.querySelector('button')?.focus();
    });
    cookingClearCancel.addEventListener('click', () => {
      cookingClearConfirm.hidden = true;
      cookingClearBtn.focus();
    });
    cookingClearConfirmBtn.addEventListener('click', clearCookingWorkspace);

    cookingRecipeRail.addEventListener('click', (e) => {
      const recipeButton = e.target.closest('[data-cooking-recipe-id]');
      if (recipeButton) selectCookingRecipe(recipeButton.dataset.cookingRecipeId);
    });

    cookingViewSwitcher.addEventListener('click', (e) => {
      const viewButton = e.target.closest('[data-cooking-view]');
      if (!viewButton) return;
      selectCookingView(viewButton.dataset.cookingView);
    });

    cookingStage.addEventListener('click', (e) => {
      const actionButton = e.target.closest('[data-action]');
      if (!actionButton) return;

      if (actionButton.dataset.action === 'remove-cooking-recipe') {
        removeCookingRecipe(actionButton.dataset.recipeId);
      } else if (actionButton.dataset.action === 'close-cooking') {
        closeCookingWorkspace();
      } else if (actionButton.dataset.action === 'toggle-cooking-check') {
        toggleCookingChecklist(
          actionButton.dataset.checkKind,
          actionButton.dataset.checkId
        );
      } else if (actionButton.dataset.action === 'retry-cooking-plan') {
        cookingPlan = null;
        cookingPlanError = '';
        ensureCookingPlan();
      }
    });

    cookingStage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button, a, iframe')) return;
      cookingSwipeStart = { x: e.clientX, y: e.clientY };
    });

    cookingStage.addEventListener('pointerup', (e) => {
      if (!cookingSwipeStart) return;
      const deltaX = e.clientX - cookingSwipeStart.x;
      const deltaY = e.clientY - cookingSwipeStart.y;
      cookingSwipeStart = null;

      if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
      moveBetweenCookingRecipes(deltaX < 0 ? 1 : -1);
    });

    cookingStage.addEventListener('pointercancel', () => {
      cookingSwipeStart = null;
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

    translationEditClose.addEventListener('click', closeTranslationEditModal);
    translationEditCancel.addEventListener('click', closeTranslationEditModal);
    translationEditSave.addEventListener('click', saveTranslationCorrection);
    translationEditModal.addEventListener('click', (e) => {
      if (e.target === translationEditModal) closeTranslationEditModal();
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
    publicIntroSignin?.addEventListener('click', signInWithGoogle);
    signoutBtn.addEventListener('click', signOut);

    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });

    if (COOKBOOK_V2_ENABLED) {
      libraryToolbar.addEventListener('click', (e) => {
        const button = e.target.closest('[data-library-scope]');
        if (!button) return;
        currentLibraryScope = button.dataset.libraryScope;
        selectedLibraryKitchenId = '';
        libraryKitchenSelect.value = '';
        renderV2Chrome();
        renderRecipes();
      });

      libraryKitchenSelect.addEventListener('change', (e) => {
        selectedLibraryKitchenId = e.target.value;
        if (selectedLibraryKitchenId) currentLibraryScope = 'all';
        renderV2Chrome();
        renderRecipes();
      });

      onboardingForm.addEventListener('submit', saveV2Profile);
      document.getElementById('onboarding-signout').addEventListener('click', signOut);
      document.getElementById('edit-profile-btn').addEventListener('click', () => {
        closeAuthModal();
        openOnboardingModal(true);
      });

      document.getElementById('create-kitchen-btn').addEventListener('click', openCreateKitchenModal);
      createKitchenForm.addEventListener('submit', createSharedKitchen);
      document.getElementById('create-kitchen-close').addEventListener('click', closeCreateKitchenModal);
      document.getElementById('create-kitchen-cancel').addEventListener('click', closeCreateKitchenModal);
      createKitchenModal.addEventListener('click', (e) => {
        if (e.target === createKitchenModal) closeCreateKitchenModal();
      });

      document.getElementById('request-kitchen-access-btn')
        .addEventListener('click', openRequestKitchenAccessModal);
      requestKitchenAccessForm.addEventListener('submit', requestKitchenAccess);
      document.getElementById('request-kitchen-access-close')
        .addEventListener('click', closeRequestKitchenAccessModal);
      document.getElementById('request-kitchen-access-cancel')
        .addEventListener('click', closeRequestKitchenAccessModal);
      requestKitchenAccessModal.addEventListener('click', (e) => {
        if (e.target === requestKitchenAccessModal) closeRequestKitchenAccessModal();
      });

      inviteKitchenForm.addEventListener('submit', inviteToKitchen);
      document.getElementById('invite-kitchen-close').addEventListener('click', closeInviteKitchenModal);
      document.getElementById('invite-kitchen-cancel').addEventListener('click', closeInviteKitchenModal);
      inviteKitchenModal.addEventListener('click', (e) => {
        if (e.target === inviteKitchenModal) closeInviteKitchenModal();
      });

      document.getElementById('account-kitchen-list').addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'invite-kitchen') {
          openInviteKitchenModal(action.dataset.kitchenId);
        } else if (action.dataset.action === 'open-kitchen') {
          selectedLibraryKitchenId = action.dataset.kitchenId;
          currentLibraryScope = 'all';
          closeAuthModal();
          renderV2Chrome();
          renderRecipes();
        }
      });

      document.getElementById('account-invitation-list').addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'accept-invitation') {
          acceptInvitation(action.dataset.invitationId);
        } else if (action.dataset.action === 'decline-invitation') {
          declineInvitation(action.dataset.invitationId);
        }
      });

      document.getElementById('account-access-request-list').addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]');
        if (!action) return;
        const requestId = action.dataset.requestId;
        if (action.dataset.action === 'approve-access-request') {
          const item = action.closest('[data-request-id]');
          const kitchenId = item?.querySelector('[data-access-kitchen]')?.value;
          approveKitchenAccessRequest(requestId, kitchenId);
        } else if (action.dataset.action === 'decline-access-request') {
          declineKitchenAccessRequest(requestId);
        }
      });

      shareRecipeForm.addEventListener('submit', shareRecipes);
      document.getElementById('share-scope-type').addEventListener('change', populateShareScopeValues);
      document.getElementById('share-recipe-close').addEventListener('click', closeShareRecipeModal);
      document.getElementById('share-recipe-cancel').addEventListener('click', closeShareRecipeModal);
      shareRecipeModal.addEventListener('click', (e) => {
        if (e.target === shareRecipeModal) closeShareRecipeModal();
      });
    }
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
    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe || !canEditRecipeNow(recipe)) {
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
      const batch = db.batch();
      addRecipeRevisionToBatch(batch, recipe, 'recipe-text', {
        text: recipeSourceText(recipe),
        textMeta: recipe.content?.textMeta || null
      });
      const textMeta = {
        source: 'human',
        protected: true,
        editedByUid: currentUser.uid,
        editedByUsername: userProfile?.username || '',
        editedAt: new Date().toISOString()
      };
      batch.update(db.collection('recipes').doc(currentRecipeId), {
        'content.text': text,
        'content.textMeta': textMeta
      });
      await batch.commit();

      if (!recipe.content) recipe.content = {};
      recipe.content.text = text;
      recipe.content.textMeta = textMeta;

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

  async function applyExtractionCandidate() {
    const recipe = recipes.find(item => item.id === currentRecipeId);
    const candidate = recipe?.intelligence?.extractionCandidate;
    if (!recipe || !candidate?.text || !canEditRecipeNow(recipe)) return;

    try {
      const recipeRef = db.collection('recipes').doc(recipe.id);
      const revisionRef = recipeRef.collection('revisions').doc();
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(recipeRef);
        if (!snapshot.exists) throw new Error('missing-recipe');
        const stored = snapshot.data();
        const storedCandidate = stored.intelligence?.extractionCandidate;
        if (!storedCandidate?.text || storedCandidate.text !== candidate.text) {
          throw new Error('candidate-changed');
        }
        transaction.set(revisionRef, {
          kind: 'recipe-text',
          value: {
            text: stored.content?.text || stored.content?.transcription || '',
            textMeta: stored.content?.textMeta || null
          },
          editorUid: currentUser.uid,
          editorEmail: currentUser.email || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        transaction.update(recipeRef, {
          'content.text': storedCandidate.text,
          'content.textMeta': {
            source: 'human-approved',
            protected: true,
            artifactKey: storedCandidate.artifactKey || '',
            pipelineVersion: storedCandidate.pipelineVersion || 'extraction-v1',
            editedByUid: currentUser.uid,
            editedByUsername: userProfile?.username || '',
            editedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          'intelligence.extractionCandidate': firebase.firestore.FieldValue.delete()
        });
      });
      recipe.content = recipe.content || {};
      recipe.content.text = candidate.text;
      recipe.content.textMeta = {
        source: 'human-approved',
        protected: true,
        artifactKey: candidate.artifactKey || '',
        editedByUid: currentUser.uid
      };
      delete recipe.intelligence.extractionCandidate;
      openRecipe(recipe.id);
      showToast('החילוץ החדש אושר ונשמר. הפעלות עתידיות לא יחליפו אותו.', 'success');
    } catch (error) {
      console.error('Extraction candidate apply failed:', error);
      showToast(
        error.message === 'candidate-changed'
          ? 'נוצרה בינתיים הצעה חדשה. פתחו מחדש כדי לבדוק אותה.'
          : 'לא הצלחנו לשמור את החילוץ',
        'error'
      );
    }
  }

  async function dismissExtractionCandidate() {
    const recipe = recipes.find(item => item.id === currentRecipeId);
    if (!recipe || !canEditRecipeNow(recipe)) return;
    try {
      await db.collection('recipes').doc(recipe.id).update({
        'intelligence.extractionCandidate': firebase.firestore.FieldValue.delete()
      });
      if (recipe.intelligence) delete recipe.intelligence.extractionCandidate;
      openRecipe(recipe.id);
      showToast('הטקסט השמור נשאר ללא שינוי', 'success');
    } catch (error) {
      console.error('Extraction candidate dismiss failed:', error);
      showToast('לא הצלחנו לסגור את ההצעה', 'error');
    }
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
    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe || !canEditRecipeNow(recipe)) {
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

  async function reconcileRecipeFromServer(recipeId) {
    if (!recipeId || !COOKBOOK_V2_ENABLED) return null;
    try {
      const snapshot = await db.collection('recipes').doc(recipeId)
        .get({ source: 'server' });
      if (!snapshot.exists) return null;
      const storedRecipe = { id: snapshot.id, ...snapshot.data() };
      const index = recipes.findIndex(item => item.id === recipeId);
      if (index !== -1) recipes[index] = storedRecipe;
      return storedRecipe;
    } catch (error) {
      console.error('Recipe reconciliation failed:', error);
      return null;
    }
  }

  // Recipe extraction function
  async function extractRecipeFromUrl() {
    if (!currentRecipeId) return;
    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe || !canEditRecipeNow(recipe) || !recipe.content?.url) return;

    const url = recipe.content.url;
    const extractBtn = document.querySelector('.extract-recipe-btn');

    const idleLabel = extractBtn?.dataset.idleLabel || 'חלץ מתכון';
    const isSocialVideo = recipe.type === 'video';

    if (extractBtn) {
      extractBtn.disabled = true;
      extractBtn.setAttribute('aria-busy', 'true');
      extractBtn.textContent = isSocialVideo
        ? 'בודק תיאור ותגובה ראשונה…'
        : 'קורא את עמוד המתכון…';
    }

    try {
      const result = await callImporter('/extract', {
        recipeId: recipe.id,
        url,
        socialText: '',
        screenshots: [],
        categories: categories.map(category => ({ id: category.id, name: category.name })),
        tags: AVAILABLE_TAGS.map(tag => ({ id: tag.id, name: tag.name }))
      });
      const recipeText = result.draft?.recipeText?.trim();

      if (recipeText && recipeText.length > 50) {
        const recipeRef = db.collection('recipes').doc(currentRecipeId);
        const candidate = {
          text: recipeText,
          artifactKey: result.artifactKey || '',
          pipelineVersion: result.pipelineVersion || 'extraction-v1',
          generatedByUid: currentUser.uid,
          generatedAt: new Date().toISOString()
        };
        const outcome = await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(recipeRef);
          if (!snapshot.exists) throw new Error('המתכון כבר לא קיים');
          const stored = snapshot.data();
          const storedText = stored.content?.text || stored.content?.transcription || '';
          if (storedText.trim()) {
            transaction.update(recipeRef, {
              'intelligence.extractionCandidate': candidate
            });
            return 'candidate';
          }
          transaction.update(recipeRef, {
            'content.text': recipeText,
            'content.textMeta': {
              source: 'generated',
              protected: false,
              artifactKey: result.artifactKey || '',
              pipelineVersion: result.pipelineVersion || 'extraction-v1',
              generatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }
          });
          return 'applied-empty';
        });

        if (!recipe.content) recipe.content = {};
        if (outcome === 'candidate') {
          recipe.intelligence = recipe.intelligence || {};
          recipe.intelligence.extractionCandidate = candidate;
          showToast('החילוץ החדש מוכן לבדיקה. הטקסט השמור לא השתנה.', 'success');
        } else {
          recipe.content.text = recipeText;
          recipe.content.textMeta = {
            source: 'generated',
            protected: false,
            artifactKey: result.artifactKey || '',
            pipelineVersion: result.pipelineVersion || 'extraction-v1'
          };
          showToast('המתכון חולץ ונשמר', 'success');
        }
        updateRecipesCache();
        openRecipe(currentRecipeId); // Refresh modal
      } else {
        throw new Error(result.warning || 'לא נמצא מספיק טקסט. אפשר להוסיף אותו ידנית.');
      }
    } catch (error) {
      console.error('Extraction failed:', error);
      const permissionDenied = error.code === 'permission-denied' ||
        /insufficient permissions/i.test(error.message || '');
      if (permissionDenied) {
        const storedRecipe = await reconcileRecipeFromServer(recipe.id);
        if (storedRecipe && currentRecipeId === recipe.id) openRecipe(recipe.id);
        showToast(
          'החילוץ הסתיים, אבל לחשבון אין הרשאה לשמור במתכון הזה. הטקסט לא נשמר.',
          'error'
        );
      } else {
        showToast(error.message || 'שגיאה בחילוץ המתכון. נסה העלאה ידנית.', 'error');
      }
    } finally {
      if (extractBtn) {
        extractBtn.disabled = false;
        extractBtn.removeAttribute('aria-busy');
        extractBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a7.5 7.5 0 1 0 .45 7.2M19 8V3.5M19 8h-4.5"/></svg> ${idleLabel}`;
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
    showToast(appLanguage === 'en' ? 'Settings saved' : 'ההגדרות נשמרו', 'success');
    closeSettingsModal();
  }

  function initLanguage() {
    try {
      appLanguage = localStorage.getItem('language') === 'en' ? 'en' : 'he';
    } catch (error) {
      appLanguage = 'he';
    }
    applyLanguage(appLanguage, false);
  }

  function applyLanguage(language, rerender = true) {
    appLanguage = language === 'en' ? 'en' : 'he';
    const html = document.documentElement;
    html.lang = appLanguage;
    html.dir = appLanguage === 'en' ? 'ltr' : 'rtl';

    try {
      localStorage.setItem('language', appLanguage);
    } catch (error) {
      // localStorage may be unavailable in private browsing.
    }

    document.querySelectorAll('.language-btn').forEach(button => {
      const active = button.dataset.language === appLanguage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const copy = UI_COPY[appLanguage];
    const eyebrow = document.querySelector('.header-eyebrow');
    const title = document.querySelector('.header-brand h1');
    if (eyebrow) eyebrow.textContent = copy.eyebrow;
    if (title) title.textContent = copy.title;
    if (settingsBtn) {
      settingsBtn.title = copy.settings;
      settingsBtn.setAttribute('aria-label', copy.settings);
      settingsBtn.querySelector('.header-action-label').textContent = copy.settings;
    }
    if (searchInput) searchInput.placeholder = copy.search;
    if (publicIntro) {
      publicIntro.querySelector('.public-intro-eyebrow')?.replaceChildren(
        copy.publicIntroEyebrow
      );
      publicIntro.querySelector('h2')?.replaceChildren(copy.publicIntroTitle);
      publicIntro.querySelector('.public-intro-copy p')?.replaceChildren(
        copy.publicIntroBody
      );
      publicIntro.querySelectorAll('.public-intro-steps span').forEach((step, index) => {
        const number = document.createElement('b');
        number.textContent = String(index + 1).padStart(2, '0');
        step.replaceChildren(number, ` ${copy.publicIntroSteps[index]}`);
      });
      const actionText = document.createTextNode(copy.publicIntroAction);
      const actionIcon = publicIntroSignin?.querySelector('svg');
      publicIntroSignin?.replaceChildren(actionText);
      if (actionIcon) publicIntroSignin.append(actionIcon);
    }
    document.querySelector('[data-library-scope="all"]')?.replaceChildren(copy.all);
    document.querySelector('[data-library-scope="mine"]')?.replaceChildren(copy.mine);
    document.querySelector('[data-library-scope="shared"]')?.replaceChildren(copy.shared);
    document.querySelector('.kitchen-picker > span')?.replaceChildren(copy.kitchen);
    document.querySelector('.tags-filter-label')?.replaceChildren(copy.filterTags);
    const addRecipeLabel = addRecipeBtn?.querySelector('span')?.nextSibling;
    if (addRecipeLabel) addRecipeLabel.textContent = ` ${copy.addRecipe}`;
    const settingTitle = document.getElementById('language-setting-title');
    const settingNote = document.getElementById('language-setting-note');
    if (settingTitle) settingTitle.textContent = appLanguage === 'en' ? 'Language' : 'שפה';
    if (settingNote) {
      settingNote.textContent = appLanguage === 'en'
        ? 'In English, recipe text is translated precisely when you open it. Quantities, times, and temperatures stay exactly as written.'
        : 'באנגלית, טקסט המתכון מתורגם במדויק כשפותחים אותו. כמויות, זמנים וטמפרטורות נשארים כפי שנכתבו.';
    }
    document.querySelector('#settings-modal .modal-title')?.replaceChildren(
      appLanguage === 'en' ? 'Settings' : 'הגדרות'
    );
    const cookingFabLabel = cookingFab?.querySelector('span:not(.cooking-fab-count)');
    if (cookingFabLabel) {
      cookingFabLabel.textContent = appLanguage === 'en'
        ? 'I’m cooking now'
        : 'אני במטבח עכשיו';
    }
    document.querySelector('.cooking-workspace-heading > span')?.replaceChildren(
      appLanguage === 'en' ? 'LIVE COOKING' : 'בישול חי'
    );
    document.getElementById('cooking-workspace-title')?.replaceChildren(
      appLanguage === 'en' ? 'I’m cooking now' : 'אני במטבח עכשיו'
    );
    if (cookingClearBtn) {
      cookingClearBtn.textContent = appLanguage === 'en' ? 'Clear kitchen' : 'ניקוי המטבח';
    }
    const cookingViewLabels = appLanguage === 'en'
      ? { recipes: 'Recipes', ingredients: 'Ingredients', timeline: 'Timeline' }
      : { recipes: 'מתכונים', ingredients: 'רשימת מרכיבים', timeline: 'ציר בישול' };
    document.querySelectorAll('[data-cooking-view]').forEach(button => {
      button.textContent = cookingViewLabels[button.dataset.cookingView];
    });
    updateAuthUI();

    if (rerender && isInitialized) {
      renderCategories();
      populateCategorySelect();
      renderTagFilters();
      renderV2Chrome();
      renderRecipes();
      if (currentRecipeId && modal.classList.contains('active')) openRecipe(currentRecipeId);
      if (isCookingWorkspaceOpen) renderCookingWorkspace();
    }
  }

  function setupLanguageToggle() {
    document.querySelectorAll('.language-btn').forEach(button => {
      button.addEventListener('click', () => applyLanguage(button.dataset.language));
    });
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
    const systemPrefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'auto' && systemPrefersDark);
    html.classList.remove('dark-mode', 'light-mode');

    if (theme === 'dark') {
      html.classList.add('dark-mode');
    } else if (theme === 'light') {
      html.classList.add('light-mode');
    }
    // 'auto' = no class, uses prefers-color-scheme

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', isDark ? '#171b18' : '#f7f4ed');

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
      const isActive = btn.dataset.theme === savedTheme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
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
    const recipe = recipes.find(r => r.id === currentRecipeId);
    if (!recipe || !canEditRecipeNow(recipe)) {
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
    if (!isSystemEditor()) {
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
    if (!isSystemEditor()) {
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
    if (!isSystemEditor()) {
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
    if (!isSystemEditor()) {
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
