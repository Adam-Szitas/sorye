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

    let active: string | null = null;
    const mark = (id: string | null) => {
      for (const link of links) {
        const on = id !== null && link.hash === `#${id}`;
        link.classList.toggle('is-current', on);
        if (on) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
      if (id === active) return;
      active = id;
      const link = links.find((item) => item.hash === `#${id}`);
      if (!link || nav.scrollWidth <= nav.clientWidth + 1) return;
      const left = link.offsetLeft;
      const right = left + link.offsetWidth;
      if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) {
        nav.scrollLeft = Math.max(0, left - 12);
      }
    };

    let frame = 0;
    const sync = () => {
      const line = Math.min(160, window.innerHeight * 0.28);
      let current: string | null = sections[0]?.id ?? null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) current = section.id;
      }
      mark(current);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };

    sync();
    const settle = window.setTimeout(sync, 50);
    document.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', sync);
    return () => {
      window.clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', sync);
    };
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
