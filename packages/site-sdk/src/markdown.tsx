/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { Fragment, h, type Child } from './html';
// Keep the JSX factory imports alive: Turbopack elides imports it sees as unused
// before it applies the classic JSX transform, leaving `h is not defined` at runtime.
void h; void Fragment;
/**
 * Safe Markdown subset. No HTML: everything that is not one of the constructs
 * below is rendered as literal (escaped) text.
 *
 * Blocks: paragraphs, `## ` / `### ` headings (rendered one level below the
 * section heading), `- ` / `* ` lists, `1. ` lists.
 * Inline: `**bold**`, `*italic*` / `_italic_`, `[label](link)` where link
 * passes `isSafeLink`; unsafe links render as their label only.
 */
import { isSafeLink } from './schema';

export type HrefResolver = (link: string) => string;

const INLINE = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;

function inline(text: string, href: HrefResolver, keyBase: string): Child[] {
  const out: Child[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyBase}-${index++}`;
    if (match[1] !== undefined) out.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2] !== undefined) out.push(<em key={key}>{match[2]}</em>);
    else if (match[3] !== undefined) out.push(<em key={key}>{match[3]}</em>);
    else {
      const label = match[4] ?? '';
      const link = match[5] ?? '';
      out.push(isSafeLink(link) ? <a key={key} href={href(link)} {...externalRel(link)}>{label}</a> : <>{label}</>);
    }
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function externalRel(link: string): { rel?: string } {
  return link.startsWith('https://') ? { rel: 'noopener noreferrer' } : {};
}

function withBreaks(lines: string[], href: HrefResolver, keyBase: string): Child[] {
  const out: Child[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyBase}-br${i}`} />);
    out.push(...inline(line, href, `${keyBase}-${i}`));
  });
  return out;
}

export function Markdown({ source, href }: { source: string; href: HrefResolver }) {
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: Child[] = [];
  blocks.forEach((block, bi) => {
    const lines = block.split('\n');
    const key = `b${bi}`;
    if (lines.length === 1 && lines[0]!.startsWith('### ')) {
      out.push(<h4 key={key}>{inline(lines[0]!.slice(4), href, key)}</h4>);
    } else if (lines.length === 1 && lines[0]!.startsWith('## ')) {
      out.push(<h3 key={key}>{inline(lines[0]!.slice(3), href, key)}</h3>);
    } else if (lines.every((l) => /^[-*] /.test(l))) {
      out.push(<ul key={key}>{lines.map((l, i) => <li key={i}>{inline(l.slice(2), href, `${key}-${i}`)}</li>)}</ul>);
    } else if (lines.every((l) => /^\d{1,3}\. /.test(l))) {
      out.push(<ol key={key}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\d{1,3}\. /, ''), href, `${key}-${i}`)}</li>)}</ol>);
    } else {
      out.push(<p key={key}>{withBreaks(lines, href, key)}</p>);
    }
  });
  return <>{out}</>;
}

/** Plain text of a Markdown source, for meta descriptions and message bodies. */
export function markdownToText(source: string): string {
  return source
    .replace(/\[([^\]\n]{1,200})\]\([^)\s]{1,500}\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/[*_]([^*_\n]+)[*_]/g, '$1')
    .replace(/^#{2,3} /gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
