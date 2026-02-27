---
name: txc
description: TXC Cloud Dokumentation. Verwenden bei Arbeiten an der Cloud-Integration unter /app/txc.
---

# TXC (Cloud-Integration)
Supabase-basierte Cloud-Sync unter `/app/txc` — Google OAuth, manueller TXN-Sync, TXN-Mediensync, TXFE-Bildspeicher. **Speicherlimit: 50 MB pro User.**

---

## Datei-Struktur

```
src/
├── pages/app/txc.astro              — Dashboard-Seite (Login + Speicheranzeige + Inhalts-Modal)
├── pages/app/txfe.astro             — Enthält "In Cloud"-Button im Header
├── lib/
│   └── supabase.ts                  — Supabase-Client (Singleton)
└── scripts/txc/
    ├── authManager.ts               — Google Sign-In / Sign-Out / getUser
    └── txnSync.ts                   — TXN-Sync, Mediensync, TXFE-Upload, Merge-Logik, Usage
```

**npm-Abhängigkeit:** `@supabase/supabase-js`

---

## Supabase-Projekt

- **URL:** `https://rvapnpbthkonispwzvpw.supabase.co`
- **Anon Key:** In `src/lib/supabase.ts` (öffentlich, darf im Frontend stehen)
- **Google OAuth:** Konfiguriert in Supabase → Authentication → Providers → Google
- **Redirect URL:** `https://rvapnpbthkonispwzvpw.supabase.co/auth/v1/callback`

---

## Datenbank-Schema

```sql
-- Ordner (für TXN)
create table folders (
  id text primary key,               -- TXN-Format: "${Date.now()}-${random}"
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  parent_id text,                    -- selbst-referenzierend für verschachtelte Ordner
  created_at bigint not null,        -- Unix-Timestamp (ms), kein timestamptz!
  is_deleted boolean default false
);

-- Notizen (für TXN)
create table notes (
  id text primary key,               -- TXN-Format: "${Date.now()}-${random}"
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default '',
  content text not null default '',  -- HTML innerHTML (txn-media:// Referenzen drin)
  folder_id text references folders(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  pinned boolean default false,
  is_deleted boolean default false   -- Soft-Delete (nie wirklich löschen)
);

-- Bild-Metadaten (für TXFE)
create table txfe_images (
  id text primary key,               -- Format: "img_${Date.now()}"
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,                -- Originaldateiname
  storage_path text not null,        -- "${userId}/${timestamp}.png"
  created_at timestamptz default now()
);
```

**RLS:** Alle Tabellen gesichert — jeder User sieht nur `user_id = auth.uid()`.

---

## Storage

- **Bucket:** `images` (nicht public)
- **Policies:** Upload/Read/Delete nur für eigene `userId` (aus Pfad-Prefix)

### Pfad-Struktur

| Inhalt | Pfad | Beschreibung |
|--------|------|-------------|
| TXFE-Bilder | `{userId}/{timestamp}.png` | Verarbeitete Bilder aus dem Foto-Editor |
| TXN-Medien | `{userId}/txn/{mediaId}` | Eingebettete Bilder/Videos aus Notizen |

**TXN-Medien-IDs** haben das Format `txn-media-{timestamp}-{random}` und werden im Note-Content als `src="txn-media://{id}"` referenziert. Lokal liegen sie in IndexedDB (`txn_db`, Store `media`).

---

## Speicherlimit

**50 MB pro User**, enforced in `txnSync.ts`:

```typescript
const LIMIT_BYTES = 50 * 1024 * 1024;
```

- `syncAll()` prüft vor dem Upload: Notiz-Bytes + TXFE-Storage + TXN-Medien-Storage > 50 MB → `throw new Error('Speicherplatz voll (50 MB)')`
- `saveImageBlobToCloud()` prüft: aktuelle Usage + Blob-Größe > 50 MB → `throw`
- Die aufrufenden Funktionen in `main.ts` catchen den Fehler und zeigen eine Notification

---

## Auth (`authManager.ts`)

```typescript
import { signInWithGoogle, signOut, getUser, onAuthChange } from '../../scripts/txc/authManager';

await signInWithGoogle();   // Google OAuth — öffnet Popup/Redirect
await signOut();

const user = await getUser();  // User | null

const { data: { subscription } } = onAuthChange((user) => { ... });
```

**Redirect nach Login:** `window.location.origin + '/app/txc'`

**User-Objekt:**
```typescript
user.id                              // UUID (Supabase user_id)
user.email
user.user_metadata.full_name
user.user_metadata.avatar_url
```

---

## TXN-Sync (`txnSync.ts`)

### ⚠️ Kein automatischer Sync mehr

`scheduleSyncAll()` wurde aus `persistAll()` entfernt. Änderungen werden nur **lokal** (localStorage) gespeichert. Cloud-Sync ist ausschließlich manuell über Buttons in TXN.

### Manuelle Sync-Buttons in TXN (`src/components/TXN/TXNEditor.astro`)

