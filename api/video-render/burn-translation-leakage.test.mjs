import test from 'node:test';
import assert from 'node:assert/strict';
import { stripBurnTranslationLeakage } from './burn-translation-leakage.js';
import { stripBurnNonSpeechTags } from './subtitle-pipeline.js';
import { buildCueLines } from './text-layout.js';
import { resolveCueLineLayout, BURN_RTL_MAX_LINES } from './layout-engine.js';
import { isRtlText } from './rtl-text.js';

test('stripBurnTranslationLeakage removes internal glossary coaching phrase', () => {
  const t = stripBurnTranslationLeakage(
    'به خوبی انجام میدی وای ددلیفت عالیه ،عالیه بعدش درست میشه'
  );
  assert.ok(!/به\s+خوبی\s+انجام/i.test(t));
  assert.ok(!/وای\s+ددلیفت\s+عالیه/i.test(t));
  assert.ok(/بعدش|درست/i.test(t));
});

test('stripBurnNonSpeechTags applies leakage strip', () => {
  const t = stripBurnNonSpeechTags('به خوبی انجام میدی، بزن بریم');
  assert.ok(!/به\s+خوبی\s+انجام/i.test(t));
  assert.match(t, /بزن بریم/);
});

test('RTL burn layout uses two balanced lines', () => {
  assert.equal(BURN_RTL_MAX_LINES, 2);
  const fa =
    'تو یک چالش شرکت کرده بود تا برنده بشه میتونه موهایش رو کوتاه کنه';
  assert.ok(isRtlText(fa));
  const layout = resolveCueLineLayout({ rtlMaxCharsPerLine: 24 }, fa);
  const lines = buildCueLines({ text: fa }, layout, false);
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[0].length - lines[1].length) <= 12);
});
