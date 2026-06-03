import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceRtlPunctuationTokens, wrapRtlAssLines } from './rtl-ass-bidi.js';
import { markSpokenWord, pickSpokenWordKeyRtl } from './emphasis-engine.js';
import { generateAssContent } from './ass-generator.js';

test('wrapRtlAssLines wraps each row in RLE/PDF without leading ASS tags outside', () => {
  const wrapped = wrapRtlAssLines('{\\c&H00FFFFFF&}سلام{\\r}\\Nدنیا');
  assert.ok(wrapped.startsWith('\u202B'));
  assert.ok(wrapped.includes('\u202C'));
  assert.ok(!/^\{\\c/.test(wrapped));
  assert.ok(wrapped.includes('\\N'));
});

test('pickSpokenWordKeyRtl uses first word in line text (reading-order start)', () => {
  const tokens = [
    { text: 'بچه', clean: 'بچه', isSpace: false },
    { text: ' ', isSpace: true },
    { text: 'این', clean: 'این', isSpace: false }
  ];
  const key = pickSpokenWordKeyRtl(
    [
      { word: 'این', start: 0.1, end: 0.6 },
      { word: 'بچه', start: 2, end: 2.5 }
    ],
    tokens,
    'این بچه در یک چالش'
  );
  assert.equal(key, 'این');
});

test('RTL hormozi spokenWord uses inline color on first line word', () => {
  const segments = [
    {
      start: 0,
      end: 4,
      text: 'این بچه داره در یک چالش شرکت می‌کنه',
      words: [
        { word: 'این', start: 0.1, end: 0.5 },
        { word: 'بچه', start: 1.2, end: 1.6 }
      ]
    }
  ];
  const { content } = generateAssContent(segments, 'alexHormozi', {
    captionMode: 'viral',
    strictCleanSrtTimings: true,
    durationSec: 30
  });
  const dialogue = content.split('\n').find((l) => l.startsWith('Dialogue:'));
  assert.ok(dialogue, 'expected Dialogue line');
  const textField = dialogue.split(',').slice(9).join(',');
  assert.ok(textField.includes('این'), 'expected first line word');
  assert.match(textField, /\{\\c&H/i, 'RTL highlight uses inline ASS color');
  const colorAt = textField.indexOf('{\\c');
  const wordAt = textField.indexOf('این');
  assert.ok(colorAt >= 0 && wordAt >= 0 && colorAt < wordAt + 8, 'color tag precedes first word');
});

test('coalesceRtlPunctuationTokens attaches Persian comma to previous word', () => {
  const tokens = [
    { text: 'سلام', clean: 'سلام', isSpace: false },
    { text: '،', clean: '', isSpace: false },
    { text: ' ', isSpace: true }
  ];
  const out = coalesceRtlPunctuationTokens(tokens);
  assert.equal(out.length, 2);
  assert.ok(out[0].text.includes('،'));
});

test('RTL alexHormozi ASS uses RLE wrapper and inline emphasis inside', () => {
  const segments = [{ start: 0, end: 2, text: 'منتظر لحظه مناسب' }];
  const { content } = generateAssContent(segments, 'alexHormozi', { captionMode: 'viral' });
  assert.match(content, /RTL_alexHormozi/);
  const dialogue = content.split('\n').find((l) => l.startsWith('Dialogue:'));
  assert.ok(dialogue);
  const textField = dialogue.split(',').slice(9).join(',');
  assert.ok(textField.includes('\u202B'));
  assert.ok(textField.includes('\u202C'));
});
