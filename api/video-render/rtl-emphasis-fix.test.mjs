import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAssContent } from './ass-generator.js';

test('RTL Persian MrBeast export includes inline color emphasis tags', () => {
  const segments = [{ start: 0, end: 1.5, text: 'سلام دنیا تست' }];
  const { content } = generateAssContent(segments, 'mrBeast', { captionMode: 'viral' });
  assert.match(content, /RTL_mrBeast/);
  assert.match(content, /Dialogue:.*\\c&H[0-9A-F]+&/i);
  assert.doesNotMatch(content, /Dialogue:[^\n]*سلام[^\n]*\\N[^\n]*\\c/);
});
