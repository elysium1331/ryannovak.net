# ryannovak.net

Personal site for Ryan Novak. Single-page CV, plus a `/bored/` page with two small games and an `/arcade/` page with four more — quick casual puzzles with monthly "Mount Olympus" standings.

## Stack

Static HTML, CSS, and vanilla JS. No framework, no build step, no dependencies. Open any `.html` in a browser and it works. Deploy by uploading the folder to any static host (GitHub Pages, Netlify, S3, the web server you already have, etc.).

## Folder structure

```
.
├── index.html                  # Single-page CV (Hero, About, Experience, Skills, Education, Stats, Quotes, Contact)
├── bored/
│   └── index.html              # Game picker — Zen, Bidstream, and a door to the Arcade
├── arcade/
│   ├── index.html              # "More games" hub — the four arcade games
│   ├── arena.js                # Shared identity + standings library (see below)
│   └── arena.css               # Shared styles for the chip + standings board
├── games/
│   ├── zen/                    # Gentle physics toy (drag, fling, tilt on mobile)
│   ├── bidstream/              # RTB bidding game — 60s round, maximize ROAS
│   ├── eclipse/                # Tango-style sun/moon logic grid
│   ├── olympus/                # Queens-style thunderbolt placement puzzle
│   ├── labyrinth/              # Zip-style draw-the-path puzzle
│   └── echo/                   # Simon-style memory game
│       └── (each: index.html, style.css, game.js)
├── css/
│   └── main.css                # Shared styles, design tokens, reset, layout
├── js/
│   └── main.js                 # Nav, reveal-on-scroll, stat counters
├── img/
│   ├── ryan.jpg                # Headshot
│   ├── favicon.svg             # Preferred favicon (scalable)
│   └── favicon.ico             # Fallback favicon (multi-size)
├── assets/
│   ├── Ryan_Novak_Resume.docx  # Source resume
│   └── Ryan_Novak_Resume.pdf   # PDF for the "Download CV" button
└── README.md
```

## Updating content

**Your 2025 stats** live in `index.html` inside `<section id="stats">`. Each stat is a `<div class="stat">` with a `data-target` attribute that the counter animates to. Change the number in `data-target`, change the label, done.

**Experience bullets** live in `index.html` inside `<section id="experience">`. Each role is an `<article class="job">`. Mark the current role with `class="job current"` so the accent dot glows.

**Social links** are in the Contact section and the bored-page footer.

**Colors & type** live in `css/main.css` at the top under `:root`. Change `--accent` to re-theme.

## The games

**Zen** — Click empty space to spawn, drag to fling, double-click to reset. On mobile it responds to tilt (iOS 13+ requires tapping "Enable tilt" for permission).

**Bidstream** — 60-second round. Budget $500. Bid requests arrive; press 1 (BID HIGH), 2 (BID LOW), or 3 (PASS). Fraud requests come in with red flags and shady domains — correctly passing them pays a small bonus; bidding on them just loses your money. Best ROAS is saved to `localStorage` per-browser.

**Eclipse** — Tango-style logic. Fill the 6×6 grid with suns and moons: three of each per row and column, no three in a row, and `=` / `×` edge constraints. Every puzzle is generated client-side with a unique solution. Score is solve time.

**Olympus** — Queens-style logic. Place one thunderbolt per row, column, and colored realm; no two bolts touch, even diagonally. Unique-solution puzzles, generated fresh each run. Score is solve time.

**Labyrinth** — Zip-style path drawing. Drag Ariadne's thread from waypoint 1 to 7, in order, covering every cell exactly once. Score is solve time.

**Echo** — Simon-style memory. Four toned tiles, a sequence that grows each round, one mistake ends the run. Score is rounds completed.

## The Arena (anonymous standings)

`arcade/arena.js` powers the four arcade games:

- **Identity** — if cookies are enabled, the browser gets an anonymous random token (`arena_id` cookie, 1-year expiry). No accounts, no personal data. The token deterministically maps to a readable name — an epithet plus a Greek hero, e.g. *Swift Atalanta* — so players can find themselves on the board.
- **Scores** — each game reports a best score per player, stored in `localStorage`, namespaced by month.
- **Standings** — after each run, the game shows Mount Olympus standings: local players merged with the **Immortals**, seeded house entries (Olympian gods) whose scores re-roll every month so the board always has a pace to beat. The player's row is highlighted with a `YOU` tag.
- **Monthly reset** — standings are keyed by `YYYY-MM`; on the first visit in a new month, the old month's scores are cleared automatically.

Everything is client-side (this is a static site), so standings are per-browser. Swapping in a real backend later only means replacing the storage functions inside `arena.js`.

## Deploying

Just upload the whole folder. No server-side anything. If your host needs a default document, it's `index.html` at the root and inside every subfolder.

---

Built in April 2026.
