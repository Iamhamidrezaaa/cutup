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

export const TRANSCRIPTION_PROVIDER_ORDER = [
  OPENAI_PROVIDER_ID,
  GROQ_PROVIDER_ID,
  DEEPGRAM_PROVIDER_ID,
  LOCAL_WHISPER_PROVIDER_ID
];
