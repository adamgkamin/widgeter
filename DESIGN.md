# WIDGETER — Design Document

**Version:** 0.3
**Status:** Living document — update before changing code, never the other way around.

---

## 0. How To Use This Document

This document is the source of truth for the game. The rule is:

1. If you want to change behavior, **edit this doc first**, then update the code to match.
2. When prompting Claude Code, **reference section numbers** ("implement section 5.2") so it has no room to improvise math or rules.
3. When something feels wrong in playtesting, **diagnose against this doc**: is the doc wrong, or is the code wrong? Fix the right one.

All numbers in this document are *starting values* meant for tuning. They are exact and authoritative until changed here.

---

## 1. Glossary

Terms used precisely throughout. Do not let them drift.

- **Tick:** the smallest unit of game time. 1 tick = 1 second of real time.
- **Day:** 240 ticks. 180 ticks of "market open" + 60 ticks of "night."
- **Tile:** a single character cell on the 80×50 grid.
- **Glyph:** the character drawn in a tile (`@`, `#`, `T`, etc.).
- **Station:** a multi-tile structure the player interacts with (workbench, market, etc.).
- **Door:** a single tile in a station's wall the player passes through to interact.
- **Widget:** the universal good produced and traded in the game.
- **Raw Material (RM):** the input consumed to produce widgets.
- **Credit:** the in-game currency.
- **Inventory:** items the player carries; capped (starts at 5 widgets).
- **Cost of Carry:** the per-day per-widget cost of holding inventory once storage exists.
- **Look Mode:** the inspection mode triggered by `L`; world pauses, cursor moves freely.
- **Phase:** a major chapter of the game (Phase 1–4); not displayed to player.

---

## 2. Core Fantasy & Four-Phase Arc

The player runs a one-person workshop that grows into a financialized widget empire. Each phase reframes what the game is about.

**Phase 1 — Manual Production (target: 5 minutes).**
The player walks to the raw materials shed, buys materials, walks to the workbench, crafts widgets by pressing space, walks to the market, sells. Limited inventory forces multiple trips. The arithmetic is simple: buy low, sell high, profit. The player feels the friction of physical labor. This phase ends when they unlock automation.

**Phase 2 — Automation (target: 30–45 minutes).**
The player can hire workers and build automated workbenches. Courier robots ferry widgets from production to market. The factory and storage warehouse appear on the map. The player shifts from doing labor to managing it. Production scales massively — and that's exactly when the next problem appears.

**Phase 3 — Market Awareness (target: 45–60 minutes).**
Demand becomes a live thing. Each day, widget demand fluctuates. Overproduction means widgets pile up in storage incurring cost of carry. The market price moves. The player learns to *match production to demand*, not maximize production. This is where Universal Paperclips' "more is always better" assumption gets shattered. The bank appears; loans become possible. Bookkeeping matters.

**Phase 4 — Derivatives (target: 60–90 minutes).**
A derivatives terminal appears. Initially: forwards and futures, framed as hedging. The player learns to lock in tomorrow's price to protect against demand shocks. Then options. Then the realization that speculation pays better than production. The endgame is a financial one — the workshop becomes a vestigial appendage of a trading desk. Win condition: TBD, likely a credit threshold reachable only via successful speculation.

The whole arc is **3–4 hours**. Each phase teaches a concept the next phase subverts.

---

## 3. Visual & UI Spec

### 3.1 Screen Layout (80 columns × 50 rows)

```
Rows  0–42   Game world (43 rows × 80 cols)
Row   43     Status bar (single line: resources, day, time)
Rows  44–48  Event log (5 rows of scrolling text)
Row   49     Command hint line
```

Total: 50 rows. Game area is 43×80 = 3,440 tiles.

### 3.2 Color Palette (8 active colors + dim variants)

| Name           | Hex (target)  | Role |
|----------------|---------------|------|
| BRIGHT_WHITE   | #f0f0f0       | Player `@`, critical UI, cursor |
| DIM_GRAY       | #555555       | Floor `.`, walls `#`, idle stations |
| BRIGHT_ORANGE  | #ff9933       | Active workbench, raw materials |
| BRIGHT_YELLOW  | #ffd633       | Credits, market, gold |
| BRIGHT_GREEN   | #66cc66       | Bank, profit, positive deltas, trees |
| BRIGHT_RED     | #ff5555       | Costs, losses, expired widgets, warnings |
| BRIGHT_CYAN    | #66ccff       | Information, tutorial text, derivatives |
| BRIGHT_MAGENTA | #cc66cc       | Special events, unlocks, narrative beats |

Each bright color has a dim variant at ~40% brightness for inactive states. Trees use a *darker* green than the bank to distinguish foliage from finance.

Background is `#0a0a0a` (near-black, not pure black — softer on eyes).

### 3.3 Title Screen

On launch, the screen shows:

```
W       W IIII DDDD   GGGG  EEEE  TTTT EEEE  RRRR
W       W  II  D  D  G     E      TT  E     R  R
W   W   W  II  D  D  G GG  EEE    TT  EEE   RRRR
W  W W  W  II  D  D  G  G  E      TT  E     R R
 WW   WW  IIII DDDD   GGGG  EEEE   TT  EEEE  R  R


[ press any key to start ]
```

Centering is computed at runtime: `x = floor((80 - maxLineWidth) / 2)`.

Letters in BRIGHT_YELLOW. Subtitle in BRIGHT_CYAN, blinking at 1 Hz.

On any keypress: the **phase-in transition** plays.

### 3.4 Phase-In Transition

Pure cosmetic. Approximately 1.5 seconds.

- Title screen fades to black.
- Game world renders **row by row, top to bottom, left to right**, one column per frame.
- Each tile appears at full color immediately (no fade per tile — speed is the effect).
- Frame rate: ~60 fps. Total render time: 80 cols × 50 rows / 60 fps ≈ 1.3s.
- Status bar and event log render last.
- First log line appears: `> The morning bell has rung.`

