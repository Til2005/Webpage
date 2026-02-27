import {
  getState, initState, subscribe, loadCloudData,
  createNote, updateNote, deleteNote, togglePinNote,
  createFolder, updateFolder, deleteFolder, toggleFolderExpanded,
  setActiveNote, setSearchQuery, toggleNoteSelection, clearSelection,
  restoreNote, restoreFolder, batchUpdateNoteContents,
  type Note, type Folder,
} from './stateManager';
import { loadNotes, loadFolders, saveNotes, saveFolders } from './storageManager';
import { syncAll, loadFromCloud, mergeData, loadTXNMediaFromCloud, deleteNoteFromCloud, listCloudMedia } from '../txc/txnSync';
import { searchNotes, highlightInEditor } from './searchManager';
import { exportNote, exportMultiple, type ExportFormat } from './exportManager';
import { importFile } from './importManager';
import { saveMedia, loadMediaAsDataUrl, cleanupUnusedMedia } from './mediaStorage';

// ── DOM helpers ───────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let editorEl: HTMLDivElement;
let titleInput: HTMLInputElement;
let fileTree: HTMLElement;
let searchInput: HTMLInputElement;
let searchResultsEl: HTMLElement;
let saveStatusEl: HTMLElement;
let wordCountEl: HTMLElement;
let createdAtEl: HTMLElement;
let updatedAtEl: HTMLElement;
let editorWrapper: HTMLElement;
let emptyState: HTMLElement;
let pinBtn: HTMLButtonElement;
let selectionBar: HTMLElement;
let selectionCount: HTMLElement;

// ── Undo / Redo ───────────────────────────────────────────────────────────────

interface HistoryEntry {
  undo: () => void;
  redo: () => void;
}

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
const MAX_HISTORY = 50;

