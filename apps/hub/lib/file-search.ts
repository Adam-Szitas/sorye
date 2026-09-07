import type { WorkspaceFile } from '@sorye/types';

/** Client-side Drive regex cap — never compile unbounded user patterns on the server. */
export const FILE_SEARCH_REGEX_MAX = 80;

export function fileExtension(name: string): string {
  const base = name.replace(/^.*[/\\]/, '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

function matchesTypeToken(file: WorkspaceFile, token: string): boolean {
  const mime = file.mime.toLowerCase();
  const ext = fileExtension(file.displayName);
  switch (token) {
    case 'pdf':
      return mime === 'application/pdf' || ext === 'pdf';
    case 'image':
    case 'img':
      return mime.startsWith('image/');
    case 'text':
      return mime.startsWith('text/') || mime === 'application/json';
    case 'csv':
      return mime === 'text/csv' || ext === 'csv';
    case 'md':
    case 'markdown':
      return mime === 'text/markdown' || ext === 'md' || ext === 'markdown';
    case 'json':
      return mime === 'application/json' || ext === 'json';
    case 'office':
      return (
        mime.includes('word') ||
        mime.includes('excel') ||
        mime.includes('spreadsheet') ||
        mime.includes('powerpoint') ||
        mime.includes('presentation')
      );
    default:
      return mime.includes(token) || ext === token;
  }
}

function matchesRegex(file: WorkspaceFile, re: RegExp): boolean {
  return (
    re.test(file.displayName) ||
    re.test(file.mime) ||
    re.test(fileExtension(file.displayName))
  );
}

/**
 * Filter an already-fetched workspace file list in the browser.
 * Regex is compiled here only (length-capped) — never against the server store.
 */
export function filterWorkspaceFiles(
  files: WorkspaceFile[],
  query: string,
  regexMode: boolean,
): { files: WorkspaceFile[]; error: string | null } {
  const raw = query.trim();
  if (!raw) return { files, error: null };

  const typeTokens: string[] = [];
  const rest = raw
    .replace(/\btype:([a-z0-9.+-]+)/gi, (_, token: string) => {
      typeTokens.push(token.toLowerCase());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  let next = files;
  if (typeTokens.length > 0) {
    next = next.filter((file) =>
      typeTokens.every((token) => matchesTypeToken(file, token)),
    );
  }

  if (!rest) return { files: next, error: null };

  const wrapped = /^\/([\s\S]*)\/([a-z]*)$/i.exec(rest);
  const useRegex = regexMode || Boolean(wrapped);
  const source = wrapped ? wrapped[1] : rest;
  const flags = wrapped ? wrapped[2] : 'i';

  if (useRegex) {
    if (source.length === 0) {
      return { files: next, error: 'Enter a regular expression' };
    }
    if (source.length > FILE_SEARCH_REGEX_MAX) {
      return {
        files: next,
        error: `Regex is too long (max ${FILE_SEARCH_REGEX_MAX} characters)`,
      };
    }
    try {
      const re = new RegExp(source, flags);
      return {
        files: next.filter((file) => matchesRegex(file, re)),
        error: null,
      };
    } catch {
      return { files: next, error: 'Invalid regular expression' };
    }
  }

  const needle = rest.toLowerCase();
  return {
    files: next.filter((file) => {
      return (
        file.displayName.toLowerCase().includes(needle) ||
        file.mime.toLowerCase().includes(needle) ||
        fileExtension(file.displayName).includes(needle)
      );
    }),
    error: null,
  };
}
