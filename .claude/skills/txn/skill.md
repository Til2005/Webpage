---
name: txn
description: TXN Notes App Dokumentation. Verwenden bei Arbeiten an der Notizen-App unter /app/txn.
---

# TXN (Notes App)
WYSIWYG-Notizen-App unter `/app/txn` — localStorage + IndexedDB, Vault-Struktur, Rich Text, Export/Import.

---

## Datei-Struktur

```
src/
├── pages/app/txn.astro                  — Page (AppLayout + mobile Toggle)
├── components/TXN/
│   ├── TXN.astro                        — Wrapper, lädt initTXN()
│   ├── TXNSidebar.astro                 — Sidebar HTML (Ordnerbaum, Suche, Auswahl-Bar)
│   └── TXNEditor.astro                  — Editor HTML (Toolbar, contenteditable, Status-Bar)
└── scripts/txn/
    ├── main.ts                          — Initialisierung + alle Event-Handler
    ├── stateManager.ts                  — State CRUD + subscribe/notify
    ├── storageManager.ts                — localStorage lesen/schreiben (Notes + Folders)
    ├── mediaStorage.ts                  — IndexedDB für Bilder/Videos
    ├── searchManager.ts                 — Volltextsuche + Highlight
    ├── exportManager.ts                 — PDF/MD/TXT/DOCX + ZIP Multi-Export
    └── importManager.ts                 — TXT/MD/DOCX Import
```

**npm-Abhängigkeiten:** `jszip` · `jspdf` · `html2canvas`

---

## Datenmodell

```typescript
interface Note {
  id: string;          // `${Date.now()}-${random}`
  title: string;
  content: string;     // HTML (innerHTML des contenteditable)
                       // Medien als txn-media://ID referenziert (nicht als base64)
  folderId: string | null;
  createdAt: number;   // timestamp ms
  updatedAt: number;   // timestamp ms
  pinned: boolean;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  expanded: boolean;
}

interface TXNState {
  folders: Folder[];
  notes: Note[];
  activeNoteId: string | null;
  searchQuery: string;
  selectedNoteIds: string[];  // für Multi-Export per Ctrl+Click
}
```

**localStorage Keys:** `txn_notes` · `txn_folders`
**IndexedDB:** DB `txn_db`, Store `media` — Blobs mit Key `txn-media-${timestamp}-${random}`

---

## State-Management (`stateManager.ts`)

```typescript
// Schreiben
createNote(folderId?)   → Note   // setzt activeNoteId automatisch
updateNote(id, partial)          // setzt updatedAt = Date.now()
deleteNote(id)
togglePinNote(id)
createFolder(name, parentId?)  → Folder
updateFolder(id, partial)
deleteFolder(id)               // verschiebt Notizen → root
toggleFolderExpanded(id)
setActiveNote(id | null)
setSearchQuery(query)
toggleNoteSelection(id)        // Ctrl+Click Multi-Select
clearSelection()
restoreNote(note)              // stellt gelöschte Note wieder her (für Undo)
restoreFolder(folder)          // stellt gelöschten Ordner wieder her (für Undo)
batchUpdateNoteContents(updates: Array<{id, content}>)  // Batch ohne updatedAt-Änderung

// Lesen
getState()         → Readonly<TXNState>

// Init (nur beim Start, ruft kein notify() auf)
initState(partial) → void

// Reaktiv
subscribe(callback) → unsubscribe-Funktion
```

**Wichtig:** `updateNote` / `createNote` etc. rufen `notify()` auf → `onStateChange()` wird getriggert → `renderSidebar()` + `renderEditor()` + `renderSelectionBar()`.

---

## Medien-Speicherung (`mediaStorage.ts`)

Bilder und Videos werden als Blobs in IndexedDB gespeichert. Im Note-Content steht nur eine ID-Referenz.

```typescript
// API
saveMedia(id: string, blob: Blob): Promise<void>
loadMediaAsDataUrl(id: string): Promise<string | null>   // gibt base64 data URL zurück
cleanupUnusedMedia(usedIds: Set<string>): Promise<void>  // löscht verwaiste Einträge
```

**Content-Format im Speicher:**
```html
<!-- Im localStorage (gespeichert): -->
<img src="txn-media://txn-media-1234567890-abc" data-media-id="txn-media-1234567890-abc" ...>

<!-- Im Editor-DOM (live): -->
<img src="data:image/png;base64,..." data-media-id="txn-media-1234567890-abc" ...>
```

