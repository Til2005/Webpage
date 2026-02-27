---
name: txp
description: TXP Easter Egg Maskottchen Dokumentation. Verwenden bei Arbeiten am Roboter-Charakter.
---
# TXP Easter Egg

Code in `src/components/HeroSection.astro` (TXPAnimator Klasse)

## Text-States (WICHTIG)
- 0 = "Til Sander" (Initial)
- 1 = "TXP" (nach erstem Klick)
- 2 = Final Text (nach zweitem Klick)
- 3 = Runner-Modus (nach drittem Klick)

## DOM-Element-IDs
- `txpSprite`, `txpCharacter`, `txpPlatform`, `txpPlatformContainer`
- `txpRunnerGround`, `txpClickHint`
- `heroTextTil`, `heroTextTXP`, `heroTextFinal`, `heroTextRunner`, `heroTextJump`, `heroTextScore`
- `scoreDisplay` - Punktzahl im Score-Text
- `txpTrigger` (Button im Dropdown)
- `txpDeathScreen`, `deathScoreDisplay` - Death Screen Overlay
- `txpPauseScreen` - Pause Screen Overlay

## Animationen
| Animation | Frames | FPS | Pfad |
|-----------|--------|-----|------|
| jump | 105 | 15 | `/animations/txp/jump/TXP%20Sprung_` |
| idle | 24 | 24 | `/animations/txp/idle/TXP%20Stand%20Pose_` |
| walk | 24 | 24 | `/animations/txp/walk/TXP%20Lauf%20Loop_` |
| talk | 24 | 24 | `/animations/txp/talk/TXP_Talk%20Pose_` |
| enemy1 walk | 12 | 12 | `/animations/enemy1/walk/AI%20Gegner_FPS%2012` |
| enemy2 jump | 24 | 36 | `/animations/enemy2/Gegner%20Loop_` |
| enemy3 fly | 9 | 10 | `/animations/enemy3/frame_` (light) / `/animations/enemy3/darkmode/frame_` (dark), Suffix: `_delay-0.1s.png` |

Frame-Format: `00000.png` (5-stellig, 0-basiert) — außer enemy3 (eigenes Suffix)

## Interaktionsablauf

### Aktivierung (Klick auf "???" im Menu)
- Event `txp:activate` wird ausgelöst
- TXP fliegt vom Button zur Plattform (Jump-Animation, gespiegelt mit scaleX(-1))
- Plattform erscheint (scale-x-0 → scale-x-100)
- Nach Landung: Idle-Animation
- Nach 3 Sek ohne Klick: "klick mich an" Hint + Talk-Animation (2 Sek)

### Klick 1: Text → "Hallo, ich bin TXP"
### Klick 2: Text → "Schön dich kennenzulernen!"
### Klick 3: Runner-Modus startet

## Runner-Modus (textState === 3)

### Plattform-Animation
1. **Phase 1**: Plattform wächst nach RECHTS (400px/s, transformOrigin: left)
2. **Pause**: 500ms
3. **Phase 2**: Plattform wächst nach LINKS (80px/s)
   - Rechter Rand bleibt am Bildschirmrand
   - `transform: translateX(-X) scaleX(scale)` - Scale erhöht sich proportional

### Text-Wechsel
- Bei Phase 2 Start: "Ich hab einen Termin!" / "Hilf mir den Ort zu erreichen!"
- Nach 4 Sek: "Springe mit der" / "Leertaste" + Spacebar-Listener aktiv
- Nach erstem Sprung: "Deine Punktzahl" / "0001"

### Walk-Animation
- Startet bei Phase 2
- Basis 24 FPS, skaliert dynamisch mit Score: `baseWalkFPS * Math.pow(getSpeedMultiplier(), 2.5)`
- Loop, nach Sprung: Startet ab Frame 13 (Index 12)

## Sprung-Mechanik

```typescript
const jumpHeight = 210;      // Pixel Höhe
const totalFrames = 89;      // Frames der Animation (von 120)
const startFrame = 5;        // Aufwärtsbewegung startet nach Frame 5
const fps = 55;              // Animationsgeschwindigkeit
```

- Aufwärtsbewegung: `Math.sin(progress * Math.PI)` (Parabel)
- Nach Sprung: Walk-Animation ab Frame 13

## Pause-System
- **ESC-Taste**: Pausiert/Resumed das Spiel (nur verfügbar nach erstem Sprung)
- **Bei Pause**: Alle Animationen, Timer, Score-Counter und Enemy-Spawning werden gestoppt
- **Pause Screen**: Zeigt "Pausiert" + Hinweise "ESC zum Fortsetzen" / "Leertaste zum Neustarten"
- **Bei Resume**: Alle Systeme werden nahtlos fortgesetzt (Platform-Animation, Walk-Animation, Game Loop, Enemy Spawning)
- **Leertaste im Pause-Modus**: Startet das Spiel neu (wie beim Death Screen)

## Score-System
- Startet nach erstem Sprung bei 1
- RAF-Loop statt setInterval: Rate = `10 * getSpeedMultiplier()` Punkte/Sekunde (endless skalierend)
  - Score 0 → 10 P/s, Score 1000 → 20 P/s, Score 2000 → 30 P/s, …
