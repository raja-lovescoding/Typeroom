import type { ReactNode } from 'react';
import { isPlaceholder } from '../config/site.js';
import { usePageTitle } from '../lib/router.js';

/** Layout for text pages (About, Privacy, Terms, Contact). */
export function ProsePage({ title, lead, updated, children }: {
  title: string;
  lead?: ReactNode;
  /** "Last updated" date for legal pages. */
  updated?: string;
  children: ReactNode;
}) {
  usePageTitle(title);
  return <article className="prose">
    <header className="prose-head">
      <h1>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
      {updated && <p className="muted small">Last updated: {updated}</p>}
    </header>
    {children}
  </article>;
}

/**
 * Renders an operator-supplied value. Unconfigured values are [[PLACEHOLDERS]] and render as a
 * highlighted marker so they can't slip into production unnoticed.
 */
export function Fill({ value }: { value: string }) {
  if (isPlaceholder(value)) return <mark className="placeholder" title="Not configured yet: set this in the web app's environment">{value}</mark>;
  return <>{value}</>;
}

/** A mailto link for the configured contact address, or its placeholder. */
export function ContactEmail({ email, subject }: { email: string; subject?: string }) {
  if (isPlaceholder(email)) return <Fill value={email} />;
  const href = `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  return <a href={href}>{email}</a>;
}

export function External({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}