**Medien-Hilfsfunktionen in `main.ts`:**
```typescript
prepareContentForSave(html)   // data: URLs → txn-media://ID (async, migriert auch alte Notizen)
restoreMediaInEditor(el, noteId) // txn-media://ID → data URLs im DOM (async, abortable)
resolveMediaInHtml(html)      // txn-media://ID → data URLs für Export (async)
dataUrlToBlob(dataUrl)        // Hilfsfunktion für Migration
```

**Migration beim Start:**
```typescript
// Singleton-Promise — läuft nur einmal, alle Aufrufer warten auf dieselbe Instanz
ensureMigrated(): Promise<void>
migrateMediaToIndexedDB()     // scannt alle Notizen, migriert base64 → IndexedDB
```
`ensureMigrated()` wird in `scheduleAutoSave` und `initImport` vor `persistAll()` awaited.

---

## Undo / Redo

App-Level-Undo für strukturelle Aktionen (Löschen). Text-Undo im Editor bleibt Browser-nativ.

```typescript
// Stack (max. 50 Einträge)
undoStack: HistoryEntry[]
redoStack: HistoryEntry[]

interface HistoryEntry { undo: () => void; redo: () => void; }

recordAction(entry)   // fügt zu undoStack hinzu, leert redoStack
performUndo()         // pop undoStack → push redoStack → entry.undo()
performRedo()         // pop redoStack → push undoStack → entry.redo()

// Wrapper (nutzen History + persistAll intern):
deleteNoteWithHistory(noteId)          // löscht + pushes undo-Entry
deleteSelectedNotesWithHistory()       // löscht alle selectedNoteIds + Batch-Undo
deleteFolderWithHistory(folderId)      // löscht Ordner + rettet betroffene Notizen für Undo
```

**Wo verwendet:**
- Context-Menu „Löschen" → `deleteNoteWithHistory` / `deleteFolderWithHistory`
- Entf-Taste → `deleteNoteWithHistory` / `deleteSelectedNotesWithHistory`
- Ctrl+Z / Ctrl+Shift+Z → `performUndo` / `performRedo` (nur außerhalb des Editors)

---

## Keyboard Shortcuts

```
F2              — Notiz-Titel fokussieren + selektieren
Entf            — Fokussierte Notiz löschen (ohne Confirm), Toast "Strg+Z rückgängig"
                  Wenn selectedNoteIds > 0: alle ausgewählten löschen
Strg+Z          — App-Undo (außerhalb Editor) / Text-Undo (im Editor, Browser-nativ)
Strg+Shift+Z    — App-Redo (außerhalb Editor)
```

**Bedingungen:** Delete/Undo/Redo greifen nicht wenn `target === editorEl` oder `INPUT/TEXTAREA/SELECT`.

---

## DOM-Element-IDs

### Sidebar
| ID | Element | Funktion |
|----|---------|---------|
| `txnSidebar` | `<aside>` | Sidebar-Container (mobile: fixed drawer) |
| `txnSidebarToggle` | `<button>` | Mobile Hamburger (im Header via slot) |
| `txnSidebarOverlay` | `<div>` | Mobile Backdrop |
| `txnFileTree` | `<div>` | Dateibaum (wird via JS gebaut) |
| `txnSearchResults` | `<div>` | Suchergebnisse (toggle mit txnFileTree) |
| `txnSearch` | `<input search>` | Suche (live, `setSearchQuery`) |
| `txnNewNote` | `<button>` | Neue Notiz (root) |
| `txnNewFolder` | `<button>` | Neuer Ordner (prompt) |
| `txnSelectionBar` | `<div>` | Auswahl-Bar (zeigt bei selectedNoteIds.length > 0) |
| `txnSelectionCount` | `<span>` | "X ausgewählt" Text |
| `txnSelectionClear` | `<button>` | clearSelection() |

