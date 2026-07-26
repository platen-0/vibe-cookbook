import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const expectedTitle = 'Levashel.com | Save, share, and cook your recipes';
const expectedDescription =
  'Save recipes from links, photos, and notes, share them with family and friends, and follow several recipes while you cook.';

test('publishes a complete large-image social sharing card', () => {
  const html = readFileSync('index.html', 'utf8');
  const image = readFileSync('og-card.png');

  assert.ok(
    html.includes(`<meta property="og:title" content="${expectedTitle}">`)
  );
  assert.ok(
    html.includes(
      `<meta property="og:description" content="${expectedDescription}">`
    )
  );
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/levashel\.com\/og-card\.png\?v=2">/
  );
  assert.match(
    html,
    /<meta name="twitter:card" content="summary_large_image">/
  );

  assert.equal(image.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});