function recordAction(entry: HistoryEntry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

function performUndo() {
  const entry = undoStack.pop();
  if (!entry) { showNotification('Nichts rückgängig zu machen', 'info'); return; }
  redoStack.push(entry);
  entry.undo();
}

function performRedo() {
  const entry = redoStack.pop();
  if (!entry) { showNotification('Nichts wiederherzustellen', 'info'); return; }
  undoStack.push(entry);
  entry.redo();
}

function deleteNoteWithHistory(noteId: string) {
  const note = getState().notes.find(n => n.id === noteId);
  if (!note) return;
  const backup = { ...note };
  deleteNote(noteId);
  persistAll();
  recordAction({
    undo: () => { restoreNote(backup); persistAll(); showNotification(`„${backup.title}" wiederhergestellt`, 'info'); },
    redo: () => { deleteNote(backup.id); persistAll(); },
  });
}

function deleteSelectedNotesWithHistory() {
  const { selectedNoteIds, notes } = getState();
  const toDelete = notes.filter(n => selectedNoteIds.includes(n.id)).map(n => ({ ...n }));
  if (toDelete.length === 0) return;
  toDelete.forEach(n => deleteNote(n.id));
  clearSelection();
  persistAll();
  recordAction({
    undo: () => { toDelete.forEach(n => restoreNote(n)); persistAll(); showNotification(`${toDelete.length} Notiz${toDelete.length > 1 ? 'en' : ''} wiederhergestellt`, 'info'); },
    redo: () => { toDelete.forEach(n => deleteNote(n.id)); persistAll(); },
  });
  showNotification(`${toDelete.length} Notiz${toDelete.length > 1 ? 'en' : ''} gelöscht – Strg+Z rückgängig`, 'info');
}

function deleteFolderWithHistory(folderId: string) {
  const { folders, notes } = getState();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;
  const folderBackup = { ...folder };
  const affectedNotes = notes.filter(n => n.folderId === folderId).map(n => ({ ...n }));
  deleteFolder(folderId);
  persistAll();
  recordAction({
    undo: () => {
      restoreFolder(folderBackup);
      affectedNotes.forEach(n => restoreNote(n));
      persistAll();
      showNotification(`Ordner „${folderBackup.name}" wiederhergestellt`, 'info');
    },
    redo: () => { deleteFolder(folderBackup.id); persistAll(); },
  });
}

// ── Media helpers ─────────────────────────────────────────────────────────────

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Vor dem Speichern: data URLs → txn-media://ID (auch Migration alter Notizen)
async function prepareContentForSave(html: string): Promise<string> {
  const div = document.createElement('div');
  // Neutralize existing txn-media:// src attrs — Chrome fetches even detached DOM nodes
  div.innerHTML = html.replace(/src="txn-media:\/\/[^"]*"/g, 'src=""');
  // Remove overlay divs and selection markers that must never be persisted
  div.querySelectorAll('.txn-img-resize-overlay').forEach(el => el.remove());
  div.querySelectorAll('[data-txn-selected]').forEach(el => el.removeAttribute('data-txn-selected'));
  for (const el of Array.from(div.querySelectorAll<HTMLElement>('img, video'))) {
    const src = el.getAttribute('src') || '';
    if (!src.startsWith('data:')) continue;
    let id = el.dataset.mediaId;
    if (!id) {
      id = `txn-media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveMedia(id, dataUrlToBlob(src));
      el.dataset.mediaId = id;
    }
    el.setAttribute('src', ''); // keep empty — reconstruct via string to avoid browser fetch
  }
  // Reconstruct txn-media:// src in plain string — never set on DOM element
  return div.innerHTML.replace(
    /<(img|video)(\b[^>]*?)>/g,
    (match, tag, attrs) => {
      const idMatch = attrs.match(/\bdata-media-id="(txn-media-[^"]+)"/);
      if (!idMatch) return match;
      const id = idMatch[1];
      return `<${tag}${attrs.replace(/\bsrc="[^"]*"/, `src="txn-media://${id}"`)}>`;
    }
  );
}

// Beim Laden: txn-media://ID → data URLs im Editor-DOM
async function restoreMediaInEditor(el: HTMLDivElement, noteId: string) {
  // Clean up any persisted overlay artifacts from old saves
  el.querySelectorAll('.txn-img-resize-overlay').forEach(o => o.remove());
  el.querySelectorAll('[data-txn-selected]').forEach(o => o.removeAttribute('data-txn-selected'));
  const items = Array.from(el.querySelectorAll<HTMLElement>('[data-media-id]'));
  // Sofort leeren, damit Browser keine txn-media:// URL zu laden versucht
  items.forEach(item => {
    if ((item.getAttribute('src') || '').startsWith('txn-media://')) {
      item.setAttribute('src', '');
    }
  });
  // Async aus IndexedDB laden
  for (const item of items) {
    if (el.dataset.noteId !== noteId) return;
    const dataUrl = await loadMediaAsDataUrl(item.dataset.mediaId!);
    if (el.dataset.noteId !== noteId) return;
    if (dataUrl) item.setAttribute('src', dataUrl);
  }
}

// Für Export: txn-media://ID → data URLs in HTML-String
async function resolveMediaInHtml(html: string): Promise<string> {
  const div = document.createElement('div');
  div.innerHTML = html;
  for (const el of Array.from(div.querySelectorAll<HTMLElement>('[data-media-id]'))) {
    const src = el.getAttribute('src') || '';
    if (!src.startsWith('txn-media://')) continue;
    const dataUrl = await loadMediaAsDataUrl(el.dataset.mediaId!);
    if (dataUrl) el.setAttribute('src', dataUrl);
  }
  return div.innerHTML;
}

// Beim Start: vorhandene Base64-Bilder aus localStorage → IndexedDB migrieren
// Singleton-Promise: läuft nur einmal, alle Aufrufer warten auf dieselbe Instanz
let _migrationPromise: Promise<void> | null = null;

function ensureMigrated(): Promise<void> {
  if (!_migrationPromise) _migrationPromise = migrateMediaToIndexedDB();
  return _migrationPromise;
}

async function migrateMediaToIndexedDB() {
  const { notes } = getState();
  const updates: Array<{ id: string; content: string }> = [];
  for (const note of notes) {
    if (!note.content.includes('src="data:')) continue;
    const content = await prepareContentForSave(note.content);
    if (content !== note.content) updates.push({ id: note.id, content });
  }
  if (updates.length > 0) {
    batchUpdateNoteContents(updates);
    const { notes: n, folders: f } = getState();
    saveNotes(n);
    saveFolders(f);
  }
}

// Beim Start: nicht mehr referenzierte Medien aus IndexedDB löschen
async function cleanupOrphanedMedia() {
  const { notes } = getState();
  const usedIds = new Set<string>();
  notes.forEach(note => {
    const matches = note.content.match(/data-media-id="([^"]+)"/g) || [];
    matches.forEach(m => usedIds.add(m.replace(/data-media-id="|"/g, '')));
  });
  await cleanupUnusedMedia(usedIds);
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let hoveredNoteId: string | null = null;
let hoveredFolderId: string | null = null;

function scheduleAutoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  if (saveStatusEl) {
    saveStatusEl.textContent = 'Wird gespeichert…';
    saveStatusEl.setAttribute('data-status', 'saving');
  }
  saveTimer = setTimeout(async () => {
    await ensureMigrated();
    const { activeNoteId } = getState();
    if (activeNoteId && editorEl) {
      const content = await prepareContentForSave(editorEl.innerHTML);
      updateNote(activeNoteId, { content });
    }
    persistAll();
    if (saveStatusEl) {
      saveStatusEl.textContent = 'Gespeichert';
      saveStatusEl.setAttribute('data-status', 'saved');
    }
  }, 800);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function persistAll() {
  const { notes, folders } = getState();
  saveNotes(notes);
  saveFolders(folders);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function countWords(html: string): number {
  const div = document.createElement('div');
  div.innerHTML = html.replace(/src="txn-media:\/\/[^"]*"/g, 'src=""');
  const text = div.innerText || div.textContent || '';
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function escHtml(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Notifications ─────────────────────────────────────────────────────────────

function showNotification(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  const container = $('txnNotifications');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `txn-toast txn-toast--${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('txn-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('txn-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Context menus ─────────────────────────────────────────────────────────────

function removeContextMenu() {
  document.querySelector('.txn-context-menu')?.remove();
}

function createMenu(x: number, y: number, items: Array<{ label: string; action: () => void; danger?: boolean }>) {
  removeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'txn-context-menu';
  menu.style.cssText = `left:${x}px;top:${y}px`;

  items.forEach(({ label, action, danger }) => {
    const btn = document.createElement('button');
    btn.className = `txn-context-menu__item${danger ? ' txn-context-menu__item--danger' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => { action(); removeContextMenu(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;

  setTimeout(() => {
    document.addEventListener('click', removeContextMenu, { once: true });
  }, 0);
}

function showNoteContextMenu(e: MouseEvent, noteId: string) {
  e.preventDefault();
  e.stopPropagation();
  const note = getState().notes.find(n => n.id === noteId);
  if (!note) return;
  createMenu(e.clientX, e.clientY, [
    {
      label: note.pinned ? 'Loslösen' : 'Anpinnen',
      action: () => { togglePinNote(noteId); persistAll(); },
    },
    {
      label: 'Umbenennen',
      action: () => {
        const name = prompt('Neuer Name:', note.title);
        if (name?.trim()) { updateNote(noteId, { title: name.trim() }); persistAll(); }
      },
    },
    {
      label: 'Löschen',
      danger: true,
      action: () => {
        if (confirm(`„${note.title}" löschen?`)) { deleteNoteWithHistory(noteId); }
      },
    },
  ]);
}

function showFolderContextMenu(e: MouseEvent, folderId: string) {
  e.preventDefault();
  e.stopPropagation();
  const folder = getState().folders.find(f => f.id === folderId);
  if (!folder) return;
  createMenu(e.clientX, e.clientY, [
    {
      label: 'Umbenennen',
      action: () => {
        const name = prompt('Neuer Name:', folder.name);
        if (name?.trim()) { updateFolder(folderId, { name: name.trim() }); persistAll(); }
      },
    },
    {
      label: 'Löschen',
      danger: true,
      action: () => {
        if (confirm(`Ordner „${folder.name}" löschen?\nNotizen werden ins Stammverzeichnis verschoben.`)) {
          deleteFolderWithHistory(folderId);
        }
      },
    },
  ]);
}

// ── Sidebar render ────────────────────────────────────────────────────────────

function renderSidebar() {
  if (!fileTree) return;
  const { notes, folders, activeNoteId, searchQuery, selectedNoteIds } = getState();

  if (searchQuery.trim()) {
    fileTree.style.display = 'none';
    if (searchResultsEl) {
      searchResultsEl.style.display = 'block';
      renderSearchResults(notes, searchQuery);
    }
    return;
  }

  fileTree.style.display = 'block';
  if (searchResultsEl) searchResultsEl.style.display = 'none';

  const frag = document.createDocumentFragment();

  // Pinned
  const pinned = notes.filter(n => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  if (pinned.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'txn-tree-section';
    sec.innerHTML = '<div class="txn-tree-section-label">Angepinnt</div>';
    pinned.forEach(n => sec.appendChild(buildNoteEl(n, activeNoteId, selectedNoteIds)));
    frag.appendChild(sec);
  }

  // Root folders
  folders
    .filter(f => !f.parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(f => frag.appendChild(buildFolderEl(f, folders, notes, activeNoteId, selectedNoteIds)));

  // Root notes (not pinned, no folder)
  notes
    .filter(n => !n.pinned && !n.folderId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach(n => frag.appendChild(buildNoteEl(n, activeNoteId, selectedNoteIds)));

  fileTree.innerHTML = '';
  fileTree.appendChild(frag);
}

function buildNoteEl(note: Note, activeId: string | null, selected: string[]): HTMLElement {
  const el = document.createElement('div');
  el.className =
    `txn-note-item` +
    (note.id === activeId ? ' txn-note-item--active' : '') +
    (selected.includes(note.id) ? ' txn-note-item--selected' : '');
  el.dataset.noteId = note.id;
  el.setAttribute('role', 'treeitem');
  el.tabIndex = 0;

  const date = new Date(note.updatedAt).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  });

  el.innerHTML = `
    <div class="txn-note-item__icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    </div>
    <div class="txn-note-item__body">
      <span class="txn-note-item__title">${escHtml(note.title)}</span>
      <span class="txn-note-item__date">${date}</span>
    </div>
    ${note.pinned ? `<div class="txn-note-item__pin" aria-label="Angepinnt">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/>
      </svg>
    </div>` : ''}
    <button class="txn-note-item__delete" title="Löschen" aria-label="Notiz löschen">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>
  `;

  el.querySelector<HTMLButtonElement>('.txn-note-item__delete')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    deleteNoteWithHistory(note.id);
    showNotification(`„${note.title}" gelöscht – Strg+Z rückgängig`, 'info');
  });

  el.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      toggleNoteSelection(note.id);
    } else {
      clearSelection();
      setActiveNote(note.id);
      closeSidebarOnMobile();
    }
  });
  el.addEventListener('mouseenter', () => { hoveredNoteId = note.id; });
  el.addEventListener('mouseleave', () => { if (hoveredNoteId === note.id) hoveredNoteId = null; });
  el.addEventListener('contextmenu', (e) => showNoteContextMenu(e as MouseEvent, note.id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveNote(note.id); closeSidebarOnMobile(); }
  });

  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData('text/plain', note.id);
    e.dataTransfer!.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('txn-note-item--dragging'));
  });
  el.addEventListener('dragend', () => el.classList.remove('txn-note-item--dragging'));

  return el;
}

