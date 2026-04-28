import {
  DISPLAY_WIDTH, DISPLAY_HEIGHT, WORLD_ROWS,
  STATUS_ROW, LOG_START_ROW, LOG_END_ROW, HINT_ROW,
  BG, BRIGHT_WHITE, BRIGHT_YELLOW, BRIGHT_CYAN, BRIGHT_MAGENTA, DIM_GRAY,
} from './constants.js';

// ── Display init ──────────────────────────────────────────────────────────────

const display = new ROT.Display({
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  fontSize: 16,
  fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  bg: BG,
  fg: BRIGHT_WHITE,
});

document.body.appendChild(display.getContainer());

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearScreen() {
  for (let y = 0; y < DISPLAY_HEIGHT; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      display.draw(x, y, ' ', BRIGHT_WHITE, BG);
    }
  }
}

function drawRow(y, text, fg) {
  for (let x = 0; x < DISPLAY_WIDTH; x++) {
    const ch = x < text.length ? text[x] : ' ';
    display.draw(x, y, ch, fg, BG);
  }
}

function wordWrap(text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= maxWidth) {
      line += ' ' + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── Game state (§8) ───────────────────────────────────────────────────────────

const state = {
  gameState: 'title', // 'title' | 'transitioning' | 'intro' | 'playing'
  player: {
    x: 15,
    y: 14,
    credits: 10,
    inventory: { rm: 0, widgets: 0 },
    inventoryCaps: { rm: 5, widgets: 5 },
  },
  day: 1,
  tick: 0,
  dayTick: 0,       // 0–239; resets each day
  marketOpen: true, // true for dayTick 0–179, false for 180–239
  phase: 1,
  lifetimeCreditsEarned: 0,
  logLines: [], // max 5 entries: {text, color}
  bellFiredToday: false,
  lastAmbientTick:   0,
  lastNarrativeTick: 0,
  nextAmbientDelay:  45, // first ambient fires after ~45s
  stepsWalked:       0,
  stations: {
    factory: { unlocked: false },
    storage: { unlocked: false },
  },
  officeUnlocked: false,
  storage: { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 },
  workbenchWidgets:  0,
  productionHalted:  false,
  wbFullLogged:      false,
  rmPurchasedToday:  0,
  rmLimitLogged:     false,
  couriersOwned:        0,
  demand:               50,
  marketPrice:          8,
  widgetsSoldToday:     0,
  demandMetLogged:      false,
  debt:                 0,
  debtDaysUnpaid:       0,
  demandCrashOccurred:  false,
  audio: { muted: false },
  workers: { apprentices: [], couriers: [] },
  skills: {
    apprentice:   0,
    courier:      0,
    workerCarry:  0,
    workerSpeed:  0,
    courierCarry: 0,
    courierSpeed: 0,
    storageExp1:  0,
    storageExp2:  0,
    reducedCarry: 0,
    discountDump: 0,
  },
};

// ── Save / load (§8) ─────────────────────────────────────────────────────────

const SAVE_KEY       = 'widgeter.save.v1';
const SCHEMA_VERSION = 1;

function saveGame() {
  const data = {
    schemaVersion:        SCHEMA_VERSION,
    player:               state.player,
    day:                  state.day,
    tick:                 state.tick,
    dayTick:              state.dayTick,
    marketOpen:           state.marketOpen,
    phase:                state.phase,
    lifetimeCreditsEarned: state.lifetimeCreditsEarned,
    logLines:             state.logLines,
    bellFiredToday:       state.bellFiredToday,
    lastAmbientTick:      state.lastAmbientTick,
    lastNarrativeTick:    state.lastNarrativeTick,
    nextAmbientDelay:     state.nextAmbientDelay,
    stepsWalked:          state.stepsWalked,
    stations:             state.stations,
    officeUnlocked:       state.officeUnlocked,
    storage:              state.storage,
    workbenchWidgets:     state.workbenchWidgets,
    productionHalted:     state.productionHalted,
    wbFullLogged:         state.wbFullLogged,
    rmPurchasedToday:     state.rmPurchasedToday,
    rmLimitLogged:        state.rmLimitLogged,
    couriersOwned:        state.couriersOwned,
    demand:               state.demand,
    marketPrice:          state.marketPrice,
    widgetsSoldToday:     state.widgetsSoldToday,
    demandMetLogged:      state.demandMetLogged,
    debt:                 state.debt,
    debtDaysUnpaid:       state.debtDaysUnpaid,
    demandCrashOccurred:  state.demandCrashOccurred,
    audio:                state.audio,
    workers:              state.workers,
    skills:               state.skills,
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.schemaVersion !== SCHEMA_VERSION) return;
    state.player               = data.player;
    state.day                  = data.day;
    state.tick                 = data.tick;
    state.dayTick              = data.dayTick   ?? 0;
    state.marketOpen           = data.marketOpen ?? true;
    state.phase                = data.phase;
    state.lifetimeCreditsEarned = data.lifetimeCreditsEarned;
    state.logLines             = data.logLines || [];
    state.bellFiredToday       = data.bellFiredToday    ?? false;
    state.lastAmbientTick      = data.lastAmbientTick   ?? 0;
    state.lastNarrativeTick    = data.lastNarrativeTick ?? 0;
    state.nextAmbientDelay     = data.nextAmbientDelay  ?? 45;
    state.stepsWalked          = data.stepsWalked       ?? 0;
    state.stations             = data.stations          ?? { factory: { unlocked: false }, storage: { unlocked: false } };
    state.officeUnlocked       = data.officeUnlocked    ?? false;
    state.storage              = data.storage           ?? { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 };
    state.workbenchWidgets     = data.workbenchWidgets  ?? 0;
    state.productionHalted     = data.productionHalted  ?? false;
    state.wbFullLogged         = data.wbFullLogged       ?? false;
    state.rmPurchasedToday     = data.rmPurchasedToday   ?? 0;
    state.rmLimitLogged        = data.rmLimitLogged       ?? false;
    state.couriersOwned        = data.couriersOwned        ?? 0;
    state.demand               = data.demand               ?? 50;
    state.marketPrice          = data.marketPrice          ?? 8;
    state.widgetsSoldToday     = data.widgetsSoldToday     ?? 0;
    state.demandMetLogged      = data.demandMetLogged       ?? false;
    state.debt                 = data.debt                 ?? 0;
    state.debtDaysUnpaid       = data.debtDaysUnpaid       ?? 0;
    state.demandCrashOccurred  = data.demandCrashOccurred  ?? false;
    state.audio                = data.audio               ?? { muted: false };
    state.workers              = data.workers           ?? { apprentices: [], couriers: [] };
    state.workers.couriers     = state.workers.couriers ?? []; // normalise old saves
    state.skills               = data.skills            ?? { apprentice: 0, courier: 0, workerCarry: 0, workerSpeed: 0, courierCarry: 0, courierSpeed: 0, storageExp1: 0, storageExp2: 0, reducedCarry: 0, discountDump: 0 };
    // normalise old saves missing phase-3 skill keys
    state.skills.storageExp1   = state.skills.storageExp1  ?? 0;
    state.skills.storageExp2   = state.skills.storageExp2  ?? 0;
    state.skills.reducedCarry  = state.skills.reducedCarry ?? 0;
    state.skills.discountDump  = state.skills.discountDump ?? 0;
  } catch (_) {
    // corrupt save — start fresh
  }
}

const hasSave = !!localStorage.getItem(SAVE_KEY);
loadGame();

// ── Descriptions (§6.1) ───────────────────────────────────────────────────────

let descriptions = null; // loaded async; look mode is gated on this being non-null

fetch('src/content/descriptions.json')
  .then(r => r.json())
  .then(data => { descriptions = data; })
  .catch(() => { descriptions = { glyphs: {}, tiles: {} }; }); // fail gracefully

// ── §3.3 Title screen ─────────────────────────────────────────────────────────

const TITLE_ART = [
  "W       W IIII DDDD   GGGG  EEEE  TTTT EEEE  RRRR ",
  "W       W  II  D  D  G     E       TT  E     R  R ",
  "W   W   W  II  D  D  G GG  EEE     TT  EEE   RRRR ",
  "W  W W  W  II  D  D  G  G  E       TT  E     R R  ",
  " WW   WW  IIII DDDD   GGGG  EEEE   TT  EEEE  R  R ",
];
const PROMPT = "[ press any key to start ]";

const ART_MAX_W = Math.max(...TITLE_ART.map(l => l.length));
const ART_X     = Math.floor((DISPLAY_WIDTH - ART_MAX_W) / 2);
const ART_Y     = Math.floor((DISPLAY_HEIGHT - (TITLE_ART.length + 2 + 1)) / 2);
const PROMPT_X  = Math.floor((DISPLAY_WIDTH - PROMPT.length) / 2);
const PROMPT_Y  = ART_Y + TITLE_ART.length + 2;

function drawArt() {
  for (let row = 0; row < TITLE_ART.length; row++) {
    const line = TITLE_ART[row];
    for (let col = 0; col < line.length; col++) {
      display.draw(ART_X + col, ART_Y + row, line[col], BRIGHT_YELLOW, BG);
    }
  }
}

function drawPrompt(visible) {
  const fg = visible ? BRIGHT_CYAN : BG;
  for (let col = 0; col < PROMPT.length; col++) {
    display.draw(PROMPT_X + col, PROMPT_Y, PROMPT[col], fg, BG);
  }
}

clearScreen();
drawArt();
drawPrompt(true);

const CREDIT  = "Created by Adam A.";
const VERSION = "Ver: Preview";
for (let i = 0; i < CREDIT.length;  i++) display.draw(79 - CREDIT.length  + i, 48, CREDIT[i],  '#555555', BG);
for (let i = 0; i < VERSION.length; i++) display.draw(79 - VERSION.length + i, 49, VERSION[i], '#555555', BG);

let promptVisible = true;
let blinkInterval = setInterval(() => {
  promptVisible = !promptVisible;
  drawPrompt(promptVisible);
}, 500);

// ── Event log (§3.8) ──────────────────────────────────────────────────────────

function addLog(message, color) {
  state.logLines.push({ text: message, color });
  if (state.logLines.length > 5) state.logLines.shift();
  renderLog();
}

// Splits text longer than 70 chars at the nearest word boundary and logs each part.
// 70 chars + the "> " prefix = 72 displayed chars, matching the log area width.
function wrapLog(text, color) {
  const MAX = 70;
  if (text.length <= MAX) { addLog(text, color); return; }
  const cut = text.lastIndexOf(' ', MAX);
  const split = cut > 0 ? cut : MAX;
  addLog(text.slice(0, split), color);
  addLog(text.slice(split + (cut > 0 ? 1 : 0)), color);
}

function renderLog() {
  for (let i = 0; i < 5; i++) {
    const row   = LOG_START_ROW + i;
    const entry = state.logLines[state.logLines.length - 5 + i];
    if (entry) {
      drawRow(row, '> ' + entry.text, entry.color);
    } else {
      drawRow(row, '>', DIM_GRAY);
    }
  }
}

// Time indicator — redrawn every tick (§3.7, §7.2)
const TIMER_X   = 50;
const TIMER_MAX = 26;

function drawTimeIndicator() {
  const open      = state.marketOpen;
  const remaining = open ? (180 - state.dayTick) : (240 - state.dayTick);
  const label     = open ? 'market open' : 'night';
  const text      = `[== ${label} ${remaining}s ==]`;
  const fg        = open ? BRIGHT_YELLOW : BRIGHT_MAGENTA;
  for (let i = 0; i < TIMER_MAX; i++) display.draw(TIMER_X + i, STATUS_ROW, ' ', BRIGHT_WHITE, BG);
  for (let i = 0; i < text.length; i++) display.draw(TIMER_X + i, STATUS_ROW, text[i], fg, BG);
}

