import { SITE, isPlaceholder } from '../config/site.js';
import { ContactEmail, External, ProsePage } from './Page.js';

/** No form and no backend: a mailto link (from VITE_CONTACT_EMAIL) and GitHub issues. */
export function Contact() {
  const hasEmail = !isPlaceholder(SITE.contactEmail);
  return <ProsePage title="Contact" lead={<>Found a bug, have an idea, or need to reach us about your data? Here&apos;s how.</>}>
    <div className="contact-grid">
      <section className="contact-card">
        <h2>Bugs and ideas</h2>
        <p>The fastest way to report a problem or suggest a feature is a GitHub issue. Anyone can read them, so please don&apos;t include personal details.</p>
        <p className="contact-action"><External href={`${SITE.issuesUrl}/new`}>Open an issue on GitHub</External></p>
        <p className="muted small">Or browse <External href={SITE.issuesUrl}>existing issues</External> first.</p>
      </section>

      <section className="contact-card">
        <h2>Email</h2>
        <p>For privacy requests, reports about abusive rooms or players, security issues, and anything you&apos;d rather not post publicly.</p>
        <p className="contact-action">
          {hasEmail
            ? <a className="button-link" href={`mailto:${SITE.contactEmail}?subject=${encodeURIComponent('Typeroom')}`}>Email {SITE.contactEmail}</a>
            : <ContactEmail email={SITE.contactEmail} />}
        </p>
        <p className="muted small">For abuse reports, include the room code and roughly when it happened.</p>
      </section>
    </div>

    <section>
      <h2>Security</h2>
      <p>
        If you think you&apos;ve found a security vulnerability, please email it rather than opening a public issue, and give us a
        reasonable chance to fix it before disclosing it. Thank you!
      </p>
    </section>
  </ProsePage>;
}
