---
name: txcv
description: TXCV Konverter Dokumentation. Verwenden bei Arbeiten am Datei-Konverter unter /app/txcv.
---

# TXCV (Datei-Konverter)
Client-seitiger Bild- und Daten-Konverter unter `/app/txcv` — kein Backend, reine Browser-APIs (Canvas, FileReader, createImageBitmap).

---

## Datei-Struktur

```
src/
├── pages/app/txcv.astro             — Page (AppLayout + Header-Slot)
├── components/TXCV/
│   └── TXCV.astro                   — Gesamte App (HTML + Script + Style in einer Datei)
├── data/apps.ts                     — TXCV-Eintrag: id='txcv', href='/app/txcv'
└── public/icons/apps/txcv.svg       — App-Icon
```

**Keine externen Abhängigkeiten** — alles inline in `TXCV.astro`.

---

## Architektur

`TXCV.astro` enthält alles in einer Datei:
- **HTML:** Tab-Bar, Image-Panel, Data-Panel, Toast
- **`<script>`:** TypeScript — State, Conversion-Logik, UI-Events, TXC-Integration
- **`<style>`:** Scoped CSS mit CSS-Variablen

### State

```typescript
interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;  // Object URL (revoken nach clearQueue)
  targetFormat: string; // MIME type
  quality: number;      // 0.1–1.0, nur für JPEG/WebP
}

interface ResultItem {
  id: string;
  originalName: string;
  blob: Blob;
  url: string;     // Object URL (revoken bei newConversion)
  ext: string;     // 'jpg', 'png', etc.
  sizeBytes: number;
}

const queue = new Map<string, QueueItem>();
const results: ResultItem[] = [];
```

---

## Unterstützte Formate

### Bilder-Tab

| Input (Browser lädt via createImageBitmap) | Output |
|---|---|
| JPEG, PNG, WebP, GIF (1. Frame), BMP, SVG, ICO, AVIF | JPEG, PNG, WebP, BMP, ICO |

**Qualitätsschieberegler** nur für JPEG und WebP aktiv (`qualityFormats()` liefert diese).

**GIF:** Nur erster Frame wird konvertiert (kein animiertes GIF Output — Canvas-Limitation).

**AVIF Input:** Chrome + Firefox. Safari: noch kein Support (schlägt mit createImageBitmap fehl).

**SVG Fallback:** Wenn `createImageBitmap(file)` fehlschlägt → `<img>` laden → dann `createImageBitmap(img)`.

### Daten-Tab

| Tool | Funktion |
|---|---|
| JSON Formatierer | Pretty Print (`JSON.stringify(…, null, 2)`) + Minify |
| CSV ↔ JSON | Vollständiger CSV-Parser (Quoted fields, escaped quotes) |
| Base64 | Text encode/decode + Datei-to-Base64 via FileReader |
| URL-Kodierung | `encodeURIComponent` / `decodeURIComponent` |

---

## Kern-Konvertierung

```typescript
async function convertImage(file: File, targetMime: string, quality: number): Promise<Blob>
```

Flow:
1. `createImageBitmap(file)` — bei SVG-Fehler: IMG-Fallback
2. Canvas erstellen, bei JPEG weißen Hintergrund zeichnen
3. `bitmap.close()` nach `drawImage`
4. `targetMime === 'image/bmp'` → `encodeBMP(canvas)`
5. `targetMime === 'image/x-icon'` → `encodeICO(canvas)` (async)
6. Sonst: `canvas.toBlob(…, targetMime, quality)`

---

## Eigene Encoder

### BMP (24-bit, BI_RGB)

```typescript
function encodeBMP(canvas: HTMLCanvasElement): Blob
```

