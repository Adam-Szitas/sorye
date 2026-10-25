'use client';

import { useEffect } from 'react';

const LINKS = [
  { href: '#map', label: 'System' },
  { href: '#request', label: 'Request' },
  { href: '#events', label: 'Relay' },
  { href: '#state', label: 'State' },
  { href: '#storage', label: 'Storage' },
  { href: '#docker', label: 'Docker' },
  { href: '#setup', label: 'Setup' },
] as const;

export function ArchitectureNav() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('[data-arch-nav]');
    if (!nav) return;
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    const sections = links
      .map((link) => document.getElementById(link.hash.slice(1)))
      .filter((node): node is HTMLElement => node instanceof HTMLElement);

    const mark = (id: string | null) => {
      for (const link of links) {
        const on = id !== null && link.hash === `#${id}`;
        link.classList.toggle('is-current', on);
        if (on) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    };

    if (CSS.supports('scroll-target-group: auto')) {
      const style = document.createElement('style');
      style.textContent =
        '.arch-nav a:target-current{color:var(--color-text);font-weight:650;background:rgba(56,189,248,.12);box-shadow:inset 0 -2px 0 var(--color-accent)}@media (min-width:56rem){.arch-nav a:target-current{box-shadow:inset 2px 0 0 var(--color-accent)}}';
      document.head.appendChild(style);
      const sync = () => {
        const current = nav.querySelector('a:target-current');
        const id = current instanceof HTMLAnchorElement ? current.hash.slice(1) : null;
        for (const link of links) {
          link.classList.remove('is-current');
          if (id !== null && link.hash === `#${id}`) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        }
      };
      sync();
      document.addEventListener('scroll', sync, { passive: true });
      document.addEventListener('scrollend', sync);
      return () => {
        document.removeEventListener('scroll', sync);
        document.removeEventListener('scrollend', sync);
        style.remove();
      };
    }

    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let best: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        if (best) mark(best);
      },
      { rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="On this page" data-arch-nav className="arch-nav">
      {LINKS.map((link) => (
        <a key={link.href} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
