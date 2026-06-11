/**
 * Client-side subtitle cleaning — mirrors api/video-render/subtitle-pipeline.js
 */
(function (global) {
  'use strict';

  const MODES = { ACCURATE: 'accurate', CLEAN: 'clean', VIRAL: 'viral' };

  const NonSpeech = () => global.CutupNonSpeechTags;
  const NOTES = /♪+/g;
  const HALLUCINATION = /[@#$%^&*]{2,}/;
  const NOISE = /^(applause|laughter|music|inaudible|crowd|cheering|clapping)\b/i;
  const TRANSLATION_LEAK_RES = [
    /به\s+خوبی\s+انجام\s+می(?:دهی|دی|د|‌دهی|‌دی)/giu,
    /(?:^|[\s،,])وای\s+ددلیفت(?:ت)?\s+عالیه/giu,
    /(?:^|[\s،,])وای\s+اسکوات(?:ت)?\s+هم\s+عالیه/giu,
    /این\s+بنچ\s+پرش\s+عالیه/giu,
    /^ددلیفت(?:ت)?\s+عالیه[.!?\s]*$/giu
  ];

  function stripTranslationLeakage(text) {
    let t = String(text || '');
    for (const re of TRANSLATION_LEAK_RES) {
      t = t.replace(re, ' ');
    }
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  function clean(text, opts = {}) {
    let t = String(text || '');
    if (opts.stripTranslationLeakage) {
      t = stripTranslationLeakage(t);
    }
    if (opts.stripNoiseTags !== false && NonSpeech()?.stripNonSpeechDescriptiveTags) {
      t = NonSpeech().stripNonSpeechDescriptiveTags(t);
    } else if (opts.stripNoiseTags !== false) {
      t = t.replace(/\[[^\]]*]/g, ' ');
    }
    t = t.replace(NOTES, ' ');
    t = t.replace(HALLUCINATION, ' ');
    t = t.replace(/[@#$%^&*]/g, (m) => (m.length === 1 ? '' : ' '));
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  }

  function normalizeNonSpeech(text) {
    return NonSpeech()?.stripNonSpeechDescriptiveTags
      ? NonSpeech().stripNonSpeechDescriptiveTags(text)
      : String(text || '').replace(/\[[^\]]*]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function isGarbage(text, strict) {
    const t = clean(text);
    if (!t) return true;
    if (strict && NOISE.test(t)) return true;
    if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;
    return false;
  }

  const ROLLING_CHAIN_GAP_SEC = 0.18;
  const BLINK_MAX_DUR_SEC = 0.15;
  const TIGHT_TAIL_PAD_SEC = 0.06;
  const MIN_CUE_DURATION_SEC = 0.08;
  const MIN_CUE_GAP_SEC = 0.02;

  function roundTimelineSec(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.round(n * 1000) / 1000;
  }

  function applyTightSpeechSync(segments) {
    var list = (segments || []).map(function (seg) {
      var start = roundTimelineSec(seg.start);
      var end = roundTimelineSec(seg.end);
      var words = seg.words;
      if (Array.isArray(words) && words.length) {
        var timed = words.filter(function (w) {
          return isFinite(Number(w && w.start)) && isFinite(Number(w && w.end));
        });
        if (timed.length) {
          var ws = Number(timed[0].start);
          var we = Number(timed[timed.length - 1].end);
          start = roundTimelineSec(Math.max(0, ws));
          end = roundTimelineSec(Math.max(start + MIN_CUE_DURATION_SEC, we + TIGHT_TAIL_PAD_SEC));
        }
      } else if (isFinite(Number(seg._audioStart)) && isFinite(Number(seg._audioEnd))) {
        start = roundTimelineSec(Math.max(0, Number(seg._audioStart)));
        end = roundTimelineSec(Math.max(start + MIN_CUE_DURATION_SEC, Number(seg._audioEnd) + TIGHT_TAIL_PAD_SEC));
      }
      if (end <= start) end = roundTimelineSec(start + MIN_CUE_DURATION_SEC);
      return { start: start, end: end, text: seg.text };
    });
    return eliminateCueOverlaps(list);
  }

  function eliminateCueOverlaps(segments) {
    var sorted = (segments || []).slice().sort(function (a, b) {
      return a.start - b.start;
    });
    for (var i = 0; i < sorted.length - 1; i++) {
      var cur = sorted[i];
      var next = sorted[i + 1];
      var maxEnd = roundTimelineSec(next.start - MIN_CUE_GAP_SEC);
      if (cur.end > maxEnd) {
        cur.end = roundTimelineSec(Math.max(cur.start + MIN_CUE_DURATION_SEC, maxEnd));
      }
    }
    return sorted;
  }

  function normalizeCueText(text) {
    return String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Merge YouTube rolling captions (growing text + blink duplicates). Mirrors api/video-render/subtitle-pipeline.js */
  function mergeRollingCaptionChains(segments) {
    const sorted = (segments || [])
      .filter(function (s) {
        return s && typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start;
      })
      .sort(function (a, b) {
        return a.start - b.start;
      });

    const chains = [];
    let chain = null;

    function flush() {
      if (!chain) return;
      const text = normalizeCueText(chain.text);
      if (!text) {
        chain = null;
        return;
      }
      chains.push({ start: chain.start, end: chain.end, text: text });
      chain = null;
    }

    for (var i = 0; i < sorted.length; i++) {
      var seg = sorted[i];
      var text = normalizeCueText(seg.text);
      if (!text) continue;
      var start = Number(seg.start);
      var end = Number(seg.end);

      if (!chain) {
        chain = { start: start, end: end, text: text };
        continue;
      }

      var gap = start - chain.end;
      var prev = chain.text;
      var growing = text.indexOf(prev) === 0 && text.length > prev.length;
      var same = text === prev;

      if (gap <= ROLLING_CHAIN_GAP_SEC && (growing || same)) {
        chain.end = Math.max(chain.end, end);
        if (text.length > prev.length) chain.text = text;
        continue;
      }

      if (chain && gap > ROLLING_CHAIN_GAP_SEC && gap < 1.2) {
        chain.end = Math.max(chain.end, start - 0.03);
      }
      flush();
      chain = { start: start, end: end, text: text };
    }
    flush();
    return chains;
  }

  function dropBlinkDuplicateCues(segments) {
    const sorted = (segments || []).slice().sort(function (a, b) {
      return a.start - b.start;
    });
    const out = [];
    for (var i = 0; i < sorted.length; i++) {
      var seg = sorted[i];
      var text = normalizeCueText(seg.text);
      if (!text) continue;
      var prev = out[out.length - 1];
      var dur = Number(seg.end) - Number(seg.start);
      if (prev) {
        var prevText = normalizeCueText(prev.text);
        var gap = Number(seg.start) - Number(prev.end);
        if (text === prevText && (dur < BLINK_MAX_DUR_SEC || gap < 0.05)) continue;
      }
      out.push({ start: Number(seg.start), end: Number(seg.end), text: text });
    }
    return out;
  }

  function normalizeTimelineSegments(segments) {
    var list = (segments || [])
      .filter(function (s) {
        return s && Number(s.end) > Number(s.start);
      })
      .map(function (s) {
        return {
          start: Number(s.start),
          end: Number(s.end),
          text: normalizeCueText(s.text)
        };
      })
      .filter(function (s) {
        return s.text;
      });
    list = mergeRollingCaptionChains(list);
    list = dropBlinkDuplicateCues(list);
    list = applyTightSpeechSync(list);
    return list;
  }

  const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[''\-][\p{L}\p{M}\p{N}]+)*/gu;
  const SHORT_FORM_MAX_WORDS = 5;
  const SHORT_FORM_MAX_CHARS = 42;
  const PAUSE_GAP_SEC = 0.28;

  function cueWords(text) {
    return String(text || '').match(TOKEN_RE) || [];
  }

  function isProtectedToken(word, prevWord) {
    const w = String(word || '');
    if (!w) return false;
    if (/\d/.test(w) || /^\$/.test(w) || /%$/.test(w)) return true;
    if (/^[A-Z][\p{L}\p{M}']+$/.test(w) && w.length > 1) {
      if (prevWord && /^[A-Z][\p{L}\p{M}']+$/.test(prevWord)) return true;
      return true;
    }
    return false;
  }

  function isProtectedBoundary(words, splitAfterIndex) {
    const left = words[splitAfterIndex];
    const right = words[splitAfterIndex + 1];
    if (!left || !right) return false;
    if (isProtectedToken(left, words[splitAfterIndex - 1])) return true;
    if (isProtectedToken(right, left)) return true;
    return false;
  }

  function segmentSegmentToMasterCues(segment) {
    const text = normalizeCueText(segment.text);
    if (!text) return [];
    const words = cueWords(text);
    if (!words.length) return [];
    const segStart = Number(segment.start);
    const segEnd = Number(segment.end);
    const dur = Math.max(0.08 * words.length, segEnd - segStart);
    const per = dur / words.length;
    const timeline = words.map(function (word, i) {
      const start = segStart + i * per;
      const end = Math.min(segEnd, Math.max(start + 0.06, segStart + (i + 1) * per));
      return { word: word, start: start, end: end };
    });

    const specs = [];
    var bucketStart = 0;
    for (var i = 0; i < words.length; i++) {
      var token = words[i];
      var chunkLen = i - bucketStart + 1;
      var chunkText = words.slice(bucketStart, i + 1).join(' ');
      var hitPunctStrong = /[.!?…]["']?$/.test(token);
      var hitPunctSoft = /[,;:]["']?$/.test(token) && chunkLen >= 2;
      var hitMaxWords = chunkLen >= SHORT_FORM_MAX_WORDS;
      var hitMaxChars = chunkText.length > SHORT_FORM_MAX_CHARS;
      var atEnd = i === words.length - 1;
      if (hitPunctStrong || hitPunctSoft || hitMaxWords || hitMaxChars || atEnd) {
        var splitAt = i;
        if ((hitMaxWords || hitMaxChars) && !hitPunctStrong && !hitPunctSoft && chunkLen > 1) {
          while (splitAt > bucketStart && isProtectedBoundary(words, splitAt - 1)) {
            splitAt -= 1;
          }
        }
        specs.push({ tokenStart: bucketStart, tokenEnd: splitAt });
        bucketStart = splitAt + 1;
        i = splitAt;
      }
    }

    return specs.map(function (spec) {
      var slice = timeline.slice(spec.tokenStart, spec.tokenEnd + 1);
      var start = slice.length ? slice[0].start : segStart;
      var end = slice.length ? slice[slice.length - 1].end : segEnd;
      return {
        start: roundTimelineSec(start),
        end: roundTimelineSec(Math.max(start + MIN_CUE_DURATION_SEC, end)),
        text: words.slice(spec.tokenStart, spec.tokenEnd + 1).join(' ')
      };
    });
  }

  function segmentShortFormMasterCues(segments) {
    const out = [];
    for (const seg of segments || []) {
      if (!seg || seg.end <= seg.start) continue;
      const pieces = segmentSegmentToMasterCues(seg);
      for (const piece of pieces) {
        if (piece.text) {
          out.push({
            id: 'master-' + out.length,
            start: piece.start,
            end: piece.end,
            text: piece.text,
            locked: true
          });
        }
      }
    }
    return out;
  }

  function stripNonSpeechForCleanSrt(text) {
    return normalizeNonSpeech(text);
  }

  function assertClientWordIntegrity(postProcessed, cleanCues) {
    function wordsFrom(segs) {
      const list = [];
      for (const seg of segs || []) {
        const t = normalizeCueText(seg.text);
        const w = t.match(TOKEN_RE) || [];
        for (const token of w) {
          const n = token.toLowerCase().replace(/[^\p{L}\p{M}\p{N}']/gu, '');
          if (n) list.push(n);
        }
      }
      return list;
    }
    const a = wordsFrom(postProcessed);
    const b = wordsFrom(cleanCues);
    if (a.join(' ') !== b.join(' ')) {
      console.error('[subtitle_word_loss_client]', {
        sourceWordCount: a.length,
        cleanWordCount: b.length,
        missingPreview: a.filter((w, i) => b[i] !== w).slice(0, 8)
      });
      throw new Error('SUBTITLE_WORD_LOSS: clean_srt_client');
    }
  }

  function normalizePostProcessedForCleanSrtClient(segments) {
    return (segments || [])
      .filter(function (s) {
        return s && s.end > s.start;
      })
      .map(function (s) {
        return {
          start: Number(s.start),
          end: Number(s.end),
          text: stripNonSpeechForCleanSrt(clean(s.text, { stripTranslationLeakage: true })),
          words: s.words
        };
      })
      .filter(function (s) {
        return normalizeCueText(s.text);
      })
      .sort(function (a, b) {
        return a.start - b.start;
      });
  }

  function prepareAccurate(segments) {
    const normalized = normalizePostProcessedForCleanSrtClient(segments);
    const split = segmentShortFormMasterCues(normalized);
    assertClientWordIntegrity(normalized, split);
    return split;
  }

  function prepareClean(segments) {
    const out = [];
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      let text = clean(s.text);
      if (!text || isGarbage(text, true) || NonSpeech()?.isOnlyNonSpeechContent?.(text)) continue;
      out.push({ start: s.start, end: s.end, text });
    }
    return normalizeTimelineSegments(out);
  }

  function prepareViral(segments) {
    const out = [];
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      const text = clean(s.text, { stripTranslationLeakage: true });
      if (!text || isGarbage(text, true) || NonSpeech()?.isOnlyNonSpeechContent?.(text)) continue;
      out.push({ start: s.start, end: s.end, text });
    }
    return normalizeTimelineSegments(out);
  }

  function prepareSegmentsForMode(segments, mode) {
    const m = String(mode || 'viral').toLowerCase();
    if (m === 'accurate') return prepareAccurate(segments);
    if (m === 'clean') return prepareClean(segments);
    return prepareViral(segments);
  }

  /** @deprecated use prepareSegmentsForMode */
  function prepareSegments(segments) {
    return prepareSegmentsForMode(segments, 'viral');
  }

  /** Strip HTML entities (&gt;, @gt;, etc.) from cue text. */
  function decodeSubtitleTextEntities(text) {
    let t = String(text || '');
    if (!t) return '';
    t = t.replace(
      /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*--(?:>|&gt;|@gt;)\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/gi,
      ' '
    );
    t = t.replace(/&amp;/gi, '&');
    t = t.replace(/&quot;/gi, '"');
    t = t.replace(/&#0*39;/gi, "'");
    t = t.replace(/&gt;/gi, '>');
    t = t.replace(/&lt;/gi, '<');
    t = t.replace(/@gt;/gi, '>');
    t = t.replace(/@lt;/gi, '<');
    t = t.replace(/@amp;/gi, '&');
    t = t.replace(/(?:>>\s*){2,}/g, ' ');
    t = t.replace(/^\s*>>\s*|\s*>>\s*$/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  global.decodeSubtitleTextEntities = decodeSubtitleTextEntities;
  global.CutupSubtitleClean = {
    MODES,
    clean,
    isGarbage,
    prepareSegments,
    prepareSegmentsForMode,
    prepareAccurate,
    segmentShortFormMasterCues,
    decodeSubtitleTextEntities,
    normalizeTimelineSegments,
    mergeRollingCaptionChains,
    applyTightSpeechSync,
    roundTimelineSec
  };
})(typeof window !== 'undefined' ? window : globalThis);