function buildFolderEl(
  folder: Folder, allFolders: Folder[], allNotes: Note[],
  activeId: string | null, selected: string[]
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'txn-folder-wrap';

  const header = document.createElement('div');
  header.className = `txn-folder-header${folder.expanded ? ' txn-folder-header--open' : ''}`;
  header.dataset.folderId = folder.id;
  header.setAttribute('role', 'treeitem');
  header.setAttribute('aria-expanded', String(folder.expanded));
  header.tabIndex = 0;
  header.innerHTML = `
    <svg class="txn-folder-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
    <svg class="txn-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    <span class="txn-folder-name">${escHtml(folder.name)}</span>
    <button class="txn-folder-add" data-folder-id="${folder.id}" title="Notiz in Ordner erstellen" aria-label="Notiz in ${escHtml(folder.name)} erstellen">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <button class="txn-folder-delete" title="Ordner löschen" aria-label="Ordner ${escHtml(folder.name)} löschen">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>
  `;

  header.addEventListener('mouseenter', () => { hoveredFolderId = folder.id; });
  header.addEventListener('mouseleave', () => { if (hoveredFolderId === folder.id) hoveredFolderId = null; });

  header.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.txn-folder-add, .txn-folder-delete')) return;
    toggleFolderExpanded(folder.id);
    persistAll();
  });
  header.addEventListener('contextmenu', (e) => showFolderContextMenu(e as MouseEvent, folder.id));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { toggleFolderExpanded(folder.id); persistAll(); }
  });

  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'move';
    header.classList.add('txn-folder-header--drag-over');
  });
  header.addEventListener('dragleave', (e) => {
    if (!header.contains(e.relatedTarget as Node)) {
      header.classList.remove('txn-folder-header--drag-over');
    }
  });
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    header.classList.remove('txn-folder-header--drag-over');
    const noteId = e.dataTransfer?.getData('text/plain');
    if (!noteId) return;
    if (!folder.expanded) toggleFolderExpanded(folder.id);
    updateNote(noteId, { folderId: folder.id });
    persistAll();
  });
  header.querySelector<HTMLButtonElement>('.txn-folder-add')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const note = createNote(folder.id);
    persistAll();
    setActiveNote(note.id);
    closeSidebarOnMobile();
  });
  header.querySelector<HTMLButtonElement>('.txn-folder-delete')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteFolderWithHistory(folder.id);
    showNotification(`Ordner „${folder.name}" gelöscht – Strg+Z rückgängig`, 'info');
  });

  wrap.appendChild(header);

  if (folder.expanded) {
    const children = document.createElement('div');
    children.className = 'txn-folder-children';
    allFolders
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(f => children.appendChild(buildFolderEl(f, allFolders, allNotes, activeId, selected)));
    allNotes
      .filter(n => n.folderId === folder.id && !n.pinned)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach(n => children.appendChild(buildNoteEl(n, activeId, selected)));
    wrap.appendChild(children);
  }
  return wrap;
}

function renderSearchResults(notes: Note[], query: string) {
  if (!searchResultsEl) return;
  const results = searchNotes(notes, query);

  if (results.length === 0) {
    searchResultsEl.innerHTML = '<div class="txn-search-empty">Keine Treffer</div>';
    return;
  }

  const { activeNoteId } = getState();
  const frag = document.createDocumentFragment();
  results.forEach(r => {
    const item = document.createElement('div');
    item.className = `txn-note-item${activeNoteId === r.noteId ? ' txn-note-item--active' : ''}`;
    item.dataset.noteId = r.noteId;
    item.innerHTML = `
      <div class="txn-note-item__body">
        <span class="txn-note-item__title">${hlQuery(escHtml(r.title), query)}</span>
        <span class="txn-search-snippet">${hlQuery(escHtml(r.snippet), query)}</span>
      </div>
    `;
    item.addEventListener('click', () => { setActiveNote(r.noteId); closeSidebarOnMobile(); });
    frag.appendChild(item);
  });
  searchResultsEl.innerHTML = '';
  searchResultsEl.appendChild(frag);
}

function hlQuery(text: string, query: string): string {
  if (!query.trim()) return text;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark class="txn-highlight">$1</mark>');
}

// ── Editor render ─────────────────────────────────────────────────────────────

