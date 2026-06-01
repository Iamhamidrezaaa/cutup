# Segmentation Training Data

Semantic caption line-break outcomes for evaluation and future optimization.

## Format (`dataset.jsonl`)

```json
{
  "recordedAt": "2026-06-01T12:00:00.000Z",
  "language": "en",
  "domain": "fitness",
  "text": "Nice deadlift keep pushing",
  "chosenLines": ["Nice deadlift", "keep pushing"],
  "score": 94,
  "breakReason": "domain_phrase",
  "selectedVersion": "semantic",
  "currentScore": 72,
  "semanticScore": 94
}
```

Disable: `SEGMENTATION_TRAINING_DATA=0`
