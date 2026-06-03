import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLanguageCode,
  isSupportedLanguageCode,
  pickSupportedFromAvailableTracks,
  SUPPORTED_LANGUAGE_CODES
} from './supported-languages.js';

test('includes site translation languages', () => {
  assert.ok(SUPPORTED_LANGUAGE_CODES.length >= 60);
  for (const code of ['en', 'fr', 'fa', 'ja', 'hi', 'ar', 'de', 'vi']) {
    assert.ok(isSupportedLanguageCode(code), code);
  }
});

test('normalizeLanguageCode handles aliases', () => {
  assert.equal(normalizeLanguageCode('french'), 'fr');
  assert.equal(normalizeLanguageCode('fr-FR'), 'fr');
  assert.equal(normalizeLanguageCode('zh-CN'), 'zh');
});

test('pickSupportedFromAvailableTracks prefers metadata language', () => {
  const hit = pickSupportedFromAvailableTracks(['en', 'fr-FR', 'de'], 'fr');
  assert.ok(String(hit).startsWith('fr'));
});