### Editor
| ID | Element | Funktion |
|----|---------|---------|
| `txnEditorWrapper` | `<div>` | Gesamt-Editor (flex column, display:none wenn keine Note) |
| `txnEmptyState` | `<div>` | Leer-Zustand (display:flex wenn keine Note aktiv) |
| `txnNewNoteEmpty` | `<button>` | Neue Notiz aus Leer-Zustand |
| `txnNoteTitle` | `<input>` | Notiz-Titel (live → updateNote title) |
| `txnContent` | `<div contenteditable>` | Editor-Inhalt (innerHTML = note.content) |
| `txnPinBtn` | `<button>` | Anpinnen, aria-pressed="true/false" |
| `txnExportBtn` | `<button>` | Export-Dropdown-Toggle |
| `txnExportMenu` | `<div>` | Export-Dropdown (Klasse: txn-export-menu--open) |
| `txnImportBtn` | `<button>` | Öffnet txnImportInput |

### Toolbar
| ID | Funktion |
|----|---------|
| `txnFontSize` | `<select>` (11–48px), mousedown → saveSel(), change → applyFontSize(px) |
| `txnTextColorBtn` | Klick → saveSel() + textColorInput.click() |
| `txnTextColor` | `<input type=color>` (sr-only), change → execCommand('foreColor') |
| `txnTextColorDot` | `<span>` — Farbvorschau-Punkt |
| `txnHighlightColorBtn` | Klick → saveSel() + highlightInput.click() |
| `txnHighlightColor` | `<input type=color>` (sr-only), change → execCommand('backColor') |
| `txnHighlightColorDot` | `<span>` — Farbvorschau-Punkt |
| `txnInsertImage` | Klick → saveSel() + txnImageInput.click() |
| `txnInsertVideo` | Klick → saveSel() + txnVideoInput.click() |
| `txnOpenTXFE` | Klick → window.open('/app/txfe', '_blank') |

### Datei-Inputs (sr-only, aria-hidden)
| ID | Accept |
|----|--------|
| `txnImageInput` | `.png,.jpg,.jpeg,.webp,.gif,.svg` |
| `txnVideoInput` | `.mp4,.mov,.mkv,.webm` |
| `txnImportInput` | `.txt,.md,.markdown,.docx,.doc` |

### Status-Bar
| ID | Inhalt |
|----|--------|
| `txnCreatedAt` | "Erstellt DD.MM.YY, HH:MM" |
| `txnUpdatedAt` | "Bearbeitet DD.MM.YY, HH:MM" |
| `txnWordCount` | "X Wort(e)" |
| `txnSaveStatus` | "" / "Wird gespeichert…" / "Gespeichert", data-status="saving|saved" |

### Sonstiges
| ID | Funktion |
|----|---------|
| `txnNotifications` | Toast-Container (fixed bottom-right, z-index 200) |

---

## Toolbar — Kommandos

Alle `[data-cmd]` Buttons verwenden `mousedown` + `e.preventDefault()` (Fokus bleibt im Editor):

| data-cmd | data-value | Funktion |
|---------|-----------|---------|
| `bold` | — | execCommand('bold') |
| `italic` | — | execCommand('italic') |
| `underline` | — | execCommand('underline') |
| `strikeThrough` | — | execCommand('strikeThrough') |
| `formatBlock` | `h1`–`h3`, `p` | execCommand('formatBlock', false, value) |
| `insertUnorderedList` | — | execCommand('insertUnorderedList') |
| `insertOrderedList` | — | execCommand('insertOrderedList') |

**Aktiv-Zustand:** `.txn-toolbar-btn--active` wird bei `queryCommandState(cmd) === true` gesetzt.

**Selektion speichern/wiederherstellen:**
```typescript
let savedRange: Range | null = null;
saveSel()    // speichert getRangeAt(0).cloneRange() in savedRange
restoreSel() // stellt savedRange wieder her
```
Wird bei Farbpicker-Buttons und Font-Size-Select verwendet (diese stehlen den Fokus).

**Font-Size-Hack** (execCommand kennt keine px-Werte):
```typescript
document.execCommand('fontSize', false, '7'); // erzeugt <font size="7">
editorEl.querySelectorAll('font[size="7"]').forEach(el => {
  const span = document.createElement('span');
  span.style.fontSize = `${px}px`;
  span.innerHTML = el.innerHTML;
  el.parentNode?.replaceChild(span, el);
});
```

---

## Auto-Save