function renderEditor() {
  if (!editorWrapper || !emptyState) return;
  const { activeNoteId, notes, searchQuery } = getState();
  const titleRow = document.getElementById('txnTitleRow');

  if (!activeNoteId) {
    emptyState.style.display = 'flex';
    editorWrapper.style.display = 'none';
    titleRow?.classList.add('txn-title-row--no-note');
    return;
  }
  const note = notes.find(n => n.id === activeNoteId);
  if (!note) {
    emptyState.style.display = 'flex';
    editorWrapper.style.display = 'none';
    titleRow?.classList.add('txn-title-row--no-note');
    return;
  }

  emptyState.style.display = 'none';
  editorWrapper.style.display = 'flex';
  titleRow?.classList.remove('txn-title-row--no-note');

  if (titleInput && titleInput.value !== note.title) titleInput.value = note.title;

  // Only replace editor content when switching notes (not on every keystroke)
  if (editorEl && editorEl.dataset.noteId !== note.id) {
    editorEl.innerHTML = (note.content || '<p><br></p>').replace(/src="txn-media:\/\/[^"]*"/g, 'src=""');
    editorEl.dataset.noteId = note.id;
    restoreMediaInEditor(editorEl, note.id);
    if (searchQuery.trim()) highlightInEditor(editorEl, searchQuery);
    // Place cursor at end
    requestAnimationFrame(() => {
      if (document.activeElement !== editorEl) {
        editorEl.focus();
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    });
  }

  if (createdAtEl) createdAtEl.textContent = `Erstellt ${formatDate(note.createdAt)}`;
  if (updatedAtEl) updatedAtEl.textContent = `Bearbeitet ${formatDate(note.updatedAt)}`;
  if (wordCountEl) {
    const wc = countWords(note.content);
    wordCountEl.textContent = `${wc} Wort${wc !== 1 ? 'e' : ''}`;
  }

  if (pinBtn) {
    pinBtn.setAttribute('aria-pressed', String(note.pinned));
    pinBtn.title = note.pinned ? 'Loslösen' : 'Anpinnen';
    pinBtn.querySelector('.txn-pin-icon')?.classList.toggle('txn-pin-icon--active', note.pinned);
  }
}

// ── Selection bar ─────────────────────────────────────────────────────────────

function renderSelectionBar() {
  if (!selectionBar) return;
  const { selectedNoteIds } = getState();
  selectionBar.style.display = selectedNoteIds.length > 0 ? 'flex' : 'none';
  if (selectionCount) selectionCount.textContent = `${selectedNoteIds.length} ausgewählt`;
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────

function closeSidebarOnMobile() {
  if (window.innerWidth >= 768) return;
  $('txnSidebar')?.classList.remove('txn-sidebar--open');
  $('txnSidebarOverlay')?.classList.remove('txn-sidebar-overlay--visible');
  $<HTMLButtonElement>('txnSidebarToggle')?.setAttribute('aria-expanded', 'false');
}

function initMobileSidebar() {
  const toggle = $('txnSidebarToggle');
  const sidebar = $('txnSidebar');
  const overlay = $('txnSidebarOverlay');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('txn-sidebar--open');
    overlay?.classList.toggle('txn-sidebar-overlay--visible', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  overlay?.addEventListener('click', closeSidebarOnMobile);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

let savedRange: Range | null = null;
function saveSel() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreSel() {
  if (!savedRange) return;
  editorEl.focus();
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(savedRange);
}

function applyFontSize(px: number) {
  restoreSel();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  document.execCommand('fontSize', false, '7');
  editorEl.querySelectorAll('font[size="7"]').forEach(el => {
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;
    span.innerHTML = el.innerHTML;
    el.parentNode?.replaceChild(span, el);
  });
}

function updateToolbarState() {
  ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach(cmd => {
    document.querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`)
      ?.classList.toggle('txn-toolbar-btn--active', document.queryCommandState(cmd));
  });
}

function initToolbar() {
  editorEl.addEventListener('blur', saveSel);

  document.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.execCommand(btn.dataset.cmd!, false, btn.dataset.value ?? undefined);
      updateToolbarState();
    });
  });

  const sizeSelect = $<HTMLSelectElement>('txnFontSize');
  sizeSelect?.addEventListener('mousedown', saveSel);
  sizeSelect?.addEventListener('change', () => applyFontSize(parseInt(sizeSelect.value)));

  const textColorInput = $<HTMLInputElement>('txnTextColor');
  $('txnTextColorBtn')?.addEventListener('mousedown', (e) => { e.preventDefault(); saveSel(); textColorInput?.click(); });
  textColorInput?.addEventListener('change', () => {
    restoreSel();
    document.execCommand('foreColor', false, textColorInput.value);
    const dot = $('txnTextColorDot');
    if (dot) dot.setAttribute('fill', textColorInput.value);
  });
  if (textColorInput) {
    const dot = $('txnTextColorDot');
    if (dot) dot.setAttribute('fill', textColorInput.value);
  }

  const hlInput = $<HTMLInputElement>('txnHighlightColor');
  $('txnHighlightColorBtn')?.addEventListener('mousedown', (e) => { e.preventDefault(); saveSel(); hlInput?.click(); });
  hlInput?.addEventListener('change', () => {
    restoreSel();
    document.execCommand('backColor', false, hlInput.value);
    const dot = $('txnHighlightColorDot');
    if (dot) dot.style.backgroundColor = hlInput.value;
  });

  editorEl.addEventListener('keyup', updateToolbarState);
  editorEl.addEventListener('mouseup', updateToolbarState);
}

// ── Title input ───────────────────────────────────────────────────────────────

function initTitleInput() {
  titleInput.addEventListener('input', () => {
    const { activeNoteId } = getState();
    if (!activeNoteId) return;
    updateNote(activeNoteId, { title: titleInput.value });
    scheduleAutoSave();
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    const inEditor = target === editorEl;

    // F2 — focus title
    if (e.key === 'F2' && !inInput && !inEditor) {
      const { activeNoteId } = getState();
      if (!activeNoteId || !titleInput) return;
      e.preventDefault();
      titleInput.focus();
      titleInput.select();
      return;
    }

    // Delete — delete selected media element (image/video overlay active)
    if (e.key === 'Delete' && !inInput) {
      const selectedMedia = editorEl?.querySelector('[data-txn-selected]') as HTMLElement | null;
      if (selectedMedia) {
        e.preventDefault();
        selectedMedia.remove();
        scheduleAutoSave();
        return;
      }
    }

    // Delete — delete focused note or selected notes
    if (e.key === 'Delete' && !inInput && !inEditor) {
      const { selectedNoteIds } = getState();
      if (selectedNoteIds.length > 0) {
        e.preventDefault();
        deleteSelectedNotesWithHistory();
        return;
      }
      // Check if a note item is focused or hovered
      const noteEl = (document.activeElement as HTMLElement)?.closest?.('[data-note-id]') as HTMLElement | null;
      const noteId = noteEl?.dataset?.noteId || hoveredNoteId || undefined;
      if (noteId) {
        e.preventDefault();
        const note = getState().notes.find(n => n.id === noteId);
        if (!note) return;
        deleteNoteWithHistory(noteId);
        showNotification(`„${note.title}" gelöscht – Strg+Z rückgängig`, 'info');
        return;
      }
      // Check if a folder is focused or hovered
      const folderEl = (document.activeElement as HTMLElement)?.closest?.('[data-folder-id]') as HTMLElement | null;
      const folderId = folderEl?.dataset?.folderId || hoveredFolderId || undefined;
      if (folderId) {
        e.preventDefault();
        const folder = getState().folders.find(f => f.id === folderId);
        if (!folder) return;
        deleteFolderWithHistory(folderId);
        showNotification(`Ordner „${folder.name}" gelöscht – Strg+Z rückgängig`, 'info');
      }
      return;
    }

    // Ctrl+Z / Ctrl+Shift+Z — undo / redo (only outside editor)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !inEditor && !inInput) {
      e.preventDefault();
      if (e.shiftKey) {
        performRedo();
      } else {
        performUndo();
      }
    }
  });
}

// ── Editor events ─────────────────────────────────────────────────────────────

function initEditor() {
  editorEl.addEventListener('input', () => {
    const { activeNoteId, searchQuery } = getState();
    if (!activeNoteId) return;
    if (wordCountEl) {
      const wc = countWords(editorEl.innerHTML);
      wordCountEl.textContent = `${wc} Wort${wc !== 1 ? 'e' : ''}`;
    }
    if (searchQuery.trim()) highlightInEditor(editorEl, searchQuery);
    scheduleAutoSave();
  });

  // Ctrl+Click opens links
  editorEl.addEventListener('click', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const a = (e.target as Element).closest('a');
    if (a?.href) {
      e.preventDefault();
      const tmp = document.createElement('a');
      tmp.href = a.href;
      tmp.target = '_blank';
      tmp.rel = 'noopener noreferrer';
      tmp.click();
    }
  });

  // Consistent Enter: insert paragraph
  editorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const node = window.getSelection()?.getRangeAt(0)?.startContainer;
      const inList = (node as Node)?.parentElement?.closest('li, ul, ol');
      if (!inList) { e.preventDefault(); document.execCommand('insertParagraph'); }
    }
  });

  // Paste: strip external cruft
  editorEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain') || '';
    if (html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      div.querySelectorAll('script,style,meta,link').forEach(el => el.remove());
      div.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));
      document.execCommand('insertHTML', false, div.innerHTML);
    } else {
      document.execCommand('insertText', false, text);
    }
  });
}

