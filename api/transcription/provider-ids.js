/** Provider id strings — single source of truth (no circular imports). */
export const PROVIDERS = {
  OPENAI: 'openai',
  GROQ: 'groq',
  DEEPGRAM: 'deepgram',
  LOCAL: 'local-whisper'
};

export const OPENAI_PROVIDER_ID = PROVIDERS.OPENAI;
export const GROQ_PROVIDER_ID = PROVIDERS.GROQ;
export const DEEPGRAM_PROVIDER_ID = PROVIDERS.DEEPGRAM;
export const LOCAL_WHISPER_PROVIDER_ID = PROVIDERS.LOCAL;

/** Production default ASR — Groq Whisper Large V3. */
export const PRIMARY_TRANSCRIPTION_PROVIDER_ID = GROQ_PROVIDER_ID;

export const GROQ_WHISPER_MODEL = 'whisper-large-v3';
export const OPENAI_WHISPER_MODEL = 'whisper-1';

/** Failover order: primary first, then optional fallbacks. */
export const TRANSCRIPTION_PROVIDER_ORDER = [
  GROQ_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
  DEEPGRAM_PROVIDER_ID,
  LOCAL_WHISPER_PROVIDER_ID
];

export const TRANSCRIPTION_PROVIDER_MODELS = Object.freeze({
  [GROQ_PROVIDER_ID]: GROQ_WHISPER_MODEL,
  [OPENAI_PROVIDER_ID]: OPENAI_WHISPER_MODEL,
  [DEEPGRAM_PROVIDER_ID]: 'nova-3',
  [LOCAL_WHISPER_PROVIDER_ID]: null
});
