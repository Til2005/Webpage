# Portfolio — Projektkonventionen

## Projekt
Persoenliches Web-Portfolio gebaut mit Astro + Tailwind CSS v4.
Ziel: Google-Bewerbungsniveau — erstklassiges Design, Performance, Accessibility.

## Befehle
- `npm run dev` — Dev-Server (laeuft separat)
- `npm run build` — Nur vor Push/Commit

## Konventionen
- Komponenten: `src/components/` (PascalCase)
- Layouts: `src/layouts/`, Seiten: `src/pages/`
- Styles: `src/styles/global.css`, Assets: `public/`
- Deutsch fuer UI, Englisch fuer Code
- Semantisches HTML, WCAG 2.1 AA

## Design-System
- Monochrom Schwarz/Weiss, viel Whitespace
- Font: Google Sans Variable (`public/fonts/`)
- Dark Mode: `data-theme="dark"` auf `<html>`
- Zweisprachig: DE (Standard) + EN, `src/data/i18n.ts`

## Farbpalette
Dark Mode:
- `#131315` — Hintergrund (`--color-bg`)
- `#212124` — Menüleiste / Sidebar
- `#1F1F21` — Hover-Hintergrund

White Mode:
- `#FDF8F5` — Hintergrund (`--color-bg`)
- `#F8F3F0` — Menüleiste / Sidebar
- `#F0ECE9` — Hover-Hintergrund

## Skills (bei Bedarf automatisch geladen)
- `txfe` — TXFE Foto Editor Dokumentation
- `txn` — TXN Notes App Dokumentation
- `txp` — TXP Easter Egg Maskottchen
- `txcv` — TXCV Konverter Dokumentation

## Arbeitsweise (WICHTIG)
Arbeite immer nach den Claude Code Best Practices (https://code.claude.com/docs/en/best-practices):
- **Verifizieren:** Dev-Server laeuft separat (`npm run dev`). KEIN `npm run build` nach Aenderungen — nur visuelles Feedback vom User einholen. Build nur vor Push/Commit ausfuehren.
- **Nicht ueberengineeren:** Nur das aendern, was gefragt ist. Keine ungefragten Features, Refactorings oder Kommentare.
- **Kontext schlank halten:** `/clear` zwischen unabhaengigen Aufgaben.
- **Erst erkunden, dann planen, dann coden:** Bei nicht-trivialen Aufgaben erst Codebase lesen, Plan erstellen, dann umsetzen.
- **Spezifischer Kontext:** Dateien lesen bevor man sie aendert. Keine Aenderungen an ungelesenem Code.
- **Frueh korrigieren:** Bei 2+ fehlgeschlagenen Versuchen: `/clear` und mit besserem Prompt neu starten.
- **Subagents nutzen:** Fuer Recherche separate Subagents verwenden, um Hauptkontext sauber zu halten.