function drawStatusBar() {
  drawRow(STATUS_ROW, '', BRIGHT_WHITE);
  const seg = (x, text, fg) => {
    for (let i = 0; i < text.length; i++) display.draw(x + i, STATUS_ROW, text[i], fg, BG);
    return x + text.length;
  };
  const inv = state.player.inventory;
  const cap = state.player.inventoryCaps;
  const widgetFg = inv.widgets >= cap.widgets ? '#ff5555' : BRIGHT_WHITE;
  let sx = 0;
  if (state.phase >= 2) {
    const activeW = state.workers.apprentices.filter(w => w.workerState !== 'idle' && !w.paused).length;
    const activeC = state.workers.couriers.filter(c => c.courierState === 'delivering' || c.courierState === 'loading').length;
    sx = seg(sx, `CR:${state.player.credits}`,            '#ffd633') + 1;
    sx = seg(sx, `RM:${inv.rm}`,                           '#ff9933') + 1;
    sx = seg(sx, `WG:${inv.widgets}/${cap.widgets}`,       widgetFg)  + 1;
    sx = seg(sx, `D:${state.rmPurchasedToday}/100`,        '#ff9933') + 1;
    sx = seg(sx, `W:${activeW}`,                           '#66ccff') + 1;
    sx = seg(sx, `C:${activeC}`,                           '#cc66cc') + 1;
    sx = seg(sx, `ST:${state.storage.widgets}/50`,         '#66ccff') + 1;
    if (state.phase >= 3) seg(sx, `P:${state.marketPrice}cr`, '#66cc66');
  } else {
    sx = seg(sx, `Credits: ${state.player.credits}`,       '#ffd633') + 4;
    sx = seg(sx, `Raw: ${inv.rm}`,                         '#ff9933') + 4;
    sx = seg(sx, `Widgets: ${inv.widgets}/${cap.widgets}`, widgetFg)  + 4;
         seg(sx, `Day ${state.day}`,                       BRIGHT_WHITE);
  }
  drawTimeIndicator();
}

// ── Tile map (§4.2) ───────────────────────────────────────────────────────────

// Station definitions — single source of truth for layout and colors
const STATION_DEFS = [
  { x: 10, y: 30, label: 'FC', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x: 23, y: 32, label: 'ST', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x: 61, y:  4, label: 'BK', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x: 56, y: 16, label: 'DV', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x:  9, y:  2, label: 'RM', wc: '#ff6600', lc: '#ff6600' },
  { x: 34, y:  8, label: 'WB', wc: '#cc3300', lc: '#cc3300' },
  { x: 61, y: 23, label: 'MT', wc: '#ffd633', lc: '#ffd633' },
  { x: 23, y: 17, label: 'OF', wc: '#aaaaaa', lc: '#ffffff' },
];

let tileMap   = []; // tileMap[x][y] = { glyph, fg, bg, walkable }
const dirtyTiles = new Set(); // "x,y" strings of tiles that need redrawing
let shimmerTiles = []; // pond water tile coords for shimmer animation (§4.2)
const shimmerActive = new Set(); // "x,y" keys currently at bright shimmer color

function markDirty(x, y) { dirtyTiles.add(`${x},${y}`); }

function renderDirty() {
  for (const key of dirtyTiles) {
    const [x, y] = key.split(',').map(Number);
    const t = tileMap[x][y];
    display.draw(x, y, t.glyph, t.fg, t.bg);
  }
  dirtyTiles.clear();
}

function buildTileMap() {
  const mk = (glyph, fg, walkable) => ({ glyph, fg, bg: BG, walkable });

  // Initialise every cell as mixed terrain (§4.2)
  for (let x = 0; x < DISPLAY_WIDTH; x++) {
    tileMap[x] = [];
    for (let y = 0; y < WORLD_ROWS; y++) {
      const h = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      let glyph, fg;
      if      (h <= 50) { glyph = '.'; fg = '#1a1a1a'; } // bare floor
      else if (h <= 65) { glyph = ','; fg = '#2a2a1a'; } // dirt
      else if (h <= 75) { glyph = "'"; fg = '#2a3a1a'; } // sparse grass
      else if (h <= 82) { glyph = '`'; fg = '#1a2a1a'; } // moss
      else if (h <= 87) { glyph = '_'; fg = '#3a3020'; } // worn earth
      else              { glyph = '.'; fg = '#1a1a1a'; } // floor (88–100)
      tileMap[x][y] = mk(glyph, fg, true);
    }
  }

  // Path network — §4.4
  const pc = '#3a3530';
  for (let y = 3;  y <= 28; y++) tileMap[15][y] = mk(':', pc, true);
  for (let x = 15; x <= 62; x++) tileMap[x][14] = mk(':', pc, true);
  for (let x = 15; x <= 62; x++) tileMap[x][28] = mk(':', pc, true);
  for (let y = 14; y <= 28; y++) tileMap[62][y] = mk(':', pc, true);

  // Phase 2 paths — static when already unlocked (animated on first unlock)
  if (state.phase >= 2) {
    for (const [px, py] of [
      [14,28],[13,28],[12,28],[11,28],[11,29],[11,30],[11,31], // to Factory
      [24,29],[24,30],[24,31],                                  // to Storage
    ]) tileMap[px][py] = mk(':', pc, true);
  }

  // Phase 3 paths — static when already unlocked (animated on first unlock)
  if (state.phase >= 3) {
    for (const [px, py] of [[62,13],[62,12],[62,11],[62,10],[62,9],[62,8],[62,7]])
      tileMap[px][py] = mk(':', pc, true);
  }

  // Trees — §4.5
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      const onPath = (x === 15 && y >= 3 && y <= 28) || (y === 14 && x >= 15 && x <= 62)
                  || (y === 28 && x >= 15 && x <= 62) || (x === 62 && y >= 14 && y <= 28);
      if (onPath) continue;
      const reserved = (x >= 8  && x <= 13 && y >= 1  && y <= 5)
                    || (x >= 33 && x <= 38 && y >= 7  && y <= 11)
                    || (x >= 60 && x <= 65 && y >= 22 && y <= 26)
                    || (x >= 22 && x <= 27 && y >= 16 && y <= 20);
      if (!reserved && ((x * 1664525 + y * 1013904223) >>> 16) % 100 < 8)
        tileMap[x][y] = mk('Y', '#2d5a2d', true);
    }
  }

  // Tall grass clusters — §4.2
  const GRASS_ZONES = [
    { x1: 55, y1:  2, x2: 70, y2:  8 }, // Zone A: northeast, near Bank
    { x1:  3, y1: 20, x2: 12, y2: 30 }, // Zone B: southwest, near Factory
    { x1: 40, y1: 30, x2: 55, y2: 40 }, // Zone C: south-center
  ];
  for (const z of GRASS_ZONES) {
    for (let y = z.y1; y <= z.y2; y++) {
      for (let x = z.x1; x <= z.x2; x++) {
        const g = tileMap[x][y].glyph;
        if (g === ':' || g === 'Y') continue; // skip paths and trees
        if (((x * 1664525 + y * 1013904223) >>> 16) % 100 < 60)
          tileMap[x][y] = mk('"', '#1a3a1a', true);
      }
    }
  }

  // Pond — §4.2
  const POND_CX = 22, POND_CY = 25, POND_RX = 4, POND_RY = 3;
  const isPathTile = (x, y) =>
    (x === 15 && y >= 3 && y <= 28) ||
    (y === 14 && x >= 15 && x <= 62) ||
    (y === 28 && x >= 15 && x <= 62) ||
    (x === 62 && y >= 14 && y <= 28);
  const isStationTile = (x, y) =>
    STATION_DEFS.some(s => x >= s.x && x <= s.x + 3 && y >= s.y && y <= s.y + 2);

  shimmerTiles = [];
  for (let y = POND_CY - POND_RY - 1; y <= POND_CY + POND_RY + 1; y++) {
    for (let x = POND_CX - POND_RX - 1; x <= POND_CX + POND_RX + 1; x++) {
      if (x <= 0 || x >= DISPLAY_WIDTH - 1 || y <= 0 || y >= WORLD_ROWS - 1) continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const dx = (x - POND_CX) / POND_RX;
      const dy = (y - POND_CY) / POND_RY;
      if (dx * dx + dy * dy < 1) {
        tileMap[x][y] = mk('~', '#1a4a6a', false);
        shimmerTiles.push({ x, y });
      } else {
        // Bank: 1-tile ring outside ellipse (expanded radii 5, 4)
        const bx = (x - POND_CX) / (POND_RX + 1);
        const by = (y - POND_CY) / (POND_RY + 1);
        if (bx * bx + by * by < 1) {
          tileMap[x][y] = mk(',', '#2a2a1a', true);
        }
      }
    }
  }

  // Wildflower meadow — §4.2
  const FLOWER_COLORS = ['#ccaa00', '#cc4444', '#8a3a8a'];
  const FLOWER_DESCS  = [
    "A small yellow flower. It doesn't know how hard things are.",
    'A red wildflower growing where it wasn\'t planted.',
    'Purple flowers in a loose cluster. They smell faintly of something.',
  ];
  for (let y = 8; y <= 16; y++) {
    for (let x = 42; x <= 54; x++) {
      if (x <= 0 || x >= DISPLAY_WIDTH - 1 || y <= 0 || y >= WORLD_ROWS - 1) continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      if (tileMap[x][y].glyph === 'Y') continue;
      const isFlower = ((x * 1664525 + y * 1013904223) >>> 16) % 100 < 15;
      if (isFlower) {
        const fi = (x * 31 + y * 17) % 3;
        tileMap[x][y] = mk('*', FLOWER_COLORS[fi], true);
        tileMap[x][y].description = FLOWER_DESCS[fi];
      } else {
        tileMap[x][y] = mk("'", '#2a3a1a', true);
      }
    }
  }

  // Fallen logs — §4.2
  for (const [lx, ly] of [[8,6],[71,9],[5,35],[68,38],[44,4],[50,39]]) {
    tileMap[lx][ly] = mk('&', '#5a4a2a', false);
  }

  // Worn ground near Market approach — §4.2
  for (let y = 18; y <= 25; y++) {
    for (let x = 55; x <= 63; x++) {
      if (x <= 0 || x >= DISPLAY_WIDTH - 1 || y <= 0 || y >= WORLD_ROWS - 1) continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      if (tileMap[x][y].glyph === 'Y') continue;
      const h = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (h < 80) {
        tileMap[x][y] = mk('.', '#1a1a1a', true);
      } else if (h < 90) {
        tileMap[x][y] = mk(',', '#2a2a1a', true);
      } else {
        tileMap[x][y] = mk('_', '#3a3020', true);
      }
    }
  }

  // Border — §4.1 (overwrites edge floor)
  for (let x = 0; x < DISPLAY_WIDTH; x++) {
    tileMap[x][0]            = mk('#', DIM_GRAY, false);
    tileMap[x][WORLD_ROWS-1] = mk('#', DIM_GRAY, false);
  }
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    tileMap[0][y]               = mk('#', DIM_GRAY, false);
    tileMap[DISPLAY_WIDTH-1][y] = mk('#', DIM_GRAY, false);
  }

  // Apply phase 2 unlock colors before stamping stations
  if (state.phase >= 2) {
    const fc2 = STATION_DEFS.find(s => s.label === 'FC');
    const st2 = STATION_DEFS.find(s => s.label === 'ST');
    if (fc2) { fc2.wc = '#555555'; fc2.lc = '#ff9933'; }
    if (st2) { st2.wc = '#555555'; st2.lc = '#66ccff'; }
  }
  if (state.phase >= 3) {
    const bk3 = STATION_DEFS.find(s => s.label === 'BK');
    if (bk3) { bk3.wc = '#555555'; bk3.lc = '#66cc66'; }
  }

  // Stations — §3.5 (overwrites floor/trees in their footprint)
  const STATION_DESCS = {
    RM: {
      wall: 'The raw materials shed. Walk to the door and press space to buy materials.',
      door: 'The entrance to the materials shed. The door hangs slightly open.',
    },
    WB: {
      wall: 'The workbench shed. This is where widgets are made.',
      door: 'The workbench entrance. A bell hangs above it, unrung.',
    },
    MT: {
      wall: 'The market. Open at dawn, closed at dusk. Widgets become credits here.',
      door: 'The market entrance. The hours are posted but the sign is faded.',
    },
    OF: {
      wall: 'The Office. Upgrades and skills are available here.',
      door: 'The Office door. It opens easier than it looks.',
    },
    FC: { wall: 'A large building with dark windows. Whatever ran here ran hard. The smell of old machine oil hasn\'t left.' },
    ST: { wall: 'A warehouse, padlocked. Through the slats you can see empty pallets and a hand truck.' },
    BK: { wall: "Through the dusty window, you see a polished counter and a sign: 'NO INTEREST WITHOUT DEPOSIT.' The door is locked." },
    DV: { wall: "A glass-fronted building with screens displaying numbers you don't yet understand. The door is locked. A small plaque reads: 'AUTHORIZED PERSONNEL ONLY.'" },
  };
  for (const s of STATION_DEFS) {
    tileMap[s.x  ][s.y]   = mk('+',        s.wc, false);
    tileMap[s.x+1][s.y]   = mk('-',        s.wc, false);
    tileMap[s.x+2][s.y]   = mk('-',        s.wc, false);
    tileMap[s.x+3][s.y]   = mk('+',        s.wc, false);
    tileMap[s.x  ][s.y+1] = mk('|',        s.wc, false);
    tileMap[s.x+1][s.y+1] = mk(s.label[0], s.lc, false);
    tileMap[s.x+2][s.y+1] = mk(s.label[1], s.lc, false);
    tileMap[s.x+3][s.y+1] = mk('|',        s.wc, false);
    tileMap[s.x  ][s.y+2] = mk('+',        s.wc, false);
    tileMap[s.x+1][s.y+2] = mk('.',        s.wc, true);  // door — walkable
    tileMap[s.x+2][s.y+2] = mk('-',        s.wc, false);
    tileMap[s.x+3][s.y+2] = mk('+',        s.wc, false);
    const sd = STATION_DESCS[s.label];
    if (sd) {
      const wallD = sd.wall;
      const doorD = sd.door || sd.wall;
      for (const [wx, wy] of [
        [s.x,   s.y],   [s.x+1, s.y],   [s.x+2, s.y],   [s.x+3, s.y],
        [s.x,   s.y+1], [s.x+1, s.y+1], [s.x+2, s.y+1], [s.x+3, s.y+1],
        [s.x,   s.y+2],                  [s.x+2, s.y+2], [s.x+3, s.y+2],
      ]) tileMap[wx][wy].description = wallD;
      tileMap[s.x+1][s.y+2].description = doorD;
    }
  }
}


