/**
 * Site-wide facts used by the layout and the About / Privacy / Terms / Contact pages.
 *
 * Operator details come from build-time environment variables (see apps/web/.env.example).
 * Anything not configured renders as a highlighted [[PLACEHOLDER]] on the page, so a missing
 * value is impossible to miss, and `vite build` warns about it.
 */

const env = import.meta.env;

export const PLACEHOLDER_PATTERN = /^\[\[[A-Z_]+\]\]$/;
const placeholder = (name: string) => `[[${name}]]`;
const configured = (value: string | undefined, name: string) => (value && value.trim() ? value.trim() : placeholder(name));

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value);
}

const repoUrl = (env.VITE_REPO_URL?.trim() || 'https://github.com/raja-lovescoding/Typeroom').replace(/\/+$/, '');

export const SITE = {
  name: 'Typeroom',
  tagline: 'New age of type race begins ...',
  version: __APP_VERSION__,
  repoUrl,
  issuesUrl: `${repoUrl}/issues`,
  author: { name: 'raja-lovescoding', url: 'https://github.com/raja-lovescoding' },

  /** Where privacy and general requests go. Set VITE_CONTACT_EMAIL. */
  contactEmail: configured(env.VITE_CONTACT_EMAIL, 'CONTACT_EMAIL'),
  /** The person or organisation that runs this deployment. Set VITE_OPERATOR_NAME. */
  operatorName: configured(env.VITE_OPERATOR_NAME, 'OPERATOR_NAME'),
  /** Governing law for the Terms, e.g. "England and Wales". Set VITE_JURISDICTION. */
  jurisdiction: configured(env.VITE_JURISDICTION, 'JURISDICTION'),
  /** Who hosts the servers (processes logs on the operator's behalf), e.g. "Hetzner Online GmbH (Germany)". Set VITE_HOSTING_PROVIDER. */
  hostingProvider: configured(env.VITE_HOSTING_PROVIDER, 'HOSTING_PROVIDER'),
  /** How long the host keeps server/proxy logs. Must match your log rotation. Set VITE_LOG_RETENTION_DAYS. */
  logRetentionDays: configured(env.VITE_LOG_RETENTION_DAYS, 'LOG_RETENTION_DAYS'),

  /** Bump whenever the Privacy Policy or Terms text changes. */
  legalLastUpdated: '11 November 2026',
} as const;
