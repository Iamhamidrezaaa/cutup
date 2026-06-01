# Translation Quality Harness (Phase 2)

Evaluation-only pipeline. Does **not** modify ASS, RTL, fonts, styles, or timing.

## Architecture

```
test-corpus/{lang}/{domain}.json
        │
        ▼
api/translation-quality-harness.js
        │
        ├─► translate (provider: mock | live LLM)
        ├─► rewrite (api/translation-rewrite-strategies.js — per target language)
        ├─► back-translate
        └─► evaluate (api/translation-quality-score.js)
        │
        ▼
translation-quality-report.json
```

### Modules

| Module | Role |
|--------|------|
| `api/translation-rewrite-strategies.js` | fa/ar/es/ru/fr/de/tr/hi/tl/en localization prompts |
| `api/translation-quality-harness.js` | Sentence pipeline, failure detection, report aggregation |
| `api/translation-quality-score.js` | 0–100 scores, back-translation semantic blend |
| `test-corpus/generate-corpus.mjs` | Builds 50+ sentences × 10 langs × 4 domains |

### Pipeline per sentence

1. **Original** (corpus)
2. **Translate** → target language
3. **Rewrite** (if `translationScore < 75` before rewrite, or always in harness after initial score)
4. **Back-translate** → source language
5. **Evaluate** → `translationScore`, `meaningScore`, `fluencyScore`, `rewriteApplied`

### Failure flags

- `foreign_script_contamination`
- `low_language_confidence` (confidence < 0.80)
- `low_translation_score` (< 75)
- `low_meaning_preservation` (< 70)

## Report format

See `translation-quality-report.json`:

```json
{
  "byTargetLanguage": {
    "fa": { "averageScore": 91, "averageMeaningScore": 88, "rewriteRate": 0.2 }
  },
  "summary": {
    "lowestScoringTargets": [{ "language": "fa", "averageScore": 82 }]
  },
  "recommendedImprovements": ["..."]
}
```

## Run

```bash
node test-corpus/generate-corpus.mjs
node experiments/translation-quality-harness/run-harness.mjs
```
