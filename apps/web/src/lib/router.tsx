import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/**
 * A deliberately tiny History API router. The site has a handful of flat routes, so a pathname
 * store plus a <Link> that intercepts plain left-clicks is all it needs.
 */

const NAVIGATE_EVENT = 'typeroom:navigate';

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

const getPathname = () => window.location.pathname;

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === window.location.pathname + window.location.search + window.location.hash) return;
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  if (!options.replace) window.scrollTo({ top: 0 });
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/** An internal link. Modified clicks (new tab, etc.) fall through to the browser. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  const pathname = usePathname();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} aria-current={pathname === to ? 'page' : undefined} onClick={handleClick} {...rest} />;
}

/** Sets document.title for the current page. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · Typeroom` : 'Typeroom: multiplayer typing races';
  }, [title]);
}

export const ROOM_PATH = /^\/r\/([A-Z2-9]{6})\/?$/;

export function roomCodeFromPath(pathname: string): string | undefined {
  return pathname.match(ROOM_PATH)?.[1];
}