// ── §3.4 Phase-in transition ──────────────────────────────────────────────────

function drawWorld() {
  buildTileMap();

  // Mark every map tile dirty so renderDirty redraws the full world
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) markDirty(x, y);
  }
  renderDirty();

  // Player @ (§3.5)
  display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);

  // Apprentice workers (§5.3)
  for (const w of state.workers.apprentices)
    display.draw(w.x, w.y, 'a', '#66ccff', BG);
  for (const c of state.workers.couriers)
    display.draw(c.x, c.y, 'c', '#cc66cc', BG);

  // Status bar (§3.7)
  drawStatusBar();

  // Event log (§3.8)
  renderLog();

  // Command hint (§3.9)
  drawRow(HINT_ROW,
    "[arrows: move]  [space: interact]  [i: inventory]  [o: look]  [p: ponder]",
    '#555555');
}

function startPhaseIn() {
  clearScreen();
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      display.draw(x, y, '·', '#222222', BG);
    }
  }
  const TOTAL_TILES     = DISPLAY_WIDTH * WORLD_ROWS;
  const TILES_PER_FRAME = Math.ceil(TOTAL_TILES / (1.3 * 60));
  let index = 0;

  function step() {
    if (state.gameState !== 'transitioning') return;
    if (index >= TOTAL_TILES) {
      drawWorld();
      showIntroScreen();
      return;
    }
    const end = Math.min(index + TILES_PER_FRAME, TOTAL_TILES);
    while (index < end) {
      display.draw(index % DISPLAY_WIDTH, Math.floor(index / DISPLAY_WIDTH), ' ', BRIGHT_WHITE, BG);
      index++;
    }
    requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ── §3.4 Intro flavor screen ──────────────────────────────────────────────────

const INTRO_PARAS = [
  "On the morning of the deep orange sun, the dew is heavy on the leaves surrounding your workshop. The air smells something metallic.",
  "You have inherited a large, formidable landscape. A workbench, a plot of land, a small wallet of credits. The buyers come at dawn and leave at dusk. Between these hours you will be manufacturing.",
  "You make small, useful objects with sufficient patience and raw materials.",
  "Begin at the workbench. Buy materials from the shed to the north. Sell what you make at the market to the south-east.",
];

function showIntroScreen() {
  state.gameState = 'intro';

  const BOX_W   = 60;
  const INNER_W = BOX_W - 2;
  const BOX_X   = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);

  const TITLE_TEXT  = "-- WIDGETER --";
  const PROMPT_TEXT = "[ press any key to begin ]";

  const wrapped = INTRO_PARAS.map(p => wordWrap(p, INNER_W));
  const rows = [];
  rows.push(null);
  rows.push({ text: TITLE_TEXT, fg: BRIGHT_CYAN, center: true });
  rows.push(null);
  for (let i = 0; i < wrapped.length; i++) {
    if (i > 0) rows.push(null);
    for (const line of wrapped[i]) rows.push({ text: line, fg: BRIGHT_WHITE });
  }
  rows.push(null);
  const PROMPT_IDX = rows.length;
  rows.push({ text: PROMPT_TEXT, fg: BRIGHT_CYAN, center: true });

  const BOX_H = rows.length + 2;
  const BOX_Y = Math.floor((DISPLAY_HEIGHT - BOX_H) / 2);

  function drawContentRow(i, fg_override) {
    const y   = BOX_Y + 1 + i;
    const row = rows[i];
    display.draw(BOX_X,             y, '|', DIM_GRAY, BG);
    display.draw(BOX_X + BOX_W - 1, y, '|', DIM_GRAY, BG);
    if (row === null || fg_override === BG) {
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, y, ' ', BRIGHT_WHITE, BG);
      return;
    }
    let text = row.text;
    if (row.center) {
      const pad = Math.floor((INNER_W - text.length) / 2);
      text = ' '.repeat(pad) + text;
    }
    const fg = fg_override !== undefined ? fg_override : row.fg;
    for (let x = 0; x < INNER_W; x++) {
      display.draw(BOX_X + 1 + x, y, x < text.length ? text[x] : ' ', fg, BG);
    }
  }

  display.draw(BOX_X,             BOX_Y, '+', DIM_GRAY, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y, '+', DIM_GRAY, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '-', DIM_GRAY, BG);
  const botY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X,             botY, '+', DIM_GRAY, BG);
  display.draw(BOX_X + BOX_W - 1, botY, '+', DIM_GRAY, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, botY, '-', DIM_GRAY, BG);

  for (let i = 0; i < rows.length; i++) drawContentRow(i, BG);
  drawContentRow(1);

  const paraRanges = [];
  let ri = 3;
  for (let i = 0; i < wrapped.length; i++) {
    const blankIdx = i > 0 ? ri++ : null;
    paraRanges.push({ blankIdx, start: ri, end: ri + wrapped[i].length });
    ri += wrapped[i].length;
  }

  const timers = [];
  let introBlinkInterval = null;

  function cancel() {
    timers.forEach(id => clearTimeout(id));
    timers.length = 0;
    clearInterval(introBlinkInterval);
    introBlinkInterval = null;
  }

  function onIntroKey() {
    if (state.gameState !== 'intro') return;
    cancel();
    window.removeEventListener('keydown', onIntroKey);
    dismissIntro();
  }
  window.addEventListener('keydown', onIntroKey);

  function revealPara(i) {
    if (state.gameState !== 'intro') return;
    const { blankIdx, start, end } = paraRanges[i];
    if (blankIdx !== null) drawContentRow(blankIdx);
    for (let r = start; r < end; r++) drawContentRow(r);
    if (i < INTRO_PARAS.length - 1) {
      timers.push(setTimeout(() => revealPara(i + 1), 400));
    } else {
      timers.push(setTimeout(showPrompt, 400));
    }
  }

  function showPrompt() {
    if (state.gameState !== 'intro') return;
    drawContentRow(PROMPT_IDX - 1);
    drawContentRow(PROMPT_IDX);
    let pv = true;
    introBlinkInterval = setInterval(() => {
      if (state.gameState !== 'intro') { clearInterval(introBlinkInterval); return; }
      pv = !pv;
      drawContentRow(PROMPT_IDX, pv ? BRIGHT_CYAN : BG);
    }, 500);
  }

  revealPara(0);
}

function dismissIntro() {
  state.gameState = 'playing';
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      display.draw(x, y, ' ', BRIGHT_WHITE, BG);
    }
  }
  if (!state.bellFiredToday) {
    state.bellFiredToday = true;
    addLog('The morning bell has rung.', BRIGHT_CYAN);
  }
  drawWorld();
}

// ── Keypress: title → phase-in / continue (§3.3) ────────────────────────────

function resetState() {
  state.player = { x: 15, y: 14, credits: 10, inventory: { rm: 0, widgets: 0 }, inventoryCaps: { rm: 5, widgets: 5 } };
  state.day = 1; state.tick = 0; state.dayTick = 0;
  state.marketOpen = true; state.phase = 1;
  state.lifetimeCreditsEarned = 0; state.logLines = []; state.bellFiredToday = false;
  state.lastAmbientTick = 0; state.lastNarrativeTick = 0; state.nextAmbientDelay = 45; state.stepsWalked = 0;
  state.stations = { factory: { unlocked: false }, storage: { unlocked: false } };
  state.officeUnlocked = false;
  state.storage = { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 };
  state.workbenchWidgets = 0;
  state.productionHalted = false;
  state.wbFullLogged     = false;
  state.rmPurchasedToday = 0;
  state.rmLimitLogged    = false;
  state.couriersOwned    = 0;
  state.demand           = 50;
  state.marketPrice      = 8;
  state.widgetsSoldToday = 0;
  state.demandMetLogged      = false;
  state.debt                 = 0;
  state.debtDaysUnpaid       = 0;
  state.demandCrashOccurred  = false;
  state.audio            = { muted: false };
  state.workers = { apprentices: [], couriers: [] };
  state.skills = { apprentice: 0, courier: 0, workerCarry: 0, workerSpeed: 0, courierCarry: 0, courierSpeed: 0, storageExp1: 0, storageExp2: 0, reducedCarry: 0, discountDump: 0 };
  const fcDef = STATION_DEFS.find(s => s.label === 'FC');
  const stDef = STATION_DEFS.find(s => s.label === 'ST');
  const bkDef = STATION_DEFS.find(s => s.label === 'BK');
  if (fcDef) { fcDef.wc = DIM_GRAY; fcDef.lc = DIM_GRAY; }
  if (stDef) { stDef.wc = DIM_GRAY; stDef.lc = DIM_GRAY; }
  if (bkDef) { bkDef.wc = DIM_GRAY; bkDef.lc = DIM_GRAY; }
}

function showNewGameConfirm() {
  clearScreen(); drawArt();
  state.gameState = 'title_menu';
  const WC = '#555555';
  const INNER_W = 23; // "Your save will be lost."
  const BOX_W = INNER_W + 4;
  const BOX_H = 8;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(28, Math.floor((DISPLAY_HEIGHT - BOX_H) / 2));
  const CX = BOX_X + 2;
  display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }
  const t1 = 'Are you sure?'; const t2 = 'Your save will be lost.';
  const o1 = '1. Yes, start over'; const o2 = '2. Cancel';
  for (let i = 0; i < t1.length; i++) display.draw(CX+i, BOX_Y+1, t1[i], BRIGHT_YELLOW, BG);
  for (let i = 0; i < t2.length; i++) display.draw(CX+i, BOX_Y+2, t2[i], BRIGHT_WHITE, BG);
  for (let i = 0; i < o1.length; i++) display.draw(CX+i, BOX_Y+4, o1[i], BRIGHT_WHITE, BG);
  for (let i = 0; i < o2.length; i++) display.draw(CX+i, BOX_Y+5, o2[i], BRIGHT_WHITE, BG);
  function ngKeyHandler(e) {
    if (e.key === '1') {
      window.removeEventListener('keydown', ngKeyHandler);
      resetState();
      localStorage.removeItem(SAVE_KEY);
      state.gameState = 'transitioning';
      startPhaseIn();
    } else if (e.key === '2') {
      window.removeEventListener('keydown', ngKeyHandler);
      showContinueMenu();
    }
  }
  window.addEventListener('keydown', ngKeyHandler);
}