// ── Media insertion ───────────────────────────────────────────────────────────

function readDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function initMedia() {
  const imgInput = $<HTMLInputElement>('txnImageInput');
  const vidInput = $<HTMLInputElement>('txnVideoInput');

  $('txnInsertImage')?.addEventListener('click', () => { saveSel(); imgInput?.click(); });
  $('txnInsertVideo')?.addEventListener('click', () => { saveSel(); vidInput?.click(); });

  imgInput?.addEventListener('change', async () => {
    for (const file of Array.from(imgInput.files || [])) {
      if (!file.type.startsWith('image/')) continue;
      const id = `txn-media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveMedia(id, file);
      const src = await readDataUrl(file);
      restoreSel();
      editorEl.focus();
      document.execCommand('insertHTML', false,
        `<img src="${src}" data-media-id="${id}" alt="${escHtml(file.name)}" style="max-width:50%;height:auto;display:block;margin:0.5em 0;">`);
    }
    imgInput.value = '';
    scheduleAutoSave();
  });

  vidInput?.addEventListener('change', async () => {
    for (const file of Array.from(vidInput.files || [])) {
      if (!file.type.startsWith('video/')) continue;
      const id = `txn-media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveMedia(id, file);
      const src = await readDataUrl(file);
      restoreSel();
      editorEl.focus();
      document.execCommand('insertHTML', false,
        `<video src="${src}" data-media-id="${id}" controls style="max-width:50%;height:auto;display:block;margin:0.5em 0;"></video>`);
    }
    vidInput.value = '';
    scheduleAutoSave();
  });
}

// ── Media Resize (IMG + VIDEO) ───────────────────────────────────────────────