### 3.5 Glyph Reference

Game-world glyphs and their canonical colors:

| Glyph | Meaning              | Color           |
|-------|----------------------|-----------------|
| `@`   | Player               | BRIGHT_WHITE    |
| `#`   | Wall (map border, station walls) | DIM_GRAY |
| `.`   | Floor                | DIM_GRAY (very dim, ~25%) |
| `:`   | Path                 | DIM_GRAY (~50%, slightly warm) |
| `T`   | Tree                 | BRIGHT_GREEN (dim variant) |
| `+`   | Station corner       | matches station theme |
| `-`   | Station horizontal wall | matches station theme |
| `|`   | Station vertical wall | matches station theme |

Station theme colors:
- Raw Materials shed: BRIGHT_ORANGE
- Workbench: BRIGHT_ORANGE
- Market: BRIGHT_YELLOW
- Office: DIM_GRAY frame, BRIGHT_WHITE accents (active from start, but most skill-tree nodes locked)
- Bank (Phase 3): BRIGHT_GREEN
- Factory (Phase 2): DIM_GRAY frame, BRIGHT_ORANGE accents
- Storage Warehouse (Phase 2): DIM_GRAY frame, BRIGHT_CYAN accents
- Derivatives Terminal (Phase 4): BRIGHT_MAGENTA

Station interior letters (the `RM`, `WB`, `MKT`, `BNK`, `OFC` labels) are always brighter than their walls.

**Locked vs. unlocked stations.** All stations in the game are present on the map from the very first frame after the phase-in transition. Stations that are not yet usable are rendered entirely in DIM_GRAY ("dusty"), regardless of their eventual theme color. When a station unlocks, three things happen in order:

1. An animated path-build (~1 tile per frame, ~30 fps) runs from the existing path network to the station's door.
2. The station's tiles transition from DIM_GRAY to its theme colors over ~1 second (smooth color interpolation, not instant).
3. A narrative log line announces the unlock in BRIGHT_MAGENTA.

The Office is a special case: its frame is dim from start (because most of its skill-tree nodes are locked), but it is *interactable* from start — the player can walk in and see what's locked. It does not "unlock" as a phase event; instead, individual nodes inside it unlock as credit thresholds are crossed.

### 3.6 House Anatomy

Stations are little houses. Smallest form is 4 wide × 3 tall:

```
+--+
|WB|
+--+
```

The interior is the label (`WB`, `RM`, `MKT`, `BNK`). The frame is `+`/`-`/`|`. There is a **door tile** — one wall segment is replaced with `.` to mark the entrance:

```
+--+
|WB|
+.-+
```

The player walks onto the door tile or stands adjacent to any station tile and presses Space to interact.

When a station is **active** (e.g., workbench currently crafting): the interior letters glow BRIGHT_WHITE for one tick and a small accent appears (like `+--+` becoming `+~~+` briefly).

When a station is **closed** (e.g., market at night): the entire frame and label dim to ~30% brightness.

### 3.7 Status Bar (Row 43)

Single line, separated by spaces. Reads left-to-right:

```
Credits: 0    Raw: 0    Widgets: 0/5    Day 1    [== market open 142s ==]
```

- **Credits**: BRIGHT_YELLOW.
- **Raw**: BRIGHT_ORANGE.
- **Widgets**: BRIGHT_WHITE; `current/max`; turns BRIGHT_RED when full.
- **Day**: BRIGHT_WHITE.
- **Time indicator**: a 12-character bar that fills from `[============]` → empty as the day progresses. BRIGHT_YELLOW during market open, BRIGHT_MAGENTA during night. Text after the bar shows the phase and seconds remaining.

### 3.8 Event Log (Rows 44–48)

5 lines. Newest message at bottom, oldest scrolls off the top. Each line prefixed with `> `.

Color rules:
- Tutorial / informational: BRIGHT_CYAN
- Money in: BRIGHT_GREEN
- Money out: BRIGHT_RED
- Narrative / unlock: BRIGHT_MAGENTA
- Default: BRIGHT_WHITE

When in **Look Mode**, the event log is replaced with the description of the tile under the cursor (see §3.10).

### 3.9 Command Hint Line (Row 49)

Always visible, shows current available commands. Adapts to context.

Default:
```
[arrows: move]  [space: interact]  [i: inventory]  [L: look]  [?: help]
```

In Look Mode:
```
[arrows: move cursor]  [L or Esc: exit look]
```

Inventory open:
```
[arrows: select]  [enter: use]  [esc: close]
```

### 3.10 Look Mode

Triggered by `L`. While active:

- World ticks **pause completely**. Day timer halts. Production halts. Markets freeze.
- A blinking cursor appears, initially on the player's tile. Cursor visual: the tile's foreground/background colors invert at 2 Hz (toggle every 0.5s).
- Arrow keys move the cursor anywhere on the 80×50 grid (including off the map area onto the HUD if you want — but easier to clamp it to rows 0–42).
- The event log area (rows 44–48) is replaced with the description of the tile under the cursor. Description text in BRIGHT_CYAN, with the tile's glyph rendered in its native color at the start of the description.
- Press `L` or `Esc` to exit. World resumes from the exact tick it paused on.

### 3.11 Look Mode Description System

See §6 for the full description architecture. Briefly: descriptions are layered (glyph default → variant pool → coordinate-specific override → station-specific → dynamic state). Lookup order is most-specific-wins.

Description length guidelines:
- Floor tiles: 4–10 words. Atmospheric, brief. ("Scuffed boards. A bent nail.")
- Path tiles: 4–10 words.
- Trees: 1–2 sentences.
- Walls: 1 sentence.
- Station tiles: 2–3 sentences, often referencing function or state.
- Hand-authored special tiles: up to ~3 sentences.

Approximately **5% of descriptions** should plant subtle hints about future phases ("a worn ledger with figures crossed out", "a posted notice about market hours", "a flier for a courier service that doesn't exist yet"). See §6.4.