| Button-ID | Funktion |
|-----------|---------|
| `txnCloudLoadBtn` | "Von TXC laden" — Cloud hat Vorrang, lokal-only bleibt erhalten |
| `txnCloudUploadBtn` | "In TXC hochladen" — lädt Notizen + Medien hoch |

Beide Buttons sind in `initCloudLoad()` / `initCloudUpload()` in `main.ts` verdrahtet.

### Cloud-Load beim Start

In `initTXN()` — lädt Cloud-Daten async nach dem Start, merged mit lokalen Daten (updatedAt entscheidet), dann `loadTXNMediaFromCloud()` für fehlende Medien.

### API

```typescript
import {
  getUserId,
  syncAll,
  loadFromCloud,
  loadTXNMediaFromCloud,
  mergeData,
  deleteNoteFromCloud,
  deleteFolderFromCloud,
  getCloudUsage,
  getCloudContents,
  saveImageBlobToCloud,
} from '../../scripts/txc/txnSync';

// User-ID
const userId = await getUserId();  // string | null

// Notizen + Ordner + TXN-Medien hochladen (mit Limit-Check)
await syncAll();  // wirft Error wenn > 50 MB

// Von Cloud laden
const cloudData = await loadFromCloud();
// → { notes: Note[], folders: Folder[] } | null

// TXN-Medien für gegebene Notizen aus Cloud → IndexedDB
await loadTXNMediaFromCloud(notes);

// Merge (für manuellen Cloud-Load: Cloud-Vorrang)
// → Cloud-IDs überschreiben lokale, lokal-only bleibt erhalten
const merged = {
  notes: [...cloudData.notes, ...localNotes.filter(n => !cloudNoteIds.has(n.id))],
  folders: [...cloudData.folders, ...localFolders.filter(f => !cloudFolderIds.has(f.id))],
};

// Merge (für Start-Sync: updatedAt entscheidet)
const merged = mergeData(local, cloud);

// Soft-Delete
await deleteNoteFromCloud(noteId);
await deleteFolderFromCloud(folderId);

// Speichernutzung
const usage = await getCloudUsage();
// → { usedBytes: number, limitBytes: number } | null
// Zählt: DB-Notiztext (UTF-8) + TXFE-Dateien + TXN-Mediendateien

// Alle Inhalte für Übersichts-Modal
const contents = await getCloudContents();
// → { notes: {id,title,sizeBytes}[], txfeImages: {name,sizeBytes}[], txnMedia: {index,sizeBytes}[] } | null

// TXFE-Bild hochladen (mit Limit-Check, wirft Error wenn voll)
const ok = await saveImageBlobToCloud(blob, 'dateiname.png');
```

### TXN-Mediensync (intern in `txnSync.ts`)

`syncTXNMedia(notes, userId)` — wird von `syncAll()` aufgerufen:
1. Extrahiert alle `txn-media://` IDs aus Note-Content
2. Listet bereits hochgeladene Dateien in `{userId}/txn/`
3. Lädt fehlende Blobs aus IndexedDB → Supabase Storage hoch
4. Löscht Dateien aus Storage, die in keiner Notiz mehr referenziert sind (Orphan-Cleanup)

`loadTXNMediaFromCloud(notes)` — wird beim Startup und bei "Von TXC laden" aufgerufen:
1. Extrahiert alle `txn-media://` IDs aus den geladenen Notizen
2. Für jede ID: prüft ob in IndexedDB vorhanden
3. Falls nicht: Download aus Supabase Storage → `saveMedia()` in IndexedDB

**Wichtig:** Bei manuellem Cloud-Load (`initCloudLoad`) muss `loadTXNMediaFromCloud` **vor** `loadCloudData` aufgerufen werden, damit Medien in IndexedDB sind wenn `restoreMediaInEditor` feuert.

### Merge-Logik

- **`mergeData(local, cloud)`:** `updatedAt` entscheidet für Notizen; Cloud hat Priorität für Ordner
- **Manueller Cloud-Load:** Cloud-Version gewinnt bei gleicher ID, lokal-only bleibt
- **Gelöschte Elemente:** Soft-Delete (`is_deleted = true`), beim Laden mit `eq('is_deleted', false)` gefiltert

---

## `mediaStorage.ts` (TXN-lokal)

TXN-Medien liegen lokal in IndexedDB (`txn_db`, Store `media`). Relevante Funktionen:

```typescript
import { saveMedia, loadMediaBlob, loadMediaAsDataUrl, cleanupUnusedMedia } from '../txn/mediaStorage';

await saveMedia(id, blob);                    // Blob speichern
const blob = await loadMediaBlob(id);         // Blob laden (null wenn nicht vorhanden)
const dataUrl = await loadMediaAsDataUrl(id); // Als Data-URL laden
await cleanupUnusedMedia(usedIds);            // Nicht mehr referenzierte löschen
```

`loadMediaBlob()` wird in `txnSync.ts` für den Cloud-Upload verwendet (leichtgewichtiger als Data-URL).

---

## TXFE-Cloud-Upload

**Button:** `#txfeCloudSaveBtn` in `src/pages/app/txfe.astro` Header

