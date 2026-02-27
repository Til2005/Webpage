---
name: txfe
description: TXFE Foto Editor Dokumentation. Verwenden bei Arbeiten am Bildeditor unter /app/txfe.
---
# TXFE (Foto Editor)
Minimalistischer Bildeditor unter `/app/txfe`

## Struktur
- Layout: `src/layouts/AppLayout.astro`
- Komponenten: `src/components/TXFE/`
- Scripts: `src/scripts/txfe/`

## State-Management
Reaktiver State mit subscribe/notify Pattern in `stateManager.ts`:
- `stateManager.subscribe(callback)` — Listener registrieren
- `stateManager.getActiveImage()` — Aktuelles Bild
- `stateManager.updateFilter(key, value)` — Filter aendern

## Filter Default-Werte (WICHTIG)
- saturation: 100, brightness: 100, contrast: 100
- warmth: 0, hue: 0, sharpness: 0

## DOM-Element-IDs
Preview: `txfePreviewImage`, `txfeImageContainer`, `txfeCropFrame`
Queue: `txfeQueueList`, `txfeQueueListMobile`
Actions: `txfeClear`, `txfeExport`, `txfeFileInput`
