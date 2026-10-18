import { useEffect, useState } from 'react';

// Hash routing for the real app; in-memory routing for the static demo (where the URL hash isn't ours to use).
let cur = __DEMO__ ? '/' : window.location.hash.slice(1) || '/';
const subs = new Set();
const notify = () => subs.forEach((f) => f());

export const nav = (p) => {
  cur = p;
  if (!__DEMO__) { try { window.location.hash = p; } catch { /* ignore */ } }
  notify();
};

if (!__DEMO__) window.addEventListener('hashchange', () => { cur = window.location.hash.slice(1) || '/'; notify(); });
else document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (a) { e.preventDefault(); nav(a.getAttribute('href').slice(1)); window.scrollTo({ top: 0 }); }
});

export function useHash() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return cur;
}
