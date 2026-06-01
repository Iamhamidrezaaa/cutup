# Translation Training Data

Adaptive translation engine persists competition outcomes here for future training and evaluation.

## Layout

```
translation-training-data/
  dataset.jsonl          # append-only, one JSON object per cue
  jobs/{traceId}.json    # full job snapshot
```

## Record format (JSONL line)

```json
{
  "recordedAt": "2026-06-01T12:00:00.000Z",
  "traceId": "tr_abc",
  "sourceLanguage": "en",
  "targetLanguage": "fa",
  "source": "Nice deadlift.",
  "target": "ددلیفتت عالیه",
  "winnerAttemptId": 2,
  "winnerStage": "localization",
  "scores": {
    "translationScore": 83,
    "meaningScore": 78,
    "fluencyScore": 88,
    "compositeScore": 81.5
  },
  "attempts": [
    {
      "attemptId": 1,
      "stage": "direct",
      "text": "ددلیفت خوبی است",
      "translationScore": 53,
      "meaningScore": 48,
      "fluencyScore": 60
    },
    {
      "attemptId": 2,
      "stage": "localization",
      "text": "ددلیفتت عالیه",
      "translationScore": 83,
      "meaningScore": 78,
      "fluencyScore": 88
    }
  ]
}
```

Disable persistence: `TRANSLATION_TRAINING_DATA=0`
