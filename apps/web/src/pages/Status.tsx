import { SITE } from '../config/site.js';
import { Link, usePageTitle, usePathname } from '../lib/router.js';
import { External } from './Page.js';

/**
 * Shared look for 404 and error pages: a big code typed out in the race font, with the caret
 * stopped on a wrong character, as if someone mistyped their way here.
 */
function TypedCode({ code, label }: { code: string; label: string }) {
  return <p className="status-code" aria-label={label}>
    <span aria-hidden>
      {[...code].map((char, index) => <span key={index} className={index === code.length - 1 ? 'char wrong-static' : 'char typed'}>{char}</span>)}
      <span className="status-caret" />
    </span>
  </p>;
}

export function NotFound() {
  const pathname = usePathname();
  usePageTitle('Page not found');
  return <section className="status-page">
    <TypedCode code="404" label="Error 404" />
    <h1>That page doesn&apos;t exist.</h1>
    <p className="muted">
      Nothing lives at <code className="status-path">{pathname}</code>. If you followed a room link, the room may have
      closed. Rooms only last while someone is in them.
    </p>
    <div className="status-actions">
      <Link to="/" className="button-link primary">Back to typing</Link>
      <Link to="/about" className="button-link">About Typeroom</Link>
    </div>
  </section>;
}

/** Fallback for the global error boundary. */
export function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  usePageTitle('Something went wrong');
  return <section className="status-page" role="alert">
    <TypedCode code="500" label="Unexpected error" />
    <h1>Something broke on our side.</h1>
    <p className="muted">
      Sorry about that. It wasn&apos;t anything you did. Your settings are safe. Try again, or reload the page if it keeps happening.
    </p>
    <div className="status-actions">
      <button className="primary" onClick={reset}>Try again</button>
      <button className="secondary" onClick={() => window.location.reload()}>Reload page</button>
      <a className="button-link" href="/">Home</a>
    </div>
    <p className="muted small">
      If this keeps happening, please <External href={`${SITE.issuesUrl}/new`}>report it on GitHub</External> with
      what you were doing and the details below.
    </p>
    <details className="error-details">
      <summary>Technical details</summary>
      <pre>{error.name}: {error.message}</pre>
    </details>
  </section>;
}
