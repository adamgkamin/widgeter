import {
  DISPLAY_WIDTH, DISPLAY_HEIGHT, WORLD_ROWS,
  STATUS_ROW, LOG_START_ROW, LOG_END_ROW, HINT_ROW,
  BG, BRIGHT_WHITE, BRIGHT_YELLOW, BRIGHT_CYAN, BRIGHT_MAGENTA, DIM_GRAY,
  LOG_SCROLL_SPEED,
} from './constants.js';
import { EffectsManager } from './src/effects.js';

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

// ── Effects manager (§3.4) ────────────────────────────────────────────────────
const effectsManager = new EffectsManager({
  markDirty:   (...a) => markDirty(...a),
  renderDirty: ()    => renderDirty(),
  getTileMap:  ()    => tileMap,
});

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

function formatCredits(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
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
    launch_facility: { unlocked: false },
    storage: { unlocked: false },
  },
  rocketWidgets:       0,
  rocketFull:          false,
  courierDestination:  'market',  // 'market' | 'rocket'
  rocketAnimFrame:     0,
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
  demandHistory:        [],
  derivativesUnlocked:  false,
  derivatives:          { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0 },
  volatility:           0.2,
  endingTriggered:      false,
  widgetsMade:          0,
  peakCredits:          0,
  bank: { deposit: 0, loan: null },
  audio: { muted: false },
  workers: { apprentices: [], couriers: [] },
  stats: {
    rmLastTen:        [],
    widgetsLastTen:   [],
    creditsLastTen:   [],
    widgetsMadeToday: 0,
    revenueToday:     0,
    costsToday:       0,
  },
  skills: {
    apprentice:   0,
    courier:      0,
    workerCarry:  0,
    workerSpeed:  0,
    courierCarry: 0,
    courierSpeed: 0,
    storageExp1:    0,
    storageExp2:    0,
    reducedCarry:   0,
    discountDump:   0,
    demandHistory:      0,
    forecast:           0,
    bulkRM:             0,
    futures:            0,
    optionsBuy:         0,
    optionsWrite:       0,
    volatilitySurface:  0,
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
    demandHistory:        state.demandHistory,
    derivativesUnlocked:  state.derivativesUnlocked,
    derivatives:          state.derivatives,
    volatility:           state.volatility,
    endingTriggered:      state.endingTriggered,
    widgetsMade:          state.widgetsMade,
    peakCredits:          state.peakCredits,
    bank:                 state.bank,
    audio:                state.audio,
    workers:              state.workers,
    stats:                state.stats,
    rocketWidgets:        state.rocketWidgets,
    rocketFull:           state.rocketFull,
    courierDestination:   state.courierDestination,
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
    state.stations             = data.stations          ?? { launch_facility: { unlocked: false }, storage: { unlocked: false } };
    state.stations.launch_facility = state.stations.launch_facility ?? { unlocked: false };
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
    state.demandHistory        = data.demandHistory        ?? [];
    state.derivativesUnlocked  = data.derivativesUnlocked  ?? false;
    state.derivatives                    = data.derivatives ?? { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0 };
    state.derivatives.forwards           = state.derivatives.forwards           ?? [];
    state.derivatives.futures            = state.derivatives.futures            ?? [];
    state.derivatives.options            = state.derivatives.options            ?? [];
    state.derivatives.pnlToday          = state.derivatives.pnlToday          ?? 0;
    state.derivatives.totalPnL          = state.derivatives.totalPnL          ?? 0;
    state.derivatives.marginCallActive  = state.derivatives.marginCallActive  ?? false;
    state.derivatives.marginCallDay     = state.derivatives.marginCallDay     ?? 0;
    state.volatility                     = data.volatility                     ?? 0.2;
    state.endingTriggered                = data.endingTriggered                ?? false;
    state.widgetsMade          = data.widgetsMade          ?? 0;
    state.peakCredits          = data.peakCredits          ?? 0;
    state.bank                 = data.bank                 ?? { deposit: 0, loan: null };
    state.bank.deposit         = state.bank.deposit        ?? 0;
    state.bank.loan            = state.bank.loan           ?? null;
    state.audio                = data.audio               ?? { muted: false };
    state.workers              = data.workers           ?? { apprentices: [], couriers: [] };
    state.workers.couriers     = state.workers.couriers ?? []; // normalise old saves
    state.stats                = data.stats ?? { rmLastTen: [], widgetsLastTen: [], creditsLastTen: [], widgetsMadeToday: 0, revenueToday: 0, costsToday: 0 };
    state.rocketWidgets        = data.rocketWidgets       ?? 0;
    state.rocketFull           = data.rocketFull          ?? false;
    state.courierDestination   = data.courierDestination  ?? 'market';
    state.stats.rmLastTen      = state.stats.rmLastTen      ?? [];
    state.stats.widgetsLastTen = state.stats.widgetsLastTen ?? [];
    state.stats.creditsLastTen = state.stats.creditsLastTen ?? [];
    state.stats.widgetsMadeToday = state.stats.widgetsMadeToday ?? 0;
    state.stats.revenueToday   = state.stats.revenueToday   ?? 0;
    state.stats.costsToday     = state.stats.costsToday     ?? 0;
    state.skills               = data.skills            ?? { apprentice: 0, courier: 0, workerCarry: 0, workerSpeed: 0, courierCarry: 0, courierSpeed: 0, storageExp1: 0, storageExp2: 0, reducedCarry: 0, discountDump: 0 };
    // normalise old saves missing phase-3 skill keys
    state.skills.storageExp1    = state.skills.storageExp1    ?? 0;
    state.skills.storageExp2    = state.skills.storageExp2    ?? 0;
    state.skills.reducedCarry   = state.skills.reducedCarry   ?? 0;
    state.skills.discountDump   = state.skills.discountDump   ?? 0;
    state.skills.demandHistory     = state.skills.demandHistory     ?? 0;
    state.skills.forecast          = state.skills.forecast          ?? 0;
    state.skills.bulkRM            = state.skills.bulkRM            ?? 0;
    state.skills.futures           = state.skills.futures           ?? 0;
    state.skills.optionsBuy        = state.skills.optionsBuy        ?? 0;
    state.skills.optionsWrite      = state.skills.optionsWrite      ?? 0;
    state.skills.volatilitySurface = state.skills.volatilitySurface ?? 0;
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

let logQueue   = []; // lines waiting to scroll in: [{text, color}]
let pendingLine = null; // line currently scrolling in: {text, color, charsRevealed}

function addLog(message, color) {
  if (pendingLine !== null || logQueue.length > 0) {
    logQueue.push({ text: message, color });
  } else {
    pendingLine = { text: message, color, charsRevealed: 0 };
  }
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
    const row = LOG_START_ROW + i;
    // During crafting, the tick loop draws directly to LOG_END_ROW — skip that slot
    if (state.gameState === 'crafting' && i === 4) continue;

    if (pendingLine && i === 4) {
      drawRow(row, '> ' + pendingLine.text.substring(0, pendingLine.charsRevealed), pendingLine.color);
    } else {
      const lineIdx = pendingLine ? (state.logLines.length - 4 + i) : (state.logLines.length - 5 + i);
      const entry = state.logLines[lineIdx];
      if (entry) {
        drawRow(row, '> ' + entry.text, entry.color);
      } else {
        drawRow(row, '>', DIM_GRAY);
      }
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
    sx = seg(sx, `CR:${formatCredits(state.player.credits)}`,            '#ffd633') + 1;
    sx = seg(sx, `RM:${inv.rm}`,                           '#ff9933') + 1;
    sx = seg(sx, `WG:${inv.widgets}/${cap.widgets}`,       widgetFg)  + 1;
    sx = seg(sx, `D:${state.rmPurchasedToday}/${state.skills.bulkRM ? 200 : 100}`, '#ff9933') + 1;
    sx = seg(sx, `W:${activeW}`,                           '#66ccff') + 1;
    sx = seg(sx, `C:${activeC}`,                           '#cc66cc') + 1;
    sx = seg(sx, `ST:${state.storage.widgets}/50`,         '#66ccff') + 1;
    if (state.phase >= 3) {
      sx = seg(sx, `P:${state.marketPrice}cr`, '#66cc66') + 1;
      if (state.phase >= 4) {
        const pnl = state.derivatives.pnlToday;
        sx = seg(sx, `PnL:${pnl >= 0 ? '+' : ''}${pnl}cr`, '#cc66cc') + 1;
      }
      if (state.phase >= 5) {
        seg(sx, `LF:${Math.floor(state.rocketWidgets / 1000)}k/1M`, '#ff5555');
      }
    }
  } else {
    sx = seg(sx, `Credits: ${formatCredits(state.player.credits)}`,       '#ffd633') + 4;
    sx = seg(sx, `Raw: ${inv.rm}`,                         '#ff9933') + 4;
    sx = seg(sx, `Widgets: ${inv.widgets}/${cap.widgets}`, widgetFg)  + 4;
         seg(sx, `Day ${state.day}`,                       BRIGHT_WHITE);
  }
  drawTimeIndicator();
}

// ── Tile map (§4.2) ───────────────────────────────────────────────────────────

// Station definitions — single source of truth for layout and colors
const STATION_DEFS = [
  { x: 66, y: 33, label: 'LF', wc: DIM_GRAY, lc: DIM_GRAY, wide: true },
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

  // Trees — §4.5
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      const onPath = (x === 15 && y >= 3 && y <= 28) || (y === 14 && x >= 15 && x <= 62)
                  || (y === 28 && x >= 15 && x <= 62) || (x === 62 && y >= 14 && y <= 28);
      if (onPath) continue;
      const reserved = (x >= 8  && x <= 13 && y >= 1  && y <= 5)
                    || (x >= 33 && x <= 38 && y >= 7  && y <= 11)
                    || (x >= 60 && x <= 65 && y >= 22 && y <= 26)
                    || (x >= 22 && x <= 27 && y >= 16 && y <= 20)
                    || (x >= 63 && x <= 75 && y >= 31 && y <= 41); // LF clearance
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

  // Apply phase unlock colors before stamping stations
  if (state.phase >= 2) {
    const st2 = STATION_DEFS.find(s => s.label === 'ST');
    if (st2) { st2.wc = '#555555'; st2.lc = '#66ccff'; }
  }
  if (state.phase >= 3) {
    const bk3 = STATION_DEFS.find(s => s.label === 'BK');
    if (bk3) { bk3.wc = '#555555'; bk3.lc = '#66cc66'; }
  }
  if (state.phase >= 4) {
    const dv4 = STATION_DEFS.find(s => s.label === 'DV');
    if (dv4) { dv4.wc = '#555555'; dv4.lc = '#cc66cc'; }
  }
  if (state.phase >= 5) {
    const lf5 = STATION_DEFS.find(s => s.label === 'LF');
    if (lf5) { lf5.wc = '#f0f0f0'; lf5.lc = '#ff5555'; }
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
    ST: { wall: 'A warehouse, padlocked. Through the slats you can see empty pallets and a hand truck.' },
    BK: { wall: "Through the dusty window, you see a polished counter and a sign: 'NO INTEREST WITHOUT DEPOSIT.' The door is locked." },
    DV: { wall: "A glass-fronted building with screens displaying numbers you don't yet understand. The door is locked. A small plaque reads: 'AUTHORIZED PERSONNEL ONLY.'" },
  };
  for (const s of STATION_DEFS) {
    if (s.wide) continue; // custom stamp handled separately
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

  // Stamp Launch Facility (8×6, custom footprint) — §4.2
  stampLF();
}

// Draws the 8×6 Launch Facility tile footprint onto the tileMap
function stampLF() {
  const lf = STATION_DEFS.find(s => s.label === 'LF');
  if (!lf) return;
  const { x: lx, y: ly, wc, lc } = lf;
  const mk = (glyph, fg, walkable) => ({ glyph, fg, bg: BG, walkable });
  const locked = state.phase < 5;
  const wallDesc = locked
    ? 'A large structure in the corner, shrouded in canvas. Something tall is underneath. The canvas smells of grease and oxidizer.'
    : 'A reinforced wall. Built to withstand something significant.';
  const doorDesc = 'The entrance to the Launch Facility. The air smells of fuel and ambition.';
  const bodyDesc = 'The rocket. It has been here longer than you realized. It was always going to end this way.';
  // Top row: +------+
  tileMap[lx  ][ly] = { ...mk('+', wc, false), description: wallDesc };
  for (let dx = 1; dx <= 6; dx++) tileMap[lx+dx][ly] = { ...mk('-', wc, false), description: wallDesc };
  tileMap[lx+7][ly] = { ...mk('+', wc, false), description: wallDesc };
  // Middle rows (y+1 to y+4)
  for (let dy = 1; dy <= 4; dy++) {
    tileMap[lx  ][ly+dy] = { ...mk('|', wc, false), description: wallDesc };
    for (let dx = 1; dx <= 6; dx++) tileMap[lx+dx][ly+dy] = { ...mk(' ', '#222222', false), description: locked ? wallDesc : bodyDesc };
    tileMap[lx+7][ly+dy] = { ...mk('|', wc, false), description: wallDesc };
  }
  // Label row (y+1): LF centered
  tileMap[lx+3][ly+1] = { ...mk('L', lc, false), description: locked ? wallDesc : bodyDesc };
  tileMap[lx+4][ly+1] = { ...mk('F', lc, false), description: locked ? wallDesc : bodyDesc };
  // Bottom row: +.-----+  door at lx+1
  tileMap[lx  ][ly+5] = { ...mk('+', wc, false), description: wallDesc };
  tileMap[lx+1][ly+5] = { ...mk('.', wc, true),  description: doorDesc };
  for (let dx = 2; dx <= 6; dx++) tileMap[lx+dx][ly+5] = { ...mk('-', wc, false), description: wallDesc };
  tileMap[lx+7][ly+5] = { ...mk('+', wc, false), description: wallDesc };
}

// Colors in the LF tiles after phase 5 unlock
function colorInLF(wc, lc) {
  const lf = STATION_DEFS.find(s => s.label === 'LF');
  if (!lf) return;
  lf.wc = wc; lf.lc = lc;
  // Re-stamp with new colors and update descriptions
  stampLF();
  // Mark all LF tiles dirty
  const { x: lx, y: ly } = lf;
  for (let dy = 0; dy <= 5; dy++)
    for (let dx = 0; dx <= 7; dx++)
      markDirty(lx+dx, ly+dy);
  renderDirty();
  display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
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
  "Begin at the shed [RM] to the north-west. Purchase materials and craft them into widgets at the workbench [WB] in the north. Sell what you make at the market [MT] in the south-east during operational hours. Good luck.",
];
// Inline color tokens for the 4th intro paragraph (index 3)
const INTRO_PARA4_TOKENS = { '[RM]': '#ff6600', '[WB]': '#cc3300', '[MT]': '#ffd633' };

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
    for (const line of wrapped[i]) rows.push({ text: line, fg: BRIGHT_WHITE, colored: i === 3 });
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
    if (row.colored && fg_override === undefined) {
      // Inline color rendering: scan for token markers and switch fg mid-line
      let cx = 0, si = 0;
      while (cx < INNER_W) {
        if (si >= text.length) { display.draw(BOX_X + 1 + cx, y, ' ', BRIGHT_WHITE, BG); cx++; continue; }
        let matched = false;
        for (const [tok, clr] of Object.entries(INTRO_PARA4_TOKENS)) {
          if (text.startsWith(tok, si)) {
            for (let j = 0; j < tok.length && cx < INNER_W; j++, cx++)
              display.draw(BOX_X + 1 + cx, y, tok[j], clr, BG);
            si += tok.length; matched = true; break;
          }
        }
        if (!matched) { display.draw(BOX_X + 1 + cx, y, text[si], row.fg, BG); cx++; si++; }
      }
    } else {
      const fg = fg_override !== undefined ? fg_override : row.fg;
      for (let x = 0; x < INNER_W; x++) {
        display.draw(BOX_X + 1 + x, y, x < text.length ? text[x] : ' ', fg, BG);
      }
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
  state.stations = { launch_facility: { unlocked: false }, storage: { unlocked: false } };
  state.rocketWidgets      = 0;
  state.rocketFull         = false;
  state.courierDestination = 'market';
  state.rocketAnimFrame    = 0;
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
  state.demandHistory        = [];
  state.derivativesUnlocked  = false;
  state.derivatives          = { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0 };
  state.volatility           = 0.2;
  state.endingTriggered      = false;
  state.widgetsMade          = 0;
  state.peakCredits          = 0;
  state.bank                 = { deposit: 0, loan: null };
  state.audio            = { muted: false };
  state.workers = { apprentices: [], couriers: [] };
  state.stats = { rmLastTen: [], widgetsLastTen: [], creditsLastTen: [], widgetsMadeToday: 0, revenueToday: 0, costsToday: 0 };
  state.skills = { apprentice: 0, courier: 0, workerCarry: 0, workerSpeed: 0, courierCarry: 0, courierSpeed: 0, storageExp1: 0, storageExp2: 0, reducedCarry: 0, discountDump: 0, demandHistory: 0, forecast: 0, bulkRM: 0, futures: 0, optionsBuy: 0, optionsWrite: 0, volatilitySurface: 0 };
  const lfDef = STATION_DEFS.find(s => s.label === 'LF');
  const stDef = STATION_DEFS.find(s => s.label === 'ST');
  const bkDef = STATION_DEFS.find(s => s.label === 'BK');
  if (lfDef) { lfDef.wc = DIM_GRAY; lfDef.lc = DIM_GRAY; }
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
  let walls;
  if (s.wide) {
    // 8×6 footprint (LF): perimeter tiles excluding the door at (s.x+1, s.y+5)
    walls = [];
    for (let dx = 0; dx <= 7; dx++) walls.push([s.x+dx, s.y], [s.x+dx, s.y+5]);
    for (let dy = 1; dy <= 4; dy++) walls.push([s.x, s.y+dy], [s.x+7, s.y+dy]);
  } else {
    // Standard 4×3 station
    walls = [
      [s.x,   s.y],   [s.x+1, s.y],   [s.x+2, s.y],   [s.x+3, s.y],
      [s.x,   s.y+1], [s.x+3, s.y+1],
      [s.x,   s.y+2], [s.x+2, s.y+2], [s.x+3, s.y+2],
    ];
  }
  return walls.some(([wx, wy]) => Math.abs(px - wx) <= 1 && Math.abs(py - wy) <= 1);
}

function openRMShedMenu() {
  const COST      = 3;
  const rmSpace   = state.player.inventoryCaps.rm - state.player.inventory.rm;
  const rmDailyCap = state.skills.bulkRM ? 200 : 100;
  const dailyLeft  = state.phase >= 2 ? Math.max(0, rmDailyCap - state.rmPurchasedToday) : Infinity;
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
        { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(state.player.x, state.player.y, rmD.x + 1, rmD.y + 2, COST); }
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

function checkPhase2Trigger() {
  if (state.lifetimeCreditsEarned >= 100 && state.phase === 1) {
    state.phase = 2;
    state.officeUnlocked = true;
    state.stations.storage.unlocked = true;
    addLog('Something stirs. The Office door swings open.', '#cc66cc');
    setTimeout(() => addLog('You can afford to hire help.', '#cc66cc'), 2000);
    setTimeout(() => {
      addLog('The Storage Warehouse is now available.', '#cc66cc');
      colorInStation('ST', '#555555', '#66ccff');
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
  state.demandHistory.push({ day: state.day, demand: state.demand, price: state.marketPrice });
  if (state.demandHistory.length > 30) state.demandHistory.shift();
}

function checkPhase3Trigger() {
  if (state.phase === 2 && (state.lifetimeCreditsEarned >= 500 || (state.couriersOwned >= 1 && state.day >= 2))) {
    state.phase = 3;
    state.stations.bank = { unlocked: true };
    calculateDailyDemand();
    addLog('The bank lights come on for the first time.', '#66cc66');
    setTimeout(() => addLog('New possibilities are available.', '#66cc66'), 2000);
    setTimeout(() => colorInStation('BK', '#555555', '#66cc66'), 4000);
  }
}

function checkPhase4Trigger() {
  if (state.phase === 3 && (state.demandCrashOccurred || state.lifetimeCreditsEarned >= 2000)) {
    state.phase = 4;
    state.derivativesUnlocked = true;
    state.stations.derivatives = { unlocked: true };
    addLog('A man in a clean suit appears at the market.', '#cc66cc');
    setTimeout(() => addLog("He offers you a contract. Lock in tomorrow's price, he says.", '#cc66cc'), 2000);
    setTimeout(() => {
      addLog('The Derivatives Terminal is now open.', '#cc66cc');
      colorInStation('DV', '#555555', '#cc66cc');
    }, 4000);
  }
}

function checkPhase5Trigger() {
  if (state.phase === 4 && state.lifetimeCreditsEarned >= 10000) {
    state.phase = 5;
    addLog('Something has been under construction this whole time.', '#cc66cc');
    setTimeout(() => addLog('The structure in the corner. You always wondered.', '#cc66cc'), 3000);
    setTimeout(() => {
      addLog('The Launch Facility is ready.', '#cc66cc');
      colorInLF('#f0f0f0', '#ff5555');
      state.stations.launch_facility.unlocked = true;
      state.rocketWidgets = 0;
      state.courierDestination = 'market';
    }, 6000);
  }
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
  const isFirstSale = state.lifetimeCreditsEarned === 0;
  const price  = state.marketPrice;
  const earned = n * price;
  state.player.credits           += earned;
  state.player.inventory.widgets -= n;
  state.lifetimeCreditsEarned    += earned;
  state.stats.revenueToday        = Math.round((state.stats.revenueToday + earned) * 10) / 10;
  if (state.phase >= 3) state.widgetsSoldToday += n;
  addLog(`Sold ${n} widget${n !== 1 ? 's' : ''} for ${formatCredits(earned)}cr.`, BRIGHT_CYAN);
  if (isFirstSale) addLog('Congrats on your first sale.', '#cc66cc');
  drawStatusBar();
  { const mtD = STATION_DEFS.find(s => s.label === 'MT'); if (mtD) effectsManager.creditRain(mtD.x + 1, mtD.y + 2, n, isFirstSale, earned); }
  checkPhase2Trigger();
}

// ── Demand history / forecast screens (§5.5) ─────────────────────────────────

function drawDemandChart(title, rows, subtitle) {
  state.gameState = 'menu';
  const BOX_W  = 52;
  const BOX_H  = 4 + rows.length + 4;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const WC     = '#555555';

  display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }

  const tX = CONT_X + Math.floor((CONT_W - title.length) / 2);
  for (let i = 0; i < title.length; i++) display.draw(tX+i, BOX_Y+1, title[i], BRIGHT_CYAN, BG);
  if (subtitle) {
    const sX = CONT_X + Math.floor((CONT_W - subtitle.length) / 2);
    for (let i = 0; i < subtitle.length; i++) display.draw(sX+i, BOX_Y+2, subtitle[i], WC, BG);
  }

  const BAR_W = 10;
  for (let i = 0; i < rows.length; i++) {
    const { label, demand, price, isForecast } = rows[i];
    const dl     = demandLabel(demand);
    const filled = Math.min(Math.round(demand / 100 * BAR_W), BAR_W);
    let cx = CONT_X;
    const row = BOX_Y + 3 + i;
    // day label
    for (let j = 0; j < label.length; j++) display.draw(cx+j, row, label[j], WC, BG);
    cx += label.length + 1;
    // bar
    for (let b = 0; b < BAR_W; b++) {
      const ch = b < filled ? '█' : '░';
      display.draw(cx+b, row, ch, b < filled ? dl.fg : '#333333', BG);
    }
    cx += BAR_W + 1;
    // demand + price + label
    const info = `D:${String(demand).padStart(3)}  P:${String(price).padStart(5)}cr  ${dl.text}`;
    for (let j = 0; j < info.length; j++) display.draw(cx+j, row, info[j], dl.fg, BG);
  }

  const esc = '[ ESC to close ]';
  const eX = CONT_X + Math.floor((CONT_W - esc.length) / 2);
  for (let i = 0; i < esc.length; i++) display.draw(eX+i, BOX_Y+BOX_H-2, esc[i], WC, BG);

  function close() {
    window.removeEventListener('keydown', chartKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }
  function chartKeyHandler(e) { if (e.key === 'Escape') close(); }
  window.addEventListener('keydown', chartKeyHandler);
}

function showDemandHistoryScreen() {
  const hist = state.demandHistory.slice(-7).reverse();
  if (hist.length === 0) {
    addLog('No demand history yet.', '#555555');
    return;
  }
  const rows = hist.map(h => ({
    label: `Day ${String(h.day).padStart(2)}  `,
    demand: h.demand,
    price: h.price,
  }));
  drawDemandChart('– DEMAND HISTORY (last 7 days) –', rows, null);
}

function showForecastScreen() {
  const rows = [];
  for (let d = 1; d <= 7; d++) {
    const expD  = Math.max(5, Math.round(50 + 30 * Math.sin((state.day + d) / 7 * 2 * Math.PI)));
    const expP  = Math.round(8 * Math.pow(expD / 50, 0.5) * 10) / 10;
    rows.push({ label: `Day ${String(state.day + d).padStart(2)}  `, demand: expD, price: expP });
  }
  drawDemandChart('– 7-DAY FORECAST –', rows, 'Actual results will vary.');
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

  const opts = [
    { label: `Sell 1 widget (+${price}cr)`,    enabled: true, action: () => sellWidgets(1) },
    { label: `Sell max (+${avail * price}cr)`, enabled: true, action: () => sellWidgets(avail) },
  ];
  if (state.skills.demandHistory) opts.push({ label: 'View Demand History', enabled: true, action: showDemandHistoryScreen });
  if (state.skills.forecast)      opts.push({ label: 'View Forecast',       enabled: true, action: showForecastScreen });
  opts.push({ label: 'Cancel', enabled: true, action: () => {} });
  showMenu(title, opts);
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
  { num: 9, name: 'Reduced Carry Cost',   cost:  300, key: 'reducedCarry',   max: 1, minPhase: 3 },
  { num:10, name: 'Market Discount Dump', cost:  250, key: 'discountDump',   max: 1, minPhase: 3 },
  { num:11, name: 'Demand History',       cost:   50, key: 'demandHistory',  max: 1, minPhase: 3, inputKey: 'a' },
  { num:12, name: '7-Day Forecast',       cost: 1500, key: 'forecast',       max: 1, minPhase: 3, inputKey: 'b' },
  { num:13, name: 'Bulk RM Contract',     cost:  500, key: 'bulkRM',          max: 1, minPhase: 3, inputKey: 'c' },
  { num:14, name: 'Futures Trading',      cost: 1000, key: 'futures',          max: 1, minPhase: 4, inputKey: 'd' },
  { num:15, name: 'Options — Buy Side',   cost: 2500, key: 'optionsBuy',       max: 1, minPhase: 4, inputKey: 'e' },
  { num:16, name: 'Options — Write Side', cost: 5000, key: 'optionsWrite',     max: 1, minPhase: 4, inputKey: 'f', requires: 'optionsBuy', requiresLabel: 'Buy Side first' },
  { num:17, name: 'Volatility Surface',   cost: 3000, key: 'volatilitySurface',max: 1, minPhase: 4, inputKey: 'g' },
];

function showOfficeMenu() {
  state.gameState = 'menu';

  // Section definitions — each item has display key and OFFICE_NODES key field
  const SECTIONS = [
    { header: 'LOGISTICS', items: [
      { k: '1', nk: 'apprentice'   },
      { k: '2', nk: 'workerCarry'  },
      { k: '3', nk: 'workerSpeed'  },
    ]},
    { header: 'WAREHOUSING', items: [
      { k: null, label: 'Launch Facility', cost: 'AUTO', specialFn: () => state.phase >= 5 },
      { k: '4',  nk: 'storageExp1'  },
      { k: '5',  nk: 'storageExp2'  },
      { k: '6',  nk: 'reducedCarry' },
      { k: '7',  nk: 'discountDump' },
    ]},
    { header: 'TRANSPORT', items: [
      { k: '8', nk: 'courier'       },
      { k: '9', nk: 'courierCarry'  },
      { k: 'a', nk: 'courierSpeed'  },
    ]},
    { header: 'MARKETING', items: [
      { k: 'b', nk: 'bulkRM'        },
      { k: 'c', nk: 'demandHistory' },
      { k: 'd', nk: 'forecast'      },
    ]},
    { header: 'TRADING', items: [
      { k: 'e', nk: 'futures'           },
      { k: 'f', nk: 'optionsBuy'        },
      { k: 'g', nk: 'optionsWrite'      },
      { k: 'h', nk: 'volatilitySurface' },
    ]},
  ];

  const IW   = 50;        // inner width
  const BOX_W  = IW + 4; // 54
  const BOX_H  = 31;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const WC     = '#555555';
  const PAGE_ROWS = 25; // content rows available per page
  let page = 0;

  function nodeStatus(nk) {
    const node  = OFFICE_NODES.find(n => n.key === nk);
    if (!node) return { fg: WC, status: '[unknown]' };
    const level = state.skills[nk] || 0;
    if (!state.officeUnlocked || state.phase < node.minPhase) return { fg: WC, status: `[phase ${node.minPhase}]` };
    if (node.requires && !state.skills[node.requires]) return { fg: WC, status: `[needs ${node.requiresLabel}]` };
    if (level >= node.max) return { fg: '#888888', status: node.max === 1 ? '[owned]' : '[max]' };
    if (state.player.credits < node.cost) return { fg: '#ff5555', status: `[${Math.ceil(node.cost - state.player.credits)}cr more]` };
    return { fg: '#66cc66', status: '[available]' };
  }

  function buildSectionRows(sec) {
    const rows = [];
    const hasAvail = sec.items.some(item => {
      if (!item.nk) return false;
      const { fg } = nodeStatus(item.nk);
      return fg === '#66cc66';
    });
    rows.push({ type: 'hdr', text: `[${sec.header}]`, fg: hasAvail ? '#ffd633' : '#333333' });
    for (const item of sec.items) {
      if (item.nk) {
        const node  = OFFICE_NODES.find(n => n.key === item.nk);
        if (!node) continue;
        const level = state.skills[item.nk] || 0;
        const { fg, status } = nodeStatus(item.nk);
        let label = node.name;
        if (node.max > 1 && level > 0) label += ` (${level}/${node.max})`;
        rows.push({ type: 'node', k: item.k, label, cost: `${node.cost}cr`, fg, status });
      } else {
        const owned = item.specialFn();
        rows.push({ type: 'node', k: null, label: item.label, cost: item.cost, fg: owned ? '#888888' : WC, status: owned ? '[owned]' : '[locked]' });
      }
    }
    rows.push({ type: 'blank' });
    return rows;
  }

  function getPages() {
    const pages = [];
    let cur = [];
    for (const sec of SECTIONS) {
      const sRows = buildSectionRows(sec);
      if (cur.length > 0 && cur.length + sRows.length > PAGE_ROWS) { pages.push(cur); cur = []; }
      cur.push(...sRows);
    }
    if (cur.length > 0) pages.push(cur);
    return pages;
  }

  function menuLine(k, label, cost, status) {
    const kp  = (k ? `${k}. ` : '   ').padEnd(4);
    const st  = (status.length > 12 ? status.slice(0, 11) + '.' : status).padEnd(12);
    const co  = cost.padStart(7);
    const lbl = (label.length > 23 ? label.slice(0, 20) + '...' : label).padEnd(23);
    return (kp + lbl + ' ' + co + ' ' + st).slice(0, IW).padEnd(IW);
  }

  function drawLine(y, text, fg) {
    for (let j = 0; j < IW; j++) display.draw(CONT_X+j, y, text[j] ?? ' ', fg, BG);
  }

  function redraw() {
    const pages = getPages();
    const pg    = pages[page] || [];
    const total = pages.length;
    // Frame + clear
    display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, botY, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, botY, '-', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }
    // Header
    const TITLE = '– THE OFFICE –';
    const tx = CONT_X + Math.floor((IW - TITLE.length) / 2);
    for (let i = 0; i < TITLE.length; i++) display.draw(tx+i, BOX_Y+1, TITLE[i], BRIGHT_CYAN, BG);
    const sub = 'Upgrades purchased with credits.';
    for (let i = 0; i < sub.length; i++) display.draw(CONT_X+i, BOX_Y+2, sub[i], WC, BG);
    // Content rows (start at row 4)
    for (let i = 0; i < pg.length && i < PAGE_ROWS; i++) {
      const row = pg[i];
      const y   = BOX_Y + 4 + i;
      if (row.type === 'blank') continue;
      if (row.type === 'hdr') {
        drawLine(y, row.text.padEnd(IW), row.fg);
      } else {
        drawLine(y, menuLine(row.k, row.label, row.cost, row.status), row.fg);
      }
    }
    // Footer
    const footer = total > 1 ? `[ page ${page+1}/${total} — TAB for next ]` : 'ESC to close';
    const fx = CONT_X + Math.floor((IW - footer.length) / 2);
    for (let i = 0; i < footer.length; i++) display.draw(fx+i, BOX_Y+BOX_H-2, footer[i], WC, BG);
  }

  redraw();

  function closeOffice() {
    window.removeEventListener('keydown', officeKeyHandler);
    for (let y = BOX_Y; y < BOX_Y+BOX_H; y++)
      for (let x = BOX_X; x < BOX_X+BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function officeKeyHandler(e) {
    if (e.key === 'Escape') { closeOffice(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const pages = getPages();
      page = (page + 1) % Math.max(1, pages.length);
      redraw(); return;
    }
    // Find matching item across all sections
    for (const sec of SECTIONS) {
      for (const item of sec.items) {
        if (!item.k || item.k !== e.key || !item.nk) continue;
        const node  = OFFICE_NODES.find(n => n.key === item.nk);
        if (!node || !state.officeUnlocked || state.phase < node.minPhase) return;
        if (node.requires && !state.skills[node.requires]) return;
        const level = state.skills[item.nk] || 0;
        if (level >= node.max || state.player.credits < node.cost) return;
        state.player.credits  -= node.cost;
        state.skills[item.nk]  = level + 1;
        if (item.nk === 'apprentice') {
          const ofDef = STATION_DEFS.find(s => s.label === 'OF');
          state.workers.apprentices.push({ x: ofDef.x+1, y: ofDef.y+2, workerState: 'idle', carryRM: 0, carryWidgets: 0, target: {x:0,y:0}, craftTimer: 0, paused: false });
        }
        if (item.nk === 'courier') {
          const ofDef = STATION_DEFS.find(s => s.label === 'OF');
          state.workers.couriers.push({ x: ofDef.x+1, y: ofDef.y+2, courierState: 'idle', carryWidgets: 0, target: {x:0,y:0} });
          state.couriersOwned++;
        }
        if (item.nk === 'storageExp1') { state.storage.widgetCap = 100; state.storage.rmCap = 100; }
        if (item.nk === 'storageExp2') { state.storage.widgetCap = 200; state.storage.rmCap = 200; }
        addLog(`${node.name} purchased.`, '#cc66cc');
        drawStatusBar();
        redraw();
        return;
      }
    }
  }
  window.addEventListener('keydown', officeKeyHandler);
}

function handlePonder() {
  const inv = state.player.inventory;
  let hint;
  // Phase 5 — rocket hints
  if (state.phase >= 5) {
    const rw = state.rocketWidgets;
    if (rw >= 1000000) { hint = 'The rocket is ready. [launch sequence coming soon]'; }
    else if (state.courierDestination === 'market') { hint = 'The rocket waits. Credits won\'t matter where it\'s going.'; }
    else if (rw >= 900000) { hint = 'Almost. Everything you built was for this.'; }
    else if (rw >= 500000) { hint = 'Over halfway. You can feel something building.'; }
    else if (rw >= 100000) { hint = 'You are committed now.'; }
    else                   { hint = 'The rocket is loading. This will take time.'; }
    wrapLog(hint, '#ff5555'); return;
  }
  // Phase 4 derivative hints
  if (state.phase >= 4) {
    const fwds = state.derivatives.forwards;
    if (fwds.length === 0) {
      hint = 'The terminal is waiting. A forward costs nothing to enter.';
      wrapLog(hint, '#cc66cc'); return;
    }
    const unrealized = fwds.reduce((s, f) => s + (f.lockedPrice - state.marketPrice) * f.quantity, 0);
    if (unrealized > 0) {
      hint = 'Your forward looks good. The market moved your way.';
    } else {
      hint = "The market didn't cooperate. You'll owe the difference at settlement.";
    }
    wrapLog(hint, '#cc66cc'); return;
  }

  // Phase 3 urgent hints first
  if (state.phase >= 3 && state.bank.loan && (state.bank.loan.deadline - state.day) <= 5) {
    hint = 'The bank will want its money soon.';
  } else if (state.phase >= 3 && state.debt > 0) {
    hint = 'You owe more than you have. The bank may help — or make things worse.';
  } else if (state.phase >= 3 && state.demand < 20) {
    hint = 'The market is weak today. Holding widgets costs you. Consider your options.';
  } else if (state.phase >= 3 && state.storage.widgets > state.storage.widgetCap * 0.8) {
    hint = 'Your storage is getting heavy. Every widget in there costs you at dusk.';
  } else if (state.lifetimeCreditsEarned === 0) {
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

// ── Bank numeric prompt helper ────────────────────────────────────────────────

function showNumericPrompt(title, maxVal, onConfirm, onCancel) {
  const BOX_W = 40, BOX_H = 8;
  const BOX_X = Math.floor((DISPLAY_WIDTH  - BOX_W) / 2);
  const BOX_Y = Math.floor((DISPLAY_HEIGHT - BOX_H) / 2);
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const WC = '#555555';

  let inputStr = '';

  function redrawPrompt() {
    display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, bY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }
    const tX = CONT_X + Math.floor((CONT_W - title.length) / 2);
    for (let i = 0; i < title.length; i++) display.draw(tX+i, BOX_Y+1, title[i], BRIGHT_CYAN, BG);
    const amtLine = `Amount: ${inputStr}_`;
    for (let i = 0; i < amtLine.length; i++) display.draw(CONT_X+i, BOX_Y+3, amtLine[i], BRIGHT_WHITE, BG);
    const maxLine = `Max: ${maxVal}`;
    for (let i = 0; i < maxLine.length; i++) display.draw(CONT_X+i, BOX_Y+4, maxLine[i], WC, BG);
    const hint = 'Enter: confirm   ESC: cancel';
    const hX = CONT_X + Math.floor((CONT_W - hint.length) / 2);
    for (let i = 0; i < hint.length; i++) display.draw(hX+i, BOX_Y+6, hint[i], WC, BG);
  }

  function closePrompt() {
    window.removeEventListener('keydown', promptHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (y < WORLD_ROWS) { markDirty(x, y); }
        else { display.draw(x, y, ' ', BRIGHT_WHITE, BG); }
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
  }

  function promptHandler(e) {
    e.preventDefault();
    if (e.key === 'Escape')    { closePrompt(); onCancel?.(); return; }
    if (e.key === 'Enter')     { const v = Math.min(parseInt(inputStr) || 0, maxVal); closePrompt(); if (v > 0) onConfirm(v); else onCancel?.(); return; }
    if (e.key === 'Backspace') { inputStr = inputStr.slice(0, -1); redrawPrompt(); return; }
    if (/^[0-9]$/.test(e.key) && inputStr.length < 9) { inputStr += e.key; redrawPrompt(); }
  }

  redrawPrompt();
  window.addEventListener('keydown', promptHandler);
}

// ── Bank menu (§5.4) ─────────────────────────────────────────────────────────

function openBankMenu() {
  if (!state.stations.bank || !state.stations.bank.unlocked) return;
  state.gameState = 'menu';

  const BOX_W  = 56;
  const BOX_H  = 22;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const WC     = '#555555';
  const GC     = '#66cc66';

  function line(row, text, fg) {
    for (let i = 0; i < text.length; i++) display.draw(CONT_X+i, BOX_Y+row, text[i], fg, BG);
  }
  function centered(row, text, fg) {
    const cx = CONT_X + Math.floor((CONT_W - text.length) / 2);
    for (let i = 0; i < text.length; i++) display.draw(cx+i, BOX_Y+row, text[i], fg, BG);
  }

  function redraw() {
    display.draw(BOX_X, BOX_Y, '+', GC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', GC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', GC, BG);
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, bY, '+', GC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', GC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', GC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', GC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', GC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }

    centered(1, '– BANK –', GC);

    // Deposit section
    const dep = state.bank.deposit;
    line(3, `Deposit balance: ${dep.toFixed(1)}cr`, GC);
    const availDep = Math.max(0, state.player.credits - 10);
    line(4, `1. Deposit all             ${availDep > 0 ? `[+${availDep}cr available]` : '[need more than 10cr]'}`, availDep > 0 ? GC : WC);
    line(5, `2. Deposit custom amount   ${availDep > 0 ? '[enter amount]' : '[need more than 10cr]'}`, availDep > 0 ? GC : WC);
    line(6, `3. Withdraw all            ${dep > 0 ? `[${dep.toFixed(1)}cr]` : '[no deposit]'}`, dep > 0 ? GC : WC);

    for (let i = 0; i < CONT_W; i++) display.draw(CONT_X+i, BOX_Y+8, '.', WC, BG);

    // Loan section
    const loan = state.bank.loan;
    const loanLimit = Math.floor(state.lifetimeCreditsEarned * 0.5);
    if (loan) {
      const daysLeft = loan.deadline - state.day;
      const rateStr  = (loan.rate * 100).toFixed(1);
      const owed     = loan.remaining.toFixed(1);
      if (daysLeft >= 0) {
        line(9,  `Active loan: ${owed}cr at ${rateStr}%/day`, '#ffd633');
        line(10, `  Deadline: day ${loan.deadline} — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`, '#ffd633');
      } else {
        line(9,  `OVERDUE LOAN: ${owed}cr at ${rateStr}%/day`, '#ff5555');
        line(10, `  ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} overdue — REPAY IMMEDIATELY`, '#ff5555');
      }
    } else {
      line(9, `No active loan.  Loan limit: ${loanLimit}cr`, WC);
    }

    const can4 = !loan && loanLimit > 0;
    line(12, `4. Take loan               ${can4 ? `[limit: ${loanLimit}cr]` : (loan ? '[loan active]' : '[insufficient history]')}`, can4 ? GC : WC);
    const can5 = !!loan;
    line(13, `5. Repay loan              ${can5 ? `[owed: ${loan.remaining.toFixed(1)}cr]` : '[no loan]'}`, can5 ? (state.player.credits >= loan.remaining ? GC : '#ff9933') : WC);
    const daysLeft2   = loan ? loan.deadline - state.day : 999;
    const can6 = !!loan && daysLeft2 <= 5 && loan.rate < 0.05;
    line(14, `6. Refinance loan          ${can6 ? '[within refi window]' : (!loan ? '[no loan]' : (loan.rate >= 0.05 ? '[rate cap reached]' : '[>5 days to deadline]'))}`, can6 ? '#ff9933' : WC);

    if (state.debt > 0) {
      line(16, `Outstanding debt: ${formatCredits(state.debt)}cr`, '#ff5555');
    }

    centered(BOX_H-2, 'ESC to close', WC);
  }

  redraw();

  function closeBank() {
    window.removeEventListener('keydown', bankKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function bankKeyHandler(e) {
    if (e.key === 'Escape') { closeBank(); return; }
    const loan = state.bank.loan;

    if (e.key === '1') {
      const amt = Math.max(0, state.player.credits - 10);
      if (amt <= 0) return;
      state.bank.deposit       = Math.round((state.bank.deposit + amt) * 10) / 10;
      state.player.credits     = 10;
      addLog(`Deposited ${amt}cr.`, GC);
      drawStatusBar(); redraw();
      return;
    }
    if (e.key === '2') {
      const maxDep = Math.max(0, state.player.credits - 10);
      if (maxDep <= 0) return;
      window.removeEventListener('keydown', bankKeyHandler);
      showNumericPrompt('Deposit Amount', maxDep,
        (val) => { state.bank.deposit = Math.round((state.bank.deposit + val) * 10) / 10; state.player.credits -= val; addLog(`Deposited ${val}cr.`, GC); drawStatusBar(); openBankMenu(); },
        () => openBankMenu()
      );
      return;
    }
    if (e.key === '3') {
      if (state.bank.deposit <= 0) return;
      const amt = state.bank.deposit;
      state.player.credits = Math.round((state.player.credits + amt) * 10) / 10;
      state.bank.deposit   = 0;
      addLog(`Withdrew ${amt.toFixed(1)}cr from deposit.`, GC);
      drawStatusBar(); redraw();
      return;
    }
    if (e.key === '4') {
      if (loan) return;
      const loanLimit = Math.floor(state.lifetimeCreditsEarned * 0.5);
      if (loanLimit <= 0) return;
      window.removeEventListener('keydown', bankKeyHandler);
      showNumericPrompt('Loan Amount', loanLimit,
        (val) => {
          state.bank.loan = { principal: val, remaining: val, rate: 0.01, dayTaken: state.day, deadline: state.day + 20, refinanceCount: 0, overdueDays: 0 };
          state.player.credits += val;
          addLog(`Loan of ${val}cr approved. Repay within 20 days.`, '#ffd633');
          drawStatusBar(); openBankMenu();
        },
        () => openBankMenu()
      );
      return;
    }
    if (e.key === '5') {
      if (!loan || state.player.credits <= 0) return;
      if (state.player.credits >= loan.remaining) {
        state.player.credits -= loan.remaining;
        addLog(`Loan of ${loan.remaining.toFixed(1)}cr repaid in full.`, GC);
        state.bank.loan = null;
      } else {
        const partial = state.player.credits;
        loan.remaining = Math.round((loan.remaining - partial) * 10) / 10;
        state.player.credits = 0;
        addLog(`Partial repayment: ${partial}cr. Remaining: ${loan.remaining}cr.`, '#ff9933');
      }
      drawStatusBar(); redraw();
      return;
    }
    if (e.key === '6') {
      if (!loan) return;
      const daysLeft = loan.deadline - state.day;
      if (daysLeft > 5 || loan.rate >= 0.05) return;
      loan.rate = Math.round((loan.rate + 0.005) * 1000) / 1000;
      loan.deadline = state.day + 20;
      loan.refinanceCount++;
      addLog(`Loan refinanced at ${(loan.rate * 100).toFixed(1)}%/day. New deadline: day ${loan.deadline}.`, '#ff9933');
      redraw();
      return;
    }
  }
  window.addEventListener('keydown', bankKeyHandler);
}

// ── Bankruptcy screen (§5.4) ─────────────────────────────────────────────────

function showBankruptcyScreen() {
  state.gameState = 'title';
  clearScreen();

  const BOX_W  = 52;
  const BOX_H  = 17;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.floor((DISPLAY_HEIGHT - BOX_H) / 2);
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const RC     = '#ff5555';
  const WC     = '#555555';

  display.draw(BOX_X, BOX_Y, '+', RC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', RC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', RC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', RC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', RC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', RC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', RC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', RC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }

  function line(row, text, fg) {
    for (let i = 0; i < text.length; i++) display.draw(CONT_X+i, BOX_Y+row, text[i], fg, BG);
  }
  function centered(row, text, fg) {
    const cx = CONT_X + Math.floor((CONT_W - text.length) / 2);
    for (let i = 0; i < text.length; i++) display.draw(cx+i, BOX_Y+row, text[i], fg, BG);
  }

  centered(1, '– BANKRUPTCY –', RC);
  centered(2, 'The debt has come due.', WC);
  line(4,  `Days survived:   ${state.day}`, BRIGHT_WHITE);
  line(5,  `Widgets made:    ${state.widgetsMade}`, BRIGHT_WHITE);
  line(6,  `Peak credits:    ${state.peakCredits}cr`, '#ffd633');
  line(7,  `Total earned:    ${state.lifetimeCreditsEarned}cr`, '#ffd633');
  line(9,  `Final debt:      ${state.bank.loan ? state.bank.loan.remaining.toFixed(1) : 0}cr`, RC);
  centered(12, 'Press any key to return to menu.', WC);

  localStorage.removeItem(SAVE_KEY);

  function bankruptcyKeyHandler(e) {
    window.removeEventListener('keydown', bankruptcyKeyHandler);
    resetState();
    clearScreen();
    drawArt();
    drawPrompt(true);
    state.gameState = 'title';
  }
  window.addEventListener('keydown', bankruptcyKeyHandler);
}

// ── Derivatives helpers ───────────────────────────────────────────────────────

function calcOptionPremium(type, strike, daysToExpiry) {
  const spot      = state.marketPrice;
  const intrinsic = type === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const timeValue = state.volatility * Math.sqrt(daysToExpiry) * spot * 0.1;
  return Math.round((intrinsic + timeValue) * 10) / 10;
}

function calculateVolatility() {
  if (state.demandHistory.length < 2) { state.volatility = 0.2; return; }
  const prices  = state.demandHistory.slice(-14).map(h => h.price);
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  if (returns.length === 0) { state.volatility = 0.2; return; }
  const mean     = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  state.volatility = Math.min(0.5, Math.max(0.1, Math.round(Math.sqrt(variance) * 1000) / 1000));
}

// Module-level handle so tick loop can refresh the positions dashboard
let dashboardRedrawFn  = null;
let inventoryRedrawFn  = null;
let lfMenuRedrawFn     = null;

function checkAbstractionCollapse() {
  if (state.endingTriggered || state.derivatives.totalPnL < 50000) return;
  state.endingTriggered = true;
  state.gameState = 'ending';
  saveGame();
  addLog('The numbers have stopped meaning anything.', '#cc66cc');
  setTimeout(() => addLog('Your widgets. Your credits. Your contracts. All of it — weightless.', '#cc66cc'), 3000);
  setTimeout(() => addLog('You look at the workbench. You look at the terminal. You understand something.', '#cc66cc'), 6000);
  setTimeout(() => {
    const BLINK_TEXT = '[ABSTRACTION COLLAPSE IMMINENT]';
    const bx = Math.floor((DISPLAY_WIDTH - BLINK_TEXT.length) / 2);
    let blinkOn = true;
    const blinkInterval = setInterval(() => {
      blinkOn = !blinkOn;
      for (let i = 0; i < BLINK_TEXT.length; i++)
        display.draw(bx + i, LOG_END_ROW, blinkOn ? BLINK_TEXT[i] : ' ', '#ff5555', BG);
    }, 500);
    setTimeout(() => { clearInterval(blinkInterval); showAbstractionCollapseNote(); }, 3000);
  }, 9000);
}

function showAbstractionCollapseNote() {
  state.gameState = 'ending';
  clearScreen();
  const MC  = '#cc66cc';
  const WC  = '#555555';
  const BOX_W  = 56;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = 4;
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;

  const TEXT_PARAS = [
    "You started with a workbench and ten credits.",
    "You made widgets. Then you made money.\nThen you made money from the idea of money.\nThen you made money from the idea of the idea.",
    "The market is still out there. The widgets\nare still being made. Somewhere a courier\nis still walking the same worn path.",
    "You don't need to be there anymore.",
  ];

  // Build rows
  const rows = [null, { text: '– A NOTE –', center: true, fg: MC }, null];
  for (const para of TEXT_PARAS) {
    for (const ln of para.split('\n')) {
      for (const wrapped of wordWrap(ln, CONT_W)) rows.push({ text: wrapped, fg: BRIGHT_WHITE });
    }
    rows.push(null);
  }
  rows.push(null);
  rows.push({ text: '[press any key to continue]', center: true, fg: MC });

  const BOX_H = rows.length + 2;

  display.draw(BOX_X, BOX_Y, '+', MC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '+', MC, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '-', MC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', MC, BG); display.draw(BOX_X + BOX_W - 1, bY, '+', MC, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, bY, '-', MC, BG);
  for (let y = 1; y < BOX_H - 1; y++) {
    display.draw(BOX_X, BOX_Y + y, '|', MC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '|', MC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + y, ' ', BRIGHT_WHITE, BG);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const y = BOX_Y + 1 + i;
    if (y >= BOX_Y + BOX_H - 1) break;
    if (row.center) {
      const cx = CONT_X + Math.floor((CONT_W - row.text.length) / 2);
      for (let j = 0; j < row.text.length; j++) display.draw(cx + j, y, row.text[j], row.fg, BG);
    } else {
      for (let j = 0; j < row.text.length; j++) display.draw(CONT_X + j, y, row.text[j], row.fg, BG);
    }
  }

  function noteKeyHandler() {
    window.removeEventListener('keydown', noteKeyHandler);
    state.gameState = 'playing';
    clearScreen();
    drawWorld();
    addLog('> To be continued.', '#555555');
  }
  window.addEventListener('keydown', noteKeyHandler);
}

// ── Derivatives Terminal (§5.5) ──────────────────────────────────────────────

function openFuturesMenu() {
  if (!state.skills.futures) return;
  state.gameState = 'menu';
  const BOX_W = 58, BOX_H = 18;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2, CONT_W = BOX_W - 4;
  const WC = '#555555', MC = '#cc66cc';

  function line(row, text, fg) { for (let i = 0; i < text.length; i++) display.draw(CONT_X + i, BOX_Y + row, text[i], fg, BG); }
  function centered(row, text, fg) { const cx = CONT_X + Math.floor((CONT_W - text.length) / 2); for (let i = 0; i < text.length; i++) display.draw(cx + i, BOX_Y + row, text[i], fg, BG); }

  function redraw() {
    display.draw(BOX_X, BOX_Y, '+', MC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '+', MC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '-', MC, BG);
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, bY, '+', MC, BG); display.draw(BOX_X + BOX_W - 1, bY, '+', MC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, bY, '-', MC, BG);
    for (let y = 1; y < BOX_H - 1; y++) {
      display.draw(BOX_X, BOX_Y + y, '|', MC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '|', MC, BG);
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + y, ' ', BRIGHT_WHITE, BG);
    }
    centered(1, '– FUTURES –', MC);
    const futs = state.derivatives.futures;
    const totalContracts = futs.length;
    const totalMargin    = Math.round(futs.reduce((s, f) => s + f.marginHeld, 0) * 10) / 10;
    const dl = demandLabel(state.demand);
    line(3, `Current price:  ${state.marketPrice}cr`, BRIGHT_WHITE);
    line(4, `Today's demand: ${state.demand} (${dl.text})`, dl.fg);
    line(5, `Open futures:   ${totalContracts} contracts (${totalContracts * 10} widgets notional)`, BRIGHT_WHITE);
    line(6, `Margin held:    ${totalMargin}cr`, '#ffd633');
    for (let i = 0; i < CONT_W; i++) display.draw(CONT_X + i, BOX_Y + 8, '.', WC, BG);
    const initMargin = Math.round(state.marketPrice * 10 * 0.20 * 10) / 10;
    const canOpen = state.player.credits >= initMargin;
    line(9,  `1. Buy 1 contract (long — profit if price rises)  ${canOpen ? '[AVAILABLE]' : '[Need ' + initMargin + 'cr]'}`, canOpen ? MC : '#ff5555');
    line(10, `2. Sell 1 contract (short — profit if price falls) ${canOpen ? '[AVAILABLE]' : '[Need ' + initMargin + 'cr]'}`, canOpen ? MC : '#ff5555');
    line(11, `3. Close all positions  ${futs.length > 0 ? '[settle now]' : '[none open]'}`, futs.length > 0 ? '#ff9933' : WC);
    line(12, `4. Back`, WC);
    centered(BOX_H - 2, 'ESC / 4 to go back', WC);
  }

  redraw();

  function closeF() {
    window.removeEventListener('keydown', futKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++) for (let x = BOX_X; x < BOX_X + BOX_W; x++) if (y < WORLD_ROWS) markDirty(x, y);
    renderDirty(); display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function futKeyHandler(e) {
    if (e.key === 'Escape' || e.key === '4') { closeF(); openDerivativesMenu(); return; }
    const initMargin = Math.round(state.marketPrice * 10 * 0.20 * 10) / 10;
    if ((e.key === '1' || e.key === '2') && state.player.credits >= initMargin) {
      const type = e.key === '1' ? 'long' : 'short';
      state.player.credits = Math.round((state.player.credits - initMargin) * 10) / 10;
      state.derivatives.futures.push({ type, quantity: 10, entryPrice: state.marketPrice, lastSettlementPrice: state.marketPrice, openDay: state.day, marginHeld: initMargin });
      addLog(`Opened ${type} future at ${state.marketPrice}cr. Margin: ${initMargin}cr.`, MC);
      drawStatusBar(); redraw(); return;
    }
    if (e.key === '3' && state.derivatives.futures.length > 0) {
      let totalPnL = 0;
      for (const f of state.derivatives.futures) {
        const pnl = Math.round((state.marketPrice - f.entryPrice) * f.quantity * (f.type === 'long' ? 1 : -1) * 10) / 10;
        state.player.credits = Math.round((state.player.credits + f.marginHeld + pnl) * 10) / 10;
        totalPnL += pnl;
      }
      totalPnL = Math.round(totalPnL * 10) / 10;
      state.derivatives.futures = [];
      state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday + totalPnL) * 10) / 10;
      state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL + totalPnL) * 10) / 10;
      state.derivatives.marginCallActive = false;
      addLog(`Futures closed. PnL: ${totalPnL >= 0 ? '+' : ''}${totalPnL}cr.`, totalPnL >= 0 ? '#66cc66' : '#ff5555');
      drawStatusBar(); redraw(); return;
    }
  }
  window.addEventListener('keydown', futKeyHandler);
}

function openCallPutFlow(type, side) {
  const EXPIRIES = [1, 3, 7, 14];
  const spot = state.marketPrice;
  showMenu(`${side === 'buy' ? 'Buy' : 'Write'} ${type.toUpperCase()} — Select Expiry`, [
    ...EXPIRIES.map(days => ({
      label: `${days}-day expiry  (ATM premium: ${calcOptionPremium(type, spot, days)}cr)`,
      enabled: true,
      action: () => {
        showNumericPrompt(`Strike (ATM=${spot}, exp ${days}d)`, 999,
          (strike) => {
            const premium = calcOptionPremium(type, strike, days);
            if (side === 'buy') {
              if (state.player.credits < premium) { addLog(`Need ${premium}cr for premium.`, '#ff5555'); openDerivativesMenu(); return; }
              state.player.credits = Math.round((state.player.credits - premium) * 10) / 10;
              state.derivatives.options.push({ type, strike, expiry: state.day + days, premium, quantity: 1, side: 'buy', marginHeld: 0 });
              addLog(`Bought ${type} strike ${strike}cr exp day ${state.day + days}. Premium: ${premium}cr.`, '#cc66cc');
            } else {
              const margin = Math.round(premium * 3 * 10) / 10;
              const netCost = Math.round((margin - premium) * 10) / 10;
              if (state.player.credits < netCost) { addLog(`Need ${netCost}cr net margin to write.`, '#ff5555'); openDerivativesMenu(); return; }
              state.player.credits = Math.round((state.player.credits + premium - margin) * 10) / 10;
              state.derivatives.options.push({ type, strike, expiry: state.day + days, premium, quantity: 1, side: 'write', marginHeld: margin });
              addLog(`Written ${type} strike ${strike}cr exp day ${state.day + days}. Premium rcvd: ${premium}cr.`, '#cc66cc');
            }
            drawStatusBar(); openDerivativesMenu();
          },
          () => openDerivativesMenu()
        );
      },
    })),
    { label: 'Back', enabled: true, action: () => openDerivativesMenu() },
  ]);
}

function openOptionsMenu(side) {
  if (side === 'buy'   && !state.skills.optionsBuy)   return;
  if (side === 'write' && !state.skills.optionsWrite) return;
  const prefix = side === 'buy' ? 'Buy' : 'Write';
  showMenu(`Options — ${prefix} Side`, [
    { label: `1. ${prefix} Call`, enabled: true, action: () => openCallPutFlow('call', side) },
    { label: `2. ${prefix} Put`,  enabled: true, action: () => openCallPutFlow('put',  side) },
    { label: 'Back',              enabled: true, action: () => openDerivativesMenu() },
  ]);
}

function showVolatilityChart() {
  if (!state.skills.volatilitySurface) return;
  const hist = state.demandHistory.slice(-14);
  if (hist.length < 2) { addLog('Not enough price history for volatility chart.', '#555555'); return; }
  const prices  = hist.map(h => h.price);
  const dailyRets = prices.map((p, i) => i === 0 ? 0 : Math.abs((p - prices[i - 1]) / prices[i - 1]));
  const maxRet = Math.max(...dailyRets.slice(1), 0.01);
  const rows = hist.map((h, i) => ({
    label:  `Day ${String(h.day).padStart(2)}  `,
    demand: Math.round(dailyRets[i] * 100),
    price:  Math.round(dailyRets[i] * 1000) / 10,
  }));
  rows.shift(); // remove first (no return)
  const volPct = Math.round(state.volatility * 100);
  drawDemandChart(`– VOLATILITY (14-day) — vol: ${volPct}% –`, rows, null);
}

function showPositionsDashboard() {
  state.gameState = 'dashboard';

  const BOX_W = 72;
  const BOX_H = 38;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const WC = '#555555', MC = '#cc66cc';

  function r10(n) { return Math.round(n * 10) / 10; }
  function pnlFg(v) { return v > 0 ? '#66cc66' : v < 0 ? '#ff5555' : WC; }
  function pStr(v) { return `${v >= 0 ? '+' : ''}${v}`; }

  function drawFrame() {
    display.draw(BOX_X, BOX_Y, '+', MC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '+', MC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '-', MC, BG);
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, bY, '+', MC, BG); display.draw(BOX_X + BOX_W - 1, bY, '+', MC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, bY, '-', MC, BG);
    for (let y = 1; y < BOX_H - 1; y++) {
      display.draw(BOX_X, BOX_Y + y, '|', MC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '|', MC, BG);
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + y, ' ', BRIGHT_WHITE, BG);
    }
  }

  function textRow(row, text, fg) { for (let i = 0; i < text.length && i < CONT_W; i++) display.draw(CONT_X + i, BOX_Y + row, text[i], fg, BG); }
  function divRow(row) { for (let i = 0; i < CONT_W; i++) display.draw(CONT_X + i, BOX_Y + row, '.', WC, BG); }

  function redraw() {
    drawFrame();
    const cx = CONT_X + Math.floor((CONT_W - 20) / 2);
    for (let i = 0; i < '– OPEN POSITIONS –'.length; i++) display.draw(cx + i, BOX_Y + 1, '– OPEN POSITIONS –'[i], MC, BG);
    const spot = state.marketPrice;
    let row = 3;

    // FORWARDS
    const fwds = state.derivatives.forwards;
    textRow(row++, `FORWARDS (${fwds.length} open)`, '#ffd633');
    if (fwds.length === 0) { textRow(row++, '  none', WC); }
    else {
      for (const f of fwds) {
        const unr = r10((f.lockedPrice - spot) * f.quantity);
        textRow(row++, `  Day ${f.settlementDay - 1} → Day ${f.settlementDay}   ${f.quantity} widgets @ ${f.lockedPrice}cr   PnL: ${pStr(unr)}cr`, pnlFg(unr));
      }
    }
    divRow(row++);

    // FUTURES
    const futs = state.derivatives.futures;
    textRow(row++, `FUTURES (${futs.length} contracts)`, '#ffd633');
    if (futs.length === 0) { textRow(row++, '  none', WC); }
    else {
      const grouped = {};
      for (const f of futs) { grouped[f.type] = (grouped[f.type] || []); grouped[f.type].push(f); }
      for (const type of ['long', 'short']) {
        if (!grouped[type] || grouped[type].length === 0) continue;
        const grp = grouped[type];
        const avgEntry = r10(grp.reduce((s, f) => s + f.entryPrice, 0) / grp.length);
        const unr = r10(grp.reduce((s, f) => s + (spot - f.entryPrice) * f.quantity * (type === 'long' ? 1 : -1), 0));
        textRow(row++, `  ${grp.length}× ${type.toUpperCase()}  entry ${avgEntry}cr  current ${spot}cr  unreal PnL: ${pStr(unr)}cr`, pnlFg(unr));
      }
    }
    divRow(row++);

    // OPTIONS
    const opts = state.derivatives.options;
    textRow(row++, `OPTIONS (${opts.length} open)`, '#ffd633');
    if (opts.length === 0) { textRow(row++, '  none', WC); }
    else {
      for (const o of opts) {
        const intrinsic = o.type === 'call' ? Math.max(spot - o.strike, 0) : Math.max(o.strike - spot, 0);
        const val = r10(intrinsic);
        const unr = o.side === 'buy' ? r10(val - o.premium) : r10(o.premium - val);
        const side = o.side === 'write' ? ' [written]' : '';
        textRow(row++, `  ${o.type.toUpperCase().padEnd(4)}  strike ${o.strike}cr  exp day ${o.expiry}  prem ${o.premium}cr  val: ${val}cr${side}`, pnlFg(unr));
      }
    }
    divRow(row++);

    // Totals
    const totalUnr = r10(
      fwds.reduce((s, f) => s + (f.lockedPrice - spot) * f.quantity, 0) +
      futs.reduce((s, f) => s + (spot - f.entryPrice) * f.quantity * (f.type === 'long' ? 1 : -1), 0) +
      opts.filter(o => o.side === 'buy').reduce((s, o) => s + (o.type === 'call' ? Math.max(spot - o.strike, 0) : Math.max(o.strike - spot, 0)) - o.premium, 0)
    );
    textRow(row++, `Total unrealized PnL: ${pStr(totalUnr)}cr`, pnlFg(totalUnr));
    textRow(row++, `Total realized PnL today: ${pStr(state.derivatives.pnlToday)}cr`, pnlFg(state.derivatives.pnlToday));

    const esc = '[ ESC to close ]';
    const eX = CONT_X + Math.floor((CONT_W - esc.length) / 2);
    for (let i = 0; i < esc.length; i++) display.draw(eX + i, BOX_Y + BOX_H - 2, esc[i], WC, BG);
  }

  dashboardRedrawFn = redraw;
  redraw();

  function closeDash() {
    dashboardRedrawFn = null;
    window.removeEventListener('keydown', dashKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++) for (let x = BOX_X; x < BOX_X + BOX_W; x++) if (y < WORLD_ROWS) markDirty(x, y);
    renderDirty(); display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }
  function dashKeyHandler(e) { if (e.key === 'Escape') closeDash(); }
  window.addEventListener('keydown', dashKeyHandler);
}

function openDerivativesMenu() {
  if (!state.stations.derivatives || !state.stations.derivatives.unlocked) return;
  state.gameState = 'menu';

  const BOX_W  = 58;
  const BOX_H  = 20;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const WC     = '#555555';
  const MC     = '#cc66cc';

  function line(row, text, fg) {
    for (let i = 0; i < text.length; i++) display.draw(CONT_X+i, BOX_Y+row, text[i], fg, BG);
  }
  function centered(row, text, fg) {
    const cx = CONT_X + Math.floor((CONT_W - text.length) / 2);
    for (let i = 0; i < text.length; i++) display.draw(cx+i, BOX_Y+row, text[i], fg, BG);
  }

  function redraw() {
    display.draw(BOX_X, BOX_Y, '+', MC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', MC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', MC, BG);
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, bY, '+', MC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', MC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', MC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', MC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', MC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }

    centered(1, '– DERIVATIVES TERMINAL –', MC);

    const dl         = state.phase >= 3 ? demandLabel(state.demand) : { text: 'N/A', fg: WC };
    const fwdUnr     = state.derivatives.forwards.reduce((s, f) => s + (f.lockedPrice - state.marketPrice) * f.quantity, 0);
    const futUnr     = state.derivatives.futures.reduce((s, f) => s + (state.marketPrice - f.entryPrice) * f.quantity * (f.type === 'long' ? 1 : -1), 0);
    const totalUnrPnL = Math.round((fwdUnr + futUnr) * 10) / 10;
    const dispPnL    = Math.round((state.derivatives.pnlToday + totalUnrPnL) * 10) / 10;
    line(3, `Current widget price:  ${state.marketPrice}cr`, BRIGHT_WHITE);
    line(4, `Today's demand:        ${state.demand} (${dl.text})`, dl.fg);
    line(5, `Volatility:            ${Math.round(state.volatility * 100)}%`, '#66ccff');
    const pFg = dispPnL > 0 ? '#66cc66' : dispPnL < 0 ? '#ff5555' : WC;
    line(6, `Your position PnL:     ${dispPnL >= 0 ? '+' : ''}${dispPnL}cr`, pFg);

    for (let i = 0; i < CONT_W; i++) display.draw(CONT_X+i, BOX_Y+8, '.', WC, BG);

    const allPositions = state.derivatives.forwards.length + state.derivatives.futures.length + state.derivatives.options.length;
    line(9,  `1. Forward Contracts       [AVAILABLE]`, MC);
    line(10, `2. Futures Trading         ${state.skills.futures ? '[AVAILABLE]' : '[LOCKED — purchase in Office]'}`, state.skills.futures ? MC : WC);
    line(11, `3. Options — Buy Side      ${state.skills.optionsBuy ? '[AVAILABLE]' : '[LOCKED — purchase in Office]'}`, state.skills.optionsBuy ? MC : WC);
    line(12, `4. Options — Write Side    ${state.skills.optionsWrite ? '[AVAILABLE]' : '[LOCKED — purchase in Office]'}`, state.skills.optionsWrite ? MC : WC);
    line(13, `5. View Open Positions     ${allPositions > 0 ? `[${allPositions} open]` : '[none]'}`, allPositions > 0 ? BRIGHT_WHITE : WC);
    line(14, `6. Close All Positions     ${allPositions > 0 ? '[settle now]' : '[no positions]'}`, allPositions > 0 ? '#ff9933' : WC);
    if (state.skills.volatilitySurface) line(15, `7. View Volatility Surface [AVAILABLE]`, '#66ccff');

    centered(BOX_H-2, 'ESC to close', WC);
  }

  redraw();

  function closeDV() {
    window.removeEventListener('keydown', dvKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function dvKeyHandler(e) {
    if (e.key === 'Escape') { closeDV(); return; }

    if (e.key === '1') {
      const maxQty = state.storage.widgets + state.player.inventory.widgets;
      if (maxQty <= 0) { addLog('No widgets available for forward contract.', WC); return; }
      window.removeEventListener('keydown', dvKeyHandler);
      const expD = Math.max(5, Math.round(50 + 30 * Math.sin((state.day + 1) / 7 * 2 * Math.PI)));
      const expP = Math.round(8 * Math.pow(expD / 50, 0.5) * 10) / 10;
      showNumericPrompt(`Forward (today:${state.marketPrice}cr, est.tmrw:${expP}cr)`, maxQty,
        (qty) => {
          state.derivatives.forwards.push({ quantity: qty, lockedPrice: state.marketPrice, settlementDay: state.day + 1 });
          addLog(`Forward: ${qty} widgets at ${state.marketPrice}cr, settling day ${state.day + 1}.`, MC);
          openDerivativesMenu();
        },
        () => openDerivativesMenu()
      );
      return;
    }

    if (e.key === '2' && state.skills.futures)    { closeDV(); openFuturesMenu(); return; }
    if (e.key === '3' && state.skills.optionsBuy)  { closeDV(); openOptionsMenu('buy');   return; }
    if (e.key === '4' && state.skills.optionsWrite){ closeDV(); openOptionsMenu('write');  return; }

    if (e.key === '5') {
      closeDV(); showPositionsDashboard(); return;
    }

    if (e.key === '6') {
      const allPos = state.derivatives.forwards.length + state.derivatives.futures.length + state.derivatives.options.length;
      if (allPos === 0) return;
      let totalPnL = 0;
      for (const f of state.derivatives.forwards) totalPnL += (f.lockedPrice - state.marketPrice) * f.quantity;
      for (const f of state.derivatives.futures)  { totalPnL += (state.marketPrice - f.entryPrice) * f.quantity * (f.type === 'long' ? 1 : -1); state.player.credits = Math.round((state.player.credits + f.marginHeld) * 10) / 10; }
      for (const o of state.derivatives.options)  { if (o.side === 'buy') { const ev = o.type === 'call' ? Math.max(state.marketPrice - o.strike, 0) : Math.max(o.strike - state.marketPrice, 0); totalPnL += ev - o.premium; } else { const ev = o.type === 'call' ? Math.max(state.marketPrice - o.strike, 0) : Math.max(o.strike - state.marketPrice, 0); totalPnL += o.premium - ev; state.player.credits = Math.round((state.player.credits + o.marginHeld) * 10) / 10; } }
      totalPnL = Math.round(totalPnL * 10) / 10;
      state.player.credits = Math.round((state.player.credits + totalPnL) * 10) / 10;
      state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday + totalPnL) * 10) / 10;
      state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL + totalPnL) * 10) / 10;
      state.derivatives.forwards = []; state.derivatives.futures = []; state.derivatives.options = [];
      state.derivatives.marginCallActive = false;
      addLog(`All positions closed. PnL: ${totalPnL >= 0 ? '+' : ''}${totalPnL}cr.`, totalPnL >= 0 ? '#66cc66' : '#ff5555');
      drawStatusBar(); redraw(); return;
    }

    if (e.key === '7' && state.skills.volatilitySurface) { closeDV(); showVolatilityChart(); return; }
  }
  window.addEventListener('keydown', dvKeyHandler);
}

function showForwardPositions() {
  state.gameState = 'menu';
  const fwds = state.derivatives.forwards;
  const BOX_W  = 52;
  const BOX_H  = Math.max(8, 5 + fwds.length + 3);
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const WC     = '#555555';
  const MC     = '#cc66cc';

  display.draw(BOX_X, BOX_Y, '+', MC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', MC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', MC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '+', MC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', MC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', MC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '|', MC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', MC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }
  const tX = CONT_X + Math.floor((CONT_W - 18) / 2);
  for (let i = 0; i < '– OPEN POSITIONS –'.length; i++) display.draw(tX+i, BOX_Y+1, '– OPEN POSITIONS –'[i], MC, BG);
  for (let i = 0; i < fwds.length; i++) {
    const f   = fwds[i];
    const unr = Math.round((f.lockedPrice - state.marketPrice) * f.quantity * 10) / 10;
    const txt = `Fwd day ${f.settlementDay}: ${f.quantity}wg @ ${f.lockedPrice}cr  unr:${unr >= 0 ? '+' : ''}${unr}cr`;
    const fg  = unr >= 0 ? '#66cc66' : '#ff5555';
    for (let j = 0; j < txt.length; j++) display.draw(CONT_X+j, BOX_Y+3+i, txt[j], fg, BG);
  }
  const esc = '[ ESC to close ]';
  const eX  = CONT_X + Math.floor((CONT_W - esc.length) / 2);
  for (let i = 0; i < esc.length; i++) display.draw(eX+i, BOX_Y+BOX_H-2, esc[i], WC, BG);

  function close() {
    window.removeEventListener('keydown', posKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }
  function posKeyHandler(e) { if (e.key === 'Escape') close(); }
  window.addEventListener('keydown', posKeyHandler);
}

// ── Large digit renderer (§9) ─────────────────────────────────────────────────

const LARGE_DIGITS = {
  '0': [' ███ ','█   █',' ███ '],
  '1': ['  █  ','  █  ','  █  '],
  '2': ['████ ','  ███','████ '],
  '3': ['████ ',' ███ ','████ '],
  '4': ['█   █',' ████','    █'],
  '5': [' ████','███  ',' ███ '],
  '6': [' ████','████ ',' ███ '],
  '7': ['████ ','   █ ','   █ '],
  '8': [' ███ ',' ███ ',' ███ '],
  '9': [' ███ ',' ████',' ███ '],
  ',': ['     ','     ','  ,  '],
  ' ': ['     ','     ','     '],
};

function renderLargeNumber(display, x, y, numberString, color) {
  for (let ci = 0; ci < numberString.length; ci++) {
    const ch    = numberString[ci];
    const pat   = LARGE_DIGITS[ch] || LARGE_DIGITS[' '];
    const ox    = x + ci * 6;
    for (let row = 0; row < 3; row++) {
      const line = pat[row];
      for (let col = 0; col < 5; col++) {
        const sx = ox + col, sy = y + row;
        if (sx < 0 || sx >= DISPLAY_WIDTH || sy < 0 || sy >= DISPLAY_HEIGHT) continue;
        display.draw(sx, sy, line[col] || ' ', color, BG);
      }
    }
  }
}

// ── Launch Facility menu (§9) ─────────────────────────────────────────────────

function openLFMenu() {
  state.gameState = 'lf_menu';

  const BOX_W  = 64;
  const BOX_H  = 24;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const IW     = BOX_W - 2; // 62 inner width
  const RC     = '#ff5555'; // rocket red (border color)
  const WC     = '#555555';
  const DC     = '#333333';

  function menuPad(str, width) {
    if (str.length > width) return str.slice(0, width - 1) + '…';
    return str.padEnd(width);
  }

  function drawInnerRow(row, text, fg) {
    const abs  = BOX_Y + row;
    const line = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, abs, line[i] || ' ', fg, BG);
  }

  function drawFrame() {
    // Top border ╔═…═╗
    display.draw(BOX_X, BOX_Y, '╔', RC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', RC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '═', RC, BG);
    // Bottom border ╚═…═╝
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '╚', RC, BG);
    display.draw(BOX_X + BOX_W - 1, botY, '╝', RC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, botY, '═', RC, BG);
    // Side borders + clear interior
    for (let r = 1; r < BOX_H - 1; r++) {
      display.draw(BOX_X, BOX_Y + r, '║', RC, BG);
      display.draw(BOX_X + BOX_W - 1, BOX_Y + r, '║', RC, BG);
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);
    }
  }

  // Rocket body art (col 3-19 within box, rows 3-20 within box)
  // Each entry: [string, fg] — # chars replaced by █ in spec colors
  const ROCKET_BODY = [
    // row 3
    ['     /\\     ', '#aaaaaa'],
    // row 4
    ['    /  \\    ', '#aaaaaa'],
    // row 5
    ['   | /\\ |   ', '#aaaaaa'],
  ];
  // We draw the rocket row-by-row with per-character color handling
  function drawRocketRow(boxRow, str, defaultFg, redChars, whiteChars) {
    const absY = BOX_Y + boxRow;
    const startX = BOX_X + 3;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      let fg = defaultFg;
      if (redChars && redChars.has(i)) fg = '#ff5555';
      else if (whiteChars && whiteChars.has(i)) fg = '#ffffff';
      display.draw(startX + i, absY, ch, fg, BG);
    }
  }

  function drawRocket() {
    // Body rows (box rows 3-17)
    drawRocketRow(3,  '     /\\     ', '#aaaaaa');
    drawRocketRow(4,  '    /  \\    ', '#aaaaaa');
    drawRocketRow(5,  '   | /\\ |   ', '#aaaaaa');
    // rows 6-10: rocket body with red fills (positions 4-7 are █ in #ff5555)
    drawRocketRow(6,  '   |/  \\|   ', '#aaaaaa', new Set([4,5,6,7]), null);
    // override with actual red glyphs
    const absY6 = BOX_Y + 6, bx = BOX_X + 3;
    display.draw(bx+4, absY6, '█', '#ff5555', BG);
    display.draw(bx+5, absY6, '█', '#ff5555', BG);
    display.draw(bx+6, absY6, '█', '#ff5555', BG);
    display.draw(bx+7, absY6, '█', '#ff5555', BG);
    // rows 7-10: all-red body interior
    for (let r = 7; r <= 10; r++) {
      const ay = BOX_Y + r;
      if (r <= 8) {
        display.draw(bx+0, ay, ' ', '#aaaaaa', BG); display.draw(bx+1, ay, ' ', '#aaaaaa', BG); display.draw(bx+2, ay, ' ', '#aaaaaa', BG);
        display.draw(bx+3, ay, '|', '#aaaaaa', BG);
        display.draw(bx+4, ay, '█', '#ff5555', BG); display.draw(bx+5, ay, '█', '#ff5555', BG);
        display.draw(bx+6, ay, '█', '#ff5555', BG); display.draw(bx+7, ay, '█', '#ff5555', BG);
        display.draw(bx+8, ay, '|', '#aaaaaa', BG);
        display.draw(bx+9, ay, ' ', '#aaaaaa', BG); display.draw(bx+10, ay, ' ', '#aaaaaa', BG); display.draw(bx+11, ay, ' ', '#aaaaaa', BG);
      } else if (r === 9) {
        display.draw(bx+0, ay, ' ', '#aaaaaa', BG); display.draw(bx+1, ay, ' ', '#aaaaaa', BG);
        display.draw(bx+2, ay, '/', '#aaaaaa', BG);
        display.draw(bx+3, ay, '|', '#aaaaaa', BG);
        display.draw(bx+4, ay, '█', '#ff5555', BG); display.draw(bx+5, ay, '█', '#ff5555', BG);
        display.draw(bx+6, ay, '█', '#ff5555', BG); display.draw(bx+7, ay, '█', '#ff5555', BG);
        display.draw(bx+8, ay, '|', '#aaaaaa', BG);
        display.draw(bx+9, ay, '\\', '#aaaaaa', BG);
        display.draw(bx+10, ay, ' ', '#aaaaaa', BG); display.draw(bx+11, ay, ' ', '#aaaaaa', BG);
      } else { // r === 10
        display.draw(bx+0, ay, ' ', '#aaaaaa', BG);
        display.draw(bx+1, ay, '/', '#aaaaaa', BG);
        display.draw(bx+2, ay, ' ', '#aaaaaa', BG);
        display.draw(bx+3, ay, '|', '#aaaaaa', BG);
        display.draw(bx+4, ay, '█', '#ff5555', BG); display.draw(bx+5, ay, '█', '#ff5555', BG);
        display.draw(bx+6, ay, '█', '#ff5555', BG); display.draw(bx+7, ay, '█', '#ff5555', BG);
        display.draw(bx+8, ay, '|', '#aaaaaa', BG);
        display.draw(bx+9, ay, ' ', '#aaaaaa', BG);
        display.draw(bx+10, ay, '\\', '#aaaaaa', BG);
        display.draw(bx+11, ay, ' ', '#aaaaaa', BG);
      }
    }
    // row 11: +----+ frame
    drawRocketRow(11, '/  +----+  \\', '#aaaaaa');
    // rows 12-14: body + windows
    drawRocketRow(12, '   |    |   ', '#aaaaaa');
    const ay13 = BOX_Y + 13, ay14 = BOX_Y + 14;
    drawRocketRow(13, '   |    |   ', '#aaaaaa');
    display.draw(bx+4, ay13, '█', '#ffffff', BG); display.draw(bx+5, ay13, '█', '#ffffff', BG);
    drawRocketRow(14, '   |    |   ', '#aaaaaa');
    display.draw(bx+4, ay14, '█', '#ffffff', BG); display.draw(bx+5, ay14, '█', '#ffffff', BG);
    // row 15: +----+
    drawRocketRow(15, '   +----+   ', '#aaaaaa');
    // rows 16-17: base
    drawRocketRow(16, '  /      \\  ', '#aaaaaa');
    drawRocketRow(17, ' /________\\ ', '#aaaaaa');
    // rows 18-20: flames (only if rocketWidgets > 0)
    if (state.rocketWidgets > 0) {
      if (state.rocketAnimFrame === 0) {
        drawRocketRow(18, '    *  *    ', '#ff9933');
        drawRocketRow(19, '   ^^^*^^^  ', '#ffd633');
        drawRocketRow(20, '  * * * * * ', '#ff5555');
      } else {
        drawRocketRow(18, '   * ** *   ', '#ffd633');
        drawRocketRow(19, '  *^*^*^*   ', '#ff9933');
        drawRocketRow(20, '   *^*^*^   ', '#ff5555');
      }
    }
  }

  function drawRightPane() {
    const RP = BOX_X + 1 + 21; // absolute x start of right pane
    const RW = 40;
    function rpt(row, text, fg) {
      const line = menuPad(text, RW);
      const ay   = BOX_Y + row;
      for (let i = 0; i < RW; i++) display.draw(RP + i, ay, line[i] || ' ', fg, BG);
    }

    rpt(6,  'WIDGETS LOADED', WC);

    // Large digit display (rows 7-9)
    const rw     = Math.min(state.rocketWidgets, 1000000);
    const numStr = rw.toLocaleString('en-US');
    const numFg  = rw >= 900000 ? '#ff5555' : rw >= 500000 ? '#ff9933' : '#ffd633';
    renderLargeNumber(display, RP, BOX_Y + 7, numStr, numFg);

    rpt(10, '/ 1,000,000', WC);

    // Progress bar (row 12)
    const pct      = rw / 1000000;
    const BAR_W    = 28;
    const filled   = Math.round(pct * BAR_W);
    const pctStr   = (pct * 100).toFixed(1) + '%';
    let bar = '[';
    for (let i = 0; i < BAR_W; i++) bar += i < filled ? '█' : '░';
    bar += '] ' + pctStr;
    rpt(12, bar, '#f0f0f0');

    // Divider (row 14)
    rpt(14, '═'.repeat(38), DC);

    // Courier toggle (row 16)
    const dest = state.courierDestination;
    const mktActive = dest === 'market';
    const mktStr  = mktActive ? '>> [ MARKET ] <<' : '   [ MARKET ]  ';
    const rktStr  = mktActive ? '   [ ROCKET ]  ' : '>> [ ROCKET ] <<';
    const mktFg   = mktActive ? RC : WC;
    const rktFg   = mktActive ? WC : RC;
    const toggleLine = mktStr + ' / ' + rktStr;
    const ay16 = BOX_Y + 16;
    let tx = RP;
    for (let i = 0; i < mktStr.length; i++) display.draw(tx++, ay16, mktStr[i], mktFg, BG);
    for (const ch of ' / ') display.draw(tx++, ay16, ch, WC, BG);
    for (let i = 0; i < rktStr.length; i++) display.draw(tx++, ay16, rktStr[i], rktFg, BG);

    rpt(17, 'space: toggle destination', DC);

    // Status (row 19)
    const status = mktActive ? 'Selling widgets for credits.' : 'Loading the rocket.';
    rpt(19, status, mktActive ? '#66cc66' : RC);
  }

  function redraw() {
    drawFrame();

    // Row 1: title
    const title = menuPad('LAUNCH FACILITY', IW);
    const tx = Math.floor((IW - 'LAUNCH FACILITY'.length) / 2);
    for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, BOX_Y+1, title[i], '#f0f0f0', BG);

    // Row 2: subtitle
    const sub = menuPad('destination unknown', IW);
    const sx  = Math.floor((IW - 'destination unknown'.length) / 2);
    for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, BOX_Y+2, sub[i], WC, BG);

    // Row 3: ─ separator
    for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, BOX_Y+3, '─', DC, BG);

    // │ separator at col 20 within inner (rows 4-20)
    for (let r = 4; r <= 20; r++) display.draw(BOX_X+1+20, BOX_Y+r, '│', DC, BG);

    // Row 21: ─ separator
    for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, BOX_Y+21, '─', DC, BG);

    // Row 22: full-width toggle centered
    const dest     = state.courierDestination;
    const mktA     = dest === 'market';
    const fullToggle = (mktA ? '>> [ MARKET ] <<' : '   [ MARKET ]  ') + ' / ' + (mktA ? '   [ ROCKET ]  ' : '>> [ ROCKET ] <<');
    const fullPad  = menuPad(fullToggle, IW);
    const ftx = Math.floor((IW - fullToggle.length) / 2);
    for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, BOX_Y+22, fullPad[i] || ' ', BRIGHT_WHITE, BG);
    // Re-draw toggle parts in their colors
    let ltx = BOX_X + 1 + ftx;
    const mktStr = mktA ? '>> [ MARKET ] <<' : '   [ MARKET ]  ';
    const rktStr = mktA ? '   [ ROCKET ]  ' : '>> [ ROCKET ] <<';
    for (const ch of mktStr) display.draw(ltx++, BOX_Y+22, ch, mktA ? RC : WC, BG);
    for (const ch of ' / ')  display.draw(ltx++, BOX_Y+22, ch, WC, BG);
    for (const ch of rktStr) display.draw(ltx++, BOX_Y+22, ch, mktA ? WC : RC, BG);

    drawRocket();
    drawRightPane();
  }

  lfMenuRedrawFn = redraw;
  redraw();

  function closeLF() {
    lfMenuRedrawFn = null;
    window.removeEventListener('keydown', lfKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function lfKeyHandler(e) {
    if (e.key === 'Escape') { closeLF(); return; }
    if (e.key === ' ') {
      e.preventDefault();
      if (state.rocketWidgets < 1000000) {
        state.courierDestination = state.courierDestination === 'market' ? 'rocket' : 'market';
        redraw();
      }
    }
  }
  window.addEventListener('keydown', lfKeyHandler);
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
  const bkStation = STATION_DEFS.find(s => s.label === 'BK');
  if (bkStation && isAdjacentToStation(bkStation)) { openBankMenu(); return; }
  const dvStation = STATION_DEFS.find(s => s.label === 'DV');
  if (dvStation && isAdjacentToStation(dvStation)) { openDerivativesMenu(); return; }
  const lfStation = STATION_DEFS.find(s => s.label === 'LF');
  if (lfStation && isAdjacentToStation(lfStation) && state.stations.launch_facility?.unlocked) { openLFMenu(); return; }
}

// ── Inventory screen (§3.9) ──────────────────────────────────────────────────

function showInventory() {
  state.gameState = 'inventory';
  let tab          = 'stocks'; // 'stocks' | 'ops'
  let workerScroll = 0;

  const BOX_W  = 54;
  const BOX_H  = 24;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4; // 50
  const WC     = '#555555';

  function drawFrame() {
    display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, botY, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, botY, '-', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }
  }

  function t(row, col, text, fg) {
    for (let i = 0; i < text.length && col + i < CONT_W; i++)
      display.draw(CONT_X + col + i, BOX_Y + row, text[i], fg, BG);
  }
  function tc(row, text, fg) { t(row, Math.floor((CONT_W - text.length) / 2), text, fg); }
  function divRow(row) { for (let i = 0; i < CONT_W; i++) display.draw(CONT_X+i, BOX_Y+row, '.', WC, BG); }

  function drawTabBar(row) {
    const stocks = tab === 'stocks';
    t(row, 0, '[ < ', WC);
    t(row, 4, 'STOCKS', stocks ? BRIGHT_CYAN : WC);
    t(row, 10, '    ', WC);
    t(row, 14, 'OPERATIONS', stocks ? WC : BRIGHT_CYAN);
    t(row, 24, ' > ]', WC);
  }

  function drawBar(row, label, current, max, barFg, labelFg) {
    const BAR_W  = 12;
    const filled = max > 0 ? Math.min(Math.round(current / max * BAR_W), BAR_W) : 0;
    t(row, 0, label.padEnd(16), labelFg);
    display.draw(CONT_X+16, BOX_Y+row, '[', WC, BG);
    for (let i = 0; i < BAR_W; i++)
      display.draw(CONT_X+17+i, BOX_Y+row, i < filled ? '=' : ' ', i < filled ? barFg : WC, BG);
    display.draw(CONT_X+29, BOX_Y+row, ']', WC, BG);
    t(row, 30, `${current}/${max}`.padStart(9), labelFg);
  }

  function drawSymRow(row, label, sym, symFg, value, valFg) {
    const SYM_W = 20;
    const syms  = Math.min(Math.floor(value / 10), SYM_W);
    t(row, 0, label.padEnd(16), WC);
    for (let i = 0; i < SYM_W; i++)
      display.draw(CONT_X+16+i, BOX_Y+row, i < syms ? sym : ' ', i < syms ? symFg : WC, BG);
    const valStr = `${formatCredits(value)}cr`;
    t(row, CONT_W - valStr.length, valStr, valFg);
  }

  function redrawStocks() {
    const inv = state.player.inventory;
    const cap = state.player.inventoryCaps;
    tc(1, '-- INVENTORY [STOCKS] --', BRIGHT_CYAN);
    drawTabBar(2);
    drawBar(4, 'Raw Materials', inv.rm,      cap.rm,      '#66cc66', '#ff9933');
    drawBar(5, 'Widgets',       inv.widgets, cap.widgets, '#66cc66', BRIGHT_WHITE);
    divRow(7);
    drawSymRow(9,  'Credits',         '$', '#ffd633', state.player.credits,        '#ffd633');
    drawSymRow(10, 'Lifetime earned', '~', WC,        state.lifetimeCreditsEarned, WC);
    divRow(12);
    if (state.phase >= 3) {
      t(14, 0, 'MARKET REPORT', BRIGHT_CYAN);
      const dl = demandLabel(state.demand);
      t(15, 0, `Demand today:   ${String(state.demand).padStart(3)} widgets   (${dl.text})`, dl.fg);
      t(16, 0, `Price today:    ${state.marketPrice}cr`, BRIGHT_WHITE);
      t(17, 0, `Sold today:     ${state.widgetsSoldToday} / ${state.demand}`, BRIGHT_WHITE);
      t(18, 0, `Remaining:      ${Math.max(0, state.demand - state.widgetsSoldToday)} widgets`, BRIGHT_WHITE);
    } else {
      t(14, 0, 'MARKET REPORT — available in Phase 3', WC);
    }
    const ms  = state.marketOpen ? 'OPEN' : 'CLOSED';
    const mFg = state.marketOpen ? BRIGHT_YELLOW : WC;
    const mRem = state.marketOpen ? (180 - state.dayTick) : (240 - state.dayTick);
    const pre  = `Day ${state.day}    Market: `;
    t(20, 0, pre, BRIGHT_WHITE);
    t(20, pre.length, ms, mFg);
    t(20, pre.length + ms.length, `    ${mRem}s left`, BRIGHT_WHITE);
    tc(22, '[ ESC to close ]', WC);
  }

  const LP_W   = 23; // left pane width
  const SEP    = 23; // separator col
  const RP_OFF = 24; // right pane start col
  const RP_W   = CONT_W - RP_OFF; // 26

  function lp(row, col, text, fg) {
    for (let i = 0; i < text.length && col + i < LP_W; i++)
      display.draw(CONT_X + col + i, BOX_Y + row, text[i], fg, BG);
  }
  function rp(row, col, text, fg) {
    for (let i = 0; i < text.length && RP_OFF + col + i < CONT_W; i++)
      display.draw(CONT_X + RP_OFF + col + i, BOX_Y + row, text[i], fg, BG);
  }

  function redrawOps() {
    tc(1, '-- INVENTORY [OPERATIONS] --', BRIGHT_CYAN);
    drawTabBar(2);
    for (let r = 3; r <= 21; r++) display.draw(CONT_X + SEP, BOX_Y + r, '|', WC, BG);

    // Left pane — production stats
    lp(3,  0, 'PRODUCTION STATS', '#ffd633');
    const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const rateRM  = avg(state.stats.rmLastTen);
    const rateWg  = avg(state.stats.widgetsLastTen);
    const rateCr  = avg(state.stats.creditsLastTen);
    const crFg    = rateCr >= 0 ? '#66cc66' : '#ff5555';
    const crSign  = rateCr >= 0 ? '+' : '';
    lp(5,  0, `RM/sec    ${Math.abs(rateRM).toFixed(1)}`, BRIGHT_WHITE);
    lp(6,  0, `Wdgt/sec  ${rateWg.toFixed(1)}`, BRIGHT_WHITE);
    lp(7,  0, `Cr/sec  ${crSign}${rateCr.toFixed(1)}cr`, crFg);
    for (let i = 0; i < LP_W; i++) display.draw(CONT_X+i, BOX_Y+9, '.', WC, BG);
    lp(11, 0, 'Today', BRIGHT_WHITE);
    lp(12, 0, `RM purch'd${String(state.rmPurchasedToday).padStart(LP_W-10)}`, BRIGHT_WHITE);
    lp(13, 0, `Wdgts made${String(state.stats.widgetsMadeToday).padStart(LP_W-10)}`, BRIGHT_WHITE);
    lp(14, 0, `Wdgts sold${String(state.widgetsSoldToday).padStart(LP_W-10)}`, BRIGHT_WHITE);
    lp(15, 0, `Revenue${(formatCredits(state.stats.revenueToday)+'cr').padStart(LP_W-7)}`, '#66cc66');
    lp(16, 0, `Costs  ${(formatCredits(state.stats.costsToday)+'cr').padStart(LP_W-7)}`, '#ff5555');
    const net    = Math.round((state.stats.revenueToday - state.stats.costsToday) * 10) / 10;
    const netS   = (net >= 0 ? '+' : '') + formatCredits(net) + 'cr';
    lp(17, 0, `Net${netS.padStart(LP_W-3)}`, net >= 0 ? '#66cc66' : '#ff5555');

    // Right pane — workers
    const allW = [
      ...state.workers.apprentices.map((w, i) => ({ type: 'appr', idx: i, w })),
      ...state.workers.couriers.map((c, i)    => ({ type: 'cour', idx: i, w: c })),
    ];
    if (allW.length === 0) {
      rp(10, 0, 'No workers', WC);
      rp(11, 0, 'hired yet.', WC);
    } else {
      const LINES_PER = 5;
      const maxVis    = Math.floor(18 / LINES_PER); // 3
      workerScroll = Math.min(workerScroll, Math.max(0, allW.length - maxVis));
      if (workerScroll > 0)                  rp(3,  RP_W - 2, '▲', WC);
      if (workerScroll + maxVis < allW.length) rp(20, RP_W - 2, '▼', WC);
      let row = 4;
      for (let wi = workerScroll; wi < Math.min(workerScroll + maxVis, allW.length); wi++) {
        const { type, idx, w } = allW[wi];
        if (type === 'appr') {
          const st = w.paused ? 'idle' : w.workerState;
          let fFg, fig2, stLbl, taskLbl;
          if (st === 'crafting')                         { fFg = '#ff9933'; fig2 = '[=]'; stLbl = 'CRAFTING';   taskLbl = 'making widget'; }
          else if (st === 'fetching' || st === 'returning') { fFg = '#66ccff'; fig2 = '\\|/'; stLbl = 'WORKING';    taskLbl = st === 'fetching' ? 'RM → WB' : 'WB → RM'; }
          else                                           { fFg = WC;        fig2 = '...'; stLbl = w.paused ? 'PAUSED' : 'IDLE'; taskLbl = 'waiting'; }
          rp(row,   0, '[o]', fFg);   rp(row,   4, `Appr. ${idx+1}`, BRIGHT_WHITE);
          rp(row+1, 0, fig2, fFg);    rp(row+1, 4, stLbl, fFg);
          rp(row+2, 0, ' | ', fFg);   rp(row+2, 4, taskLbl, WC);
          rp(row+3, 0, '/ \\', fFg);
        } else {
          const st = w.courierState;
          let fFg, fig2, stLbl, taskLbl;
          if      (st === 'loading')    { fFg = '#cc66cc'; fig2 = '/=\\'; stLbl = 'LOADING';    taskLbl = 'at STG'; }
          else if (st === 'delivering') { fFg = '#ffd633'; fig2 = '>>>'; stLbl = 'DELIVERING'; taskLbl = 'STG→MKT'; }
          else if (st === 'returning')  { fFg = WC;        fig2 = '<<<'; stLbl = 'RETURNING';  taskLbl = 'MKT→STG'; }
          else                          { fFg = WC;        fig2 = '/=\\'; stLbl = 'IDLE';       taskLbl = 'waiting'; }
          rp(row,   0, '[>]', fFg);  rp(row,   4, `Cour. ${idx+1}`, BRIGHT_WHITE);
          rp(row+1, 0, fig2, fFg);   rp(row+1, 4, stLbl, fFg);
          rp(row+2, 0, '   ', fFg);  rp(row+2, 4, taskLbl, WC);
          rp(row+3, 0, '   ', fFg);
        }
        row += LINES_PER;
      }
    }
    tc(22, '[ ESC to close ]', WC);
  }

  function redraw() {
    drawFrame();
    if (tab === 'stocks') redrawStocks(); else redrawOps();
  }

  inventoryRedrawFn = redraw;
  redraw();

  function closeInventory() {
    inventoryRedrawFn = null;
    window.removeEventListener('keydown', invKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function invKeyHandler(e) {
    if (e.key === 'Escape' || e.key === 'i') { closeInventory(); return; }
    if (e.key === 'ArrowLeft')  { tab = 'stocks'; workerScroll = 0; redraw(); return; }
    if (e.key === 'ArrowRight') { tab = 'ops'; redraw(); return; }
    if (tab === 'ops') {
      if (e.key === 'ArrowUp')   { workerScroll = Math.max(0, workerScroll - 1); redraw(); }
      if (e.key === 'ArrowDown') { workerScroll++; redraw(); }
    }
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
            if (bought === 1) { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(w.x, w.y, rmD.x + 1, rmD.y + 2, 3); }
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
          state.stats.widgetsMadeToday++;
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
  const lfDef  = STATION_DEFS.find(s => s.label === 'LF');
  const stDoor = { x: stDef.x + 1, y: stDef.y + 2 };
  const mtDoor = { x: mtDef.x + 1, y: mtDef.y + 2 };
  const lfDoor = lfDef ? { x: lfDef.x + 1, y: lfDef.y + 5 } : null;
  const speed    = Math.max(1, Math.round(1 + state.skills.courierSpeed * 0.5));
  const carryMax = 10 + state.skills.courierCarry * 5;
  const PRICE    = state.marketPrice;
  const toRocket = state.courierDestination === 'rocket' && state.stations.launch_facility?.unlocked && lfDoor;

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

  function isHeadingToLF(c) {
    return lfDoor && c.target.x === lfDoor.x && c.target.y === lfDoor.y;
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
        c.target = toRocket ? { ...lfDoor } : { ...mtDoor };
        c.courierState = 'delivering';
      }
    }

    if (c.courierState === 'delivering') {
      const destDoor = isHeadingToLF(c) ? lfDoor : mtDoor;
      if (!near(c, destDoor)) moveToward(c, destDoor);
      if (near(c, destDoor)) {
        if (isHeadingToLF(c)) {
          // Deliver to Launch Facility
          if (c.carryWidgets > 0 && state.rocketWidgets < 1000000) {
            const toLoad = Math.min(c.carryWidgets, 1000000 - state.rocketWidgets);
            state.rocketWidgets += toLoad;
            c.carryWidgets -= toLoad;
            addLog(`Courier loaded ${toLoad} widget${toLoad !== 1 ? 's' : ''}. Total: ${state.rocketWidgets.toLocaleString()} / 1,000,000.`, '#ff5555');
            drawStatusBar();
            if (!state.rocketFull && state.rocketWidgets >= 1000000) {
              state.rocketFull = true;
              addLog('The rocket is ready. [launch sequence coming soon]', '#ff5555');
            }
          }
          c.carryWidgets = 0; // committed — cannot be retrieved
          c.target = { ...stDoor };
          c.courierState = 'returning';
        } else {
          // Deliver to Market (existing behavior)
          const demandLeft = state.phase >= 3 ? (state.demand - state.widgetsSoldToday) : Infinity;
          if (state.marketOpen && c.carryWidgets > 0 && demandLeft > 0) {
            const n = state.phase >= 3 ? Math.min(c.carryWidgets, demandLeft) : c.carryWidgets;
            const earned = n * PRICE;
            state.player.credits += earned;
            state.lifetimeCreditsEarned += earned;
            state.stats.revenueToday = Math.round((state.stats.revenueToday + earned) * 10) / 10;
            if (state.phase >= 3) state.widgetsSoldToday += n;
            c.carryWidgets -= n;
            addLog(`Courier sold ${n} widget${n !== 1 ? 's' : ''} for ${formatCredits(earned)}cr.`, '#66cc66');
            drawStatusBar();
            { const mtD = STATION_DEFS.find(s => s.label === 'MT'); if (mtD) effectsManager.creditRain(mtD.x + 1, mtD.y + 2, n, false, earned); }
            checkPhase2Trigger();
            c.target = { ...stDoor };
            c.courierState = 'returning';
          } else if (!state.marketOpen || demandLeft <= 0) {
            c.target = { ...stDoor };
            c.courierState = 'returning';
          }
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
  const credits = { 1: 50, 2: 500, 3: 2000, 4: 5000, 5: 10000 };
  resetState();
  state.phase = n;
  state.player.credits = credits[n] ?? 10000;
  state.lifetimeCreditsEarned = credits[n] ?? 10000;
  if (n >= 2) {
    state.officeUnlocked = true;
    state.stations.storage.unlocked = true;
    const stD = STATION_DEFS.find(s => s.label === 'ST');
    if (stD) { stD.wc = '#555555'; stD.lc = '#66ccff'; }
  }
  if (n >= 3) {
    state.stations.bank = { unlocked: true };
    const bkD = STATION_DEFS.find(s => s.label === 'BK');
    if (bkD) { bkD.wc = '#555555'; bkD.lc = '#66cc66'; }
    calculateDailyDemand();
    state.widgetsSoldToday = 0;
  }
  if (n >= 4) {
    state.stations.derivatives = { unlocked: true };
    state.derivativesUnlocked  = true;
    const dvD = STATION_DEFS.find(s => s.label === 'DV');
    if (dvD) { dvD.wc = '#555555'; dvD.lc = '#cc66cc'; }
  }
  if (n >= 5) {
    state.stations.launch_facility = { unlocked: true };
    state.rocketWidgets     = 0;
    state.courierDestination = 'market';
    const lfD = STATION_DEFS.find(s => s.label === 'LF');
    if (lfD) { lfD.wc = '#f0f0f0'; lfD.lc = '#ff5555'; }
  }
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
      line(4, '1. Jump to Phase 1  (fresh start, 50cr)',           BRIGHT_WHITE);
      line(5, '2. Jump to Phase 2  (500cr, workers unlocked)',     BRIGHT_WHITE);
      line(6, '3. Jump to Phase 3  (2000cr, bank unlocked)',       BRIGHT_WHITE);
      line(7, '4. Jump to Phase 4  (5000cr, derivatives unlocked)',BRIGHT_WHITE);
      line(8, '5. Jump to Phase 5  (10000cr, LF unlocked)',        BRIGHT_WHITE);
      line(9, '6. Back',            BRIGHT_WHITE);
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
      if (num >= 1 && num <= 5) {
        window.removeEventListener('keydown', pauseKeyHandler);
        devJumpToPhase(num);
      } else if (e.key === '6' || e.key === 'Escape') { screen = 'settings'; render(); }
    }
  }
  window.addEventListener('keydown', pauseKeyHandler);
}

// ── Day/night slow column-wave (§3.4) ────────────────────────────────────────

let dayNightFlash = null; // { type: 'open'|'close', frame: 0 }  — 120 frames total

function startDayNightFlash(type) {
  dayNightFlash = { type, frame: 0 }; // cancel any in-progress effect and restart
}

function _advanceDayNightWave() {
  if (!dayNightFlash) return;

  if (dayNightFlash.frame >= 120) {
    // Wave complete — mark all tiles dirty so map fully restores
    for (let y = 0; y < WORLD_ROWS; y++)
      for (let x = 0; x < DISPLAY_WIDTH; x++)
        markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    dayNightFlash = null;
    return;
  }

  const f    = dayNightFlash.frame++;
  const dawn = dayNightFlash.type === 'open';

  // Wave front position (0–79 over 120 frames)
  const wf = dawn
    ? Math.floor(f / 119 * 79)
    : (79 - Math.floor(f / 119 * 79));

  // Column colors: full / 60% / 30%
  const cFull = dawn ? '#ffd633' : '#334488';
  const cMed  = dawn ? '#aa8800' : '#223366';
  const cDim  = dawn ? '#554400' : '#111833';

  const drawWaveCol = (x, color) => {
    if (x < 0 || x >= DISPLAY_WIDTH) return;
    for (let y = 0; y < WORLD_ROWS; y++) display.draw(x, y, '░', color, BG);
  };
  const restoreCol = (x) => {
    if (x < 0 || x >= DISPLAY_WIDTH) return;
    for (let y = 0; y < WORLD_ROWS; y++) markDirty(x, y);
  };

  if (dawn) {
    restoreCol(wf - 3); // column leaving the wave window
    renderDirty();
    drawWaveCol(wf,     cFull);
    drawWaveCol(wf - 1, cMed);
    drawWaveCol(wf - 2, cDim);
  } else {
    restoreCol(wf + 3);
    renderDirty();
    drawWaveCol(wf,     cFull);
    drawWaveCol(wf + 1, cMed);
    drawWaveCol(wf + 2, cDim);
  }
}

// ── Tick loop — 1 tick/second (§7.1) ─────────────────────────────────────────

setInterval(() => {
  if (state.gameState !== 'playing' && state.gameState !== 'crafting' && state.gameState !== 'dashboard' && state.gameState !== 'inventory' && state.gameState !== 'lf_menu') return;

  // Stats: snapshot before tick for delta computation
  const _sCr = state.player.credits;
  const _sRM = state.player.inventory.rm + state.storage.rm;
  const _sWg = state.player.inventory.widgets + state.storage.widgets;

  state.tick++;
  state.dayTick++;
  if (state.dayTick >= 240) { state.dayTick = 0; state.day++; state.bellFiredToday = false; state.rmPurchasedToday = 0; state.rmLimitLogged = false; state.widgetsSoldToday = 0; state.demandMetLogged = false; state.stats.widgetsMadeToday = 0; state.stats.revenueToday = 0; state.stats.costsToday = 0; }
  const prevMarketOpen = state.marketOpen;
  state.marketOpen = state.dayTick < 180;
  if (state.marketOpen !== prevMarketOpen) startDayNightFlash(state.marketOpen ? 'open' : 'close');
  if (state.dayTick === 0 && !state.bellFiredToday) {
    state.bellFiredToday = true;
    addLog('The morning bell has rung.', BRIGHT_CYAN);
    if (state.phase >= 3) {
      calculateDailyDemand();
      const dl = demandLabel(state.demand);
      wrapLog(`Market demand today: ${dl.text}. Price: ${state.marketPrice}cr/widget.`, dl.fg);
    }
    // Settle forward contracts due today
    if (state.derivatives.forwards.length > 0) {
      const due = state.derivatives.forwards.filter(f => f.settlementDay === state.day);
      state.derivatives.forwards = state.derivatives.forwards.filter(f => f.settlementDay !== state.day);
      for (const f of due) {
        const actualPrice = state.marketPrice;
        const totalWidgets = state.storage.widgets + state.player.inventory.widgets;
        if (totalWidgets >= f.quantity) {
          const pnl = Math.round((f.lockedPrice - actualPrice) * f.quantity * 10) / 10;
          state.player.credits       = Math.round((state.player.credits + pnl) * 10) / 10;
          state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday + pnl) * 10) / 10;
          state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL + pnl) * 10) / 10;
          addLog(`Forward settled: ${f.quantity}wg at ${f.lockedPrice}cr vs ${actualPrice}cr. PnL: ${pnl >= 0 ? '+' : ''}${pnl}cr.`, pnl >= 0 ? '#66cc66' : '#ff5555');
        } else {
          const shortfall = f.quantity - totalWidgets;
          const penalty   = Math.round(actualPrice * shortfall * 10) / 10;
          state.player.credits       = Math.round((state.player.credits - penalty) * 10) / 10;
          state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday - penalty) * 10) / 10;
          state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL - penalty) * 10) / 10;
          addLog(`Short delivery on forward. Penalty: ${penalty}cr.`, '#ff5555');
        }
        drawStatusBar();
      }
    }
    // Reset daily PnL
    state.derivatives.pnlToday = 0;

    // Volatility recalculation
    if (state.phase >= 3) calculateVolatility();

    // Options expiry
    const dueOpts = state.derivatives.options.filter(o => o.expiry === state.day);
    state.derivatives.options = state.derivatives.options.filter(o => o.expiry !== state.day);
    for (const o of dueOpts) {
      const ev = o.type === 'call' ? Math.max(state.marketPrice - o.strike, 0) : Math.max(o.strike - state.marketPrice, 0);
      if (o.side === 'buy') {
        state.player.credits = Math.round((state.player.credits + ev) * 10) / 10;
        const pnl = Math.round((ev - o.premium) * 10) / 10;
        state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday + pnl) * 10) / 10;
        state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL + pnl) * 10) / 10;
        if (ev > 0) { addLog(`Option expired: exercise ${ev}cr. Net PnL: ${pnl >= 0 ? '+' : ''}${pnl}cr.`, pnl >= 0 ? '#66cc66' : '#ff5555'); }
        else        { addLog(`Option expired worthless. Premium lost.`, '#ff5555'); }
      } else {
        state.player.credits = Math.round((state.player.credits + o.marginHeld) * 10) / 10;
        const pnl = Math.round((o.premium - ev) * 10) / 10;
        state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday + pnl) * 10) / 10;
        state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL + pnl) * 10) / 10;
        if (ev > 0) {
          if (state.player.credits >= ev) {
            state.player.credits = Math.round((state.player.credits - ev) * 10) / 10;
            addLog(`Written option exercised. Paid ${ev}cr. Net PnL: ${pnl >= 0 ? '+' : ''}${pnl}cr.`, pnl >= 0 ? '#66cc66' : '#ff5555');
          } else {
            state.debt = Math.round((state.debt + ev - state.player.credits) * 10) / 10;
            state.player.credits = 0;
            addLog(`Written option exercised against you. Debt: ${state.debt}cr.`, '#ff5555');
          }
        } else { addLog(`Written option expired. Premium kept: ${o.premium}cr.`, '#66cc66'); }
      }
      drawStatusBar();
    }

    // Margin call enforcement
    if (state.derivatives.marginCallActive && state.day > state.derivatives.marginCallDay) {
      let closePnL = 0;
      for (const f of state.derivatives.futures) {
        const pnl = Math.round((state.marketPrice - f.entryPrice) * f.quantity * (f.type === 'long' ? 1 : -1) * 10) / 10;
        state.player.credits = Math.round((state.player.credits + f.marginHeld) * 10) / 10;
        closePnL += pnl;
      }
      state.derivatives.futures = [];
      state.derivatives.marginCallActive = false;
      state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday + closePnL) * 10) / 10;
      state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL + closePnL) * 10) / 10;
      addLog('Positions force-closed due to margin call.', '#ff5555');
      drawStatusBar();
    }

    // Loan overdue check
    if (state.bank.loan && state.day > state.bank.loan.deadline) {
      state.bank.loan.overdueDays = (state.bank.loan.overdueDays || 0) + 1;
      addLog('LOAN OVERDUE. Repay or refinance immediately.', '#ff5555');
      if (state.bank.loan.overdueDays >= 3 && state.player.credits <= 0 && state.bank.deposit <= 0) {
        setTimeout(showBankruptcyScreen, 1000);
      }
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
      state.widgetsMade++;
      state.stats.widgetsMadeToday++;
      drawStatusBar();
      { const wbD = STATION_DEFS.find(s => s.label === 'WB'); if (wbD) effectsManager.sparkBurst(wbD.x + 1, wbD.y + 1, state.widgetsMade); }
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
  checkPhase4Trigger();
  checkPhase5Trigger();

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
      state.stats.costsToday = Math.round((state.stats.costsToday + carryCost) * 10) / 10;
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
    // Deposit interest: 0.5% per day
    if (state.bank.deposit > 0) {
      const interest = Math.round(state.bank.deposit * 0.005 * 10) / 10;
      if (interest > 0) {
        state.bank.deposit = Math.round((state.bank.deposit + interest) * 10) / 10;
        addLog(`Bank interest: +${interest}cr.`, '#66cc66');
      }
    }
    // Loan interest
    if (state.bank.loan) {
      const lInterest = Math.round(state.bank.loan.remaining * state.bank.loan.rate * 10) / 10;
      state.bank.loan.remaining = Math.round((state.bank.loan.remaining + lInterest) * 10) / 10;
      state.stats.costsToday = Math.round((state.stats.costsToday + lInterest) * 10) / 10;
      addLog(`Loan interest: ${lInterest}cr. Total owed: ${state.bank.loan.remaining.toFixed(1)}cr.`, '#ff5555');
    }
    if (state.bank.deposit > 0 || state.bank.loan) drawStatusBar();

    // Futures mark-to-market
    if (state.derivatives.futures.length > 0) {
      let totalMTM = 0;
      for (const f of state.derivatives.futures) {
        const dailyPnL = Math.round((state.marketPrice - f.lastSettlementPrice) * f.quantity * (f.type === 'long' ? 1 : -1) * 10) / 10;
        f.lastSettlementPrice = state.marketPrice;
        totalMTM += dailyPnL;
      }
      totalMTM = Math.round(totalMTM * 10) / 10;
      state.player.credits       = Math.round((state.player.credits + totalMTM) * 10) / 10;
      state.derivatives.pnlToday = Math.round((state.derivatives.pnlToday + totalMTM) * 10) / 10;
      state.derivatives.totalPnL = Math.round((state.derivatives.totalPnL + totalMTM) * 10) / 10;
      addLog(`Futures MTM: ${totalMTM >= 0 ? '+' : ''}${totalMTM}cr.`, totalMTM >= 0 ? '#66cc66' : '#ff5555');
      drawStatusBar();
      // Maintenance margin check
      const totalNotional = state.derivatives.futures.reduce((s, f) => s + state.marketPrice * f.quantity, 0);
      const maintenanceMargin = totalNotional * 0.10;
      if (state.player.credits < maintenanceMargin) {
        if (!state.derivatives.marginCallActive) {
          state.derivatives.marginCallActive = true;
          state.derivatives.marginCallDay    = state.day;
          addLog('MARGIN CALL. Deposit credits or positions will close.', '#ff5555');
        }
      } else {
        state.derivatives.marginCallActive = false;
      }
    }
  }

  // Update peak credits each tick
  if (state.player.credits > state.peakCredits) state.peakCredits = state.player.credits;

  // Live-refresh positions dashboard
  if (state.gameState === 'dashboard' && dashboardRedrawFn) dashboardRedrawFn();

  // Live-refresh inventory
  if (state.gameState === 'inventory' && inventoryRedrawFn) inventoryRedrawFn();

  // Live-refresh LF menu + rocket animation frame
  if (state.gameState === 'lf_menu') {
    state.rocketAnimFrame = Math.floor(state.tick / 8) % 2;
    if (lfMenuRedrawFn) lfMenuRedrawFn();
  }

  // Stats: compute and store per-tick deltas (rolling 10-tick window)
  const crDelta = Math.round((state.player.credits - _sCr) * 10) / 10;
  const rmDelta = (state.player.inventory.rm + state.storage.rm) - _sRM;
  const wgDelta = (state.player.inventory.widgets + state.storage.widgets) - _sWg;
  state.stats.creditsLastTen.push(crDelta); if (state.stats.creditsLastTen.length > 10) state.stats.creditsLastTen.shift();
  state.stats.rmLastTen.push(rmDelta);      if (state.stats.rmLastTen.length > 10) state.stats.rmLastTen.shift();
  state.stats.widgetsLastTen.push(wgDelta); if (state.stats.widgetsLastTen.length > 10) state.stats.widgetsLastTen.shift();

  // Abstraction collapse check
  if (state.phase >= 4 && !state.endingTriggered) checkAbstractionCollapse();

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
      'The path is quieter than usual.',
      'A shadow passes. Nothing there.',
      'The shed door creaks in the wind.',
      'You notice the smell of cut grass.',
      'Somewhere a hinge needs oil.',
      'The light is good today.',
      'A stone turns underfoot.',
      'The trees are still.',
      'You find yourself humming something you don\'t recognize.',
      'A drop of water falls from somewhere above.',
      'The air smells faintly of metal.',
      'A cart wheel turns in the distance.',
      'Your shadow is longer than you expected.',
      'Something small crosses the path ahead of you.',
      'A gust of wind, then nothing.',
      'The workbench light flickers once.',
      'You pause for a moment without meaning to.',
      'The market sign swings slightly.',
      'A good day for it, whatever it is.',
      'The clouds are moving fast today.',
      'You hear footsteps that aren\'t yours. Then you don\'t.',
      'The pond is very still.',
      'One of the flowers has closed for the day.',
      'There is more to do. There is always more to do.',
      'The path remembers everyone who has walked it.',
      'A receipt blows past. Not yours.',
      'The numbers are moving in your favor. For now.',
      'You check your inventory out of habit.',
      'The morning feels like the last one, and also the first.',
      'A distant sound you cannot place.',
    ];
    if (state.phase >= 2) {
      AMBIENT.push(
        'A worker laughs at something across the yard.',
        'You hear the sound of tools from the workbench.',
        'One of your workers waves. You nod back.',
        'The courier returns empty-handed, then sets off again.',
        'One of your workers pauses and looks at the sky.',
        'The factory hums at a frequency you feel more than hear.',
        'A courier passes without acknowledging you.',
        'You realize you haven\'t made a widget by hand in a while.',
      );
    }
    if (state.phase >= 3) {
      AMBIENT.push(
        'A page from a demand report catches on a fence post.',
        'The bank is quiet today. It is always quiet.',
        'You check the price before you mean to.',
      );
    }
    if (state.phase >= 4) {
      AMBIENT.push(
        'The terminal blinks. You ignore it. Then you don\'t.',
        'A number on the screen is larger than yesterday.',
      );
    }
    if (state.phase >= 5) {
      AMBIENT.push(
        'The rocket does not look real from this angle.',
        'You wonder what a widget looks like from orbit.',
      );
    }
    addLog(AMBIENT[Math.floor(Math.random() * AMBIENT.length)], '#555555');
    state.lastAmbientTick  = state.tick;
    state.nextAmbientDelay = 20 + Math.floor(Math.random() * 61); // 20–80
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
  effectsManager.update();
}, 1000);

// ── Effects render loop — runs at ~60fps independent of game tick ─────────────
;(function effectsLoop(ts) {
  effectsManager.render(display);

  // Scroll-in: advance pendingLine only when world is active (not paused, not look mode)
  const logActive = state.gameState === 'playing' || state.gameState === 'crafting' ||
                    state.gameState === 'dashboard' || state.gameState === 'menu' ||
                    state.gameState === 'inventory' || state.gameState === 'lf_menu';
  if (pendingLine && logActive) {
    pendingLine.charsRevealed = Math.min(pendingLine.charsRevealed + LOG_SCROLL_SPEED, pendingLine.text.length);
    renderLog();
    if (pendingLine.charsRevealed >= pendingLine.text.length) {
      state.logLines.push({ text: pendingLine.text, color: pendingLine.color });
      if (state.logLines.length > 5) state.logLines.shift();
      pendingLine = null;
      if (logQueue.length > 0) pendingLine = { ...logQueue.shift(), charsRevealed: 0 };
    }
  }

  // Day/night slow wave advance (~60fps)
  _advanceDayNightWave();

  requestAnimationFrame(effectsLoop);
})(0);
