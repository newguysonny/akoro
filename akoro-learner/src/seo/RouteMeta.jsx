/**
 * RouteMeta — keeps the tab title and description in step with the page while a visitor navigates the marketing site
 * (the build already wrote the right ones into each page's HTML for first loads and crawlers).
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { pageFor } from './pages.js';

function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

export default function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = pageFor(pathname);
    if (!page) return;
    document.title = page.title;
    setMeta('description', page.description);
  }, [pathname]);
  return null;
}