- Header: 54 Bytes (14 File-Header + 40 BITMAPINFOHEADER)
- 24 bpp, keine Kompression, 2835 px/m (≈72 DPI)
- Pixel: BGR-Reihenfolge, **bottom-up** (y von height-1 bis 0)
- Zeilenpadding auf 4-Byte-Grenze: `rowPad = (4 - (width*3)%4) % 4`
- Gibt `Blob({type: 'image/bmp'})` zurück

### ICO (PNG-in-ICO)

```typescript
async function encodeICO(canvas: HTMLCanvasElement): Promise<Blob>
```

- Skaliert auf max. 256×256 (proportional)
- Rendert PNG via `canvas.toBlob('image/png')`
- Baut ICO-Container: 6 Bytes Header + 16 Bytes Directory Entry + PNG-Daten
- Breite/Höhe im Directory: `0` wenn ≥256 (ICO-Standard)
- Gibt `Blob({type: 'image/x-icon'})` zurück

---

## TXC-Integration

```typescript
import { saveImageBlobToCloud } from '../../scripts/txc/txnSync';
const ok = await saveImageBlobToCloud(result.blob, filename);
```

- Dynamischer Import beim ersten Klick auf "TXC"-Button
- Gibt `true` bei Erfolg, wirft `Error` bei Speicher voll (>50 MB) oder nicht eingeloggt
- **Nicht eingeloggt:** `saveImageBlobToCloud` gibt `false` zurück oder wirft → Toast: "Nicht in TXC eingeloggt"
- **Voll:** Error-Message enthält "50" oder "voll" → Toast: "TXC Speicher voll (50 MB)"
- Nach Erfolg: Button bekommt `.txcv-btn-cloud--done` (grün, pointer-events: none)

---

## DOM-Element-IDs

### Image-Panel

| ID | Beschreibung |
|---|---|
| `txcvDrop` | Drop-Zone (click → fileInput, drag/drop) |
| `txcvInput` | Versteckter `<input type="file" multiple>` (primär) |
| `txcvAddMoreInput` | Versteckter `<input type="file" multiple>` (+ Weitere) |
| `txcvQueue` | Container für Queue-Items |
| `txcvActionBar` | Aktionsleiste (global Format + Buttons) |
| `txcvGlobalFormat` | `<select>` für globales Zielformat |
| `txcvConvertBtn` | Konvertieren-Button |
| `txcvClearBtn` | Queue leeren |
| `txcvAddMoreBtn` | Weitere Dateien hinzufügen |
| `txcvResults` | Ergebnis-Container |
| `txcvResultsGrid` | Grid für ResultCards |
| `txcvDownloadAllBtn` | Alle herunterladen |
| `txcvNewConversionBtn` | Neue Konvertierung (reset) |
| `txcvToast` | Toast-Notification |

### Queue-Item-Struktur (dynamisch erzeugt)

```html
<div class="txcv-queue-item" data-id="{id}">
  <img class="txcv-qi-thumb" />
  <div class="txcv-qi-info">
    <span class="txcv-qi-name" />
    <span class="txcv-qi-meta" />      <!-- "PNG · 1.2 MB" -->
  </div>
  <div class="txcv-qi-controls">
    <div class="txcv-qi-arrow" />
    <select class="txcv-select txcv-qi-format" />
    <div class="txcv-qi-quality-wrap" data-visible="true|false">
      <input type="range" class="txcv-qi-quality" min="0.1" max="1" step="0.05" />
      <span class="txcv-qi-quality-val" />
    </div>
  </div>
  <button class="txcv-qi-remove" />
</div>
```

Status-Klassen: `.txcv-qi--converting` (Puls-Animation) | `.txcv-qi--done` | `.txcv-qi--error`

### Daten-Panel IDs