function showContinueMenu() {
  clearScreen(); drawArt();
  state.gameState = 'title_menu';
  const WC = '#555555';
  const INNER_W = 14; // "-- WIDGETER --"
  const BOX_W = INNER_W + 4;
  const BOX_H = 7;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(28, Math.floor((DISPLAY_HEIGHT - BOX_H) / 2));
  const CX = BOX_X + 2;
  display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }
  const title = '-- WIDGETER --';
  for (let i = 0; i < title.length; i++) display.draw(CX+i, BOX_Y+1, title[i], BRIGHT_CYAN, BG);
  const o1 = '1. Continue'; const o2 = '2. New Game';
  for (let i = 0; i < o1.length; i++) display.draw(CX+i, BOX_Y+3, o1[i], BRIGHT_WHITE, BG);
  for (let i = 0; i < o2.length; i++) display.draw(CX+i, BOX_Y+4, o2[i], BRIGHT_WHITE, BG);
  function cmKeyHandler(e) {
    if (e.key === '1') {
      window.removeEventListener('keydown', cmKeyHandler);
      state.gameState = 'playing';
      clearScreen();
      drawWorld();
    } else if (e.key === '2') {
      window.removeEventListener('keydown', cmKeyHandler);
      showNewGameConfirm();
    }
  }
  window.addEventListener('keydown', cmKeyHandler);
}

function onAnyKey() {
  clearInterval(blinkInterval);
  window.removeEventListener('keydown', onAnyKey);
  if (hasSave) {
    showContinueMenu();
  } else {
    state.gameState = 'transitioning';
    startPhaseIn();
  }
}

window.addEventListener('keydown', onAnyKey);

// ── Arrow key movement (§3.5) ─────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (state.gameState === 'crafting' && e.key === 'Escape') { cancelCrafting(); return; }
  if (state.gameState === 'crafting') {
    const ARROW = { ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true };
    if (ARROW[e.key]) {
      e.preventDefault();
      addLog("You can't move — you're mid-craft. Press Esc to cancel.", '#ff5555');
    }
    return;
  }
  if (state.gameState !== 'playing') return;
  if (e.key === 'Escape') { showPauseMenu(); return; }
  if (e.key === 'o') { enterLookMode(); e.stopImmediatePropagation(); return; }
  if (e.key === 'i') { showInventory(); return; }
  if (e.key === 'p') { handlePonder(); return; }
  if (e.key === ' ') { e.preventDefault(); handleInteract(); return; }
  const DIRS = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
  const d = DIRS[e.key];
  if (!d) return;
  e.preventDefault();
  const nx = state.player.x + d[0];
  const ny = state.player.y + d[1];
  if (!tileMap[nx][ny].walkable) return;
  markDirty(state.player.x, state.player.y);
  state.player.x = nx;
  state.player.y = ny;
  markDirty(state.player.x, state.player.y);
  renderDirty();
  display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
  state.stepsWalked++;
  state.lastNarrativeTick = state.tick;
  if (state.stepsWalked === 1000)
    addLog('Your boots have worn a groove in the path.', '#cc66cc');
  if (state.stepsWalked === 5000)
    addLog('You wonder when you last looked at the sky.', '#cc66cc');
});

// ── Look Mode (§3.10) ─────────────────────────────────────────────────────────

let lookX = 0;
let lookY = 0;
let lookBlinkInterval = null;

// ── Crafting state ────────────────────────────────────────────────────────────
const CRAFT_TICKS = 3; // ticks per widget (§5.2)
let craftQueue    = 0; // widgets still to make after the current one
let craftProgress = 0; // ticks elapsed for current widget
let craftTotal    = 0; // total widgets in this session (for completion log)

function drawLookCursor(inverted) {
  const onPlayer = lookX === state.player.x && lookY === state.player.y;
  const glyph  = onPlayer ? '@'          : tileMap[lookX][lookY].glyph;
  const tileFg = onPlayer ? BRIGHT_WHITE : tileMap[lookX][lookY].fg;
  const tileBg = tileMap[lookX][lookY].bg;
  display.draw(lookX, lookY, glyph, inverted ? tileBg : tileFg, inverted ? tileFg : tileBg);
}

function restoreLookTile() {
  markDirty(lookX, lookY);
  renderDirty();
  if (lookX === state.player.x && lookY === state.player.y)
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
}

// Priority: tileMap[x][y].description → tiles["x,y"] → glyphs[g].variants[hash] → glyphs[g].default → fallback (§6.1, §6.2, §6.5)
function getDescription(x, y, glyph) {
  if (!descriptions) return 'Nothing remarkable.';
  const td0 = tileMap[x]?.[y]?.description;
  if (td0) return td0;
  const td = descriptions.tiles && descriptions.tiles[`${x},${y}`];
  if (td) return td;
  const gd = descriptions.glyphs && descriptions.glyphs[glyph];
  if (gd) {
    if (gd.variants && gd.variants.length) {
      const idx = ((x * 1664525 + y * 1013904223) >>> 16) % gd.variants.length;
      return gd.variants[idx];
    }
    if (gd.default) return gd.default;
  }
  return (descriptions.glyphs && descriptions.glyphs.unknown) || 'Nothing remarkable.';
}

// Render description into the log area without touching state.logLines (§3.10)
function renderLookDescription() {
  const onPlayer = lookX === state.player.x && lookY === state.player.y;
  const glyph  = onPlayer ? '@' : tileMap[lookX][lookY].glyph;
  const tileFg = onPlayer ? BRIGHT_WHITE : tileMap[lookX][lookY].fg;
  const desc   = getDescription(lookX, lookY, glyph);

  for (let r = LOG_START_ROW; r <= LOG_END_ROW; r++) drawRow(r, '', BRIGHT_WHITE);

  // Glyph in its native color at column 0, description in BRIGHT_CYAN from column 2
  display.draw(0, LOG_START_ROW, glyph, tileFg, BG);
  const lines = wordWrap(desc, DISPLAY_WIDTH - 2); // leave room for glyph+space on line 1
  for (let i = 0; i < lines.length && i < 5; i++) {
    const xOff = i === 0 ? 2 : 0;
    for (let j = 0; j < lines[i].length; j++)
      display.draw(xOff + j, LOG_START_ROW + i, lines[i][j], BRIGHT_CYAN, BG);
  }
}

function enterLookMode() {
  if (!descriptions) return; // wait for JSON to load
  state.gameState = 'look';
  lookX = state.player.x;
  lookY = state.player.y;
  drawLookCursor(true);
  renderLookDescription();
  let blinkOn = true;
  lookBlinkInterval = setInterval(() => {
    if (state.gameState !== 'look') { clearInterval(lookBlinkInterval); return; }
    blinkOn = !blinkOn;
    drawLookCursor(blinkOn);
  }, 500);
}

function exitLookMode() {
  clearInterval(lookBlinkInterval);
  lookBlinkInterval = null;
  restoreLookTile();
  renderLog(); // restore event log (§3.10)
  state.gameState = 'playing';
}

window.addEventListener('keydown', (e) => {
  if (state.gameState !== 'look') return;
  if (e.key === 'o') { exitLookMode(); return; }
  if (e.key === 'Escape') { exitLookMode(); showPauseMenu(); return; }
  const DIRS = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
  const d = DIRS[e.key];
  if (!d) return;
  e.preventDefault();
  restoreLookTile();
  lookX = Math.max(0, Math.min(DISPLAY_WIDTH - 1, lookX + d[0]));
  lookY = Math.max(0, Math.min(WORLD_ROWS - 1,    lookY + d[1]));
  drawLookCursor(true);
  renderLookDescription();
});

// ── Menu system ───────────────────────────────────────────────────────────────

function showMenu(title, options) {
  state.gameState = 'menu';

  const ESC_LABEL = 'ESC to cancel';
  const INNER_W   = Math.max(title.length, ESC_LABEL.length,
                             ...options.map((o, i) => `${i + 1}. ${o.label}`.length));
  const BOX_W  = INNER_W + 4;           // 2 borders + 2 padding
  const BOX_H  = options.length + 6;    // top + title + blank + options + blank + esc + bottom
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(10, Math.floor((WORLD_ROWS  - BOX_H) / 2));
  const CONT_X = BOX_X + 2;             // content left edge
  const WC     = '#555555';

  // Frame
  display.draw(BOX_X, BOX_Y, '+', WC, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y, '+', WC, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '-', WC, BG);
  const botY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, botY, '+', WC, BG);
  display.draw(BOX_X + BOX_W - 1, botY, '+', WC, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, botY, '-', WC, BG);
  for (let y = 1; y < BOX_H - 1; y++) {
    display.draw(BOX_X, BOX_Y + y, '|', WC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '|', WC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + y, ' ', BRIGHT_WHITE, BG);
  }

  // Title
  for (let i = 0; i < title.length; i++) display.draw(CONT_X + i, BOX_Y + 1, title[i], BRIGHT_CYAN, BG);

  // Options (row BOX_Y + 3 onward — gap of 1 after title)
  for (let i = 0; i < options.length; i++) {
    const opt  = options[i];
    const fg   = opt.enabled === false ? DIM_GRAY : BRIGHT_WHITE;
    const text = `${i + 1}. ${opt.label}`;
    for (let j = 0; j < text.length; j++) display.draw(CONT_X + j, BOX_Y + 3 + i, text[j], fg, BG);
  }

  // ESC hint
  for (let i = 0; i < ESC_LABEL.length; i++)
    display.draw(CONT_X + i, BOX_Y + 3 + options.length + 1, ESC_LABEL[i], DIM_GRAY, BG);

  function closeMenu() {
    window.removeEventListener('keydown', menuKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    if (state.gameState === 'menu') state.gameState = 'playing'; // don't override if action changed state (e.g. crafting)
  }

  function menuKeyHandler(e) {
    if (e.key === 'Escape') { closeMenu(); return; }
    const num = parseInt(e.key);
    if (num >= 1 && num <= options.length) {
      const opt = options[num - 1];
      if (opt.enabled === false) return; // disabled — do nothing, stay open
      opt.action();
      closeMenu();
    }
  }
  window.addEventListener('keydown', menuKeyHandler);
}

// ── Station interaction (§5.2) ────────────────────────────────────────────────

function isAdjacentToStation(s) {
  const { x: px, y: py } = state.player;
  // Wall tiles of a 4×3 station (excludes door at s.x+1, s.y+2)
  const walls = [
    [s.x,   s.y],   [s.x+1, s.y],   [s.x+2, s.y],   [s.x+3, s.y],
    [s.x,   s.y+1], [s.x+3, s.y+1],
    [s.x,   s.y+2], [s.x+2, s.y+2], [s.x+3, s.y+2],
  ];
  return walls.some(([wx, wy]) => Math.abs(px - wx) <= 1 && Math.abs(py - wy) <= 1);
}

function openRMShedMenu() {
  const COST      = 3;
  const rmSpace   = state.player.inventoryCaps.rm - state.player.inventory.rm;
  const dailyLeft = state.phase >= 2 ? Math.max(0, 100 - state.rmPurchasedToday) : Infinity;
  const maxBuy    = Math.min(rmSpace, Math.floor(state.player.credits / COST),
                             dailyLeft === Infinity ? Infinity : dailyLeft);
  const canBuy1   = state.player.credits >= COST && rmSpace > 0 && dailyLeft > 0;
  const limitHit  = state.phase >= 2 && dailyLeft <= 0;

  showMenu('Raw Materials Shed', [
    {
      label:   limitHit ? 'Buy 1 RM — DAILY LIMIT REACHED' : `Buy 1 RM (${COST}cr)`,
      enabled: canBuy1,
      action:  () => {
        state.player.credits      -= COST;
        state.player.inventory.rm += 1;
        state.rmPurchasedToday    += 1;
        addLog('You buy 1 raw material.', '#ff9933');
        drawStatusBar();
      },
    },
    {
      label:   `Buy max (${maxBuy})`,
      enabled: maxBuy > 0,
      action:  () => {
        state.player.credits      -= maxBuy * COST;
        state.player.inventory.rm += maxBuy;
        state.rmPurchasedToday    += maxBuy;
        addLog(`You buy ${maxBuy} raw material${maxBuy !== 1 ? 's' : ''}.`, '#ff9933');
        drawStatusBar();
      },
    },
    { label: 'Cancel', enabled: true, action: () => {} },
  ]);
}

