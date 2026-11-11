import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const twin = readFileSync(new URL('../Petes-Fix-It-Up-Shop.html', import.meta.url), 'utf8');

test('both app files carry the photo picker and the on-device letter code', () => {
  assert.equal(index, twin);
  assert.match(index, /PDF or photo/);
  assert.match(index, /image\/jpeg/);
  assert.match(index, /image\/png/);
  assert.match(index, /image\/webp/);
  assert.match(index, /src="\.\/src\/shop-logic\.mjs"/);
  assert.match(index, /PeteShop\.scan/);
  assert.match(index, /PeteShop\.parseReport/);
  assert.match(index, /PeteShop\.bureauLetter/);
  assert.match(index, /PeteShop\.movLetter/);
  assert.match(index, /scanPdfImages/);
  assert.match(index, /Open practice file/);
  assert.match(index, /label\.intake-file/);
});
