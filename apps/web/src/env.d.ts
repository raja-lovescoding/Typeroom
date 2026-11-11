/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_REPO_URL?: string;
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_OPERATOR_NAME?: string;
  readonly VITE_JURISDICTION?: string;
  readonly VITE_LOG_RETENTION_DAYS?: string;
  readonly VITE_HOSTING_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** apps/web/package.json version, injected by vite.config.ts. */
declare const __APP_VERSION__: string;