- `scoreAccum` (float) akkumuliert, `score` = `Math.floor(scoreAccum)`
- Format: 4-stellig mit führenden Nullen ("0001")
- `formatScore(score)` – Formatierungsfunktion
- `startScoreLoop()` / `stopScoreLoop()` – starten/stoppen (Pause, Death, Restart)

## Wichtige Klassen-Variablen

```typescript
textState: number      // 0-3
isActive: boolean      // TXP sichtbar
isLanded: boolean      // Auf Plattform
isRunning: boolean     // Runner-Modus
isJumping: boolean     // Sprung aktiv
isPaused: boolean      // Pause aktiv
hasJumpedOnce: boolean // Score-Trigger
score: number          // Aktuelle Punktzahl (Integer)
scoreAccum: number     // Akkumulierter Score (Float, für RAF-Loop)
scoreLoopId: number | null // RAF-ID des Score-Loops
isDead: boolean        // Death Screen aktiv
showHitboxes: boolean  // Hitbox-Anzeige (H-Taste)
enemies: EnemyInstance[] // Aktive Gegner
totalLeftExtension: number // Platform-Scroll-Position (für Resume)
scaleAfterPhase1: number   // Platform-Scale nach Phase 1 (für Resume)
```

## Enemy-System

### EnemyInstance Interface
```typescript
interface EnemyInstance {
  element: HTMLDivElement;
  sprite: HTMLImageElement;
  x: number;
  currentFrame: number;
  lastFrameTime: number;
  type: EnemyType;        // "walk" | "jump" | "fly"
  jumpOffset: number;
  lastJumpTime: number;
  speed: number;
  dying: boolean;
  baseY: number;
  hitbox: { x: number; y: number; w: number; h: number };
  floatAmplitude: number; // fly: 22 (normal), 66 (big) — unterscheidet big/normal fly
  points: number;         // Stomp-Punkte, beim Spawn gesetzt
}
```

### Gegner-Übersicht
| Typ | Größe | Base Speed | z-index | Punkte | Spawn-Chance | yOffset |
|-----|-------|-----------|---------|--------|-------------|---------|
| walk (normal) | 90px | 200px/s | 59 | 10P | 35% × 80% | 86 |
| walk (big) | 270px | 100px/s | 59 | 30P | 35% × 20% | 260 |
| jump | 95px | 130px/s | 55 | 20P | 35% | 91 |
| fly (normal) | 130px | 221px/s | 53 | 15P | 30% × 80% | 200 |
| fly (big) | 200px | 170px/s | 53 | 50P | 30% × 20% | 200 |

Alle Speeds skalieren mit `getSpeedMultiplier()` = `1 + score/1000`

Spawn-Typ-Aufteilung: `rand < 0.35` → walk, `rand < 0.70` → jump, sonst → fly

### Hitboxen (in jeweiligem Container)
- **walk normal** `{x:10, y:5, w:65, h:80}` (90px)
- **walk big** `{x:30, y:15, w:195, h:240}` (270px)
- **jump** `{x:10, y:5, w:65, h:80}` (95px)
- **fly normal** `{x:15, y:30, w:80, h:40}` (130px)
- **fly big** `{x:20, y:65, w:160, h:60}` (200px)
- **TXP** `{x:20, y:10, w:50, h:76}` (90px Container)

### Sonstiges
- **H-Taste**: Zeigt/versteckt Hitbox-Overlays (1.5px Rahmen, 40% Opacity)
- **Stomp**: Sprung von oben (obere 40% der Enemy-Hitbox) → `killEnemy()` → `enemy.points` gutschreiben + `showScorePopup()`
- **Spawning**: Distanz-basiert, startet wenn Spacebar-Listener aktiv
- **fly**: gespiegelt? Nein (bereits korrekt gezeichnet). walk/jump: `scaleX(-1)`
- **big fly**: Sine-Wave Speedvariation (0.3×–1.7×), weniger vertikales Floaten nach unten
- **Tod**: Score-Loop stoppt, Death Screen Overlay (fade 500ms), Leertaste zum Neustarten
- **Restart**: scoreAccum = 1, Gegner gelöscht, Walk + Score-Loop + Game Loop neu

## Deaktivierung
- Erneuter Klick auf TXP-Button während aktiv
- `deactivate()` → `stopRunnerMode()` → alle States/Timer/Enemies reset

## Highscore-System
- Gespeichert in `localStorage` unter Key `"txpHighscore"`
- Wird beim Initialisieren der Klasse geladen: `parseInt(localStorage.getItem("txpHighscore") ?? "0", 10)`
- Klassenvariable: `private highscore = 0`
- DOM-Element: `txpHighscoreDisplay` — Zeile im Death Screen zwischen Score und Restart-Hint
- Referenz: `private highscoreDisplay!: HTMLElement`
- Logik in `die()`:
  - Neuer Rekord → `"Neuer Highscore"` (volle Opacity), localStorage aktualisieren
  - Kein neuer Rekord → `"Highscore   XXXX"` (50% Opacity)
- Format: gleiche `formatScore()`-Funktion wie der laufende Score
