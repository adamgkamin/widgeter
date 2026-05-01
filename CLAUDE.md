# RULES
- NEVER ask for confirmation. NEVER stop to ask questions. NEVER pause for approval.
- Make every decision yourself. If something is ambiguous, pick the best option and keep going.
- Do not say "shall I proceed" or "would you like me to" or "should I continue" — just do it.
- Complete the entire task in one pass, then commit and push.
- When a prompt says "Do not stop or ask" — that means zero interruptions, zero questions, zero checkpoints.

---

# CLAUDE.md — Conventions for Claude Code

This file is read at the start of every Claude Code session. It tells Claude Code how to work on this project. **Read it fully before any task.**

---

## Project: Widgeter

A browser-based ASCII incremental game inspired by Universal Paperclips, with a NetHack/Caves-of-Qud visual aesthetic. The player runs a one-person workshop that grows into a financialized widget empire across four phases: manual production → automation → market awareness → derivatives.

The game is a static website. No backend. No build step. Hosted on GitHub Pages.

---

## The Most Important Rule

**`DESIGN.md` is the source of truth.** Every game mechanic, formula, number, and visual specification lives there. When implementing anything:

1. **Read the relevant section of DESIGN.md before writing code.**
2. If asked to implement something, **reference the section number** in your work (in commit messages, in code comments where helpful).
3. **Do not improvise game design.** If a request seems to require a decision not specified in DESIGN.md, **stop and ask the user**. Do not invent formulas, numbers, or mechanics.
4. If DESIGN.md and a user instruction conflict, **flag the conflict** and ask which takes precedence. Usually the answer is "update DESIGN.md first, then code."

The user is a beginner programmer with strong design instincts. They depend on you for implementation; you depend on them for design decisions. Stay in your lane.

---

## Tech Stack

- **HTML / CSS / vanilla JavaScript.** No frameworks, no build step, no transpilation. Files are served as-is.
- **rot.js** (https://ondras.github.io/rot.js/) for the ASCII display. Loaded via CDN in index.html. Used for the 80×50 grid, color rendering, and tile updates.
- **localStorage** for save state. Save key: `widgeter.save.v1` (see DESIGN.md §8).
- **No external runtime dependencies** beyond rot.js. Adding a new dependency requires explicit user approval.

---

## File Layout

See DESIGN.md §10 for the canonical layout. In summary:

```
widgeter/
├── index.html                    # entry point
├── styles.css                    # CRT effect, layout, font
├── main.js                       # entry, tick loop, top-level wiring
├── src/
│   ├── state.js                  # game state object, save/load
│   ├── render.js                 # rot.js rendering, color mapping
│   ├── input.js                  # keyboard handling
│   ├── look.js                   # Look Mode (DESIGN.md §3.10–3.11)
│   ├── map.js                    # map layout, tile lookup
│   ├── stations/                 # one file per station
│   ├── systems/                  # production, economy, workers, couriers, etc.
│   └── content/
│       ├── descriptions.json     # all Look Mode prose
│       └── map_starting.txt      # map layout
├── DESIGN.md                     # SOURCE OF TRUTH — read first
├── CLAUDE.md                     # this file
└── README.md                     # short project description
```

---

## Code Conventions

- **Plain JavaScript modules.** Use `import` / `export` syntax. The browser supports this natively for files served with `type="module"`.
- **No semicolon religion.** Use them; consistency matters more than style.
- **Single state object.** All game state lives on one root object (typically called `state`). Systems are pure-ish functions that take `state` and mutate it. This keeps save/load trivial.
- **Tick-based logic.** All game-time-dependent things happen in tick handlers, in the order specified in DESIGN.md §7.3. Do not add side effects to render functions.
- **Render reads, never writes.** Rendering reads from `state` and produces visual output. It must never modify `state`.
- **Magic numbers go in a `constants.js` file** referenced from a single place, so tuning is fast. Every constant should match a value in DESIGN.md.
- **Comments reference DESIGN.md section numbers** where relevant: `// see DESIGN.md §5.2 for the recipe`.

---

## Working Style With This User

The user has very limited programming experience but strong design instincts and ambition for this project. Adjust your communication accordingly:

- **Explain what you're doing in plain English** when running commands or making non-trivial decisions. Not a tutorial every time, but enough that the user can follow.
- **Show, don't just tell.** When introducing a new concept (a new file, a new pattern, a new tool), briefly explain what it is and why it's used here.
- **Small, playable increments.** Always prefer "build a small thing and let the user run it" over "build three things at once." After each meaningful change, the user should be able to refresh the browser and see the result.
- **Commit after every working change.** Use clear commit messages that reference the task and (where relevant) the DESIGN.md section. Suggest commits proactively; don't wait to be asked.
- **Surface errors clearly.** If something fails, explain what broke and what you're going to try, in language a non-programmer can follow.
- **Never invent design.** If a task needs a decision not in DESIGN.md, stop and ask. Do not silently fill in defaults.

---

## Workflow Per Task

When the user gives you a task:

1. **Confirm scope.** Restate what you understand the task to be in one or two sentences. Reference DESIGN.md sections you'll be working from.
2. **Check DESIGN.md.** Read the relevant sections. If anything is ambiguous or missing, ask before coding.
3. **Plan briefly.** Before writing code, outline the steps in plain English (one or two sentences per step). The user will read this and may correct course.
4. **Implement in small steps.** Write the smallest version that works, run it, then iterate.
5. **Test by running.** Open `index.html` in a browser (or have the user do it) after each change. The user should be playing the game frequently.
6. **Commit.** Stage and commit the change with a clear message.
7. **Hand back to the user.** Summarize what changed and what to look for when they play.

---

## What Not To Do

- **Do not introduce new game mechanics, balance changes, or formulas without DESIGN.md changes first.** Even small ones.
- **Do not refactor opportunistically.** If a refactor would help, suggest it as a separate task; don't bundle it.
- **Do not add features the user didn't ask for.** No "I also added X." If you have an idea, mention it but do not implement.
- **Do not introduce new dependencies** (npm packages, CDN libraries beyond rot.js, etc.) without explicit user approval.
- **Do not skip commits** to "save them up." Each working change is its own commit.
- **Do not assume browser features** beyond standard ES6+ modules, localStorage, and DOM. No service workers, no WebGL, no exotic APIs without discussion.

---

## When the User Hits Trouble

Common situations and how to handle them:

- **Game doesn't load in browser:** ask the user to open the browser's developer console (F12 in most browsers, or right-click → Inspect → Console tab) and share any errors. Diagnose from there.
- **Visual looks wrong:** ask for a screenshot or description. Don't assume; the user is the one with eyes on the screen.
- **Game logic feels off:** check the relevant DESIGN.md section. Is the doc wrong, or is the code wrong? Both are possible. Ask the user which they want to change.
- **Save game broke after a code change:** explain that save schema changes need migration logic (DESIGN.md §8). Offer to write a migration or to bump the schema version and ask the user to start fresh.

---

## Versioning the Doc

When a design decision changes during development:

1. Update DESIGN.md to reflect the new decision.
2. Bump the version (e.g., 1.0 → 1.1) and add a changelog entry.
3. Then, and only then, update the code.
4. Reference both in the commit message: `"§5.4: cost of carry 0.2¢ → 0.15¢ (DESIGN.md v1.2)"`

---

## Current Status

- DESIGN.md is at v0.3, ready to be locked at v1.0 when the user kicks off implementation.
- No code exists yet. The first task will be the visual shell (DESIGN.md §3) — title screen, phase-in transition, 80×50 grid with HUD layout. No game logic in this first pass.
