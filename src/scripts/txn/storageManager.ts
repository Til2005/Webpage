import type { Note, Folder } from './stateManager';

const NOTES_KEY = 'txn_notes';
const FOLDERS_KEY = 'txn_folders';

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function loadFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes: Note[]) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch (e) {
    console.error('TXN: saveNotes failed', e);
    window.dispatchEvent(new CustomEvent('txn:storage-error'));
  }
}

export function saveFolders(folders: Folder[]) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch (e) {
    console.error('TXN: saveFolders failed', e);
    window.dispatchEvent(new CustomEvent('txn:storage-error'));
  }
}
