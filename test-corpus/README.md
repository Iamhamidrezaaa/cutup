# Translation Quality Test Corpus

Multilingual subtitle evaluation corpus for the translation quality harness.

## Structure

```
test-corpus/
  manifest.json
  {language}/{domain}.json   # 50+ sentences each
```

**Languages:** English, Arabic, Spanish, Russian, French, German, Turkish, Persian, Tagalog, Hindi

**Domains:** general, fitness, business, technology

**Minimum:** 50 sentences per language/domain (2000 sentences total).

## Generate / refresh

```bash
node test-corpus/generate-corpus.mjs
```

## Harness

```bash
# Offline mock evaluation (no API keys)
node experiments/translation-quality-harness/run-harness.mjs

# Live LLM evaluation
set HARNESS_MODE=live
set HARNESS_SAMPLE_PER_CELL=3
node experiments/translation-quality-harness/run-harness.mjs
```

Output: `experiments/translation-quality-harness/translation-quality-report.json`
