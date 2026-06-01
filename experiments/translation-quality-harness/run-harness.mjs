/**
 * Translation quality harness runner (evaluation only).
 *
 * Modes:
 *   HARNESS_MODE=mock (default) — heuristic mock translate/rewrite/back-translate
 *   HARNESS_MODE=live — OpenAI/Groq via translate-srt providers (requires API keys)
 *
 * Env:
 *   HARNESS_SAMPLE_PER_CELL=5
 *   HARNESS_SOURCE=en
 *   HARNESS_TARGETS=fa,ar,es,ru,fr,de,tr,hi,tl
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  runTranslationQualityHarness,
  buildQualityReport,
  evaluateHarnessSentence,
  HARNESS_LANGUAGES
} from '../../api/translation-quality-harness.js';
import { scoreTranslationPair } from '../../api/translation-quality-score.js';
import { buildLanguageAwareRewritePrompts } from '../../api/translation-rewrite-strategies.js';
import { exampleQualityScores } from '../../api/translation-quality-score.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(__dirname, 'translation-quality-report.json');
const EXAMPLE_PATH = join(__dirname, 'translation-quality-report.example.json');

/** Mock providers for offline harness (deterministic). */
function createMockProviders() {
  const MOCK_FA = {
    'Nice deadlift.': 'ددلیفت خوبی است',
    "Let's go": 'بزن بریم',
    'Everything okay?': 'همه چیز خوب است؟',
    'We need more leads.': 'ما به لیدهای بیشتری نیاز داریم'
  };

  return {
    async translate(text, _src, tgt) {
      if (tgt === 'fa' && MOCK_FA[text]) return MOCK_FA[text];
      if (tgt === 'fa') return `[fa] ${text}`;
      if (tgt === 'ar') return `[ar] ${text}`;
      if (tgt === 'es') return `[es] ${text}`;
      return `[${tgt}] ${text}`;
    },
    async rewrite(source, translated, tgt) {
      if (tgt === 'fa' && translated.includes('ددلیفت خوبی')) return 'ددلیفتت عالیه';
      if (tgt === 'fa' && translated.includes('همه چیز خوب')) return 'همه چیز روبه‌راهه؟';
      return translated;
    },
    async backTranslate(translated, src) {
      if (src === 'en' && translated.includes('ددلیفتت عالیه')) return 'Nice deadlift';
      if (src === 'en' && translated.includes('بزن بریم')) return "Let's go";
      return translated.replace(/^\[[a-z]{2}\]\s*/i, '');
    }
  };
}

async function createLiveProviders() {
  const mod = await import('../../api/translate-srt.js');
  const { completeSingleSubtitleLine } = mod;
  const traceId = `harness-${Date.now()}`;

  const translatePrompt = (text, src, tgt) => ({
    systemPrompt: `Translate to ${tgt}. Output ONLY the translation.`,
    userPrompt: `Translate from ${src} to ${tgt}:\n${text}`
  });

  return {
    async translate(text, src, tgt) {
      const p = translatePrompt(text, src, tgt);
      return completeSingleSubtitleLine(p, traceId, `tr-${src}-${tgt}`);
    },
    async rewrite(source, translated, tgt) {
      const p = buildLanguageAwareRewritePrompts(source, translated, tgt);
      return completeSingleSubtitleLine(p, traceId, `rw-${tgt}`);
    },
    async backTranslate(translated, src) {
      const { buildBackTranslationPrompts } = await import('../../api/translation-quality-score.js');
      const p = buildBackTranslationPrompts(translated, src);
      return completeSingleSubtitleLine(p, traceId, `bt-${src}`);
    }
  };
}

async function main() {
  const mode = String(process.env.HARNESS_MODE || 'mock').toLowerCase();
  const providers =
    mode === 'live' ? await createLiveProviders() : createMockProviders();

  const sourceLanguage = process.env.HARNESS_SOURCE || 'en';
  const targetLanguages = (process.env.HARNESS_TARGETS || 'fa,ar,es,ru,fr,de,tr,hi,tl')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log('[translation-quality-harness] mode=', mode, 'source=', sourceLanguage);

  const { report, rows, outputPath } = await runTranslationQualityHarness({
    sourceLanguage,
    targetLanguages,
    samplePerCell: Number(process.env.HARNESS_SAMPLE_PER_CELL || 5),
    translate: providers.translate,
    rewrite: providers.rewrite,
    backTranslate: providers.backTranslate,
    outputPath: REPORT_PATH
  });

  const examples = exampleQualityScores();
  const exampleReport = {
    note: 'Static heuristic examples (no LLM)',
    literalVsNatural: examples,
    sampleEvaluation: await evaluateHarnessSentence({
      sourceText: 'Nice deadlift.',
      sourceLanguage: 'en',
      targetLanguage: 'fa',
      domain: 'fitness',
      ...providers
    })
  };

  mkdirSync(__dirname, { recursive: true });
  writeFileSync(EXAMPLE_PATH, JSON.stringify(exampleReport, null, 2), 'utf8');

  console.log('\n=== Report summary ===');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('\n=== By target (dashboard) ===');
  const dash = {};
  for (const [lang, v] of Object.entries(report.byTargetLanguage)) {
    dash[lang] = { averageScore: v.averageScore };
  }
  console.log(JSON.stringify(dash, null, 2));
  console.log('\n=== Lowest scores ===');
  console.log(report.summary.lowestScoringTargets);
  console.log('\n=== Recommendations ===');
  console.log(report.recommendedImprovements);
  console.log('\nReport:', outputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
