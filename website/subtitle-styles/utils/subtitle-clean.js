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
  const BURN_LIP_LEAD_SEC = 0.03;
  const BURN_TAIL_PAD_SEC = 0.02;
  const BURN_INTER_CUE_GAP_SEC = 0.03;
  const BURN_MIN_CUE_SEC = 0.06;

  function cueWords(text) {
    return String(text || '').match(TOKEN_RE) || [];
  }

  function visibleCharCount(text) {
    return normalizeCueText(text).length;
  }

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractCueTextWithPunctuation(sourceText, allTokens, tokenStart, tokenEnd) {
    const tokens = allTokens.slice(tokenStart, tokenEnd + 1);
    if (!tokens.length) return '';
    const src = normalizeCueText(sourceText);
    if (!src) return tokens.join(' ');
    let pos = 0;
    let spanStart = -1;
    let spanEnd = -1;
    for (const tok of tokens) {
      const re = new RegExp('\\b' + escapeRegExp(tok) + '\\b', 'iu');
      const slice = src.slice(pos);
      const m = slice.match(re);
      if (!m) return tokens.join(' ');
      const absStart = pos + m.index;
      if (spanStart < 0) spanStart = absStart;
      spanEnd = absStart + m[0].length;
      pos = spanEnd;
    }
    const trail = src.slice(spanEnd).match(/^[\s]*([.!?…]+["']?)/);
    if (trail) spanEnd += trail[0].length;
    return src.slice(spanStart, spanEnd).trim();
  }

  function providerWordText(w) {
    return String((w && (w.word || w.text)) || '').trim();
  }

  function attachProviderWordsToSegments(segments, providerWords) {
    const list = Array.isArray(providerWords) ? providerWords : [];
    if (!list.length) return Array.isArray(segments) ? segments : [];
    const words = list
      .filter(function (w) {
        return providerWordText(w) && isFinite(Number(w.start)) && isFinite(Number(w.end));
      })
      .sort(function (a, b) {
        return Number(a.start) - Number(b.start);
      });
    return (segments || []).map(function (seg) {
      if (Array.isArray(seg.words) && seg.words.length) return seg;
      const ss = Number(seg.start);
      const se = Number(seg.end);
      if (!isFinite(ss) || !isFinite(se)) return seg;
      const attached = words.filter(function (w) {
        const mid = (Number(w.start) + Number(w.end)) / 2;
        return mid >= ss - 0.08 && mid <= se + 0.08;
      });
      if (!attached.length) return seg;
      return { ...seg, words: attached.map(function (w) {
        return { ...w };
      }) };
    });
  }

  function normToken(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}']/gu, '');
  }

  function providerWordText(w) {
    return String((w && (w.word || w.text)) || '').trim();
  }

  function alignProviderWordsToTokens(raw, tokens) {
    const timed = (raw || []).filter(function (w) {
      return w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end));
    });
    if (!timed.length || !tokens.length) return null;
    const out = [];
    let ri = 0;
    for (let ti = 0; ti < tokens.length; ti++) {
      const want = normToken(tokens[ti]);
      let found = null;
      const searchEnd = Math.min(ri + 5, timed.length);
      for (let j = ri; j < searchEnd; j++) {
        if (normToken(providerWordText(timed[j])) === want) {
          found = timed[j];
          ri = j + 1;
          break;
        }
      }
      if (!found) return null;
      out.push({ word: tokens[ti], start: Number(found.start), end: Number(found.end) });
    }
    return out.length === tokens.length ? out : null;
  }

  function timedWordsFromCue(cue) {
    const raw = Array.isArray(cue && cue.words) ? cue.words : [];
    return raw.filter(function (w) {
      return w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end));
    });
  }

  function speechBoundsFromCue(cue) {
    const timed = timedWordsFromCue(cue);
    if (timed.length) {
      return {
        speechStart: Number(timed[0].start),
        speechEnd: Number(timed[timed.length - 1].end)
      };
    }
    return {
      speechStart: Number(cue.start),
      speechEnd: Number(cue.end)
    };
  }

  function buildWordTimeline(segment, words) {
    const segStart = Number(segment.start);
    const segEnd = Number(segment.end);
    const raw = Array.isArray(segment.words) ? segment.words : [];
    const timed = raw.filter(function (w) {
      return w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end));
    });
    const aligned = alignProviderWordsToTokens(timed, words);
    if (aligned) return aligned;
    if (timed.length >= words.length && words.length) {
      const out = [];
      for (let i = 0; i < words.length; i++) {
        const tw = timed[i] || timed[timed.length - 1];
        out.push({
          word: words[i],
          start: Number(tw.start),
          end: Number(tw.end)
        });
      }
      return out;
    }
    const dur = Math.max(0.08 * words.length, segEnd - segStart);
    const per = dur / Math.max(1, words.length);
    return words.map(function (word, i) {
      const start = segStart + i * per;
      const end = Math.min(segEnd, Math.max(start + 0.06, segStart + (i + 1) * per));
      return { word: word, start: start, end: end };
    });
  }

  function cueTimingFromWordRange(timeline, tokenStart, tokenEnd, segStart, segEnd) {
    const slice = timeline.slice(tokenStart, tokenEnd + 1);
    if (!slice.length) {
      return { start: segStart, end: segEnd };
    }
    return {
      start: Number(slice[0].start),
      end: Number(slice[slice.length - 1].end)
    };
  }

  function enforceHardCaps(specs, words, maxWords, maxChars, minWords) {
    const out = [];
    const minW = Math.max(1, Math.min(maxWords, Number(minWords) || 1));
    for (const spec of specs) {
      let cursor = spec.tokenStart;
      const end = spec.tokenEnd;
      while (cursor <= end) {
        let chunkEnd = Math.min(end, cursor + maxWords - 1);
        while (chunkEnd > cursor && visibleCharCount(words.slice(cursor, chunkEnd + 1).join(' ')) > maxChars) {
          chunkEnd -= 1;
        }
        if (chunkEnd < cursor) chunkEnd = cursor;
        if (minW >= 2 && chunkEnd < end && chunkEnd - cursor + 1 < minW) {
          const extended = Math.min(end, cursor + minW - 1, cursor + maxWords - 1);
          const extText = words.slice(cursor, extended + 1).join(' ');
          if (visibleCharCount(extText) <= maxChars) {
            chunkEnd = extended;
          }
        }
        out.push({
          tokenStart: cursor,
          tokenEnd: chunkEnd,
          boundaryReason: spec.boundaryReason || 'hard_cap'
        });
        cursor = chunkEnd + 1;
      }
    }
    return out;
  }

  function mergeOrphanSingleWordSpecs(specs, words, maxWords, maxChars) {
    if (!Array.isArray(specs) || specs.length < 2) return specs;
    const out = specs.map(function (s) {
      return { ...s };
    });

    for (let i = 0; i < out.length - 1; i++) {
      const spec = out[i];
      const wc = spec.tokenEnd - spec.tokenStart + 1;
      if (wc !== 1) continue;
      const next = out[i + 1];
      const nextWc = next.tokenEnd - next.tokenStart + 1;
      const mergedLen = wc + nextWc;
      const mergedText = words.slice(spec.tokenStart, next.tokenEnd + 1).join(' ');
      if (mergedLen <= maxWords && visibleCharCount(mergedText) <= maxChars) {
        next.tokenStart = spec.tokenStart;
        out.splice(i, 1);
        i -= 1;
        continue;
      }
      if (nextWc >= 2) {
        const peelEnd = next.tokenStart;
        const pairText = words.slice(spec.tokenStart, peelEnd + 1).join(' ');
        if (visibleCharCount(pairText) <= maxChars) {
          out[i] = { ...spec, tokenEnd: peelEnd, boundaryReason: 'orphan_peel_forward' };
          next.tokenStart = peelEnd + 1;
          if (next.tokenStart > next.tokenEnd) {
            out.splice(i + 1, 1);
          }
          i -= 1;
        }
      }
    }

    for (let i = 1; i < out.length; i++) {
      const spec = out[i];
      const wc = spec.tokenEnd - spec.tokenStart + 1;
      if (wc !== 1) continue;
      const prev = out[i - 1];
      const mergedLen = prev.tokenEnd - prev.tokenStart + 1 + 1;
      const mergedText = words.slice(prev.tokenStart, spec.tokenEnd + 1).join(' ');
      if (mergedLen <= maxWords && visibleCharCount(mergedText) <= maxChars) {
        prev.tokenEnd = spec.tokenEnd;
        out.splice(i, 1);
        i -= 1;
      }
    }

    if (out.length >= 2) {
      const last = out[out.length - 1];
      const lastWc = last.tokenEnd - last.tokenStart + 1;
      if (lastWc === 1) {
        const prev = out[out.length - 2];
        const prevWc = prev.tokenEnd - prev.tokenStart + 1;
        const mergedLen = prevWc + 1;
        const mergedText = words.slice(prev.tokenStart, last.tokenEnd + 1).join(' ');
        const mergedChars = visibleCharCount(mergedText);
        if (mergedLen <= maxWords && mergedChars <= maxChars) {
          prev.tokenEnd = last.tokenEnd;
          out.pop();
        } else if (
          mergedLen === maxWords + 1 &&
          mergedChars <= maxChars + 8 &&
          /[.!?…]["']?$/i.test(words[last.tokenEnd] || '')
        ) {
          prev.tokenEnd = last.tokenEnd;
          out.pop();
        } else if (prevWc >= 2) {
          const peelIdx = prev.tokenEnd;
          const pairText = words.slice(peelIdx, last.tokenEnd + 1).join(' ');
          if (visibleCharCount(pairText) <= maxChars && peelIdx > prev.tokenStart) {
            prev.tokenEnd = peelIdx - 1;
            last.tokenStart = peelIdx;
            last.boundaryReason = 'orphan_peel_back';
          }
        }
      }
    }

    return out;
  }

  function findPauseSplitIndices(timeline) {
    const indices = [];
    for (let i = 0; i < timeline.length - 1; i++) {
      const gap = Number(timeline[i + 1].start) - Number(timeline[i].end);
      if (gap >= PAUSE_GAP_SEC) indices.push(i);
    }
    return indices;
  }

  function polishMasterCueTimeline(cues) {
    const sorted = (cues || [])
      .filter(function (c) {
        return c && Number(c.end) > Number(c.start);
      })
      .map(function (c) {
        return { ...c };
      })
      .sort(function (a, b) {
        return Number(a.start) - Number(b.start);
      });

    for (let i = 0; i < sorted.length; i++) {
      const cue = sorted[i];
      const bounds = speechBoundsFromCue(cue);
      let start = Math.max(0, bounds.speechStart - BURN_LIP_LEAD_SEC);
      let end = bounds.speechEnd + BURN_TAIL_PAD_SEC;
      if (i + 1 < sorted.length) {
        const nextBounds = speechBoundsFromCue(sorted[i + 1]);
        const nextVisibleStart = Math.max(0, nextBounds.speechStart - BURN_LIP_LEAD_SEC);
        end = Math.min(end, nextVisibleStart - BURN_INTER_CUE_GAP_SEC);
      }
      if (end <= start) end = start + BURN_MIN_CUE_SEC;
      cue.start = roundTimelineSec(Math.max(0, start));
      cue.end = roundTimelineSec(end);
    }
    return sorted;
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

  function segmentSegmentToMasterCues(segment, opts) {
    const maxWords = Math.max(1, Number((opts && opts.maxWords) || SHORT_FORM_MAX_WORDS));
    const maxChars = Math.max(10, Number((opts && opts.maxChars) || SHORT_FORM_MAX_CHARS));
    const minWords = Math.max(1, Number((opts && opts.minWords) || 1));
    const text = normalizeCueText(segment.text);
    if (!text) return [];
    const words = cueWords(text);
    if (!words.length) return [];
    const segStart = Number(segment.start);
    const segEnd = Number(segment.end);
    const timeline = buildWordTimeline(segment, words);

    const specs = [];
    let bucketStart = 0;
    for (let i = 0; i < words.length; i++) {
      const token = words[i];
      const chunkLen = i - bucketStart + 1;
      const chunkText = words.slice(bucketStart, i + 1).join(' ');
      const hitPunctStrong = /[.!?…]["']?$/.test(token);
      const hitPunctSoft = /[,;:]["']?$/.test(token) && chunkLen >= 2;
      const hitMaxWords = chunkLen >= maxWords;
      const hitMaxChars = visibleCharCount(chunkText) >= maxChars;
      const atEnd = i === words.length - 1;
      if (hitPunctStrong || hitPunctSoft || hitMaxWords || hitMaxChars || atEnd) {
        let splitAt = i;
        if ((hitMaxWords || hitMaxChars) && !hitPunctStrong && !hitPunctSoft && chunkLen > 1) {
          while (splitAt > bucketStart && isProtectedBoundary(words, splitAt - 1)) {
            splitAt -= 1;
          }
        }
        specs.push({
          tokenStart: bucketStart,
          tokenEnd: splitAt,
          boundaryReason: hitPunctStrong
            ? 'punctuation'
            : hitPunctSoft
              ? 'punctuation_soft'
              : hitMaxWords
                ? 'max_words'
                : hitMaxChars
                  ? 'max_chars'
                  : 'segment_end'
        });
        bucketStart = splitAt + 1;
        i = splitAt;
      }
    }

    const pauseIndices = findPauseSplitIndices(timeline);
    const refined = [];
    for (const spec of specs) {
      const internalPauses = pauseIndices.filter(function (idx) {
        return idx >= spec.tokenStart && idx < spec.tokenEnd;
      });
      if (!internalPauses.length) {
        refined.push(spec);
        continue;
      }
      let curStart = spec.tokenStart;
      for (const pauseIdx of internalPauses) {
        if (pauseIdx < curStart) continue;
        if (pauseIdx - curStart + 1 < 2) continue;
        if (isProtectedBoundary(words, pauseIdx)) continue;
        refined.push({
          tokenStart: curStart,
          tokenEnd: pauseIdx,
          boundaryReason: 'speech_pause'
        });
        curStart = pauseIdx + 1;
      }
      if (curStart <= spec.tokenEnd) {
        refined.push({
          tokenStart: curStart,
          tokenEnd: spec.tokenEnd,
          boundaryReason: spec.boundaryReason
        });
      }
    }

    const capped = enforceHardCaps(refined.length ? refined : specs, words, maxWords, maxChars, minWords);
    const partitionSpecs = mergeOrphanSingleWordSpecs(capped, words, maxWords, maxChars);
    if (!partitionSpecs.length && words.length) {
      partitionSpecs.push({
        tokenStart: 0,
        tokenEnd: words.length - 1,
        boundaryReason: 'fallback_single_cue'
      });
    }

    return partitionSpecs.map(function (spec) {
      const slice = timeline.slice(spec.tokenStart, spec.tokenEnd + 1);
      const timing = cueTimingFromWordRange(
        timeline,
        spec.tokenStart,
        spec.tokenEnd,
        segStart,
        segEnd
      );
      const start = timing.start;
      const end = Math.max(start + MIN_CUE_DURATION_SEC, timing.end);
      return {
        start: roundTimelineSec(start),
        end: roundTimelineSec(end),
        text: extractCueTextWithPunctuation(text, words, spec.tokenStart, spec.tokenEnd),
        words: slice.map(function (w) {
          return { word: w.word, start: w.start, end: w.end };
        })
      };
    });
  }

  function segmentShortFormMasterCues(segments, opts) {
    const out = [];
    for (const seg of segments || []) {
      if (!seg || seg.end <= seg.start) continue;
      const pieces = segmentSegmentToMasterCues(seg, opts);
      for (const piece of pieces) {
        if (piece.text && piece.end > piece.start) {
          const row = {
            id: 'master-' + out.length,
            start: piece.start,
            end: piece.end,
            text: piece.text,
            locked: true
          };
          if (Array.isArray(piece.words) && piece.words.length) row.words = piece.words;
          out.push(row);
        }
      }
    }
    return out;
  }

  function readSourceSegmentsForBurn() {
    const decode = decodeSubtitleTextEntities;
    const versionSegs = global.CutupSubtitleVersions?.getActiveSegments?.() || [];
    const primary =
      (global.cutupSourceSegments && global.cutupSourceSegments.length
        ? global.cutupSourceSegments
        : null) ||
      (versionSegs.length ? versionSegs : null) ||
      global.originalSrtSegments ||
      global.cutupLastTranscription?.segments ||
      [];
    const raw = primary;
    return (raw || [])
      .map(function (s) {
        const text = decode ? decode(String(s.text || '')) : String(s.text || '').trim();
        const seg = {
          start: Number(s.start),
          end: Number(s.end),
          text: text
        };
        if (Array.isArray(s.words)) seg.words = s.words;
        return seg;
      })
      .filter(function (s) {
        return s.text && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start;
      });
  }

  function getMasterBurnCues() {
    try {
      const normalized = normalizePostProcessedForCleanSrtClient(readSourceSegmentsForBurn());
      if (!normalized.length) return [];
      const aspect = global.CutupTextLayout?.detectPreviewAspect?.() || 'horizontal';
      const segOpts =
        aspect === 'vertical'
          ? { maxWords: 5, maxChars: 18, minWords: 2 }
          : { maxWords: SHORT_FORM_MAX_WORDS, maxChars: SHORT_FORM_MAX_CHARS, minWords: 1 };
      let cues = segmentShortFormMasterCues(normalized, segOpts);
      if (aspect === 'vertical' && global.CutupTextLayout?.chunkSegmentsForVerticalShorts) {
        cues = global.CutupTextLayout.chunkSegmentsForVerticalShorts(cues, segOpts) || cues;
      }
      cues = polishMasterCueTimeline(cues);
      assertClientWordIntegrity(normalized, cues);
      return cues.map(function (c, i) {
        return {
          id: c.id || 'master-' + i,
          start: c.start,
          end: c.end,
          text: c.text,
          locked: true
        };
      });
    } catch (err) {
      console.warn('[master-burn-cues] fallback to source segments:', err?.message || err);
      const normalized = normalizePostProcessedForCleanSrtClient(readSourceSegmentsForBurn());
      return normalized.map(function (s, i) {
        return {
          id: 'master-' + i,
          start: s.start,
          end: s.end,
          text: s.text,
          locked: true
        };
      });
    }
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
    const providerWords =
      (global.cutupProviderWords && global.cutupProviderWords.length
        ? global.cutupProviderWords
        : null) ||
      (global.cutupLastTranscription?.words?.length ? global.cutupLastTranscription.words : null) ||
      [];
    const base = (segments || [])
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
    return attachProviderWordsToSegments(base, providerWords);
  }

  function prepareAccurate(segments) {
    return getMasterBurnCuesFromSegments(segments);
  }

  function getMasterBurnCuesFromSegments(segments) {
    const normalized = normalizePostProcessedForCleanSrtClient(segments);
    const aspect = global.CutupTextLayout?.detectPreviewAspect?.() || 'horizontal';
    const segOpts =
      aspect === 'vertical'
        ? { maxWords: 5, maxChars: 18, minWords: 2 }
        : { maxWords: SHORT_FORM_MAX_WORDS, maxChars: SHORT_FORM_MAX_CHARS, minWords: 1 };
    let cues = segmentShortFormMasterCues(normalized, segOpts);
    if (aspect === 'vertical' && global.CutupTextLayout?.chunkSegmentsForVerticalShorts) {
      cues = global.CutupTextLayout.chunkSegmentsForVerticalShorts(cues, segOpts) || cues;
    }
    cues = polishMasterCueTimeline(cues);
    assertClientWordIntegrity(normalized, cues);
    return cues;
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
    getMasterBurnCues,
    polishMasterCueTimeline,
    decodeSubtitleTextEntities,
    normalizeTimelineSegments,
    mergeRollingCaptionChains,
    applyTightSpeechSync,
    roundTimelineSec
  };
})(typeof window !== 'undefined' ? window : globalThis);