function initImageResize() {
  let activeMedia: HTMLElement | null = null;
  let overlay: HTMLDivElement | null = null;
  let startX = 0;
  let startWidth = 0;
  let activeHandle = '';
  const txfeBtn = $('txnOpenTXFE');

  function isResizableMedia(el: HTMLElement): boolean {
    return (el.tagName === 'IMG' || el.tagName === 'VIDEO') && editorEl.contains(el);
  }

  function removeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (activeMedia) activeMedia.removeAttribute('data-txn-selected');
    activeMedia = null;
    if (txfeBtn) txfeBtn.style.display = 'none';
  }

  function createOverlay(media: HTMLElement) {
    removeOverlay();
    activeMedia = media;
    media.setAttribute('data-txn-selected', '');

    // Show TXFE button only for images
    if (txfeBtn) txfeBtn.style.display = media.tagName === 'IMG' ? 'inline-flex' : 'none';

    overlay = document.createElement('div');
    overlay.className = 'txn-img-resize-overlay';
    const rect = media.getBoundingClientRect();
    const editorRect = editorEl.getBoundingClientRect();
    overlay.style.top = `${rect.top - editorRect.top + editorEl.scrollTop}px`;
    overlay.style.left = `${rect.left - editorRect.left + editorEl.scrollLeft}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const handles = ['nw', 'ne', 'sw', 'se'];
    for (const pos of handles) {
      const h = document.createElement('div');
      h.className = `txn-img-resize-handle txn-img-resize-handle--${pos}`;
      h.dataset.handle = pos;
      overlay.appendChild(h);
    }

    editorEl.appendChild(overlay);
  }

  function getSelectedImg(): HTMLImageElement | null {
    return activeMedia?.tagName === 'IMG' ? activeMedia as HTMLImageElement : null;
  }

  editorEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (isResizableMedia(target)) {
      e.preventDefault();
      createOverlay(target);
      editorEl.focus();
    } else if (!target.closest('.txn-img-resize-overlay')) {
      removeOverlay();
    }
  });

  editorEl.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('txn-img-resize-handle') || !activeMedia) return;
    e.preventDefault();
    activeHandle = target.dataset.handle || '';
    startX = e.clientX;
    startWidth = activeMedia.getBoundingClientRect().width;

    function onMove(ev: MouseEvent) {
      if (!activeMedia || !overlay) return;
      const isLeft = activeHandle.includes('w');
      const dx = isLeft ? startX - ev.clientX : ev.clientX - startX;
      const newWidth = Math.max(50, startWidth + dx);
      activeMedia.style.maxWidth = `${newWidth}px`;
      activeMedia.style.width = `${newWidth}px`;
      overlay.style.width = `${newWidth}px`;
      const newRect = activeMedia.getBoundingClientRect();
      overlay.style.height = `${newRect.height}px`;
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (activeMedia) {
        createOverlay(activeMedia);
      }
      scheduleAutoSave();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  editorEl.addEventListener('scroll', () => {
    if (activeMedia && overlay) createOverlay(activeMedia);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay) removeOverlay();
  });

  // Expose getter for TXFE integration
  (window as any).__txnGetSelectedImg = getSelectedImg;
}

// ── Export ────────────────────────────────────────────────────────────────────

function initExport() {
  const exportBtn = $('txnExportBtn');
  const menu = $('txnExportMenu');
  const wrap = exportBtn?.closest('.txn-export-wrap') as HTMLElement | null;

  if (wrap && exportBtn && menu) {
    wrap.addEventListener('mouseenter', () => {
      menu.classList.add('txn-export-menu--open');
      exportBtn.setAttribute('aria-expanded', 'true');
    });
    wrap.addEventListener('mouseleave', () => {
      menu.classList.remove('txn-export-menu--open');
      exportBtn.setAttribute('aria-expanded', 'false');
    });
  }

  menu?.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const format = btn.dataset.format as ExportFormat;
      const { activeNoteId, notes, selectedNoteIds } = getState();
      try {
        if (selectedNoteIds.length > 1) {
          const selected = notes.filter(n => selectedNoteIds.includes(n.id));
          const resolved = await Promise.all(selected.map(async n => ({ ...n, content: await resolveMediaInHtml(n.content) })));
          await exportMultiple(resolved as typeof selected, format);
          showNotification(`${selected.length} Notizen exportiert`, 'success');
        } else if (activeNoteId) {
          // Save current editor content before export
          if (editorEl) {
            const content = await prepareContentForSave(editorEl.innerHTML);
            updateNote(activeNoteId, { content });
          }
          persistAll();
          const note = getState().notes.find(n => n.id === activeNoteId);
          if (note) {
            const resolved = { ...note, content: await resolveMediaInHtml(note.content) };
            await exportNote(resolved, format);
            showNotification('Notiz exportiert', 'success');
          }
        }
      } catch (err) {
        console.error('Export error:', err);
        showNotification('Export fehlgeschlagen', 'error');
      }
    });
  });
}

// ── Import ────────────────────────────────────────────────────────────────────

// ── Cloud dropdown ────────────────────────────────────────────────────────────

function initCloudDropdown() {
  const wrap = document.querySelector('.txn-cloud-wrap') as HTMLElement | null;
  const btn = $('txnCloudBtn');
  const menu = $('txnCloudMenu');
  if (!wrap || !btn || !menu) return;

  wrap.addEventListener('mouseenter', () => {
    saveSel(); // capture cursor position before focus leaves editor
    menu.classList.add('txn-cloud-menu--open');
    btn.setAttribute('aria-expanded', 'true');
  });

  wrap.addEventListener('mouseleave', () => {
    menu.classList.remove('txn-cloud-menu--open');
    btn.setAttribute('aria-expanded', 'false');
  });
}

// ── Cloud upload ───────────────────────────────────────────────────────────────

function showCloudOnlyDialog(cloudOnlyNotes: Note[]): Promise<'continue' | 'cancel'> {
  return new Promise((resolve) => {
    const remaining = new Set(cloudOnlyNotes.map(n => n.id));

    const overlay = document.createElement('div');
    overlay.className = 'txn-cloud-dialog-overlay';

    const box = document.createElement('div');
    box.className = 'txn-cloud-dialog';

    const title = document.createElement('h3');
    title.className = 'txn-cloud-dialog__title';
    title.textContent = 'Nur in der Cloud vorhanden';
    box.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'txn-cloud-dialog__desc';
    desc.textContent = 'Diese Notizen existieren nur in der Cloud, aber nicht mehr lokal.';
    box.appendChild(desc);

    const list = document.createElement('div');
    list.className = 'txn-cloud-dialog__list';

    for (const note of cloudOnlyNotes) {
      const item = document.createElement('div');
      item.className = 'txn-cloud-dialog-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'txn-cloud-dialog-item__name';
      nameEl.textContent = note.title || 'Unbenannte Notiz';
      item.appendChild(nameEl);

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'txfe-action-btn txn-cloud-dialog-btn';
      restoreBtn.textContent = 'Wiederherstellen';
      restoreBtn.addEventListener('click', () => {
        restoreNote(note);
        persistAll();
        remaining.delete(note.id);
        item.classList.add('txn-cloud-dialog-item--done');
        restoreBtn.disabled = true;
        restoreBtn.textContent = 'Wiederhergestellt';
      });

      item.appendChild(restoreBtn);
      list.appendChild(item);
    }

    box.appendChild(list);

    const continueBtn = document.createElement('button');
    continueBtn.className = 'txfe-action-btn-primary txn-cloud-dialog__continue';
    continueBtn.textContent = 'Entfernen und weiter';
    continueBtn.addEventListener('click', async () => {
      continueBtn.disabled = true;
      continueBtn.textContent = 'Wird entfernt…';
      await Promise.all([...remaining].map(id => deleteNoteFromCloud(id)));
      overlay.remove();
      resolve('continue');
    });
    box.appendChild(continueBtn);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve('cancel');
      }
    });

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('txn-cloud-dialog-overlay--visible'));
  });
}

function initCloudUpload() {
  $('txnCloudUploadBtn')?.addEventListener('click', async () => {
    const btn = $('txnCloudUploadBtn') as HTMLButtonElement;
    if (!btn) return;
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.textContent = 'Wird hochgeladen…';
    try {
      // Check for cloud-only notes before uploading
      const cloudData = await loadFromCloud();
      if (cloudData) {
        const { notes } = getState();
        const localIds = new Set(notes.map(n => n.id));
        const cloudOnly = cloudData.notes.filter(n => !localIds.has(n.id));
        if (cloudOnly.length > 0) {
          btn.textContent = 'Warte auf Auswahl…';
          const result = await showCloudOnlyDialog(cloudOnly);
          if (result === 'cancel') return;
          btn.textContent = 'Wird hochgeladen…';
        }
      }
      await syncAll();
      showNotification('In TXC hochgeladen', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Hochladen fehlgeschlagen';
      showNotification(msg, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}

// ── Cloud load ─────────────────────────────────────────────────────────────────

function initCloudLoad() {
  $('txnCloudLoadBtn')?.addEventListener('click', async () => {
    const btn = $('txnCloudLoadBtn') as HTMLButtonElement;
    if (!btn) return;
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.textContent = 'Wird geladen…';
    try {
      const cloudData = await loadFromCloud();
      if (!cloudData) {
        showNotification('Nicht eingeloggt oder keine Cloud-Daten', 'info');
        return;
      }
      const { notes, folders } = getState();
      const cloudNoteIds = new Set(cloudData.notes.map(n => n.id));
      const cloudFolderIds = new Set(cloudData.folders.map(f => f.id));
      const merged = {
        notes: [...cloudData.notes, ...notes.filter(n => !cloudNoteIds.has(n.id))],
        folders: [...cloudData.folders, ...folders.filter(f => !cloudFolderIds.has(f.id))],
      };
      // Download media first so it's in IndexedDB before restoreMediaInEditor fires
      await loadTXNMediaFromCloud(merged.notes);
      // Reset editor's note-id so renderEditor re-writes the content
      if (editorEl) editorEl.dataset.noteId = '';
      loadCloudData(merged.notes, merged.folders);
      saveNotes(merged.notes);
      saveFolders(merged.folders);
      showNotification('Von TXC geladen', 'success');
    } catch {
      showNotification('Laden fehlgeschlagen', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}

// ── Cloud media picker ────────────────────────────────────────────────────────

function generateVideoThumbnail(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;

    const cleanup = () => { video.src = ''; };
    const t = setTimeout(() => { cleanup(); resolve(null); }, 10000);

    video.addEventListener('error', () => { clearTimeout(t); cleanup(); resolve(null); }, { once: true });

    video.addEventListener('seeked', () => {
      clearTimeout(t);
      try {
        const w = video.videoWidth || 160;
        const h = video.videoHeight || 90;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')?.drawImage(video, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve(null);
      } finally {
        cleanup();
      }
    }, { once: true });

    video.addEventListener('loadeddata', () => { video.currentTime = 0; }, { once: true });
    video.src = url;
  });
}

function initCloudMediaPicker() {
  $('txnCloudMediaBtn')?.addEventListener('click', async () => {
    // Close dropdown
    $('txnCloudMenu')?.classList.remove('txn-cloud-menu--open');
    $('txnCloudBtn')?.setAttribute('aria-expanded', 'false');

    // Build modal
    const overlay = document.createElement('div');
    overlay.className = 'txn-cloud-media-overlay';

    const box = document.createElement('div');
    box.className = 'txn-cloud-media-box';

    const hdr = document.createElement('div');
    hdr.className = 'txn-cloud-media-header';

    const titleEl = document.createElement('h3');
    titleEl.className = 'txn-cloud-media-title';
    titleEl.textContent = 'Cloud-Medien einfügen';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'txn-cloud-media-close';
    closeBtn.setAttribute('aria-label', 'Schließen');
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    hdr.appendChild(titleEl);
    hdr.appendChild(closeBtn);
    box.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'txn-cloud-media-body';
    body.innerHTML = '<p class="txn-cloud-media-status">Wird geladen…</p>';
    box.appendChild(body);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('txn-cloud-media-overlay--visible'));

    const close = () => {
      overlay.classList.remove('txn-cloud-media-overlay--visible');
      setTimeout(() => overlay.remove(), 200);
    };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Insert handler
    const insertMedia = async (signedUrl: string, mimeType: string, name: string, existingId?: string) => {
      close();
      const isImg = mimeType.startsWith('image/');
      const isVid = mimeType.startsWith('video/');
      if (!isImg && !isVid) return;

      let src: string | null = null;
      let id: string;

      if (existingId) {
        const cached = await loadMediaAsDataUrl(existingId);
        if (cached) {
          src = cached;
          id = existingId;
        } else {
          const resp = await fetch(signedUrl);
          const blob = await resp.blob();
          await saveMedia(existingId, blob);
          src = await loadMediaAsDataUrl(existingId);
          id = existingId;
        }
      } else {
        const resp = await fetch(signedUrl);
        const blob = await resp.blob();
        id = `txn-media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await saveMedia(id, blob);
        src = await loadMediaAsDataUrl(id);
      }

      if (!src) return;
      restoreSel();
      editorEl.focus();
      if (isImg) {
        document.execCommand('insertHTML', false,
          `<img src="${src}" data-media-id="${id}" alt="${escHtml(name)}" style="max-width:50%;height:auto;display:block;margin:0.5em 0;">`);
      } else {
        document.execCommand('insertHTML', false,
          `<video src="${src}" data-media-id="${id}" controls style="max-width:50%;height:auto;display:block;margin:0.5em 0;"></video>`);
      }
      scheduleAutoSave();
    };

    // Fetch cloud media
    const data = await listCloudMedia();
    body.innerHTML = '';

    if (!data || (data.txfeImages.length === 0 && data.txnMedia.length === 0)) {
      body.innerHTML = '<p class="txn-cloud-media-status">Keine Cloud-Medien gefunden. Lade zuerst Bilder oder Videos hoch.</p>';
      return;
    }

    const renderSection = (label: string, items: Array<{ id?: string; name: string; signedUrl: string; mimeType: string }>) => {
      if (items.length === 0) return;

      const section = document.createElement('div');
      section.className = 'txn-cloud-media-section';

      const h = document.createElement('p');
      h.className = 'txn-cloud-media-section-title';
      h.textContent = label;
      section.appendChild(h);

      const grid = document.createElement('div');
      grid.className = 'txn-cloud-media-grid';

      for (const item of items) {
        const thumb = document.createElement('button');
        thumb.className = 'txn-cloud-media-thumb';
        thumb.setAttribute('title', item.name);
        thumb.setAttribute('aria-label', item.name);

        if (item.mimeType.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = item.signedUrl;
          img.alt = item.name;
          thumb.appendChild(img);
        } else {
          // Show icon placeholder, replace with real thumbnail once loaded
          thumb.classList.add('txn-cloud-media-thumb--video');
          thumb.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
          generateVideoThumbnail(item.signedUrl).then(thumbnail => {
            if (!thumbnail) return;
            thumb.classList.remove('txn-cloud-media-thumb--video');
            thumb.innerHTML = '';
            const img = document.createElement('img');
            img.src = thumbnail;
            img.alt = item.name;
            thumb.appendChild(img);
          });
        }

        thumb.addEventListener('click', () => {
          insertMedia(item.signedUrl, item.mimeType, item.name, item.id);
        });
        grid.appendChild(thumb);
      }

      section.appendChild(grid);
      body.appendChild(section);
    };

    renderSection('TXFE Bilder', data.txfeImages.map(i => ({
      name: i.name,
      signedUrl: i.signedUrl,
      mimeType: i.mimeType,
    })));

    renderSection('TXN Medien', data.txnMedia.map(i => ({
      id: i.id,
      name: i.id,
      signedUrl: i.signedUrl,
      mimeType: i.mimeType,
    })));
  });
}

