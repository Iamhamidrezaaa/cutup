import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripNonSpeechDescriptiveTags,
  isOnlyNonSpeechContent,
  sanitizeTranscriptSegments,
  isNonSpeechDescriptorWord
} from './non-speech-tags.js';

test('strips English bracket and parenthetical tags', () => {
  assert.equal(stripNonSpeechDescriptiveTags('[music] to win'), 'to win');
  assert.equal(stripNonSpeechDescriptiveTags('hello (applause) world'), 'hello world');
  assert.equal(stripNonSpeechDescriptiveTags('♪♪ intro'), 'intro');
});

test('strips Persian and Arabic descriptors', () => {
  assert.equal(stripNonSpeechDescriptiveTags('[موزیک] سلام'), 'سلام');
  assert.equal(stripNonSpeechDescriptiveTags('(موسیقی) برو جلو'), 'برو جلو');
  assert.ok(isNonSpeechDescriptorWord('موزیک'));
  assert.ok(isNonSpeechDescriptorWord('[خنده]'));
});

test('drops segments that are only non-speech', () => {
  const out = sanitizeTranscriptSegments([
    { start: 0, end: 1, text: '[Music]' },
    { start: 1, end: 2, text: 'موزیک' },
    { start: 2, end: 3, text: '[موزیک] hello there' },
    { start: 3, end: 4, text: 'real speech' }
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, 'hello there');
  assert.equal(out[1].text, 'real speech');
});

test('isOnlyNonSpeechContent detects empty-after-strip cues', () => {
  assert.ok(isOnlyNonSpeechContent('[laughter]'));
  assert.ok(!isOnlyNonSpeechContent('[music] word'));
});