```typescript
// Debounced 800ms nach letzter Eingabe im Editor oder Titel
scheduleAutoSave()
  → clearTimeout(saveTimer)
  → saveStatusEl: "Wird gespeichert…"
  → setTimeout(800ms, async):
      await ensureMigrated()               // sicherstellen dass Migration abgeschlossen
      content = await prepareContentForSave(editorEl.innerHTML)  // data URLs → IDs
      updateNote(activeNoteId, { content })
      persistAll()
      saveStatusEl: "Gespeichert"
```

**Wichtig:** `updateNote` ruft `notify()` auf, aber `renderEditor` erkennt `editorEl.dataset.noteId === note.id` und ersetzt den Inhalt NICHT (kein Cursor-Reset).

---

## Editor-Render-Logik

```typescript
// renderEditor() — wird bei jedem onStateChange() aufgerufen
if (editorEl.dataset.noteId !== note.id) {
  // Note gewechselt → Inhalt neu setzen
  editorEl.innerHTML = note.content || '<p><br></p>';
  editorEl.dataset.noteId = note.id;
  restoreMediaInEditor(editorEl, note.id); // async: txn-media://ID → data URLs
  // Cursor ans Ende, Suche-Highlight anwenden
} else {
  // Gleiche Note → NUR Metadaten aktualisieren (Title, Dates, WordCount, PinBtn)
  // Inhalt NICHT anfassen → kein Cursor-Sprung
}
```

`restoreMediaInEditor` setzt zunächst synchron `src=""` auf alle `txn-media://`-Elemente (verhindert Browser-Fehler), dann async die echten data URLs.

---

## Suche

```typescript
// searchManager.ts
searchNotes(notes, query)  → SearchResult[]  // sortiert nach matchCount
highlightInEditor(editorEl, query)            // wickelt Treffer in <mark class="txn-highlight">

// Ablauf:
setSearchQuery(query)           // setzt state.searchQuery + notify()
→ renderSidebar()               // zeigt txnSearchResults, versteckt txnFileTree
→ renderEditor() (Highlight)    // wenn Editor offen: highlightInEditor()
```

Suche-Reset: ESC-Taste in `txnSearch` → `setSearchQuery('')`

---

## Export (`exportManager.ts`)

| Format | Methode | Abhängigkeit |
|--------|---------|-------------|
| PDF | jsPDF + html2canvas → direkter Download | jspdf, html2canvas |
| Markdown | HTML-Rekursion → MD-String | — |
| Plain Text | `div.innerText` | — |
| DOCX | OOXML XML + JSZip | jszip |
| ZIP (Multi) | Mehrere Dateien → JSZip | jszip |

**PDF:** Rendert Note in einem versteckten `<div>` (794px breit), html2canvas → Canvas → jsPDF → `.pdf`-Download. Kein Druckdialog.

**Vor jedem Export:** `resolveMediaInHtml(note.content)` — ersetzt `txn-media://ID` durch echte data URLs, damit Bilder im Export enthalten sind.

**DOCX-Struktur** (via JSZip):
```
[Content_Types].xml
_rels/.rels
word/_rels/document.xml.rels
word/document.xml    ← Hauptinhalt als WordprocessingML
word/styles.xml      ← Normal, Heading1–3, Quote
word/numbering.xml   ← Bullet (numId=1) + Ordered (numId=2)
```

**Multi-Export:** `exportMultiple(notes, format)` → einzeln wenn 1 Note, sonst ZIP.

**API:**
```typescript
exportNote(note, 'pdf' | 'md' | 'txt' | 'docx')   // async
exportMultiple(notes[], format)                      // async
```

---

## Import (`importManager.ts`)

| Format | Parser |
|--------|--------|
| `.txt` | Zeilen → `<p>` / `<p><br></p>` |
| `.md` / `.markdown` | Regex-basierter MD→HTML Konverter (H1–H6, Bold, Italic, Links, Lists, etc.) |
| `.docx` / `.doc` | JSZip → `word/document.xml` → DOMParser → WordprocessingML XML → HTML |

**Rückgabe:** `ImportedNote = { title, content }` (kein id/folderId/dates — wird in `main.ts` per `createNote()` + `updateNote()` hinzugefügt)

**Import-Flow in `main.ts`:**
```typescript
await ensureMigrated();              // Warten bis Migration fertig (Quota-Schutz)
const result = await importFile(file);
const note = createNote(null);
if (editorEl) editorEl.dataset.noteId = '';
updateNote(note.id, { title, content });
persistAll();
```

