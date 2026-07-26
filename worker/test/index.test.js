import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeRecipeImage,
  buildCookingPlanSchema,
  buildImageRecipeSchema,
  buildRecipeSchema,
  createCookingPlan,
  ensurePublicUrl,
  extractPageData,
  extractPrimaryPageText,
  extractRecipeDraft,
  extractSocialContext,
  findRecipeInJsonLd,
  storeRecipeImage
} from '../src/index.js';
import importerWorker from '../src/index.js';

test('allows the custom domain and legacy GitHub origin', async () => {
  const env = {
    ALLOWED_ORIGINS:
      'https://levashel.com,https://www.levashel.com,https://platen-0.github.io'
  };
  for (const origin of [
    'https://levashel.com',
    'https://www.levashel.com',
    'https://platen-0.github.io'
  ]) {
    const response = await importerWorker.fetch(
      new Request('https://worker.example/health', {
        headers: { Origin: origin }
      }),
      env
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
});

test('extracts a structured recipe and its preferred image', () => {
  const html = `
    <html>
      <head>
        <title>Fallback title</title>
        <meta property="og:image" content="https://example.com/og.jpg">
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Recipe",
            "name": "עוגת לימון",
            "image": ["https://example.com/lemon.jpg"],
            "recipeIngredient": ["2 לימונים", "1 כוס קמח"],
            "recipeInstructions": [{"@type": "HowToStep", "text": "מערבבים ואופים."}]
          }
        </script>
      </head>
      <body><article>מתכון משפחתי אהוב.</article></body>
    </html>
  `;

  const result = extractPageData(html, 'https://example.com/recipe');
  assert.equal(result.title, 'עוגת לימון');
  assert.match(result.recipeText, /2 לימונים/);
  assert.match(result.recipeText, /מערבבים ואופים/);
  assert.equal(result.imageCandidates[0].url, 'https://example.com/lemon.jpg');
  assert.equal(result.source.structuredRecipeFound, true);
});

test('finds Recipe nodes nested inside @graph-like objects', () => {
  const result = findRecipeInJsonLd({
    '@graph': [
      { '@type': 'WebPage', name: 'Page' },
      { '@type': ['Thing', 'Recipe'], name: 'Soup' }
    ]
  });
  assert.equal(result.name, 'Soup');
});

test('rejects private and credentialed URLs', () => {
  assert.throws(() => ensurePublicUrl('http://127.0.0.1/admin'), /Private network/);
  assert.throws(() => ensurePublicUrl('http://192.168.1.5/photo'), /Private network/);
  assert.throws(() => ensurePublicUrl('https://user:pass@example.com'), /credentials/);
  assert.equal(ensurePublicUrl('https://example.com/recipe').hostname, 'example.com');
});

test('builds strict enums from app categories and tags', () => {
  const schema = buildRecipeSchema(['desserts', 'soups'], ['quick', 'vegan']);
  assert.deepEqual(schema.properties.suggestedCategoryId.enum, ['', 'desserts', 'soups']);
  assert.deepEqual(schema.properties.suggestedTags.items.enum, ['quick', 'vegan']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.recipeFound.type, 'boolean');
  assert.equal('recipeText' in schema.properties, false);
});

test('reads the full article and removes page chrome', () => {
  const longIntroduction = 'סיפור משפחתי '.repeat(3_000);
  const html = `
    <body>
      <nav>ראשי קטגוריות צור קשר</nav>
      <article>
        <h1>עוגה</h1>
        <p>${longIntroduction}</p>
        <h2>מרכיבים</h2>
        <p>2 כוסות קמח</p>
        <h2>אופן הכנה</h2>
        <p>אופים 35 דקות בחום של 180 מעלות.</p>
      </article>
      <footer>הרשמה לדיוור</footer>
    </body>
  `;
  const text = extractPrimaryPageText(html);
  assert.match(text, /2 כוסות קמח/);
  assert.match(text, /180 מעלות/);
  assert.doesNotMatch(text, /ראשי קטגוריות/);
  assert.doesNotMatch(text, /הרשמה לדיוור/);
});

test('extracts a public social description and first Instagram comment by the poster', () => {
  const html = `
    <html>
      <head><meta property="og:description" content="מרכיבים בתיאור"></head>
      <body>
        <script type="application/json">
          {
            "xdt_shortcode_media": {
              "owner": {"id": "poster-1", "username": "cook"},
              "edge_media_to_caption": {"edges": [{"node": {"text": "מרכיבים בתיאור"}}]},
              "edge_media_to_parent_comment": {
                "edges": [
                  {"node": {"owner": {"id": "viewer"}, "text": "נראה מעולה"}},
                  {"node": {"owner": {"id": "poster-1"}, "text": "אופים 20 דקות"}}
                ]
              }
            }
          }
        </script>
      </body>
    </html>
  `;
  const page = extractPageData(html, 'https://www.instagram.com/p/example/');
  assert.equal(page.socialDescription, 'מרכיבים בתיאור');
  assert.equal(page.firstPosterComment, 'אופים 20 דקות');
  assert.deepEqual(
    extractSocialContext(html, { 'og:description': 'מרכיבים בתיאור' }, 'https://instagram.com/p/x'),
    { description: 'מרכיבים בתיאור', firstPosterComment: 'אופים 20 דקות' }
  );
});

test('extracts a first Facebook comment when public embedded data identifies the poster', () => {
  const html = `
    <script type="application/json">
      {
        "story": {
          "actors": [{"id": "page-1", "name": "Cook"}],
          "message": {"text": "מתכון ללחם"},
          "feedback": {
            "top_level_comments": {
              "edges": [
                {"node": {"author": {"id": "reader"}, "body": {"text": "תודה"}}},
                {"node": {"author": {"id": "page-1"}, "body": {"text": "אופים ב-200 מעלות"}}}
              ]
            }
          }
        }
      }
    </script>
  `;
  const context = extractSocialContext(
    html,
    {},
    'https://www.facebook.com/cook/posts/example'
  );
  assert.equal(context.description, 'מתכון ללחם');
  assert.equal(context.firstPosterComment, 'אופים ב-200 מעלות');
});

test('treats YouTube descriptions and creator comments as social recipe context', () => {
  const html = `
    <html>
      <head><meta property="og:description" content="2 כוסות קמח וכוס מים"></head>
      <body>
        <script type="application/json">
          {
            "video": {
              "author": {"id": "channel-1", "name": "Cook"},
              "description": {"text": "2 כוסות קמח וכוס מים"},
              "comments": [
                {"author": {"id": "viewer"}, "text": "נראה מעולה"},
                {"author": {"id": "channel-1"}, "text": "אופים 25 דקות ב-180 מעלות"}
              ]
            }
          }
        </script>
      </body>
    </html>
  `;
  const context = extractSocialContext(
    html,
    { 'og:description': '2 כוסות קמח וכוס מים' },
    'https://www.youtube.com/watch?v=example'
  );
  assert.equal(context.description, '2 כוסות קמח וכוס מים');
  assert.equal(context.firstPosterComment, 'אופים 25 דקות ב-180 מעלות');
});

test('builds a strict image classification schema', () => {
  const schema = buildImageRecipeSchema(['dessert'], ['vegan']);
  assert.deepEqual(schema.properties.classification.enum, [
    'food_photo',
    'recipe_text',
    'mixed_recipe',
    'other_text',
    'other'
  ]);
  assert.deepEqual(schema.properties.suggestedCategoryId.enum, ['', 'dessert']);
  assert.equal(schema.additionalProperties, false);
});

test('rejects headline-only model output and keeps fluff out of accepted recipe text', async () => {
  const originalFetch = globalThis.fetch;
  const modelResults = [
    {
      recipeFound: true,
      title: 'כותרת בלבד',
      summary: 'סיפור ארוך ולא מתכון',
      ingredients: [],
      instructions: [],
      suggestedCategoryId: '',
      suggestedTags: [],
      confidence: 0.2,
      extractionNotes: ''
    },
    {
      recipeFound: true,
      title: 'עוגת לימון',
      summary: 'הקדמה שלא צריכה להיכנס לטקסט המתכון',
      ingredients: ['2 לימונים', '1 כוס קמח'],
      instructions: ['מערבבים.', 'אופים 30 דקות ב-180 מעלות.'],
      suggestedCategoryId: 'dessert',
      suggestedTags: ['quick'],
      confidence: 0.93,
      extractionNotes: ''
    }
  ];
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        output: [
          {
            content: [{ type: 'output_text', text: JSON.stringify(modelResults.shift()) }]
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const input = {
      socialText: 'עוגת לימון. סיפור משפחתי.',
      categories: [{ id: 'dessert', name: 'קינוח' }],
      tags: [{ id: 'quick', name: 'מהיר' }]
    };
    const env = { OPENAI_API_KEY: 'test-key' };
    const user = { sub: 'test-user' };
    const rejected = await extractRecipeDraft(input, user, env);
    assert.equal(rejected.draft, null);

    const accepted = await extractRecipeDraft(input, user, env);
    assert.match(accepted.draft.recipeText, /2 לימונים/);
    assert.match(accepted.draft.recipeText, /180 מעלות/);
    assert.doesNotMatch(accepted.draft.recipeText, /הקדמה/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('classifies a food photo without creating a recipe draft', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  classification: 'food_photo',
                  recipeFound: false,
                  title: '',
                  ingredients: [],
                  instructions: [],
                  suggestedCategoryId: '',
                  suggestedTags: [],
                  confidence: 0.99,
                  extractionNotes: ''
                })
              }
            ]
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const analysis = await analyzeRecipeImage(
      { dataUrl: 'data:image/png;base64,AAAA', categories: [], tags: [] },
      { sub: 'test-user' },
      { OPENAI_API_KEY: 'test-key' }
    );
    assert.equal(analysis.classification, 'food_photo');
    assert.equal(analysis.recipeFound, false);
    assert.equal(analysis.draft, null);
    assert.equal(requestBody.input[1].content[1].type, 'input_image');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stores private recipe images in KV instead of the public repository', async () => {
  const stored = new Map();
  const env = {
    IMAGE_SIGNING_SECRET: 'test-secret-that-is-long-enough-for-hmac',
    RECIPE_IMAGES: {
      async put(key, value, options) {
        stored.set(key, { value, options });
      }
    }
  };
  const result = await storeRecipeImage(
    {
      recipeId: 'recipe_12345678',
      private: true,
      dataUrl: `data:image/png;base64,${Buffer.from('private-image').toString('base64')}`
    },
    { sub: 'user_123' },
    env,
    'https://worker.example'
  );
  assert.equal(result.protected, true);
  assert.equal(result.privateKey, 'recipes/user_123/recipe_12345678.png');
  assert.match(result.url, /^https:\/\/worker\.example\/private-images\//);
  assert.equal(stored.has(result.privateKey), true);
});

test('builds a strict live-cooking schema and normalizes stable checklist ids', async () => {
  const schema = buildCookingPlanSchema();
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.timeline.items.additionalProperties, false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://firestore.googleapis.com/')) {
      return new Response(JSON.stringify({ name: 'recipe' }), { status: 200 });
    }
    return new Response(JSON.stringify({
      output: [{
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            recipes: [{
              recipeId: 'recipe_a',
              ingredients: ['2 בצלים'],
              steps: [{ text: 'מטגנים 5 דקות', durationMinutes: 5, active: true }]
            }],
            combinedIngredients: [{
              display: '2 בצלים',
              normalizedName: 'בצל',
              sources: [{ recipeId: 'recipe_a', ingredientIndex: 0 }],
              note: ''
            }],
            timeline: [{
              recipeId: 'recipe_a',
              stepIndex: 0,
              startsAfterMinutes: 0,
              durationMinutes: 5,
              active: true,
              note: ''
            }],
            warnings: []
          })
        }]
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await createCookingPlan({
      recipes: [{ id: 'recipe_a', name: 'מרק', text: '2 בצלים. מטגנים 5 דקות.' }]
    }, {
      sub: 'user',
      token: 'firebase-token'
    }, {
      FIREBASE_PROJECT_ID: 'test-project',
      OPENAI_API_KEY: 'test-key'
    });
    assert.equal(result.recipes[0].ingredients[0].id, 'ingredient-recipe_a-0');
    assert.deepEqual(result.combinedIngredients[0].sourceIds, [
      'ingredient-recipe_a-0'
    ]);
    assert.equal(result.timeline[0].stepId, 'step-recipe_a-0');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
