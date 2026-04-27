# ryannovak.net

Personal site for Ryan Novak. Single-page CV, plus a `/bored/` page with two small games.

## Stack

Static HTML, CSS, and vanilla JS. No framework, no build step, no dependencies. Open any `.html` in a browser and it works. Deploy by uploading the folder to any static host (GitHub Pages, Netlify, S3, the web server you already have, etc.).

## Folder structure

```
.
├── index.html                  # Single-page CV (Hero, About, Experience, Skills, Education, Stats, Quotes, Contact)
├── bored/
│   └── index.html              # Arcade picker — links to the two games
├── games/
│   ├── zen/                    # Gentle physics toy (drag, fling, tilt on mobile)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── game.js
│   └── bidstream/              # RTB bidding game — 60s round, maximize ROAS
│       ├── index.html
│       ├── style.css
│       └── game.js
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

## Deploying

Just upload the whole folder. No server-side anything. If your host needs a default document, it's `index.html` at the root and inside every subfolder.

---

Built in April 2026.