---

## CSS-Klassen (wichtigste)

### Layout
| Klasse | Beschreibung |
|--------|-------------|
| `.txn-app` | Flex-Container, `height: calc(100vh - var(--header-height))` |
| `.txn-sidebar` | 280px, border-right; mobile: fixed drawer mit `translateX(-100%)` |
| `.txn-sidebar--open` | Mobile: `translateX(0)` |
| `.txn-sidebar-overlay--visible` | Mobile: Backdrop sichtbar |
| `.txn-editor-area` | flex: 1, overflow: hidden |
| `.txn-editor-wrapper` | flex: 1, flex-col, display:none → display:flex |
| `.txn-content` | flex: 1, overflow-y: auto, padding: 1.5rem 2.5rem |

### Interaktiv
| Klasse | Beschreibung |
|--------|-------------|
| `.txn-note-item--active` | Aktive Note (linke Border 2px) |
| `.txn-note-item--selected` | Ctrl+Click ausgewählt |
| `.txn-folder-header--open` | Ordner geöffnet (Chevron rotiert 90°) |
| `.txn-toolbar-btn--active` | Format-Zustand aktiv (z.B. Bold) |
| `.txn-export-menu--open` | Export-Dropdown sichtbar |
| `.txn-pin-icon--active` | Stern gefüllt (fill + stroke) |
| `.txn-highlight` | Suchmarkierung: `<mark class="txn-highlight">` (gelb, dunkel-transparent) |

### Toast-System
```typescript
// Aufruf:
showNotification('Text', 'success' | 'error' | 'info')

// Klassen:
.txn-toast               // Base, opacity:0 → 1 (CSS transition)
.txn-toast--visible      // sichtbar
.txn-toast--error        // rote Variante
.txn-toast--success      // fg/bg Variante (Standard)
```

---

## Context-Menu

Rechtsklick auf Notiz oder Ordner → `.txn-context-menu` (fixed, `animation: txn-menu-in`):

**Notiz-Menü:** Anpinnen/Loslösen · Umbenennen (`prompt`) · Löschen (`confirm` → `deleteNoteWithHistory`)
**Ordner-Menü:** Umbenennen · Löschen (`confirm` → `deleteFolderWithHistory`)

Schließt bei nächstem `document.click()` (einmaliger Event-Listener).

---

## Mobile-Sidebar

```typescript
// Toggle: #txnSidebarToggle (im Header-Slot, class="md:hidden")
sidebar.classList.toggle('txn-sidebar--open')
overlay.classList.toggle('txn-sidebar-overlay--visible')
toggle.setAttribute('aria-expanded', String(open))

// Automatisch schließen nach Note-Auswahl:
closeSidebarOnMobile()  // nur wenn window.innerWidth < 768
```

---

## Notizen-Reihenfolge im Dateibaum

1. **Angepinnt** (pinned === true) → Section "Angepinnt", nach `updatedAt` DESC
2. **Root-Ordner** (parentId === null) → alphabetisch
3. **Root-Notizen** (folderId === null, pinned === false) → nach `updatedAt` DESC

Innerhalb eines Ordners: Sub-Ordner alphabetisch → Notizen nach `updatedAt` DESC.

---

## Wichtige Patterns

**Medien nie als base64 in localStorage speichern** — immer über `prepareContentForSave` gehen, das data URLs in IndexedDB-IDs umwandelt.

**`ensureMigrated()` vor `persistAll()`** — in allen async Speicherpfaden (scheduleAutoSave, initImport) aufrufen, damit alte base64-Notizen zuerst migriert werden.

**Note-Inhalt niemals direkt lesen** — immer aus `editorEl.innerHTML` bei Speicherung, nicht aus `note.content` während der Bearbeitung (könnte veraltet sein).

**Kein Build nach Änderungen** — Dev-Server läuft separat, visuelles Feedback vom User.

**persistAll()** immer nach State-Mutationen aufrufen, die dauerhaft sein sollen:
```typescript
function persistAll() {
  const { notes, folders } = getState();
  saveNotes(notes);   // dispatcht 'txn:storage-error' CustomEvent bei QuotaExceededError
  saveFolders(folders);
}
```

**Storage-Fehler** werden als `txn:storage-error` CustomEvent dispatcht → `showNotification('Speicher voll…', 'error')`.
