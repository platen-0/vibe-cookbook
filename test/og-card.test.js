import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const expectedTitle = 'Levashel.com | Help in the kitchen';
const expectedDescription =
  'Add your recipes, share with friends, and have assistance live while cooking.';

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
    /<meta property="og:image" content="https:\/\/levashel\.com\/og-card\.png">/
  );
  assert.match(
    html,
    /<meta name="twitter:card" content="summary_large_image">/
  );

  assert.equal(image.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});
