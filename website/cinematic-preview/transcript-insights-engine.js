/**
 * Lightweight heuristic transcript analysis — no API calls.
 * @namespace CutupTranscriptInsights
 */
(function (global) {
  'use strict';

  const EMOTIONAL_WORDS =
    /\b(love|hate|amazing|incredible|shocked|heartbreaking|beautiful|terrifying|excited|angry|cry|cried|wow|insane|crazy|unbelievable|powerful|emotional|afraid|hope|dream|nightmare|obsessed|devastated|thrilled)\b/gi;
  const CONTROVERSIAL =
    /\b(secret|truth|lie|scam|exposed|never|always|wrong|illegal|banned|censored|they don't want|controversy|hot take|unpopular)\b/gi;
  const RETENTION =
    /\b(you need to|here's why|watch this|pay attention|don't skip|the reason|this is why|before you|number one|step one|listen)\b/gi;
  const HOOK_START =
    /^(stop|wait|listen|imagine|what if|here's|this is|i'm going to|today|ever wondered|nobody|everyone)/i;

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function formatClock(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function normalizeSegments(segments) {
    if (!Array.isArray(segments)) return [];
    return segments
      .filter(
        (s) =>
          s &&
          typeof s.start === 'number' &&
          typeof s.end === 'number' &&
          s.end > s.start &&
          String(s.text || '').trim()
      )
      .map((s) => ({
        start: s.start,
        end: s.end,
        text: String(s.text).trim()
      }));
  }

  function segmentsFromPlainText(fullText, durationSec) {
    const text = String(fullText || '').trim();
    if (!text) return [];
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const dur = Math.max(10, Number(durationSec) || text.split(/\s+/).length / 2.5);
    const per = dur / Math.max(1, sentences.length);
    let t = 0;
    return sentences.slice(0, 80).map((sentence) => {
      const chunk = sentence.trim();
      const len = Math.max(2, per * (0.7 + Math.min(chunk.length / 80, 1.3)));
      const seg = { start: t, end: t + len, text: chunk };
      t += len;
      return seg;
    });
  }

  function scoreSegment(seg, index, total) {
    const text = seg.text;
    const words = text.split(/\s+/).filter(Boolean);
    let score = 0;
    const reasons = [];

    const caps = text.replace(/[^A-Z]/g, '').length;
    const letters = text.replace(/[^A-Za-z]/g, '').length;
    if (letters > 8 && caps / letters > 0.35) {
      score += 3;
      reasons.push('emphasis');
    }
    if (/\?/.test(text)) {
      score += 2;
      reasons.push('question');
    }
    if (/!/.test(text)) {
      score += 1.5;
      reasons.push('excitement');
    }
    const emo = (text.match(EMOTIONAL_WORDS) || []).length;
    if (emo > 0) {
      score += emo * 2;
      reasons.push('emotional');
    }
    const contra = (text.match(CONTROVERSIAL) || []).length;
    if (contra > 0) {
      score += contra * 2.5;
      reasons.push('bold claim');
    }
    if (words.length >= 4 && words.length <= 18) score += 1;
    if (index === 0 && HOOK_START.test(text)) {
      score += 4;
      reasons.push('hook');
    }
    if (index < Math.max(2, Math.floor(total * 0.15)) && words.length <= 14) {
      score += 1.5;
    }
    const punctIntensity = (text.match(/[!?…]/g) || []).length;
    score += punctIntensity * 0.8;

    return { score, reasons: [...new Set(reasons)] };
  }

  function detectViralMoments(segments, limit = 5) {
    const ranked = segments
      .map((seg, i) => {
        const { score, reasons } = scoreSegment(seg, i, segments.length);
        return { ...seg, score, reasons };
      })
      .filter((s) => s.score >= 2.5)
      .sort((a, b) => b.score - a.score);

    const picked = [];
    const used = new Set();
    for (const item of ranked) {
      if (picked.length >= limit) break;
      const bucket = Math.floor(item.start / 8);
      if (used.has(bucket)) continue;
      used.add(bucket);
      picked.push({
        start: item.start,
        end: item.end,
        text: item.text,
        reason: item.reasons[0] || 'high energy',
        score: item.score
      });
    }
    if (picked.length < 3) {
      for (const seg of segments.slice(0, Math.min(segments.length, 8))) {
        if (picked.length >= 3) break;
        if (picked.some((p) => Math.abs(p.start - seg.start) < 3)) continue;
        picked.push({
          start: seg.start,
          end: seg.end,
          text: seg.text,
          reason: 'opening momentum',
          score: 1
        });
      }
    }
    return picked.sort((a, b) => a.start - b.start);
  }

  function buildChapters(segments, durationSec) {
    if (!segments.length) return [];
    const end = durationSec || segments[segments.length - 1].end;
    const labels = ['Intro Hook', 'Main Story', 'Emotional Peak', 'Key Insight', 'Conclusion'];
    const gaps = [];
    for (let i = 1; i < segments.length; i++) {
      const gap = segments[i].start - segments[i - 1].end;
      if (gap >= 3.5) gaps.push({ at: segments[i].start, gap });
    }

    const breakPoints = [0];
    if (gaps.length >= 2) {
      gaps
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 3)
        .map((g) => g.at)
        .sort((a, b) => a - b)
        .forEach((t) => {
          if (t > 2 && t < end - 5) breakPoints.push(t);
        });
    } else {
      const n = Math.min(4, Math.max(2, Math.ceil(end / 45)));
      for (let i = 1; i < n; i++) breakPoints.push((end * i) / n);
    }

    const unique = [...new Set(breakPoints.map((t) => Math.floor(t)))].sort((a, b) => a - b);
    return unique.map((start, i) => ({
      start,
      label: labels[Math.min(i, labels.length - 1)]
    }));
  }

  function buildInsights(segments, fullText, durationSec, language, platform) {
    const insights = [];
    const wordCount = String(fullText || segments.map((s) => s.text).join(' '))
      .split(/\s+/)
      .filter(Boolean).length;
    const dur = Math.max(1, durationSec || (segments.length ? segments[segments.length - 1].end : wordCount / 2.5));
    const wpm = Math.round((wordCount / dur) * 60);

    const viral = detectViralMoments(segments, 5);
    const first = segments[0];
    const hookSeg =
      segments.find((s, i) => scoreSegment(s, i, segments.length).score >= 4) || first;

    if (hookSeg) {
      insights.push({
        id: 'hook',
        icon: '🔥',
        title: 'Strong hook detected',
        detail: `Opens with energy at ${formatClock(hookSeg.start)}`
      });
    }

    const best = viral.sort((a, b) => b.score - a.score)[0];
    if (best) {
      insights.push({
        id: 'clip',
        icon: '⏱',
        title: 'Best clip starts here',
        detail: `${formatClock(best.start)} — high-retention moment`
      });
    }

    const retentionSeg = segments.find((s) => RETENTION.test(s.text));
    if (retentionSeg) {
      insights.push({
        id: 'retention',
        icon: '📈',
        title: 'High-retention phrase found',
        detail: `Around ${formatClock(retentionSeg.start)}`
      });
    } else if (best) {
      insights.push({
        id: 'retention',
        icon: '📈',
        title: 'High-retention phrase found',
        detail: `Peak engagement near ${formatClock(best.start)}`
      });
    }

    const plat = String(platform || 'social').toLowerCase();
    const readyTitle =
      plat === 'instagram'
        ? 'Instagram-ready subtitles generated'
        : plat === 'tiktok'
          ? 'TikTok-ready subtitles generated'
          : plat === 'upload' || plat === 'audiofile'
            ? 'Upload subtitles optimized'
            : plat === 'youtube'
              ? 'YouTube-ready subtitles generated'
              : 'Social-ready subtitles generated';
    insights.push({
      id: 'platform-ready',
      icon: '🎯',
      title: readyTitle,
      detail: `${segments.length || 'Timed'} cues · ${plat} workflow`
    });

    const emoCount = segments.reduce((n, s) => n + (s.text.match(EMOTIONAL_WORDS) || []).length, 0);
    if (emoCount > 0) {
      insights.push({
        id: 'emotion',
        icon: '🧠',
        title: 'Emotional intensity spike',
        detail: `${emoCount} emotional beat${emoCount > 1 ? 's' : ''} in transcript`
      });
    }

    if (wpm >= 165) {
      insights.push({
        id: 'pace',
        icon: '🎙',
        title: 'Fast-paced speaking detected',
        detail: `~${wpm} words/min — punchy delivery`
      });
    } else if (wpm > 0) {
      insights.push({
        id: 'pace',
        icon: '🎙',
        title: 'Clear speaking pace',
        detail: `~${wpm} words/min · easy to caption`
      });
    }

    const langLabel = language && language !== 'auto' ? String(language).toUpperCase().slice(0, 8) : 'Auto-detected';
    insights.push({
      id: 'lang',
      icon: '🌐',
      title: `Language: ${langLabel}`,
      detail: `${wordCount.toLocaleString()} words analyzed`
    });

    return insights.slice(0, 6);
  }

  function analyzeTranscript(input) {
    const durationSec = Number(input?.durationSec) || 0;
    let segments = normalizeSegments(input?.segments);
    const fullText = String(input?.fullText || '').trim();

    if (!segments.length && fullText) {
      segments = segmentsFromPlainText(fullText, durationSec);
    }

    const viralMoments = detectViralMoments(segments, 5);
    const chapters = buildChapters(segments, durationSec);
    const insights = buildInsights(
      segments,
      fullText || segments.map((s) => s.text).join(' '),
      durationSec,
      input?.language,
      input?.platform
    );

    const playerLines = segments.slice(0, 24).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text
    }));

    return {
      segments,
      insights,
      viralMoments,
      chapters,
      playerLines: playerLines.length ? playerLines : [{ start: 0, end: 5, text: fullText.slice(0, 120) || 'Your transcript is ready.' }],
      stats: {
        segmentCount: segments.length,
        wordCount: fullText.split(/\s+/).filter(Boolean).length,
        durationSec: durationSec || (segments.length ? segments[segments.length - 1].end : 0)
      }
    };
  }

  global.CutupTranscriptInsights = {
    analyzeTranscript,
    formatClock
  };
})(typeof window !== 'undefined' ? window : globalThis);
