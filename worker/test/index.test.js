import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecipeSchema,
  ensurePublicUrl,
  extractPageData,
  findRecipeInJsonLd
} from '../src/index.js';

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
});
