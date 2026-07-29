export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

const STORAGE_KEY = 'sorye:notes:items';

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedNotes();
    const parsed = JSON.parse(raw) as Note[];
    return Array.isArray(parsed) ? parsed : seedNotes();
  } catch {
    return seedNotes();
  }
}

export function saveNotes(notes: Note[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function seedNotes(): Note[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'note-seed-1',
      title: 'Welcome to Notes',
      body: 'Capture ideas, meeting notes, and docs here. Data is stored locally in your browser for now.',
      updatedAt: now,
    },
  ];
}
