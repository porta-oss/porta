/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_AUTH_TIMEOUT_MS?: string;
  readonly VITE_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __PORTA_RUNTIME_ENV?: {
    API_URL?: string;
    WEB_URL?: string;
  };
}