| Tool | Input | Output | Buttons |
|---|---|---|---|
| JSON | `jsonInput` | `jsonOutput` | `jsonFormatBtn`, `jsonMinifyBtn`, `jsonCopyBtn` |
| CSV↔JSON | `csvInput` | `csvOutput` | `csvToJsonBtn`, `jsonToCsvBtn`, `csvCopyBtn` |
| Base64 | `b64Input`, `b64FileInput`, `b64FileName` | `b64Output` | `b64EncodeBtn`, `b64DecodeBtn`, `b64CopyBtn` |
| URL | `urlInput` | `urlOutput` | `urlEncodeBtn`, `urlDecodeBtn`, `urlCopyBtn` |

---

## CSS-Klassen

| Klasse | Beschreibung |
|---|---|
| `.txcv-wrap` | Fullscreen-Container (flex column, `calc(100vh - header)`) |
| `.txcv-tabs` | Tab-Leiste mit Border-Bottom |
| `.txcv-tab` | Tab-Button; `.active` = `border-bottom: 2px solid var(--color-fg)` |
| `.txcv-panel` | Tab-Content (overflow-y: auto); `.hidden` = `display: none` |
| `.txcv-drop` | Drop-Zone; `--compact` = eingeklappt wenn Queue gefüllt; `--hover` = Drag-Over |
| `.txcv-queue` | Queue-Container |
| `.txcv-queue-item` | Einzelne Queue-Zeile |
| `.txcv-action-bar` | Aktionsleiste mit globalem Format-Selector |
| `.txcv-results` | Ergebnis-Bereich |
| `.txcv-results-grid` | `grid auto-fill minmax(180px, 1fr)` |
| `.txcv-result-card` | Ergebnis-Karte (thumb + info + actions) |
| `.txcv-rc-badge` | Format-Badge (PNG/JPEG/…) oben rechts im Thumbnail |
| `.txcv-btn` | Base-Button; `.txcv-btn-primary` (fg/bg invertiert); `.txcv-btn-ghost` (muted); `.txcv-btn-sm` (klein) |
| `.txcv-btn-cloud--done` | TXC-Button nach Erfolg (grün, deaktiviert) |
| `.txcv-select` | Format-Dropdown |
| `.txcv-toast` | Fixed Toast; `--show` = sichtbar; `--err` = rot |
| `.txcv-data-grid` | Data-Tab Grid (`auto-fill minmax(340px, 1fr)`) |
| `.txcv-tool-card` | Data-Tool-Karte |
| `.txcv-textarea` | Mono-Font Textarea; `--error` = roter Rahmen; `-out` = Read-only |

---

## Wichtige Patterns

**Format-zu-Extension:**
```typescript
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/avif': 'avif',
};
```

**Qualitätsformate:** Nur `['image/jpeg', 'image/webp']` — alle anderen ignorieren den Quality-Slider.

**Quality-Wrap Sichtbarkeit:** `data-visible="true|false"` auf `.txcv-qi-quality-wrap` — CSS versteckt bei `false`.

**Drop-Zone kompakt:** `.txcv-drop--compact` wird gesetzt wenn `queue.size > 0`. Drop-Icon + Format-Liste ausgeblendet, Layout wird horizontal.

**Object-URL-Lifecycle:**
- `previewUrl` (Queue): revoken in `clearQueue()` via `URL.revokeObjectURL`
- `result.url` (Results): revoken in `newConversionBtn`-Handler
- Nie vorzeitig revoken — Download-Links brauchen die URL

**JPEG-Weißhintergrund:** Vor `ctx.drawImage()` bei JPEG-Output `fillStyle = '#ffffff'` setzen (PNG-Alpha → weiß statt schwarz).

**Toast-API:**
```typescript
showToast('Nachricht', 'ok' | 'err');  // 3.5s auto-hide
```

**Copy-Helper:**
```typescript
function copyText(text: string, btn: HTMLButtonElement)
// Zeigt '✓' im Button für 1.5s
```

**Global-Format-Selector:** Setzt alle Queue-Items auf dasselbe Format + aktualisiert Quality-Wrap-Sichtbarkeit.

**Kein Build nach Änderungen** — Dev-Server läuft separat, visuelles Feedback vom User einholen.