**Flow:**
```typescript
const activeImage = stateManager.getActiveImage();
const blob = await processImage(activeImage);        // Filter + Crop angewendet
const ok = await saveImageBlobToCloud(blob, activeImage.file.name);
// wirft Error wenn Speicher voll
```

---

## TXC-Dashboard (`/app/txc`)

### Zustände

| ID | Zustand |
|----|---------|
| `txcLoading` | Spinner während Auth-Check |
| `txcSignIn` | Nicht eingeloggt — Google-Button |
| `txcDashboard` | Eingeloggt — User-Info + Speicheranzeige + Services |

### DOM-Elemente

| ID | Beschreibung |
|----|-------------|
| `txcAvatar` | `<img>` mit Google-Profilbild |
| `txcUserName` | Anzeigename |
| `txcUserEmail` | E-Mail |
| `txcStorageText` | "X.X MB / 50 MB" |
| `txcStorageFill` | Fortschrittsbalken-Fill (width in %) |
| `txcStorageBar` | Fortschrittsbalken (role="progressbar") |
| `txcContentsBtn` | "Inhalte anzeigen" — öffnet Modal |
| `txcContentsModal` | Inhalts-Übersicht Modal |
| `txcContentsList` | Modal-Inhalt (dynamisch befüllt) |
| `txcContentsClose` | Modal schließen |
| `txcSignInBtn` | → `signInWithGoogle()` |
| `txcSignOutBtn` | → `signOut()` |

### Inhalts-Modal

Öffnet sich via `txcContentsBtn`. Zeigt drei Section-Cards:
- **TXN Notizen** — Notiz-Titel + Textgröße, nach Größe sortiert
- **TXFE Bilder** — Dateiname + Dateigröße
- **TXN Medien** — "Mediendatei 1/2/…" + Dateigröße

Jede Card zeigt: Icon, Name, Anzahl, Gesamtgröße, und pro Item einen proportionalen Balken (Anteil am Section-Total). Leere Sections werden ausgeblendet.

---

## CSS-Klassen (TXC-spezifisch)

Alle Styles sind **scoped** in `src/pages/app/txc.astro` und `src/pages/app/txfe.astro`.

| Klasse | Beschreibung |
|--------|-------------|
| `.txc-app` | Fullscreen-Container, zentriert |
| `.txc-state` | Zustandscontainer (loading/signin/dashboard) |
| `.txc-spinner` | CSS-Lade-Animation |
| `.txc-google-btn` | Google-Sign-In-Button |
| `.txc-user-card` | Profilkarte (Avatar + Info + Abmelden) |
| `.txc-storage` | Speicheranzeige-Container |
| `.txc-storage-bar` | Fortschrittsbalken-Track |
| `.txc-storage-fill` | Fortschrittsbalken-Fill (rot ab 90%) |
| `.txc-contents-btn` | "Inhalte anzeigen"-Link |
| `.txc-modal` | Modal-Overlay |
| `.txc-modal-box` | Modal-Box (460px, 70vh max) |
| `.txc-section-card` | Section-Card im Modal |
| `.txc-section-head` | Card-Header (Icon + Name + Stats) |
| `.txc-section-icon` | Icon-Box (2rem, border, rounded) |
| `.txc-item-row` | Item-Zeile (Name + Größe + Balken) |
| `.txc-item-bar` / `.txc-item-fill` | Proportionaler Größenbalken |
| `.txfe-cloud-save-btn` | Cloud-Button im TXFE-Header |

---

## Wichtige Patterns

**Nicht eingeloggt → kein Sync:** Alle `txnSync`-Funktionen rufen `getUserId()` auf und geben bei `null` sofort zurück.

**Supabase-Client Singleton:** `src/lib/supabase.ts` — nie neu erstellen.

**Soft-Delete:** Notizen/Ordner nie wirklich löschen, nur `is_deleted: true`.

**bigint Timestamps:** `created_at`/`updated_at` in `notes`/`folders` sind `bigint` (Unix ms), kein `timestamptz`.

**Medien vor Render laden:** Bei manuellem Cloud-Load `loadTXNMediaFromCloud()` vor `loadCloudData()` aufrufen, damit `restoreMediaInEditor` die Blobs in IndexedDB findet.

**Editor-Reset nach Cloud-Load:** `editorEl.dataset.noteId = ''` vor `loadCloudData()` setzen, damit `renderEditor` den neuen Inhalt schreibt (sonst wird die gleiche Note-ID als "schon geladen" übersprungen).

**Kein Build nach Änderungen** — Dev-Server läuft separat, visuelles Feedback vom User.

---

## Cron-Job (Supabase Wach-Halten)

- **Service:** cron-job.org
- **URL:** `https://rvapnpbthkonispwzvpw.supabase.co/rest/v1/notes?select=id&limit=1`
- **Header:** `apikey: {anon key}`
- **Schedule:** `0 12 */3 * *` (alle 3 Tage um 12:00)
- **Zweck:** Verhindert automatisches Pausieren des kostenlosen Supabase-Projekts
