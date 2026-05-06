/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPERATIONAL_STATE_URL?: string;
  /** `operational` (default) | `demo` — demo enables optional simulation placeholders on the office floor */
  readonly VITE_INSTALOGIST_UI_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