---

## 4. Map Spec

### 4.1 Dimensions

Game world is **80 columns × 43 rows** (rows 0–42 of the screen). Outer ring (row 0, row 42, col 0, col 79) is wall `#`.

### 4.2 Starting Map

**All stations are present on the map from the first frame.** Stations not yet unlocked are rendered in DIM_GRAY ("dusty") and reject most interactions (see §3.5 and §6.7). Paths exist only between *unlocked* stations; locked stations have no path connection until unlock.

The map at game start contains:

- **Player spawn** at approximately (15, 14): central crossroads.
- **Raw Materials shed** (active, colored): upper-left, around (10, 3). 4×3 footprint. Door faces south.
- **Workbench** (active, colored): center, around (35, 9). 4×3 footprint. Door faces south.
- **Market** (active, colored): bottom-right, around (62, 24). 4×3 footprint. Door faces west.
- **Office** (active but mostly locked, dim frame with bright label): around (24, 18). 5×4 footprint (slightly larger — has interior to step into). Door faces north.
- **Factory** (locked, dusty): lower-left quadrant, around (12, 32). 8×5 footprint (larger — holds up to 5 auto-workbench slots). Door faces east.
- **Storage Warehouse** (locked, dusty): lower-left quadrant, around (24, 33). 6×4 footprint. Door faces north.
- **Bank** (locked, dusty): upper-right quadrant, around (62, 5). 4×3 footprint. Door faces south.
- **Derivatives Terminal** (locked, dusty): center-right, around (58, 17). 5×4 footprint. Door faces west.
- **Path network** (`:`) connecting only the three Phase 1 active stations and the Office to the player's spawn crossroads. New path branches animate-build to each station as it unlocks.
- **Trees** (`T`) scattered across the map. Density: ~8% of non-station, non-path tiles. Denser near the map borders, sparser near paths. Cannot spawn on station footprints (including locked ones) or future path corridors.

Exact coordinates and the full ASCII layout are in `map_starting.txt` (to be created alongside the code). The doc reference is canonical for *positions of interactive elements*; the .txt file is canonical for the precise placement of every tree and path tile.

### 4.3 Unlock Animation

When a station unlocks (whether via Phase trigger or skill-tree purchase that requires it):

1. **Path build:** path tiles spawn one per frame at ~30 fps from the nearest existing path tile to the station's door. Path takes orthogonal route, prefers existing path tiles where possible.
2. **Color transition:** the station's tiles smoothly interpolate from DIM_GRAY to their theme colors over ~1 second.
3. **Log announcement:** a BRIGHT_MAGENTA log line ("**The Bank's doors are open. Enter at your own risk.**" or similar — narrative beats per §11).

### 4.4 Paths

Path glyph is `:`. Paths are 1 tile wide. They run orthogonally (no diagonals). Where two paths meet, the intersection tile is also `:` — paths simply cross. Animated builds use the same glyph; there is no special "under construction" marker.

### 4.5 Trees

Tree glyph is `T`. Trees are non-blocking (the player walks through them) — this is permanent, not a Phase 1 affordance. They cannot spawn on path tiles, current or future station tiles, future path corridors, or the wall border. Tree placement is deterministic from a seed (so the map is the same every game) — the seed is hardcoded for now (`seed = 42`).

Each tree tile has a unique-feeling description picked from a pool of ~30 variants (see §6.2), keyed by `(x, y)` so the tree at (52, 8) always says the same thing.

---

## 5. Resources, Stations, and Formulas

This is the heart of the doc. Every formula is exact and authoritative.

### 5.1 Resources

| Resource       | Symbol | Color         | Notes |
|----------------|--------|---------------|-------|
| Credits        | $      | BRIGHT_YELLOW | Currency. Starts at 0. |
| Raw Materials  | RM     | BRIGHT_ORANGE | Input. Player carries them; later, factories store them. |
| Widgets        | WG     | BRIGHT_WHITE  | Output. Player carries them; later, storage warehouse holds them. |

### 5.2 Phase 1 Formulas

**Starting state:**
- Credits: **10** (a small starting grant; first log line acknowledges it).
- Raw Materials in inventory: 0.
- Widgets in inventory: 0.
- Inventory caps: **5 widgets, 5 raw materials** (separate caps).

**Raw Materials shed (RM station) — buying:**
- Cost per RM: **3 credits**.
- Action: walk to door, press space, menu opens:
  - "Buy 1 RM (3¢)"
  - "Buy max" — buys as many as fit in inventory and budget allows
  - "Buy custom amount" — opens a numeric prompt
  - "Cancel"
- RM purchased goes into player inventory. Fails if inventory full or insufficient credits.

**Workbench (WB station) — crafting:**
- Recipe: **1 RM → 1 widget**.
- Crafting time: **3 ticks (3 seconds) per widget**.
- Action: walk to door, press space, menu opens:
  - "Craft 1"
  - "Craft max" — crafts until RM exhausted or widget inventory full
  - "Craft custom amount"
  - "Cancel"
- **Crafting locks the player at the workbench** for the full duration. This is intentional pedagogy: feeling the time-cost of manual labor is what motivates Phase 2 automation. The workbench glyph pulses BRIGHT_WHITE on each tick of progress. Time continues to pass normally everywhere else (market open/close, day timer, etc.).
- Player can cancel mid-craft by pressing Escape; in-progress widget is forfeited (RM is consumed but no widget produced) — discourages cancel-spam.
- Widget appears in player inventory when each individual widget completes. Fails if widget inventory becomes full mid-batch (remaining RM stays in inventory).

**Market (MKT station) — selling (Phase 1 only):**
- Sale price per widget: **8 credits** (flat, no demand variation in Phase 1).
- Action: walk to door, press space, menu:
  - "Sell 1 (+8¢)"
  - "Sell max" — sells all widgets in inventory
  - "Sell custom amount"
  - "Cancel"
