/** Shared Notes models for Hub API + Notes remote. */

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

/** Browser key used only for one-time migrate off localStorage. */
export const NOTES_LOCAL_STORAGE_KEY = 'sorye:notes:items';
