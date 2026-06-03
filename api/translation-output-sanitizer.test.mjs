import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isKnownPromptLeakPhrase,
  sanitizeTranslatedSegments,
  sanitizeTranslationCueText
} from './translation-output-sanitizer.js';

test('removes known glossary leak phrases from cue text', () => {
  const out = sanitizeTranslationCueText(
    'به خوبی انجام میدی وای ددلیفت عالیه ،عالیه بعدش درست',
    'This kid joined a challenge to win'
  );
  assert.ok(!/به\s+خوبی\s+انجام/i.test(out));
  assert.ok(!/ددلیفت\s+عالیه/i.test(out));
});

test('drops cues that are only prompt examples', () => {
  assert.ok(isKnownPromptLeakPhrase('ددلیفتت عالیه'));
  const segs = sanitizeTranslatedSegments(
    [
      { start: 0, end: 2, text: 'ددلیفتت عالیه' },
      { start: 2, end: 4, text: 'تو یک چالش شرکت کردی' }
    ],
    [{ start: 0, end: 2, text: 'He joined a challenge' }]
  );
  assert.equal(segs.length, 1);
  assert.match(segs[0].text, /چالش/);
});