- Market is open during ticks 0–179 of each day; closed during ticks 180–239.
- If player tries to sell while closed: "The market is shuttered. The bell rings at dawn."

**Phase 1 economics:**
- Margin per widget: 8 - 3 = **5 credits**.
- Time per full cycle (5-widget batch): walk to RM (~5s) + buy max (~1s) + walk to WB (~6s) + craft 5 widgets (15s, locked) + walk to MKT (~7s) + sell max (~1s) ≈ **35 seconds** for 5 widgets = **7s/widget effective**.
- Per-day max manual income (180s open): ~25 widgets × 5¢ = **~125 credits/day**.

These numbers are tuned so that Phase 2 unlock at 200 cumulative credits earned takes roughly 4–5 minutes of active play.

### 5.3 Phase 2 Formulas (Automation)

**Trigger:** player has earned **≥200 credits cumulative** (lifetime gross income, not current balance).

**Unlock event:** narrative log line appears in BRIGHT_MAGENTA. The Factory and Storage Warehouse buildings color-in from gray, animated paths build to each. Office contents (most skill-tree nodes) progressively unlock as further credit thresholds are crossed.

**The Office (OFC station):**
- Visible and enterable from game start. Most nodes locked initially.
- Skill tree menu opens on interaction. Nodes are purchased with credits.
- Categories: **Hiring**, **Capital Equipment**, **Workers** (carry/speed upgrades), **Couriers** (carry/speed upgrades), **Market Intelligence** (Phase 3+), **Trading** (Phase 4+).
- Phase 2 nodes:
  - **Hire Apprentice** (50¢, repeatable up to 3): see worker spec below.
  - **Build Auto-Workbench** (75¢, repeatable up to 5; requires Factory built): see equipment spec below.
  - **Build Factory** (free at Phase 2 trigger): unlocks the Factory station and color-in.
  - **Hire Courier Robot** (30¢, repeatable up to 4): see courier spec below.
  - **Worker Carry +1** (40¢, repeatable up to 12 times): each level adds 1 to apprentice carry capacity.
  - **Worker Speed +0.25** (60¢, repeatable up to 6 times): each level adds 0.25 tiles/tick to apprentice speed.
  - **Courier Carry +5** (80¢, repeatable up to 8 times): each level adds 5 to courier capacity.
  - **Courier Speed +0.5** (100¢, repeatable up to 4 times): each level adds 0.5 tiles/tick to courier speed.

**Apprentice worker:**
- Spawns at the Office on hire, walks to workbench.
- **Job role:** handles RM→WB→Craft loop. Walks to RM shed, buys RM (using shared credit pool), walks to workbench, crafts, deposits widget at the workbench (which has a soft cap of 20 — see below). Does **not** sell at market — that's couriers' job.
- Starting carry: **3 RM or widgets**. Max upgrade via skill tree: **15**.
- Starting speed: **1 tile/tick** (one tile per second). Max upgrade: **2 tiles/tick**.
- Crafting time: same as player (3 ticks/widget).
- Max apprentices: 3 initially, additional slots unlockable later via skill tree.
- Task assignment: **FIFO by default** (workbench requests RM → next idle apprentice goes to fetch). Player can override per-apprentice via Office menu: assign specific apprentice to specific workbench, or pin to a role (RM-fetcher only, etc.).

**Auto-Workbench (capital equipment):**
- Installed in the Factory. Up to 5 slots in the base Factory. Each slot holds one auto-workbench unit.
- Crafts autonomously: **1 widget per 4 ticks** when supplied with RM.
- Pulls RM from the **Storage Warehouse** (not from player inventory). Apprentices or couriers must have stocked storage first.
- Output goes to Storage Warehouse, not to a soft cap.
- **No worker needed** — the auto-workbench runs as long as RM is available and storage has space for output.

**Workbench widget cap (Phase 2 only, before Storage exists):**
- The workbench has a **soft cap of 20 widgets** held at the bench itself.
- Apprentices deposit crafted widgets at the workbench until the cap is reached.
- When cap is reached, the workbench refuses further crafting until widgets are removed (by player carrying them to market or, once available, by courier pickup).
- This creates the "I need a courier" pressure point.
- Once the **Storage Warehouse** is built, the workbench cap is removed; widgets flow to storage.

**Courier robot:**
- Spawns at the Office on hire, walks to a "courier dispatch" point (the Storage Warehouse door once it exists, otherwise the Workbench door).
- **Job role:** ferries widgets from production sites (Workbench, Factory) to the Market. Sells at market on arrival. Returns empty.
- Starting carry: **10 widgets**. Max upgrade: **50**.
- Starting speed: **1 tile/tick**. Max upgrade: **3 tiles/tick**.
- Round trip time at base stats: ~30 seconds.
- Max couriers: 4 initially, additional slots unlockable later.
- Routing: **hand-coded routes** (Workbench→Market, Storage→Market, Factory→Storage, etc.). No A* pathfinding. This is a deliberate performance choice — see §10.

**Storage Warehouse:**
- Color-ins automatically at Phase 2 trigger (no separate purchase).
- Holds up to **50 widgets and 50 RM** (Phase 2 cap; expandable in Phase 3 via skill tree).
- No cost of carry yet (introduced at Phase 3).

**Factory:**
- Color-ins automatically at Phase 2 trigger; specific auto-workbench installations are still individually purchased.
- The Factory is a **container building**: up to 5 auto-workbench slots inside. Each slot has a position; the building visually shows occupancy (filled slots glow BRIGHT_ORANGE, empty slots dim).
- Once all 5 slots filled, a small visual flourish on the building (subtle pulse, brighter color).

**Production cap in Phase 2:**
- RM purchase cap removed — daily demand `D` is the sole production throttle. See §5.4 for demand model.

**Goal of Phase 2:** scale to ~50–100 widgets sold per day. This makes credits accumulate fast enough to feel powerful. Then Phase 3 punishes that scale.

