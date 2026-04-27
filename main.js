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
  } catch (_) {
    // corrupt save — start fresh
  }
}

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
  sx = seg(sx, `Credits: ${state.player.credits}`,              '#ffd633') + 4;
  sx = seg(sx, `Raw: ${inv.rm}`,                                '#ff9933') + 4;
  sx = seg(sx, `Widgets: ${inv.widgets}/${cap.widgets}`,        widgetFg)  + 4;
  sx = seg(sx, `Day ${state.day}`,                              BRIGHT_WHITE) + 4;
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

  // Initialise every cell as a floor tile
  for (let x = 0; x < DISPLAY_WIDTH; x++) {
    tileMap[x] = [];
    for (let y = 0; y < WORLD_ROWS; y++) {
      tileMap[x][y] = mk('.', '#1a1a1a', true);
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
                    || (x >= 22 && x <= 27 && y >= 16 && y <= 20);
      if (!reserved && ((x * 1664525 + y * 1013904223) >>> 16) % 100 < 8)
        tileMap[x][y] = mk('T', '#2d5a2d', true);
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

  // Stations — §3.5 (overwrites floor/trees in their footprint)
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

  // Status bar (§3.7)
  drawStatusBar();

  // Event log (§3.8)
  renderLog();

  // Command hint (§3.9)
  drawRow(HINT_ROW,
    "[arrows: move]  [space: interact]  [i: inventory]  [o: look]  [?: help]",
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
  addLog('The morning bell has rung.', BRIGHT_CYAN);
  drawWorld();
}

// ── Keypress: title → phase-in (§3.3) ────────────────────────────────────────

function onAnyKey() {
  clearInterval(blinkInterval);
  window.removeEventListener('keydown', onAnyKey);
  state.gameState = 'transitioning';
  startPhaseIn();
}

window.addEventListener('keydown', onAnyKey);

// ── Arrow key movement (§3.5) ─────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (state.gameState === 'crafting' && e.key === 'Escape') { cancelCrafting(); return; }
  if (state.gameState !== 'playing') return;
  if (e.key === 'o') { enterLookMode(); return; }
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

// Priority: tiles["x,y"] → glyphs[g].variants[hash] → glyphs[g].default → fallback (§6.1, §6.2)
function getDescription(x, y, glyph) {
  if (!descriptions) return 'Nothing remarkable.';
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
  if (e.key === 'o' || e.key === 'Escape') { exitLookMode(); return; }
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
  const BOX_Y  = Math.floor((WORLD_ROWS  - BOX_H) / 2);
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
    state.gameState = 'playing';
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
  const COST    = 3;
  const rmSpace = state.player.inventoryCaps.rm - state.player.inventory.rm;
  const maxBuy  = Math.min(rmSpace, Math.floor(state.player.credits / COST));
  const canBuy1 = state.player.credits >= COST && rmSpace > 0;

  showMenu('Raw Materials Shed', [
    {
      label:   `Buy 1 RM (${COST}cr)`,
      enabled: canBuy1,
      action:  () => {
        state.player.credits     -= COST;
        state.player.inventory.rm += 1;
        addLog(`You buy 1 raw material.`, '#ff9933');
        drawStatusBar();
      },
    },
    {
      label:   `Buy max (${maxBuy})`,
      enabled: maxBuy > 0,
      action:  () => {
        state.player.credits      -= maxBuy * COST;
        state.player.inventory.rm += maxBuy;
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
  addLog('Crafting cancelled. Materials lost.', '#ff5555');
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

function checkPhase2Trigger() {
  if (state.lifetimeCreditsEarned >= 200 && state.phase === 1) {
    state.phase = 2; // prevent re-triggering
    addLog('Something stirs. The Office door swings open.', BRIGHT_MAGENTA);
  }
}

function sellWidgets(n) {
  const PRICE  = 8;
  const earned = n * PRICE;
  state.player.credits            += earned;
  state.player.inventory.widgets  -= n;
  state.lifetimeCreditsEarned     += earned;
  addLog(`Sold ${n} widget${n !== 1 ? 's' : ''} for ${earned}cr.`, BRIGHT_CYAN);
  drawStatusBar();
  checkPhase2Trigger();
}

function openMarketMenu() {
  const widgets = state.player.inventory.widgets;
  const PRICE   = 8;

  if (!state.marketOpen) {
    addLog('The market is shuttered. The bell rings at dawn.', '#555555');
    return;
  }
  if (widgets === 0) {
    addLog('You have nothing to sell.', '#555555');
    return;
  }

  showMenu('Market', [
    {
      label:   `Sell 1 widget (+${PRICE}cr)`,
      enabled: true,
      action:  () => sellWidgets(1),
    },
    {
      label:   `Sell max (+${widgets * PRICE}cr)`,
      enabled: true,
      action:  () => sellWidgets(widgets),
    },
    { label: 'Cancel', enabled: true, action: () => {} },
  ]);
}

function handleInteract() {
  const rm = STATION_DEFS.find(s => s.label === 'RM');
  if (rm && isAdjacentToStation(rm)) { openRMShedMenu(); return; }
  const wb = STATION_DEFS.find(s => s.label === 'WB');
  if (wb && isAdjacentToStation(wb)) { openWorkbenchMenu(); return; }
  const mt = STATION_DEFS.find(s => s.label === 'MT');
  if (mt && isAdjacentToStation(mt)) { openMarketMenu(); return; }
}

// ── Tick loop — 1 tick/second (§7.1) ─────────────────────────────────────────

setInterval(() => {
  if (state.gameState !== 'playing' && state.gameState !== 'crafting') return;

  state.tick++;
  state.dayTick++;
  if (state.dayTick >= 240) { state.dayTick = 0; state.day++; }
  state.marketOpen = state.dayTick < 180;
  drawTimeIndicator();

  if (state.gameState === 'crafting') {
    craftProgress++;
    pulseWB();
    if (craftProgress >= CRAFT_TICKS) {
      craftProgress = 0;
      state.player.inventory.widgets++;
      drawStatusBar();
      if (craftQueue > 0) {
        craftQueue--;
        state.player.inventory.rm--;
        drawStatusBar();
      } else {
        addLog(`Crafting complete. ${craftTotal} widget${craftTotal !== 1 ? 's' : ''} ready.`, BRIGHT_CYAN);
        state.gameState = 'playing';
      }
    }
  }

  if (state.tick % 10 === 0) saveGame();
}, 1000);