// WB label tile positions for pulse effect (middle row of WB station at x=34,y=8)
const WB_LABEL_TILES = [[35, 9], [36, 9]];

function pulseWB() {
  WB_LABEL_TILES.forEach(([x, y]) => display.draw(x, y, tileMap[x][y].glyph, '#ffffff', BG));
  setTimeout(() => {
    WB_LABEL_TILES.forEach(([x, y]) => { markDirty(x, y); });
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
  }, 200);
}

function startCrafting(n) {
  state.player.inventory.rm--; // consume RM for first widget immediately
  craftQueue    = n - 1;
  craftProgress = 0;
  craftTotal    = n;
  state.gameState = 'crafting';
  drawStatusBar();
  addLog(`Crafting ${n} widget${n !== 1 ? 's' : ''}...`, BRIGHT_CYAN);
}

function cancelCrafting() {
  // In-progress widget's RM is already consumed — forfeited
  craftQueue = 0; craftProgress = 0;
  WB_LABEL_TILES.forEach(([x, y]) => { markDirty(x, y); });
  renderDirty();
  display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
  addLog('Crafting cancelled. Current widget lost.', '#ff5555');
  state.gameState = 'playing';
}

function openWorkbenchMenu() {
  const rm          = state.player.inventory.rm;
  const widgetSpace = state.player.inventoryCaps.widgets - state.player.inventory.widgets;
  const maxCraft    = Math.min(rm, widgetSpace);
  const canCraft1   = rm >= 1 && widgetSpace > 0;

  showMenu('Workbench', [
    {
      label:   'Craft 1 (1 RM → 1 widget, 3s)',
      enabled: canCraft1,
      action:  () => startCrafting(1),
    },
    {
      label:   `Craft max (${maxCraft})`,
      enabled: maxCraft > 0,
      action:  () => startCrafting(maxCraft),
    },
    { label: 'Cancel', enabled: true, action: () => {} },
  ]);
}

function colorInStation(label, wc, lc) {
  const s = STATION_DEFS.find(sd => sd.label === label);
  if (!s) return;
  s.wc = wc; s.lc = lc;
  const tiles = [
    [s.x,   s.y,   '+', wc, false], [s.x+1, s.y,   '-', wc, false],
    [s.x+2, s.y,   '-', wc, false], [s.x+3, s.y,   '+', wc, false],
    [s.x,   s.y+1, '|', wc, false], [s.x+1, s.y+1, s.label[0], lc, false],
    [s.x+2, s.y+1, s.label[1], lc, false], [s.x+3, s.y+1, '|', wc, false],
    [s.x,   s.y+2, '+', wc, false], [s.x+1, s.y+2, '.', wc, true],
    [s.x+2, s.y+2, '-', wc, false], [s.x+3, s.y+2, '+', wc, false],
  ];
  for (const [tx, ty, g, fg, w] of tiles) {
    tileMap[tx][ty] = { glyph: g, fg, bg: BG, walkable: w };
    markDirty(tx, ty);
  }
  renderDirty();
  display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
}

function animatePhase2Paths() {
  const pc = '#3a3530';
  const pathTiles = [
    [14,28],[13,28],[12,28],[11,28],[11,29],[11,30],[11,31],
    [24,29],[24,30],[24,31],
  ];
  let i = 0;
  const iv = setInterval(() => {
    if (i >= pathTiles.length) { clearInterval(iv); return; }
    const [px, py] = pathTiles[i++];
    tileMap[px][py] = { glyph: ':', fg: pc, bg: BG, walkable: true };
    markDirty(px, py);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
  }, 2000);
}

function checkPhase2Trigger() {
  if (state.lifetimeCreditsEarned >= 100 && state.phase === 1) {
    state.phase = 2;
    state.officeUnlocked = true;
    state.stations.factory.unlocked = true;
    state.stations.storage.unlocked = true;
    addLog('Something stirs. The Office door swings open.', '#cc66cc');
    setTimeout(() => addLog('You can afford to hire help.', '#cc66cc'), 2000);
    setTimeout(() => {
      addLog('The Factory and Storage Warehouse are now available.', '#cc66cc');
      colorInStation('FC', '#555555', '#ff9933');
      colorInStation('ST', '#555555', '#66ccff');
      setTimeout(animatePhase2Paths, 1000);
    }, 4000);
  }
}