### 5.4 Phase 3 Formulas (Market Awareness)

**Trigger:** player has owned ≥1 courier robot for at least 1 in-game day, AND total credits earned ≥500.

**Unlock event:** Bank station color-ins from gray with animated path-build. Notice in event log: "**The Widget Exchange has begun publishing daily demand reports.**" The market price ceases to be flat 8¢.

**Daily demand model (deferred to playtest — both formulas on the table):**
- Each day at dawn (tick 0), demand `D` is drawn for the day.
- `D = round(50 + 30 × sin(day / 7 × 2π) + N(0, 10))` — a weekly sine wave plus Gaussian noise. Min clamped at 5.
- **Pricing — Option A:** `P_today = 8 × (D / 50)^0.5` — price rises when demand rises. At D=50, P=8. At D=100, P≈11.3. At D=20, P≈5.1.
- **Pricing — Option B:** `P_today = 8 × (50 / D)^0.5` — inverse: price rises when demand is low (scarcity). At D=50, P=8. At D=20, P≈12.6. At D=100, P≈5.7.
- **Decision deferred:** to be picked in playtest. Option A is more intuitive (high demand = high price); Option B creates more interesting trading dynamics (the player wants to *withhold* widgets when demand is low). Implementation should make this a swappable function.

**Daily demand cap:**
- Only `D` widgets can be sold per day. Beyond that, the market refuses purchases for the day.
- Excess widgets remain in storage, incurring **cost of carry**.

**Storage-full behavior (the auto-halt rule):**
- When the Storage Warehouse reaches its widget cap, **all auto-workbenches and apprentices halt production**. Each halted unit shows a small visual indicator (dim red glow at its slot or sprite).
- This is the default. The lesson of Phase 3 is "match production to demand."
- Skill-tree upgrade (Phase 3+, Office, **Market Discount Dump — 250¢**): unlocks a setting where, instead of halting, full storage triggers a *discount dump* at the market — widgets above storage cap auto-sell at **50% of P_today**. Always clears, but at a cost. This is a financial-sophistication unlock.

**Cost of carry:**
- Per-widget per-day storage cost: **0.2 credits**.
- Calculated and deducted at the *end* of each day (during night phase, at tick 239).
- If end-of-day credits would go negative from cost of carry alone: deficit is tracked as **debt**. Debt accumulates day over day. See Bankruptcy below.

**Bank (BNK station):**
- Color-ins at Phase 3 trigger.
- Functions:
  - **Deposit:** earn **0.5% per day interest** on deposited balance, compounded daily at tick 239. Deposited credits are safe from negative-balance situations (separate from operating balance).
  - **Withdraw:** instant.
  - **Take loan:** borrow up to (lifetime credits earned × 0.5). Interest: **1% per day**, accrues daily at tick 239. Loans have a **deadline of 20 days from origination** to repay in full.
  - **Refinance loan:** if a loan is approaching deadline (within 5 days), the player can refinance it at a higher rate (**1.5% per day**, new 20-day deadline). Refinancing is repeatable but the rate climbs (+0.5% per refinance, capped at 5% per day).
  - **Declare bankruptcy:** ends the game in a Game Over state. Triggered manually by player, or automatically if (a) credits go negative AND no widgets to sell AND no deposit balance AND a loan is overdue, OR (b) the player is unable to make any productive action for 5 consecutive days.

**Bankruptcy is only reachable in Phase 3+** (no loans exist before then). Game Over screen shows: total widgets produced, total credits earned, days survived, peak net worth, and a flavor-text epitaph.

**Phase 3 skill-tree unlocks (in the Office):**
- **Demand History Chart** (50¢): adds a chart panel to the Market interaction showing the last 14 days of demand and price.
- **Market Discount Dump** (250¢): see above.
- **Storage Expansion I** (200¢): Storage Warehouse cap +50 widgets, +50 RM.
- **Storage Expansion II** (500¢): another +100 each.
- **Reduced Cost of Carry** (300¢): cost of carry drops from 0.2¢ to 0.1¢ per widget per day.

### 5.5 Phase 4 Formulas (Derivatives)

**Trigger:** player has experienced at least one "demand crash" (a day where `D < 20`) **OR** has total credits ≥ 2,000.

**Unlock event:** Derivatives Terminal color-ins. A stranger appears at the market for one day with a narrative beat: "**A man in a clean suit offers you a contract.**" Phase 4 begins.

**Forward contract:**
- Lock in tomorrow's selling price for a specified quantity.
- No premium, just a binding commitment.
- Settles at end of next day at the locked price, regardless of actual market price.
- If the player can't deliver the agreed quantity, they pay the difference at *next day's* price.

**Futures contract:**
- Standardized lot size: 10 widgets per contract.
- Tradable: can be closed out (sold to another notional buyer at current market) before expiry.
- Daily mark-to-market: unrealized gains/losses settle to the player's credits each day at tick 239.
- Initial margin requirement: 20% of contract notional. Maintenance margin: 10%. Margin call if balance falls below — player must deposit or close positions.

**Options — simplified pricing model:**

`Premium = max(intrinsic_value, 0) + time_value`

Where:
- `intrinsic_value` for a call = `max(spot_price - strike, 0)`; for a put = `max(strike - spot_price, 0)`.
- `time_value = base_volatility × sqrt(days_to_expiry) × spot_price × 0.1`
- `base_volatility` is a measured value from the last 14 days of price history (standard deviation of daily returns), with a floor of 0.1 and ceiling of 0.5.

This is a heuristic, not Black-Scholes. It captures the right intuitions (longer expiry = more premium; volatile market = more premium; in-the-money options cost intrinsic + time) without requiring `N(d1)` calculations.

- **Call option:** right (not obligation) to buy widgets at strike price `K` on expiry day `T`. Available expiries: 1, 3, 7, 14 days.
- **Put option:** right to sell at strike. Same expiries.
- Player can both **buy** options (cost: premium upfront) and **write/sell** options (receive premium upfront, take on obligation). Writing exposes the player to unlimited risk on the upside (calls) / downside-to-zero (puts) — and if positions move against the player, margin calls apply.

