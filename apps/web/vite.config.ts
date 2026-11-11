import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Operator details the legal pages need. Unset values render as visible [[PLACEHOLDERS]]. */
const OPERATOR_VARIABLES = ['VITE_CONTACT_EMAIL', 'VITE_OPERATOR_NAME', 'VITE_JURISDICTION', 'VITE_LOG_RETENTION_DAYS', 'VITE_HOSTING_PROVIDER'];

function warnAboutPlaceholders(mode: string): Plugin {
  return {
    name: 'typeroom:placeholder-warning',
    apply: 'build',
    buildStart() {
      const values = loadEnv(mode, process.cwd(), 'VITE_');
      const missing = OPERATOR_VARIABLES.filter((name) => !(values[name] ?? process.env[name])?.trim());
      if (missing.length > 0) {
        this.warn(`Privacy, Terms and Contact pages will show placeholders until these are set: ${missing.join(', ')}`);
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), warnAboutPlaceholders(mode)],
  define: { __APP_VERSION__: JSON.stringify(version) },
}));
