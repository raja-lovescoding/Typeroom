import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ErrorPage } from './pages/Status.js';

// The outer boundary catches failures in the layout itself (header, footer, game state); page-level
// errors are caught inside App so the header and footer stay usable.
createRoot(document.getElementById('root')!).render(<StrictMode>
  <ErrorBoundary fallback={(props) => <div className="app is-page"><main className="stage"><ErrorPage {...props} /></main></div>}>
    <App />
  </ErrorBoundary>
</StrictMode>);