**Speculation:**
- Phase 4 progressively decouples the market from production. The player can take positions far exceeding their actual widget output. PnL becomes the primary credit source.
- The Derivatives Terminal interaction opens a **trading interface** (sub-menu): price chart, current positions panel, available instruments. Updates in real-time.

**Phase 4 skill-tree unlocks (in the Office, Trading category):**
- **Forward Contracts** (free at Phase 4 trigger).
- **Futures Trading** (1,000¢): unlocks futures.
- **Options — Buy Side** (2,500¢): unlocks buying calls and puts.
- **Options — Write Side** (5,000¢): unlocks writing (selling) options. Higher capital requirements.
- **7-Day Forecast** (1,500¢, Market Intelligence): shows next 7 days of *expected* demand with confidence bands. Noise still applies — forecast is not a guarantee.
- **Volatility Surface** (3,000¢): visualizes implied vs. realized volatility. Useful for spotting mispriced options.
- **Increased Margin** (varies): each level reduces margin requirements by 2% (down to a floor).

**Win/Loss condition:**
- **Win condition: deferred until Phase 4 is playable.** Current leading candidate: **Abstraction Collapse Ending** (see §9). The player's financial scale becomes so large that the credit system breaks down — the game transitions to a final phase where everything is denominated in widgets-as-units, and a final narrative beat closes the game.
- **Loss condition: bankruptcy** (defined in §5.4). Available from Phase 3 onward.

---

## 6. Description System (Look Mode Content)

### 6.1 Architecture

Descriptions are looked up in this priority order, most-specific first:

1. **Coordinate-specific override** (`tiles[x,y]`)
2. **Station-specific** (if tile belongs to a station)
3. **Glyph variant** (deterministic pick from variant pool, hashed by coords)
4. **Glyph default**

The first hit wins. Stored in `descriptions.json`.

### 6.2 Variant Pools

Each common glyph has a variant pool. Pick is deterministic: `pool[hash(x, y) % len(pool)]`. Same tile always returns same description.

**Tree (T) pool — target 30+ entries.** Examples:
- "An old oak. Initials are carved into it, worn too smooth from time to read."
- "A young birch, its bark peeling in long curls."
- "A dead pine. A crow watches from the highest branch."
- "An apple tree, fruitless this season."
- "A tree with a small shrine at its base. The offerings are long rotten."
- "A tree with a frayed rope swing. No one has used it in years."
- "A maple. Sap drips slowly into a tin can someone left."
- "A tree split by lightning years ago, still standing."
- "A pine sapling, planted recently."
- "A gnarled tree growing at an unsettling angle."
- (~20 more to be written.)

**Floor (.) pool — target 25+ entries. Short, atmospheric.**
- "Scuffed boards."
- "A bent nail, half-buried."
- "Sawdust, old."
- "A faint chalk line."
- "A coin-shaped stain."
- "Boot prints, going somewhere."
- "Splinters, swept aside."
- "A pressed flower, dried."
- (~17 more.)

**Path (:) pool — target 20+ entries.**
- "A worn footpath."
- "Two ruts, parallel."
- "A flat stone someone laid here."
- "Loose gravel."
- "A puddle, dry now."
- (~15 more.)

