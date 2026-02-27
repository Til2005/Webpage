export interface Note {
  id: string;
  title: string;
  content: string; // HTML innerHTML
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  expanded: boolean;
}

export interface TXNState {
  folders: Folder[];
  notes: Note[];
  activeNoteId: string | null;
  searchQuery: string;
  selectedNoteIds: string[];
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

let state: TXNState = {
  folders: [],
  notes: [],
  activeNoteId: null,
  searchQuery: '',
  selectedNoteIds: [],
};

const listeners = new Set<() => void>();

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  listeners.forEach(cb => cb());
}

export function getState(): Readonly<TXNState> {
  return state;
}

export function initState(initial: Partial<TXNState>) {
  state = { ...state, ...initial };
}

export function loadCloudData(notes: Note[], folders: Folder[]) {
  state = { ...state, notes, folders };
  notify();
}

// ── Note operations ──────────────────────────────────────────────────────────

export function createNote(folderId: string | null = null): Note {
  const now = Date.now();
  const note: Note = {
    id: generateId(),
    title: 'Unbenannte Notiz',
    content: '<p><br></p>',
    folderId,
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };
  state = { ...state, notes: [...state.notes, note], activeNoteId: note.id };
  notify();
  return note;
}

export function updateNote(id: string, partial: Partial<Note>) {
  state = {
    ...state,
    notes: state.notes.map(n =>
      n.id === id ? { ...n, ...partial, updatedAt: Date.now() } : n
    ),
  };
  notify();
}

export function deleteNote(id: string) {
  state = {
    ...state,
    notes: state.notes.filter(n => n.id !== id),
    activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
    selectedNoteIds: state.selectedNoteIds.filter(sid => sid !== id),
  };
  notify();
}

export function togglePinNote(id: string) {
  state = {
    ...state,
    notes: state.notes.map(n =>
      n.id === id ? { ...n, pinned: !n.pinned } : n
    ),
  };
  notify();
}

// ── Folder operations ─────────────────────────────────────────────────────────

export function createFolder(name: string, parentId: string | null = null): Folder {
  const folder: Folder = {
    id: generateId(),
    name,
    parentId,
    createdAt: Date.now(),
    expanded: true,
  };
  state = { ...state, folders: [...state.folders, folder] };
  notify();
  return folder;
}

export function updateFolder(id: string, partial: Partial<Folder>) {
  state = {
    ...state,
    folders: state.folders.map(f =>
      f.id === id ? { ...f, ...partial } : f
    ),
  };
  notify();
}

export function deleteFolder(id: string) {
  // Move direct children to root, delete sub-folders recursively
  const childFolderIds = state.folders
    .filter(f => f.parentId === id)
    .map(f => f.id);

  state = {
    ...state,
    folders: state.folders.filter(f => f.id !== id && f.parentId !== id),
    notes: state.notes.map(n => n.folderId === id ? { ...n, folderId: null } : n),
  };
  notify();
  childFolderIds.forEach(cid => deleteFolder(cid));
}

export function toggleFolderExpanded(id: string) {
  state = {
    ...state,
    folders: state.folders.map(f =>
      f.id === id ? { ...f, expanded: !f.expanded } : f
    ),
  };
  notify();
}

// ── Active note / search ──────────────────────────────────────────────────────

export function setActiveNote(id: string | null) {
  state = { ...state, activeNoteId: id };
  notify();
}

export function setSearchQuery(query: string) {
  state = { ...state, searchQuery: query };
  notify();
}

export function toggleNoteSelection(id: string) {
  const already = state.selectedNoteIds.includes(id);
  state = {
    ...state,
    selectedNoteIds: already
      ? state.selectedNoteIds.filter(sid => sid !== id)
      : [...state.selectedNoteIds, id],
  };
  notify();
}

export function clearSelection() {
  state = { ...state, selectedNoteIds: [] };
  notify();
}

export function batchUpdateNoteContents(updates: Array<{ id: string; content: string }>) {
  if (updates.length === 0) return;
  const map = new Map(updates.map(u => [u.id, u.content]));
  state = {
    ...state,
    notes: state.notes.map(n => map.has(n.id) ? { ...n, content: map.get(n.id)! } : n),
  };
  notify();
}

export function restoreNote(note: Note) {
  if (state.notes.some(n => n.id === note.id)) return;
  state = { ...state, notes: [...state.notes, note], activeNoteId: note.id };
  notify();
}

export function restoreFolder(folder: Folder) {
  if (state.folders.some(f => f.id === folder.id)) return;
  state = { ...state, folders: [...state.folders, folder] };
  notify();
}