function initImport() {
  const importInput = $<HTMLInputElement>('txnImportInput');
  $('txnImportBtn')?.addEventListener('click', () => importInput?.click());

  importInput?.addEventListener('change', async () => {
    const files = Array.from(importInput.files || []);
    let imported = 0;

    // Sicherstellen, dass Migration abgeschlossen ist bevor gespeichert wird
    await ensureMigrated();

    for (const file of files) {
      const result = await importFile(file);
      if (result) {
        const content = await prepareContentForSave(result.content);
        const note = createNote(null);
        if (editorEl) editorEl.dataset.noteId = '';
        updateNote(note.id, { title: result.title, content });
        persistAll();
        imported++;
      }
    }

    importInput.value = '';
    if (imported > 0) {
      showNotification(`${imported} Notiz${imported > 1 ? 'en' : ''} importiert`, 'success');
    } else {
      showNotification('Keine kompatiblen Dateien gefunden', 'error');
    }
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

function initSearch() {
  searchInput = $<HTMLInputElement>('txnSearch');
  searchResultsEl = $('txnSearchResults');

  searchInput?.addEventListener('input', () => setSearchQuery(searchInput.value));
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; setSearchQuery(''); }
  });
}

// ── Sidebar buttons ───────────────────────────────────────────────────────────

