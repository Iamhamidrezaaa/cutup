/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPERATIONAL_STATE_URL?: string;
  /** Milliseconds between snapshot polls; 0 disables polling. */
  readonly VITE_OPERATIONAL_POLL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