function gaussianNoise(mean, std) {
  const u = 1 - Math.random(), v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function demandLabel(D) {
  if (D > 65)  return { text: 'HIGH',      fg: '#66cc66' };
  if (D >= 35) return { text: 'AVERAGE',   fg: '#f0f0f0' };
  if (D >= 15) return { text: 'WEAK',      fg: '#ff9933' };
  return             { text: 'COLLAPSED',  fg: '#ff5555' };
}

function calculateDailyDemand() {
  const raw      = 50 + 30 * Math.sin(state.day / 7 * 2 * Math.PI) + gaussianNoise(0, 10);
  state.demand      = Math.max(5, Math.round(raw));
  state.marketPrice = Math.round(8 * Math.pow(state.demand / 50, 0.5) * 10) / 10;
  if (state.demand < 20) state.demandCrashOccurred = true;
}

function checkPhase3Trigger() {
  if (state.phase === 2 && (state.lifetimeCreditsEarned >= 500 || (state.couriersOwned >= 1 && state.day >= 2))) {
    state.phase = 3;
    state.stations.bank = { unlocked: true };
    calculateDailyDemand();
    addLog('The bank lights come on for the first time.', '#66cc66');
    setTimeout(() => addLog('New options are becoming available.', '#66cc66'), 2000);
    setTimeout(() => {
      colorInStation('BK', '#555555', '#66cc66');
      setTimeout(animateBankPath, 1000);
    }, 4000);
  }
}

function animateBankPath() {
  const pc = '#3a3530';
  const mk = (glyph, fg, walkable) => ({ glyph, fg, bg: BG, walkable });
  const tiles = [[62,13],[62,12],[62,11],[62,10],[62,9],[62,8],[62,7]];
  tiles.forEach(([px, py], i) => {
    setTimeout(() => {
      tileMap[px][py] = mk(':', pc, true);
      markDirty(px, py);
      renderDirty();
    }, i * 200);
  });
}

function sellWidgets(n) {
  if (state.phase >= 3) {
    const remaining = state.demand - state.widgetsSoldToday;
    if (remaining <= 0) {
      if (!state.demandMetLogged) {
        addLog("The market has taken all it will take today.", '#ff9933');
        state.demandMetLogged = true;
      }
      return;
    }
    n = Math.min(n, remaining);
  }
  const price  = state.marketPrice;
  const earned = n * price;
  state.player.credits           += earned;
  state.player.inventory.widgets -= n;
  state.lifetimeCreditsEarned    += earned;
  if (state.phase >= 3) state.widgetsSoldToday += n;
  addLog(`Sold ${n} widget${n !== 1 ? 's' : ''} for ${earned}cr.`, BRIGHT_CYAN);
  drawStatusBar();
  checkPhase2Trigger();
}

function openMarketMenu() {
  const widgets = state.player.inventory.widgets;
  const price   = state.marketPrice;

  if (!state.marketOpen) {
    addLog('The market is shuttered. The bell rings at dawn.', '#555555');
    return;
  }
  if (widgets === 0) {
    addLog('You have nothing to sell.', '#555555');
    return;
  }

  if (state.phase >= 3 && state.widgetsSoldToday >= state.demand) {
    addLog("The market has taken all it will take today.", '#ff9933');
    return;
  }

  const dl    = state.phase >= 3 ? demandLabel(state.demand) : null;
  const title = dl ? `Market — Demand: ${dl.text}` : 'Market';
  const avail = state.phase >= 3 ? Math.min(widgets, state.demand - state.widgetsSoldToday) : widgets;

  showMenu(title, [
    {
      label:   `Sell 1 widget (+${price}cr)`,
      enabled: true,
      action:  () => sellWidgets(1),
    },
    {
      label:   `Sell max (+${avail * price}cr)`,
      enabled: true,
      action:  () => sellWidgets(avail),
    },
    { label: 'Cancel', enabled: true, action: () => {} },
  ]);
}

// ── Office skill tree (§5.3) ──────────────────────────────────────────────────

const OFFICE_NODES = [
  { num: 1, name: 'Hire Apprentice',      cost:  50, key: 'apprentice',   max: 3,  minPhase: 2 },
  { num: 2, name: 'Hire Courier Robot',   cost:  30, key: 'courier',      max: 4,  minPhase: 2 },
  { num: 3, name: 'Worker Carry +1',      cost:  40, key: 'workerCarry',  max: 12, minPhase: 2 },
  { num: 4, name: 'Worker Speed +0.25',   cost:  60, key: 'workerSpeed',  max: 6,  minPhase: 2 },
  { num: 5, name: 'Courier Carry +5',     cost:  80, key: 'courierCarry', max: 8,  minPhase: 2 },
  { num: 6, name: 'Courier Speed +0.5',   cost: 100, key: 'courierSpeed', max: 4,  minPhase: 2 },
  { num: 7, name: 'Storage Expansion I',  cost: 200, key: 'storageExp1',  max: 1,  minPhase: 3 },
  { num: 8, name: 'Storage Expansion II', cost: 500, key: 'storageExp2',  max: 1,  minPhase: 3, requires: 'storageExp1', requiresLabel: 'Expansion I' },
  { num: 9, name: 'Reduced Carry Cost',   cost: 300, key: 'reducedCarry', max: 1,  minPhase: 3 },
  { num:10, name: 'Market Discount Dump', cost: 250, key: 'discountDump', max: 1,  minPhase: 3 },
];

function showOfficeMenu() {
  state.gameState = 'menu';

  const visibleNodes = OFFICE_NODES.filter(n => state.phase >= n.minPhase);
  const BOX_W  = 68;
  const BOX_H  = 7 + visibleNodes.length + 5; // header(5) + nodes + footer(5) + 2 borders
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(10, Math.floor((WORLD_ROWS  - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4; // 64 chars
  const WC     = '#555555';

  function redraw() {
    // Frame + clear
    display.draw(BOX_X, BOX_Y, '+', WC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y, '+', WC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '-', WC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '+', WC, BG);
    display.draw(BOX_X + BOX_W - 1, botY, '+', WC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, botY, '-', WC, BG);
    for (let y = 1; y < BOX_H - 1; y++) {
      display.draw(BOX_X, BOX_Y + y, '|', WC, BG);
      display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '|', WC, BG);
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + y, ' ', BRIGHT_WHITE, BG);
    }

    // Title centered
    const TITLE = '– THE OFFICE –';
    const titleX = CONT_X + Math.floor((CONT_W - TITLE.length) / 2);
    for (let i = 0; i < TITLE.length; i++) display.draw(titleX + i, BOX_Y + 2, TITLE[i], BRIGHT_CYAN, BG);

    // Subtitle
    const sub = 'Upgrades are purchased with credits.';
    for (let i = 0; i < sub.length; i++) display.draw(CONT_X + i, BOX_Y + 3, sub[i], WC, BG);

    // Nodes (start at BOX_Y + 5)
    const unlocked = state.officeUnlocked;
    for (let i = 0; i < visibleNodes.length; i++) {
      const node  = visibleNodes[i];
      const level = state.skills[node.key] || 0;
      const costStr = `${node.cost}cr`.padEnd(7);
      let label = node.name;
      if (node.max > 1 && level > 0) label += `  (level ${level})`;
      let fg, suffix;
      if (!unlocked) {
        fg = WC; suffix = '[LOCKED — reach Phase 2]';
      } else if (node.requires && !state.skills[node.requires]) {
        fg = WC; suffix = `[Requires ${node.requiresLabel}]`;
      } else if (level >= node.max) {
        fg = WC; suffix = node.max === 1 ? '[Purchased]' : '[Max level]';
      } else if (state.player.credits < node.cost) {
        fg = '#ff5555'; suffix = `[Need ${node.cost - state.player.credits}cr more]`;
      } else {
        fg = '#66cc66'; suffix = '[Available]';
      }
      const line = `${node.num}. ${label.padEnd(26)} ${costStr} ${suffix}`;
      for (let j = 0; j < line.length; j++) display.draw(CONT_X + j, BOX_Y + 5 + i, line[j], fg, BG);
    }

    // ESC hint centered at second-to-last row
    const ESC = 'ESC to close';
    const escX = CONT_X + Math.floor((CONT_W - ESC.length) / 2);
    for (let i = 0; i < ESC.length; i++) display.draw(escX + i, BOX_Y + BOX_H - 2, ESC[i], WC, BG);
  }

  redraw();

  function closeOffice() {
    window.removeEventListener('keydown', officeKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function officeKeyHandler(e) {
    if (e.key === 'Escape') { closeOffice(); return; }
    const pressedNum = e.key === '0' ? 10 : parseInt(e.key);
    const node = visibleNodes.find(n => n.num === pressedNum);
    if (!node) return;
    if (!state.officeUnlocked) return;
    if (node.requires && !state.skills[node.requires]) return;
    const level = state.skills[node.key] || 0;
    if (level >= node.max) return;
    if (state.player.credits < node.cost) return;
    state.player.credits -= node.cost;
    state.skills[node.key] = level + 1;
    if (node.key === 'apprentice') {
      const ofDef = STATION_DEFS.find(s => s.label === 'OF');
      state.workers.apprentices.push({
        x: ofDef.x + 1, y: ofDef.y + 2,
        workerState: 'idle',
        carryRM: 0, carryWidgets: 0,
        target: { x: 0, y: 0 },
        craftTimer: 0,
        paused: false,
      });
    }
    if (node.key === 'courier') {
      const ofDef = STATION_DEFS.find(s => s.label === 'OF');
      state.workers.couriers.push({
        x: ofDef.x + 1, y: ofDef.y + 2,
        courierState: 'idle',
        carryWidgets: 0,
        target: { x: 0, y: 0 },
      });
      state.couriersOwned++;
    }
    if (node.key === 'storageExp1') {
      state.storage.widgetCap = 100;
      state.storage.rmCap     = 100;
    }
    if (node.key === 'storageExp2') {
      state.storage.widgetCap = 200;
      state.storage.rmCap     = 200;
    }
    addLog(`${node.name} purchased.`, '#cc66cc');
    drawStatusBar();
    redraw();
  }
  window.addEventListener('keydown', officeKeyHandler);
}

function handlePonder() {
  const inv = state.player.inventory;
  let hint;
  if (state.lifetimeCreditsEarned === 0) {
    hint = 'The shed to the north sells raw materials. The workbench crafts them.';
  } else if (inv.rm > 0 && inv.widgets === 0) {
    hint = "Those materials won't shape themselves. The workbench is waiting.";
  } else if (inv.widgets > 0 && state.marketOpen) {
    hint = 'The market is open. Someone out there wants what you\'ve made.';
  } else if (inv.widgets > 0 && !state.marketOpen) {
    hint = 'The market is dark. Wait for dawn, or use the time wisely.';
  } else if (state.lifetimeCreditsEarned >= 100 && state.phase === 1) {
    hint = "You're finding a rhythm. The Office door looks less dusty than it did.";
  } else {
    hint = 'Keep working. The numbers will move.';
  }
  wrapLog(hint, '#66ccff');
}

function openStorageMenu() {
  if (!state.stations.storage.unlocked) return;
  state.gameState = 'menu';

  const BOX_W  = 44;
  const BOX_H  = 17;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(10, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4; // 40
  const WC     = '#555555';
  const st     = state.storage;

  function drawBar(row, label, current, max, barFg) {
    const BAR_W  = 10;
    const filled = max > 0 ? Math.min(Math.round(current / max * BAR_W), BAR_W) : 0;
    const lbl    = label.padEnd(17);
    const count  = `${current} / ${max}`.padStart(7);
    for (let i = 0; i < 17; i++) display.draw(CONT_X+i, BOX_Y+row, lbl[i], BRIGHT_WHITE, BG);
    display.draw(CONT_X+17, BOX_Y+row, '[', WC, BG);
    for (let i = 0; i < BAR_W; i++)
      display.draw(CONT_X+18+i, BOX_Y+row, i < filled ? '=' : ' ', i < filled ? barFg : WC, BG);
    display.draw(CONT_X+28, BOX_Y+row, ']', WC, BG);
    for (let i = 0; i < count.length; i++) display.draw(CONT_X+29+i, BOX_Y+row, count[i], BRIGHT_WHITE, BG);
  }

  function redraw() {
    display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, botY, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, botY, '-', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }
    const TITLE = '– STORAGE –';
    const titleX = CONT_X + Math.floor((CONT_W - TITLE.length) / 2);
    for (let i = 0; i < TITLE.length; i++) display.draw(titleX+i, BOX_Y+1, TITLE[i], '#66ccff', BG);
    drawBar(3, 'Widgets stored:', st.widgets, st.widgetCap, '#f0f0f0');
    drawBar(4, 'Raw Materials:', st.rm, st.rmCap, '#ff9933');
    for (let i = 0; i < CONT_W; i++) display.draw(CONT_X+i, BOX_Y+6, '-', WC, BG);
    const ah = 'Auto-halt when full: ON';
    for (let i = 0; i < ah.length; i++) display.draw(CONT_X+i, BOX_Y+8, ah[i], '#66cc66', BG);
    for (const [idx, txt] of [
      [0, '1. Take all widgets'], [1, '2. Deposit all widgets'],
      [2, '3. Take all RM'],      [3, '4. Deposit all RM'],
    ]) for (let j = 0; j < txt.length; j++) display.draw(CONT_X+j, BOX_Y+10+idx, txt[j], BRIGHT_WHITE, BG);
    const ESC = 'ESC to close';
    const escX = CONT_X + Math.floor((CONT_W - ESC.length) / 2);
    for (let i = 0; i < ESC.length; i++) display.draw(escX+i, BOX_Y+BOX_H-2, ESC[i], WC, BG);
  }

  redraw();

  function closeStorage() {
    window.removeEventListener('keydown', storageKeyHandler);
    for (let y = BOX_Y; y < BOX_Y+BOX_H; y++)
      for (let x = BOX_X; x < BOX_X+BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function storageKeyHandler(e) {
    if (e.key === 'Escape') { closeStorage(); return; }
    const inv = state.player.inventory;
    const cap = state.player.inventoryCaps;
    if (e.key === '1') {
      const take = Math.min(st.widgets, cap.widgets - inv.widgets);
      if (take > 0) { st.widgets -= take; inv.widgets += take;
        addLog(`You take ${take} widget${take !== 1 ? 's' : ''} from storage.`, BRIGHT_CYAN);
        drawStatusBar(); redraw(); }
    } else if (e.key === '2') {
      const dep = Math.min(inv.widgets, st.widgetCap - st.widgets);
      if (dep > 0) { inv.widgets -= dep; st.widgets += dep;
        addLog(`You deposit ${dep} widget${dep !== 1 ? 's' : ''} into storage.`, BRIGHT_CYAN);
        drawStatusBar(); redraw(); }
    } else if (e.key === '3') {
      const take = Math.min(st.rm, cap.rm - inv.rm);
      if (take > 0) { st.rm -= take; inv.rm += take;
        addLog(`You take ${take} raw material${take !== 1 ? 's' : ''} from storage.`, BRIGHT_CYAN);
        drawStatusBar(); redraw(); }
    } else if (e.key === '4') {
      const dep = Math.min(inv.rm, st.rmCap - st.rm);
      if (dep > 0) { inv.rm -= dep; st.rm += dep;
        addLog(`You deposit ${dep} raw material${dep !== 1 ? 's' : ''} into storage.`, BRIGHT_CYAN);
        drawStatusBar(); redraw(); }
    }
  }
  window.addEventListener('keydown', storageKeyHandler);
}

function showWorkerManagement() {
  state.gameState = 'menu';
  const apprentices = state.workers.apprentices;
  const n           = apprentices.length;
  const carryMax    = 3 + state.skills.workerCarry;

  const BOX_W  = 64;
  const BOX_H  = 7 + 2 * n;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(10, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4; // 60
  const WC     = '#555555';

  function redraw() {
    display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, botY, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, botY, '-', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }
    const TITLE = '– WORKERS –';
    const titleX = CONT_X + Math.floor((CONT_W - TITLE.length) / 2);
    for (let i = 0; i < TITLE.length; i++) display.draw(titleX+i, BOX_Y+1, TITLE[i], '#66ccff', BG);
    if (n === 0) {
      const msg = 'No workers hired yet.';
      for (let i = 0; i < msg.length; i++) display.draw(CONT_X+i, BOX_Y+3, msg[i], WC, BG);
    } else {
      for (let i = 0; i < n; i++) {
        const w      = apprentices[i];
        const stLabel = `Apprentice ${i+1}: `;
        const stStr   = (w.paused ? 'PAUSED' : w.workerState.toUpperCase()).padEnd(9);
        const stFg    = w.paused ? '#ff5555' : '#66cc66';
        const carry   = `carry: ${w.carryRM}/${carryMax} RM`.padEnd(16);
        const pos     = `pos: (${w.x}, ${w.y})`;
        let col = CONT_X;
        for (const ch of stLabel) { display.draw(col++, BOX_Y+3+i, ch, BRIGHT_WHITE, BG); }
        for (const ch of stStr)   { display.draw(col++, BOX_Y+3+i, ch, stFg,          BG); }
        for (const ch of ('    ' + carry + '   ' + pos)) { display.draw(col++, BOX_Y+3+i, ch, BRIGHT_WHITE, BG); }
        // Toggle row
        const mode = w.paused ? 'IDLE → AUTO' : 'AUTO → IDLE';
        const tLine = `[${i+1}] Apprentice ${i+1}: ${mode}`;
        const tFg   = w.paused ? '#ff5555' : '#66cc66';
        for (let j = 0; j < tLine.length; j++) display.draw(CONT_X+j, BOX_Y+4+n+i, tLine[j], tFg, BG);
      }
    }
    const ESC = 'ESC to close';
    const escX = CONT_X + Math.floor((CONT_W - ESC.length) / 2);
    for (let i = 0; i < ESC.length; i++) display.draw(escX+i, BOX_Y+BOX_H-2, ESC[i], WC, BG);
  }

  redraw();

  function closeWorkers() {
    window.removeEventListener('keydown', workerKeyHandler);
    for (let y = BOX_Y; y < BOX_Y+BOX_H; y++)
      for (let x = BOX_X; x < BOX_X+BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function workerKeyHandler(e) {
    if (e.key === 'Escape') { closeWorkers(); return; }
    const num = parseInt(e.key);
    if (num >= 1 && num <= n) {
      apprentices[num - 1].paused = !apprentices[num - 1].paused;
      redraw();
    }
  }
  window.addEventListener('keydown', workerKeyHandler);
}

function showOfficeDispatch() {
  state.gameState = 'menu';
  const WC    = '#555555';
  const lines = ['1. Upgrades', '2. Manage Workers'];
  const INNER = Math.max('– THE OFFICE –'.length, ...lines.map(l => l.length));
  const BOX_W = INNER + 4;
  const BOX_H = 7; // top + title + blank + 2 options + blank + bottom
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(10, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CX    = BOX_X + 2;

  display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }
  const TITLE = '– THE OFFICE –';
  for (let i = 0; i < TITLE.length; i++) display.draw(CX+i, BOX_Y+1, TITLE[i], BRIGHT_CYAN, BG);
  for (let i = 0; i < lines.length; i++)
    for (let j = 0; j < lines[i].length; j++) display.draw(CX+j, BOX_Y+3+i, lines[i][j], BRIGHT_WHITE, BG);

  function close(goPlay) {
    window.removeEventListener('keydown', dispatchKeyHandler);
    for (let y = BOX_Y; y < BOX_Y+BOX_H; y++)
      for (let x = BOX_X; x < BOX_X+BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    if (goPlay) state.gameState = 'playing';
  }

  function dispatchKeyHandler(e) {
    if (e.key === 'Escape') { close(true); return; }
    if (e.key === '1') { close(false); showOfficeMenu(); return; }
    if (e.key === '2') { close(false); showWorkerManagement(); return; }
  }
  window.addEventListener('keydown', dispatchKeyHandler);
}

function handleInteract() {
  const rm = STATION_DEFS.find(s => s.label === 'RM');
  if (rm && isAdjacentToStation(rm)) { openRMShedMenu(); return; }
  const wb = STATION_DEFS.find(s => s.label === 'WB');
  if (wb && isAdjacentToStation(wb)) { openWorkbenchMenu(); return; }
  const mt = STATION_DEFS.find(s => s.label === 'MT');
  if (mt && isAdjacentToStation(mt)) { openMarketMenu(); return; }
  const of = STATION_DEFS.find(s => s.label === 'OF');
  if (of && isAdjacentToStation(of)) {
    state.officeUnlocked ? showOfficeDispatch() : showOfficeMenu();
    return;
  }
  const stStation = STATION_DEFS.find(s => s.label === 'ST');
  if (stStation && isAdjacentToStation(stStation)) { openStorageMenu(); return; }
}

// ── Inventory screen (§3.9) ──────────────────────────────────────────────────

function showInventory() {
  state.gameState = 'inventory';

  const BOX_W  = 40;
  const BOX_H  = state.phase >= 3 ? 18 : 16;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(10, Math.floor((WORLD_ROWS  - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4; // 36
  const WC     = '#555555';

  // Frame
  display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
  const botY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, botY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, botY, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, botY, '-', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }

  // Column layout (relative to CONT_X):
  //  0–14  label (15 chars)
  //    15  [ or space
  // 16–25  bar fill or symbol fill (10 chars)
  //    26  ] or space
  // 27–33  count / value (7 chars, right-aligned)

  function drawBar(row, label, current, max, barFg, labelFg) {
    const BAR_W  = 10;
    const filled = max > 0 ? Math.min(Math.round(current / max * BAR_W), BAR_W) : 0;
    const lbl    = label.padEnd(15);
    const count  = `${current} / ${max}`.padStart(7);
    for (let i = 0; i < 15; i++) display.draw(CONT_X+i, BOX_Y+row, lbl[i], labelFg, BG);
    display.draw(CONT_X+15, BOX_Y+row, '[', WC, BG);
    for (let i = 0; i < BAR_W; i++) {
      const ch = i < filled ? '=' : ' ';
      display.draw(CONT_X+16+i, BOX_Y+row, ch, i < filled ? barFg : WC, BG);
    }
    display.draw(CONT_X+26, BOX_Y+row, ']', WC, BG);
    for (let i = 0; i < count.length; i++) display.draw(CONT_X+27+i, BOX_Y+row, count[i], labelFg, BG);
  }

  function drawSymRow(row, label, sym, symFg, value, valFg) {
    const SYM_W = 10;
    const syms  = Math.min(Math.floor(value / 10), SYM_W);
    const lbl   = label.padEnd(15);
    const val   = `${value}cr`.padStart(7);
    for (let i = 0; i < 15; i++) display.draw(CONT_X+i, BOX_Y+row, lbl[i], WC, BG);
    for (let i = 0; i < SYM_W; i++) {
      display.draw(CONT_X+16+i, BOX_Y+row, i < syms ? sym : ' ', i < syms ? symFg : WC, BG);
    }
    for (let i = 0; i < val.length; i++) display.draw(CONT_X+27+i, BOX_Y+row, val[i], valFg, BG);
  }

  const inv = state.player.inventory;
  const cap = state.player.inventoryCaps;

  // Row 1 — title
  const TITLE = '-- INVENTORY --';
  const titleX = CONT_X + Math.floor((CONT_W - TITLE.length) / 2);
  for (let i = 0; i < TITLE.length; i++) display.draw(titleX+i, BOX_Y+1, TITLE[i], BRIGHT_CYAN, BG);

  // Rows 3–4 — fill bars
  drawBar(3, 'Raw Materials', inv.rm,      cap.rm,      '#66cc66', '#ff9933');
  drawBar(4, 'Widgets',       inv.widgets, cap.widgets, '#66cc66', BRIGHT_WHITE);

  // Row 6 — divider
  for (let i = 0; i < CONT_W; i++) display.draw(CONT_X+i, BOX_Y+6, '.', WC, BG);

  // Rows 8–9 — credits and lifetime
  drawSymRow(8, 'Credits',  '$', '#ffd633', state.player.credits,            '#ffd633');
  drawSymRow(9, 'Lifetime', '~', WC,        state.lifetimeCreditsEarned,     WC);

  // Row 11 — day / market status
  const ms   = state.marketOpen ? 'OPEN' : 'CLOSED';
  const mFg  = state.marketOpen ? BRIGHT_YELLOW : WC;
  const mRem = state.marketOpen ? (180 - state.dayTick) : (240 - state.dayTick);
  const pre  = `Day ${state.day}   Market: `;
  const post = `   ${mRem}s left`;
  let sx = CONT_X;
  for (const ch of pre)  { display.draw(sx++, BOX_Y+11, ch, BRIGHT_WHITE, BG); }
  for (const ch of ms)   { display.draw(sx++, BOX_Y+11, ch, mFg,          BG); }
  for (const ch of post) { display.draw(sx++, BOX_Y+11, ch, BRIGHT_WHITE, BG); }

  // Row 13 — storage cost (phase 3+) or ESC hint
  if (state.phase >= 3) {
    const mult      = state.skills.reducedCarry ? 0.1 : 0.2;
    const costPerDay = Math.round(state.storage.widgets * mult * 10) / 10;
    const costLine  = `Storage cost/day: ${costPerDay}cr`;
    for (let i = 0; i < costLine.length; i++) display.draw(CONT_X+i, BOX_Y+13, costLine[i], '#ff5555', BG);
    if (state.debt > 0) {
      const debtLine = `Debt: ${state.debt}cr`;
      for (let i = 0; i < debtLine.length; i++) display.draw(CONT_X+i, BOX_Y+14, debtLine[i], '#ff5555', BG);
    }
  }

  // Row 15 (or 13 in phase <3) — ESC hint centered
  const escRow = state.phase >= 3 ? 15 : 13;
  const ESC = '[ ESC to close ]';
  const escX = CONT_X + Math.floor((CONT_W - ESC.length) / 2);
  for (let i = 0; i < ESC.length; i++) display.draw(escX+i, BOX_Y+escRow, ESC[i], WC, BG);

  function closeInventory() {
    window.removeEventListener('keydown', invKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function invKeyHandler(e) {
    if (e.key === 'Escape' || e.key === 'i') closeInventory();
  }
  window.addEventListener('keydown', invKeyHandler);
}

// ── Apprentice worker logic (§5.3) ───────────────────────────────────────────

function tickApprentices() {
  const rmDef  = STATION_DEFS.find(s => s.label === 'RM');
  const wbDef  = STATION_DEFS.find(s => s.label === 'WB');
  const rmDoor = { x: rmDef.x + 1, y: rmDef.y + 2 };  // (10, 4)
  const wbDoor = { x: wbDef.x + 1, y: wbDef.y + 2 };  // (35, 10)
  const speed    = Math.max(1, Math.round(1 + state.skills.workerSpeed * 0.25));
  const carryMax = 3 + state.skills.workerCarry;

  for (const w of state.workers.apprentices) {
    if (w.paused) continue; // worker is paused — skip all logic, position unchanged

    markDirty(w.x, w.y); // erase from old position

    // Idle → fetching
    if (w.workerState === 'idle' && !state.productionHalted) {
      w.target = { ...rmDoor };
      w.workerState = 'fetching';
    }

    // Movement
    if (w.workerState === 'fetching' || w.workerState === 'returning') {
      for (let step = 0; step < speed; step++) {
        const dx = w.target.x - w.x;
        const dy = w.target.y - w.y;
        if (dx === 0 && dy === 0) break;
        if (Math.abs(dx) >= Math.abs(dy)) {
          w.x += dx > 0 ? 1 : -1;
        } else {
          w.y += dy > 0 ? 1 : -1;
        }
      }

      // Arrived at RM shed?
      if (w.workerState === 'fetching' &&
          Math.abs(w.x - rmDoor.x) <= 1 && Math.abs(w.y - rmDoor.y) <= 1) {
        if (state.phase >= 2 && state.rmPurchasedToday >= 100) {
          if (!state.rmLimitLogged) {
            state.rmLimitLogged = true;
            addLog('Daily RM limit reached. Workers waiting for dawn.', '#ff5555');
          }
          w.workerState = 'idle';
        } else {
          const space = carryMax - w.carryRM;
          let bought = 0;
          while (bought < space && state.player.credits >= 3) {
            if (state.phase >= 2 && state.rmPurchasedToday >= 100) break;
            state.player.credits   -= 3;
            state.rmPurchasedToday += 1;
            w.carryRM++;
            bought++;
          }
          if (bought > 0) drawStatusBar();
          w.target = { ...wbDoor };
          w.workerState = 'returning';
        }
      }

      // Arrived at workbench?
      if (w.workerState === 'returning' &&
          Math.abs(w.x - wbDoor.x) <= 1 && Math.abs(w.y - wbDoor.y) <= 1) {
        if (w.carryRM > 0) {
          w.workerState = 'crafting';
          w.craftTimer = 3;
        } else {
          w.workerState = 'idle';
        }
      }
    }

    // Crafting
    if (w.workerState === 'crafting') {
      const stUnlocked = state.stations.storage.unlocked;
      const depositFull = stUnlocked
        ? state.storage.widgets >= state.storage.widgetCap
        : state.workbenchWidgets >= 20;
      if (depositFull) {
        if (!stUnlocked && !state.wbFullLogged) {
          state.wbFullLogged = true;
          addLog('Workbench full. Waiting for pickup.', '#ff5555');
        }
      } else {
        if (!stUnlocked) state.wbFullLogged = false;
        w.craftTimer--;
        if (w.craftTimer <= 0) {
          if (stUnlocked) state.storage.widgets++;
          else             state.workbenchWidgets++;
          w.carryRM--;
          if (w.carryRM > 0) { w.craftTimer = 3; }
          else                { w.workerState = 'idle'; }
        }
      }
    }

    markDirty(w.x, w.y); // mark new position
  }
}

// ── Courier robot logic (§5.3) ───────────────────────────────────────────────

function tickCouriers() {
  const stDef  = STATION_DEFS.find(s => s.label === 'ST');
  const mtDef  = STATION_DEFS.find(s => s.label === 'MT');
  const stDoor = { x: stDef.x + 1, y: stDef.y + 2 }; // (24, 34)
  const mtDoor = { x: mtDef.x + 1, y: mtDef.y + 2 }; // (62, 25)
  const speed    = Math.max(1, Math.round(1 + state.skills.courierSpeed * 0.5));
  const carryMax = 10 + state.skills.courierCarry * 5;
  const PRICE    = state.marketPrice;

  function moveToward(c, target) {
    for (let s = 0; s < speed; s++) {
      const dx = target.x - c.x, dy = target.y - c.y;
      if (dx === 0 && dy === 0) break;
      if (Math.abs(dx) >= Math.abs(dy)) c.x += dx > 0 ? 1 : -1;
      else c.y += dy > 0 ? 1 : -1;
    }
  }

  function near(c, door) {
    return Math.abs(c.x - door.x) <= 1 && Math.abs(c.y - door.y) <= 1;
  }

  for (const c of state.workers.couriers) {
    markDirty(c.x, c.y);

    if (c.courierState === 'idle') {
      if (state.storage.widgets > 0) {
        c.target = { ...stDoor };
        c.courierState = 'loading';
      }
    }

    if (c.courierState === 'loading') {
      moveToward(c, stDoor);
      if (near(c, stDoor)) {
        const take = Math.min(state.storage.widgets, carryMax);
        state.storage.widgets -= take;
        c.carryWidgets = take;
        c.target = { ...mtDoor };
        c.courierState = 'delivering';
      }
    }

    if (c.courierState === 'delivering') {
      if (!near(c, mtDoor)) moveToward(c, mtDoor);
      if (near(c, mtDoor)) {
        const demandLeft = state.phase >= 3 ? (state.demand - state.widgetsSoldToday) : Infinity;
        if (state.marketOpen && c.carryWidgets > 0 && demandLeft > 0) {
          const n = state.phase >= 3 ? Math.min(c.carryWidgets, demandLeft) : c.carryWidgets;
          const earned = n * PRICE;
          state.player.credits += earned;
          state.lifetimeCreditsEarned += earned;
          if (state.phase >= 3) state.widgetsSoldToday += n;
          c.carryWidgets -= n;
          addLog(`Courier sold ${n} widget${n !== 1 ? 's' : ''} for ${earned}cr.`, '#66cc66');
          drawStatusBar();
          checkPhase2Trigger();
          c.target = { ...stDoor };
          c.courierState = 'returning';
        } else if (!state.marketOpen || demandLeft <= 0) {
          // market closed or demand exhausted: return
          c.target = { ...stDoor };
          c.courierState = 'returning';
        }
      }
    }

    if (c.courierState === 'returning') {
      moveToward(c, stDoor);
      if (near(c, stDoor)) c.courierState = 'idle';
    }

    markDirty(c.x, c.y);
  }
}

// ── Production constraints (§5.3) ────────────────────────────────────────────

function checkProductionHalt() {
  if (state.storage.widgets >= state.storage.widgetCap) {
    if (state.skills.discountDump) {
      // Dump overflow at 50% market price rather than halting
      const n = state.storage.widgets;
      if (n > 0) {
        const dumpPrice = Math.round(state.marketPrice * 0.5 * 10) / 10;
        state.player.credits += Math.round(n * dumpPrice * 10) / 10;
        state.storage.widgets = 0;
        addLog(`Discount dump: ${n} widget${n !== 1 ? 's' : ''} sold at ${dumpPrice}cr each.`, '#ff9933');
        drawStatusBar();
      }
      if (state.productionHalted) {
        state.productionHalted = false;
      }
    } else if (!state.productionHalted) {
      state.productionHalted = true;
      for (const w of state.workers.apprentices) w.workerState = 'idle';
      addLog('Storage full. Production halted.', '#ff5555');
    }
  } else if (state.productionHalted) {
    state.productionHalted = false;
    addLog('Storage space available. Production resuming.', '#66cc66');
  }
}

// ── Pause menu and dev tools (§3.9) ──────────────────────────────────────────

function devJumpToPhase(n) {
  const credits = { 1: 50, 2: 500, 3: 2000, 4: 5000 };
  resetState();
  state.phase = n;
  state.player.credits = credits[n];
  state.lifetimeCreditsEarned = credits[n];
  if (n >= 2) {
    state.officeUnlocked = true;
    state.stations.factory.unlocked = true;
    state.stations.storage.unlocked = true;
    const fcD = STATION_DEFS.find(s => s.label === 'FC');
    const stD = STATION_DEFS.find(s => s.label === 'ST');
    if (fcD) { fcD.wc = '#555555'; fcD.lc = '#ff9933'; }
    if (stD) { stD.wc = '#555555'; stD.lc = '#66ccff'; }
  }
  if (n >= 3) {
    state.stations.bank = { unlocked: true };
    const bkD = STATION_DEFS.find(s => s.label === 'BK');
    if (bkD) { bkD.wc = '#555555'; bkD.lc = '#66cc66'; }
    calculateDailyDemand();
    state.widgetsSoldToday = 0;
  }
  if (n >= 4) state.stations.derivatives = { unlocked: true };
  state.gameState = 'playing';
  clearScreen();
  drawWorld();
  addLog(`DEV: Jumped to Phase ${n}.`, '#ff5555');
}

function showPauseMenu() {
  const prevState = state.gameState !== 'paused' ? state.gameState : 'playing';
  state.gameState = 'paused';

  const BOX_W  = 54;
  const BOX_H  = 12;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(5, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4; // 50
  const WC     = '#555555';

  // Draw fixed frame (stays across all sub-screens)
  display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', WC, BG);
    display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
  }

  let screen = 'pause';

  function clearInner() {
    for (let y = 1; y < BOX_H-1; y++)
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }

  function line(row, text, fg) {
    for (let i = 0; i < text.length; i++) display.draw(CONT_X+i, BOX_Y+row, text[i], fg, BG);
  }
  function centered(row, text, fg) {
    const cx = CONT_X + Math.floor((CONT_W - text.length) / 2);
    for (let i = 0; i < text.length; i++) display.draw(cx+i, BOX_Y+row, text[i], fg, BG);
  }

  function render() {
    clearInner();
    if (screen === 'pause') {
      centered(1, '– PAUSED –', '#66ccff');
      line(3, '1. Resume',          BRIGHT_WHITE);
      line(4, '2. Settings',        BRIGHT_WHITE);
      line(5, '3. Quit to Menu',    BRIGHT_WHITE);
      centered(10, 'ESC to resume', WC);
    } else if (screen === 'settings') {
      centered(1, '– SETTINGS –', '#66ccff');
      line(3, `1. Mute / Unmute sounds  [${state.audio.muted ? 'OFF' : 'ON '}]`, BRIGHT_WHITE);
      line(4, '2. Developer Mode',  BRIGHT_WHITE);
      line(5, '3. Back',            BRIGHT_WHITE);
      centered(10, 'ESC to go back', WC);
    } else {
      centered(1, '– DEV MODE –', '#ff5555');
      line(2, 'For testing only.', WC);
      line(4, '1. Jump to Phase 1  (fresh start, 50cr)',         BRIGHT_WHITE);
      line(5, '2. Jump to Phase 2  (500cr, workers unlocked)',   BRIGHT_WHITE);
      line(6, '3. Jump to Phase 3  (2000cr, bank unlocked)',     BRIGHT_WHITE);
      line(7, '4. Jump to Phase 4  (5000cr, derivatives unlocked)', BRIGHT_WHITE);
      line(8, '5. Back',            BRIGHT_WHITE);
      centered(10, 'ESC to go back', WC);
    }
  }

  render();

  function close() {
    window.removeEventListener('keydown', pauseKeyHandler);
    for (let y = BOX_Y; y < BOX_Y+BOX_H; y++)
      for (let x = BOX_X; x < BOX_X+BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = prevState;
  }

  function pauseKeyHandler(e) {
    if (screen === 'pause') {
      if (e.key === '1' || e.key === 'Escape') { close(); }
      else if (e.key === '2') { screen = 'settings'; render(); }
      else if (e.key === '3') {
        window.removeEventListener('keydown', pauseKeyHandler);
        saveGame();
        showContinueMenu();
      }
    } else if (screen === 'settings') {
      if (e.key === '1') { state.audio.muted = !state.audio.muted; saveGame(); render(); }
      else if (e.key === '2') { screen = 'dev'; render(); }
      else if (e.key === '3' || e.key === 'Escape') { screen = 'pause'; render(); }
    } else {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 4) {
        window.removeEventListener('keydown', pauseKeyHandler);
        devJumpToPhase(num);
      } else if (e.key === '5' || e.key === 'Escape') { screen = 'settings'; render(); }
    }
  }
  window.addEventListener('keydown', pauseKeyHandler);
}

// ── Tick loop — 1 tick/second (§7.1) ─────────────────────────────────────────

setInterval(() => {
  if (state.gameState !== 'playing' && state.gameState !== 'crafting') return;

  state.tick++;
  state.dayTick++;
  if (state.dayTick >= 240) { state.dayTick = 0; state.day++; state.bellFiredToday = false; state.rmPurchasedToday = 0; state.rmLimitLogged = false; state.widgetsSoldToday = 0; state.demandMetLogged = false; }
  state.marketOpen = state.dayTick < 180;
  if (state.dayTick === 0 && !state.bellFiredToday) {
    state.bellFiredToday = true;
    addLog('The morning bell has rung.', BRIGHT_CYAN);
    if (state.phase >= 3) {
      calculateDailyDemand();
      const dl = demandLabel(state.demand);
      wrapLog(`Market demand today: ${dl.text}. Price: ${state.marketPrice}cr/widget.`, dl.fg);
    }
  }
  drawTimeIndicator();

  if (state.gameState === 'crafting') {
    const secsLeft = CRAFT_TICKS - craftProgress;
    drawRow(LOG_END_ROW, `> Crafting — ${secsLeft}s remaining`, '#ff9933');
    craftProgress++;
    pulseWB();
    if (craftProgress >= CRAFT_TICKS) {
      craftProgress = 0;
      state.player.inventory.widgets++;
      drawStatusBar();
      if (craftQueue > 0) {
        const stillLeft = craftQueue;
        craftQueue--;
        state.player.inventory.rm--;
        addLog(`Widget complete. ${stillLeft} remaining.`, '#66cc66');
        drawStatusBar();
      } else {
        addLog(`Done. ${craftTotal} widget${craftTotal !== 1 ? 's' : ''} crafted.`, '#66cc66');
        state.gameState = 'playing';
      }
    }
  }

  // Workers — §5.3
  if (state.workers.apprentices.length > 0) tickApprentices();
  if (state.workers.couriers.length > 0)    tickCouriers();
  if (state.workers.apprentices.length > 0 || state.workers.couriers.length > 0) {
    renderDirty();
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
  }
  checkProductionHalt();
  checkPhase3Trigger();

  // Cost of carry — fires on the last tick of each day (§5.4)
  if (state.dayTick === 239 && state.phase >= 3) {
    // First: attempt to clear any existing debt
    if (state.debt > 0) {
      const debtPayment = Math.min(state.player.credits, state.debt);
      state.player.credits = Math.round((state.player.credits - debtPayment) * 10) / 10;
      state.debt           = Math.round((state.debt - debtPayment) * 10) / 10;
      if (state.debt > 0) {
        state.debtDaysUnpaid++;
        if (state.debtDaysUnpaid >= 3) addLog('Your debts are mounting. Consider the Bank.', '#ff5555');
      } else {
        state.debtDaysUnpaid = 0;
      }
    }
    // Then: charge carry cost on stored widgets
    const mult      = state.skills.reducedCarry ? 0.1 : 0.2;
    const carryCost = Math.round(state.storage.widgets * mult * 10) / 10;
    if (carryCost > 0) {
      if (state.player.credits >= carryCost) {
        state.player.credits = Math.round((state.player.credits - carryCost) * 10) / 10;
        addLog(`Storage cost: ${carryCost}cr for ${state.storage.widgets} widgets held.`, '#ff5555');
      } else {
        const shortfall = Math.round((carryCost - state.player.credits) * 10) / 10;
        state.debt           = Math.round((state.debt + shortfall) * 10) / 10;
        state.player.credits = 0;
        addLog(`Insufficient credits for storage cost. Debt: ${state.debt}cr.`, '#ff5555');
      }
      drawStatusBar();
    }
  }

  // Ambient flavor events — §13
  if (state.tick - state.lastAmbientTick  > state.nextAmbientDelay &&
      state.tick - state.lastNarrativeTick > 15) {
    const AMBIENT = [
      'A leaf falls.',
      'You hear the bell of a distant cart.',
      'A bird lands on the workbench roof and flies away.',
      'The wind picks up briefly, then settles.',
      'Somewhere, a dog barks.',
      'A cloud passes over the sun.',
      'Your boots crunch on a small stone.',
      'The smell of rain, faint.',
      'A voice carries from far away — unintelligible.',
      'You feel the weight of the day.',
      'Something rustles in the tall grass.',
      'The pond catches the light for a moment.',
      'A bee drifts past, unhurried.',
      'The shadows shift slightly.',
      'You notice how quiet it is.',
    ];
    if (state.phase >= 2) {
      AMBIENT.push(
        'A worker laughs at something across the yard.',
        'You hear the sound of tools from the workbench.',
        'One of your workers waves. You nod back.',
        'The courier returns empty-handed, then sets off again.',
      );
    }
    addLog(AMBIENT[Math.floor(Math.random() * AMBIENT.length)], '#555555');
    state.lastAmbientTick  = state.tick;
    state.nextAmbientDelay = 30 + Math.floor(Math.random() * 91); // 30–120
  }

  // Pond shimmer — §4.2
  if (state.tick % 8 === 0 && shimmerTiles.length >= 2) {
    for (const key of shimmerActive) {
      const [sx, sy] = key.split(',').map(Number);
      tileMap[sx][sy].fg = '#1a4a6a';
      markDirty(sx, sy);
    }
    shimmerActive.clear();
    const indices = new Set();
    while (indices.size < 2) indices.add(Math.floor(Math.random() * shimmerTiles.length));
    for (const i of indices) {
      const { x: sx, y: sy } = shimmerTiles[i];
      tileMap[sx][sy].fg = '#1a6a8a';
      shimmerActive.add(`${sx},${sy}`);
      markDirty(sx, sy);
    }
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
  }

  if (state.tick % 10 === 0) saveGame();
}, 1000);