function initSidebarButtons() {
  $('txnNewNote')?.addEventListener('click', () => {
    const note = createNote(null);
    persistAll();
    closeSidebarOnMobile();
  });

  $('txnNewFolder')?.addEventListener('click', () => {
    const name = prompt('Ordnername:');
    if (name?.trim()) { createFolder(name.trim()); persistAll(); }
  });

  pinBtn = $<HTMLButtonElement>('txnPinBtn');
  pinBtn?.addEventListener('click', () => {
    const { activeNoteId } = getState();
    if (activeNoteId) { togglePinNote(activeNoteId); persistAll(); }
  });

  $('txnNewNoteEmpty')?.addEventListener('click', () => {
    createNote(null);
    persistAll();
  });
}

// ── Selection bar ─────────────────────────────────────────────────────────────

function initSelectionBar() {
  selectionBar = $('txnSelectionBar');
  selectionCount = $('txnSelectionCount');

  $('txnSelectionClear')?.addEventListener('click', clearSelection);

  selectionBar?.querySelectorAll<HTMLButtonElement>('[data-export-format]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const format = btn.dataset.exportFormat as ExportFormat;
      const { selectedNoteIds, notes } = getState();
      try {
        const selected = notes.filter(n => selectedNoteIds.includes(n.id));
        const resolved = await Promise.all(selected.map(async n => ({ ...n, content: await resolveMediaInHtml(n.content) })));
        await exportMultiple(resolved as typeof selected, format);
        showNotification(`${selectedNoteIds.length} Notizen exportiert`, 'success');
        clearSelection();
      } catch { showNotification('Export fehlgeschlagen', 'error'); }
    });
  });
}

// ── TXFE button ───────────────────────────────────────────────────────────────

function initTXFE() {
  $('txnOpenTXFE')?.addEventListener('click', () => {
    const getImg = (window as any).__txnGetSelectedImg;
    const img = getImg?.() as HTMLImageElement | null;
    if (!img?.src) return;
    const dataUrl = img.src;
    const win = window.open('/app/txfe', '_blank');
    if (!win) return;
    // Send image via postMessage once TXFE is ready
    const onMessage = (e: MessageEvent) => {
      if (e.source === win && e.data === 'txfe-ready') {
        window.removeEventListener('message', onMessage);
        win.postMessage({ type: 'txn-image', dataUrl }, '*');
      }
    };
    window.addEventListener('message', onMessage);
  });
}

// ── Root drop zone ────────────────────────────────────────────────────────────

function initRootDrop() {
  fileTree.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    fileTree.classList.add('txn-file-tree--drag-over');
  });
  fileTree.addEventListener('dragleave', (e) => {
    if (!fileTree.contains(e.relatedTarget as Node)) {
      fileTree.classList.remove('txn-file-tree--drag-over');
    }
  });
  fileTree.addEventListener('drop', (e) => {
    fileTree.classList.remove('txn-file-tree--drag-over');
    e.preventDefault();
    const noteId = e.dataTransfer?.getData('text/plain');
    if (!noteId) return;
    updateNote(noteId, { folderId: null });
    persistAll();
  });
}

// ── State change handler ──────────────────────────────────────────────────────

function onStateChange() {
  renderSidebar();
  renderEditor();
  renderSelectionBar();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTXN() {
  // Load persisted data into state
  initState({ notes: loadNotes(), folders: loadFolders() });

  // Async cloud sync: load from cloud and merge with local data
  loadFromCloud().then(async cloudData => {
    if (!cloudData) return;
    const local = { notes: getState().notes, folders: getState().folders };
    const merged = mergeData(local, cloudData);
    loadCloudData(merged.notes, merged.folders);
    saveNotes(merged.notes);
    saveFolders(merged.folders);
    await loadTXNMediaFromCloud(merged.notes);
    if (editorEl) editorEl.dataset.noteId = '';
    onStateChange();
  }).catch(() => {});

  // Get DOM refs
  editorEl = $<HTMLDivElement>('txnContent');
  titleInput = $<HTMLInputElement>('txnNoteTitle');
  fileTree = $('txnFileTree');
  editorWrapper = $('txnEditorWrapper');
  emptyState = $('txnEmptyState');
  saveStatusEl = $('txnSaveStatus');
  wordCountEl = $('txnWordCount');
  createdAtEl = $('txnCreatedAt');
  updatedAtEl = $('txnUpdatedAt');

  // Subscribe to state
  subscribe(onStateChange);

  // Storage quota error
  window.addEventListener('txn:storage-error', () => {
    showNotification('Speicher voll – Notiz nicht gespeichert! Alte Notizen löschen oder Bilder verkleinern.', 'error');
  });

  // Init all subsystems
  initMobileSidebar();
  initToolbar();
  initTitleInput();
  initEditor();
  initMedia();
  initImageResize();
  initExport();
  initImport();
  initCloudDropdown();
  initCloudUpload();
  initCloudLoad();
  initCloudMediaPicker();
  initSearch();
  initSidebarButtons();
  initSelectionBar();
  initTXFE();
  initKeyboardShortcuts();
  initRootDrop();

  // Initial render
  onStateChange();

  // Migration starten (Singleton-Promise), danach Cleanup
  ensureMigrated().then(() => cleanupOrphanedMedia());

  // Auto-open most recent note if none selected
  const { notes, activeNoteId } = getState();
  if (!activeNoteId && notes.length > 0) {
    setActiveNote([...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  }
}