**Wall (#) pool — target 15+ entries.**
- "A weather-stained boundary wall."
- "Stone, mossed."
- "Bricks, mismatched."
- (~12 more.)

### 6.3 Hand-Authored Special Tiles

At least 20 specific tiles get bespoke descriptions, scattered across the map. To be filled in during development. Examples:

- A specific tree where you carved your initials as a child.
- A floor tile with a dark stain that "isn't paint."
- A wall section with graffiti listing a stranger's accomplishments.
- A path tile where someone dropped a coin years ago — too worn to identify.

### 6.4 Foreshadowing Hints (~5% of descriptions)

Scattered through variant pools and special tiles, descriptions that hint at future phases. Examples:

- (Phase 2 hint) "A flier nailed to the wall: 'COURIER SERVICES — INQUIRE WITHIN.' No one is within."
- (Phase 3 hint) "A worn ledger lies open on the floor. Figures are scrawled in the margins, half crossed out."
- (Phase 3 hint) "A poster: 'WIDGET DEMAND REPORT — EFFECTIVE [DATE SMUDGED].'"
- (Phase 4 hint) "A pamphlet: 'HEDGING FOR THE MODERN ARTISAN.' The pages are dog-eared."
- (Phase 4 hint) "Someone has drawn a rough chart on the wall. The line goes up, then violently down."

Roughly 1 in 20 tiles should have something like this. Players who Look around will feel the world deepening as the game progresses.

### 6.5 Station Tile Descriptions

Each station's tiles get specific descriptions. Examples for the Workbench:

- Door tile (`.`): "The workbench entrance. A bell hangs above the doorway, silent for now."
- Interior label `W`: "A scarred wooden workbench. This is where you craft widgets. Press space when adjacent."
- Interior label `B`: "Tools hang above the bench: a hammer, a punch, three things you don't recognize."
- Wall (`+` corner): "The northwest corner of the workbench shed. A spider has claimed it."
- Wall (`-` top): "The shed's roof beam. A cobweb catches the light."
- Wall (`|` side): "Pegboard. Hooks empty where tools should be."

Each station's full description set lives in `descriptions.json` under `stations.<station_name>.<tile_role>`.

### 6.6 Dynamic State in Descriptions

Some station tiles reference live game state. Format: descriptions can include `{placeholders}` resolved at render time.

Example for Market interior:
- Open: "The market floor. Today's widget price: {market.price}¢. Demand: {market.demand_label}."
- Closed: "The market floor. Empty. The bell will ring at dawn — {time.until_dawn}s."

`market.demand_label` resolves to "high" / "average" / "weak" / "collapsed" depending on `D`.

### 6.7 Locked Station Teasers

When a station is in its DIM_GRAY ("dusty/locked") state and the player presses space adjacent to it or attempts to enter, a teaser message appears in the event log (BRIGHT_CYAN) instead of opening a menu. Each teaser hints at the station's eventual function without explaining mechanics.

- **Office (initially has unlocked + locked nodes mixed):** "A small office with a cork board. A few notices are pinned up; many empty pins suggest more to come."
- **Factory:** "A cavernous building, dusty. Empty machine mounts line the floor. Through a window, you see a sign: 'CAPACITY: 5 UNITS.'"
- **Storage Warehouse:** "A warehouse, padlocked. Through the slats you can see empty pallets and a hand truck."
- **Bank:** "Through the dusty window, you see a polished counter and a sign: 'NO INTEREST WITHOUT DEPOSIT.' The door is locked."
- **Derivatives Terminal:** "A glass-fronted building with screens displaying numbers you don't yet understand. The door is locked. A small plaque reads: 'AUTHORIZED PERSONNEL ONLY.'"

These same teasers also appear in Look Mode when the cursor hovers a locked station tile, replacing the usual station description.

The Office is special: it is *interactable* from start (so its teaser only fires for nodes inside it that are locked, displayed inline in the skill-tree menu), but its frame is rendered dim until enough nodes have been purchased.

---

## 7. Tick & Time Model

### 7.1 Tick

1 tick = 1 second of real time. The game runs a tick loop at 1 Hz (driven by `setInterval` or equivalent).

### 7.2 Day Structure

A day is **240 ticks**.

- **Ticks 0–179: Market Open.** Sales possible. Production runs. Couriers operate.
- **Ticks 180–239: Night.** Market closed. Production continues. Cost of carry calculated at tick 239 (last tick before next day). Day counter increments at tick 0 of next day.

### 7.3 Per-Tick Operations (Order Matters)

Each tick, in this exact order:

1. **Pause check.** If Look Mode is active, skip everything below.
2. **Player action resolution.** If player issued a movement or interaction this tick, resolve it.
3. **Station updates.** Workbenches advance crafting timers. Auto-workbenches produce. Couriers advance position.
4. **Worker AI.** Apprentices act.
5. **Market updates.** If end of day window crossed, transition open↔closed. If new day, recalculate `D` and `P_today`.
6. **End-of-day calculations.** At tick 239: cost of carry deducted, interest applied, derivative settlements processed.
7. **Render.** Repaint changed tiles.

### 7.4 Save Cadence

Auto-save to localStorage every 10 ticks AND on every day rollover.

---

## 8. Save Format

JSON object stored under localStorage key `widgeter.save.v1`.

```
{
  "version": 1,
  "schema": 1,
  "tick": 0,
  "day": 1,
  "player": {
    "x": 15, "y": 14,
    "credits": 10,
    "inventory": { "rm": 0, "widgets": 0 },
    "inventory_caps": { "rm": 5, "widgets": 5 },
    "steps_walked": 0
  },
  "stations": {
    "raw_materials":      { "id": "RM",  "x": 10, "y": 3,  "unlocked": true,  "active": true },
    "workbench":          { "id": "WB",  "x": 35, "y": 9,  "unlocked": true,  "active": true, "crafting_progress": 0, "widgets_held": 0 },
    "market":             { "id": "MKT", "x": 62, "y": 24, "unlocked": true,  "active": true, "open": true },
    "office":             { "id": "OFC", "x": 24, "y": 18, "unlocked": true,  "active": true, "skills": {} },
    "factory":            { "id": "FAC", "x": 12, "y": 32, "unlocked": false, "auto_workbenches": [] },
    "storage_warehouse":  { "id": "STG", "x": 24, "y": 33, "unlocked": false, "widgets": 0, "rm": 0 },
    "bank":               { "id": "BNK", "x": 62, "y": 5,  "unlocked": false, "deposit": 0, "loans": [] },
    "derivatives_terminal":{ "id": "DRV", "x": 58, "y": 17, "unlocked": false, "positions": [] }
  },
  "workers": { "apprentices": [], "couriers": [] },
  "phase": 1,
  "lifetime_credits_earned": 0,
  "demand_history": [],
  "log": [ /* last 50 lines */ ],
  "rng_seed": 42
}
```

Save schema is versioned. If schema changes between versions, a migration function bumps old saves forward. Saves with a higher version than the running game are rejected with a "this save is from a newer version" error.

---

## 9. Open Questions (To Resolve Before Implementation)

These are decisions deliberately not made yet. Each should be answered before the relevant phase is built.

1. **Win condition (the ending).** Leading candidate: **Abstraction Collapse Ending**. The player's financial scale grows so large that credits cease to be meaningful. The game transitions to a final phase where everything is denominated in widgets-as-units, then in something more abstract still (positions? contracts? raw market influence?). A final narrative beat closes the game. Loss condition (bankruptcy) is already defined. Confirm or revise once Phase 4 is playable.
2. **Pricing formula (Option A vs. Option B in §5.4).** Implement as a swappable function; pick during playtest.
3. **Sound design specifics.** Hooks defined (§12); actual audio assets and triggers to be tuned later by the player (you).
4. **Number tuning across all phases.** Every constant in this doc is a starting value subject to playtest revision. Track in changelog.
   - **Rocket widget target (Phase 5):** 50,000 widgets. Target is 50,000 widgets — tunable after playtesting. At max production (~6.25 widgets/second) this takes roughly 2 hours of active rocket-loading, which is the intended endgame session length.

---

## 10. File Layout (Target)

```
widgeter/
├── index.html              # Loads game
├── styles.css              # CRT effect, layout
├── main.js                 # Entry point, tick loop
├── src/
│   ├── state.js            # Game state object + save/load
│   ├── render.js           # rot.js rendering
│   ├── input.js            # Keyboard handling
│   ├── look.js             # Look Mode
│   ├── map.js              # Map layout, tile lookup
│   ├── stations/
│   │   ├── workbench.js
│   │   ├── market.js
│   │   ├── raw_materials.js
│   │   ├── office.js       # skill tree menu
│   │   ├── factory.js      # auto-workbench container
│   │   ├── storage.js
│   │   ├── bank.js
│   │   └── derivatives.js
│   ├── systems/
│   │   ├── production.js
│   │   ├── economy.js
│   │   ├── workers.js      # apprentice AI
│   │   ├── couriers.js     # hand-coded route system
│   │   ├── demand.js       # daily demand model
│   │   ├── derivatives.js  # forwards, futures, options
│   │   ├── ambient.js      # flavor events (§13)
│   │   └── unlocks.js      # phase triggers, color-in animations
│   └── content/
│       ├── descriptions.json
│       └── map_starting.txt
├── DESIGN.md               # This document
├── CLAUDE.md               # Conventions for Claude Code
└── README.md
```

**Performance notes (especially for Phase 2+):**
- Couriers and apprentices use **hand-coded routes**, not A* pathfinding. Routes are precomputed lookup tables: source-station → destination-station → list-of-tiles. Recomputed only when the path network changes (e.g., a station unlocks). This keeps per-tick cost O(workers), not O(workers × pathfinding).
- Render only changed tiles per tick, not the full grid. rot.js supports this natively.
- Tick loop must complete in well under 1 second worth of work even with full automation; if profiling shows otherwise, batch worker decisions across ticks.

---

## 11. Versioning of This Document

Bump the version at the top of this file when meaningful changes are made:

- **0.x:** pre-implementation drafts.
- **1.0:** locked at start of code work.
- **1.x:** changes during development. Document each change in a changelog at the bottom of this file.

### Changelog

- **0.3** — corrected title screen ASCII art: the W was rendered with peaks at top and points in the middle, which read as M. Redrew with proper W shape (wide top, points at bottom). Apprentice base speed raised from 0.5 to 1.0 tiles/tick. Loan deadline shortened from 30 to 20 days; refinance window unchanged at 5 days. Phase 4 trigger relaxed from AND to OR (demand crash OR ≥2,000 credits, whichever comes first). Ambient flavor event cadence changed from "every ~30s with jitter" to "uniform random 30–120s between lines."
- **0.2** — typo fix on title screen (WIDGETER, not MIDGETER). All stations now present from game start in DIM_GRAY ("dusty"), color-in on unlock with animated path-build. Added Office station with skill-tree menu, present from start. Phase 2 trigger raised from 100 to 200 cumulative credits earned. Buy/sell/craft menus updated to "1 / max / custom / cancel". Crafting lock-in confirmed as intentional pedagogy with cancel-forfeit rule. Apprentice/courier role split locked: apprentices handle RM→WB→Craft, couriers handle WB/Storage→MKT. Workbench soft cap of 20 widgets before storage. Factory specced as 5-slot container for auto-workbenches. Phase 3 storage-full default = auto-halt; "Market Discount Dump" added as later skill. Bankruptcy specced as Game Over state, only reachable Phase 3+. Loan refinance mechanic added. Options pricing simplified to intrinsic + time_value heuristic. Win condition leaning toward Abstraction Collapse Ending; deferred until Phase 4 playable. Locked station teaser descriptions added (§6.7). Performance notes added (§10). Added §12 (Sound), §13 (Ambient Flavor Events).
- **0.1** (initial) — created. All Phase 1 specs locked. Phase 2–4 outlined; details to be filled in before each is built.

---

## 12. Sound

Hooks only — actual audio integration handled later by the project owner.

**Triggers (place hooks in code, even before assets exist):**
- **UI tick:** soft 8-bit tick on every menu navigation, button press, and confirmation. Volume: very low. Should never be grating.
- **Game-start jingle:** brief musical sting (~1.5 seconds) plays once when the player presses a key on the title screen, overlapping with the phase-in transition.
- **Market-open bell:** soft bell tone at the start of each day (tick 0). Quieter than the UI tick.
- **Unlock fanfare (later):** brief musical phrase when a phase unlocks. Specific trigger TBD.
- **Bankruptcy:** somber tone. One-shot.

**Settings:**
- Master mute toggle (key: `M`).
- Saved to localStorage under `widgeter.audio.muted`.
- Default: **unmuted**, low volume.

All audio cues should be **non-grating, sparse, and skippable**. Nothing loops. Nothing plays during silence-appropriate moments (Look Mode, menus open).

---

## 13. Ambient Flavor Events

Cheap atmospheric texture to break up long walks and idle periods.

**Mechanism:** the next ambient line fires after a random delay drawn uniformly from **30–120 seconds** after the previous one (or after the previous narrative log line, whichever was more recent — ambient lines never fire within 15 seconds of a narrative line, to avoid stepping on important messages). Lines appear in the event log in DIM_GRAY (or BRIGHT_WHITE at 60% — testing will pick).

**Examples (target pool: 50+ entries):**
- "A leaf falls."
- "You hear the bell of a distant cart."
- "A bird lands on the workbench roof and flies away."
- "The wind picks up briefly, then settles."
- "Somewhere, a dog barks."
- "A cloud passes over the sun."
- "Your boots crunch on a small stone."
- "The smell of rain, faint."
- "A voice carries from far away — unintelligible."
- "You feel the weight of the day."
- (~40 more.)

**Phase-locked variants:** some ambient events only fire in specific phases:
- Phase 2+: "A worker laughs at something across the yard."
- Phase 3+: "A page from yesterday's demand report blows past."
- Phase 4+: "Through the Terminal's window, a number ticks up. Then down. Then up again."

**Easter egg — step counter:** once the player has walked **1,000 tiles cumulatively**, a one-time ambient line fires: "Your boots have worn a groove in the path." At 5,000: "You wonder when you last looked at the sky." At 10,000: TBD.

---
