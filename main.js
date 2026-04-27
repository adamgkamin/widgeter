import {
  DISPLAY_WIDTH, DISPLAY_HEIGHT, WORLD_ROWS,
  STATUS_ROW, LOG_START_ROW, LOG_END_ROW, HINT_ROW,
  BG, BRIGHT_WHITE, BRIGHT_YELLOW, BRIGHT_CYAN, DIM_GRAY,
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
  phase: 1,
  lifetimeCreditsEarned: 0,
  logLines: [], // max 5 entries: {text, color}
};

// ── Save / load (§8) ─────────────────────────────────────────────────────────

const SAVE_KEY      = 'widgeter.save.v1';
const SCHEMA_VERSION = 1;

function saveGame() {
  const data = {
    schemaVersion: SCHEMA_VERSION,
    player:               state.player,
    day:                  state.day,
    tick:                 state.tick,
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
    if (data.schemaVersion !== SCHEMA_VERSION) return; // mismatch → start fresh
    state.player               = data.player;
    state.day                  = data.day;
    state.tick                 = data.tick;
    state.phase                = data.phase;
    state.lifetimeCreditsEarned = data.lifetimeCreditsEarned;
    state.logLines             = data.logLines || [];
  } catch (_) {
    // corrupt save — ignore, start fresh
  }
}

loadGame(); // restore save on startup if present

// ── §3.3 Title screen ─────────────────────────────────────────────────────────

const TITLE_ART = [
  "W       W IIII DDDD   GGGG  EEEE  TTTT EEEE  RRRR ",
  "W       W  II  D  D  G     E       TT  E     R  R ",
  "W   W   W  II  D  D  G GG  EEE     TT  EEE   RRRR ",
  "W  W W  W  II  D  D  G  G  E       TT  E     R R  ",
  " WW   WW  IIII DDDD   GGGG  EEEE   TT  EEEE  R  R ",
];
const PROMPT = "[ press any key to start ]";

const ART_MAX_W  = Math.max(...TITLE_ART.map(l => l.length));
const ART_X      = Math.floor((DISPLAY_WIDTH - ART_MAX_W) / 2);
const ART_Y      = Math.floor((DISPLAY_HEIGHT - (TITLE_ART.length + 2 + 1)) / 2);
const PROMPT_X   = Math.floor((DISPLAY_WIDTH - PROMPT.length) / 2);
const PROMPT_Y   = ART_Y + TITLE_ART.length + 2;

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

// Right-aligned credits in bottom-right corner of title screen
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

// ── §3.4 Phase-in transition ──────────────────────────────────────────────────

// Station definitions — single source of truth for layout and colors
const STATION_DEFS = [
  { x: 10, y: 30, label: 'FC', wc: DIM_GRAY,   lc: DIM_GRAY   },
  { x: 23, y: 32, label: 'ST', wc: DIM_GRAY,   lc: DIM_GRAY   },
  { x: 61, y:  4, label: 'BK', wc: DIM_GRAY,   lc: DIM_GRAY   },
  { x: 56, y: 16, label: 'DV', wc: DIM_GRAY,   lc: DIM_GRAY   },
  { x:  9, y:  2, label: 'RM', wc: '#ff6600',  lc: '#ff6600'  },
  { x: 34, y:  8, label: 'WB', wc: '#cc3300',  lc: '#cc3300'  },
  { x: 61, y: 23, label: 'MT', wc: '#ffd633',  lc: '#ffd633'  },
  { x: 23, y: 17, label: 'OF', wc: '#aaaaaa',  lc: '#ffffff'  },
];

// Return the map tile {ch, fg} at (x, y), ignoring the player
function getTileAt(x, y) {
  if (x === 0 || x === DISPLAY_WIDTH - 1 || y === 0 || y === WORLD_ROWS - 1)
    return { ch: '#', fg: DIM_GRAY };

  for (const s of STATION_DEFS) {
    if (x < s.x || x > s.x + 3 || y < s.y || y > s.y + 2) continue;
    if (y === s.y)
      return { ch: (x === s.x || x === s.x + 3) ? '+' : '-', fg: s.wc };
    if (y === s.y + 2)
      return { ch: x === s.x + 1 ? '.' : (x === s.x || x === s.x + 3 ? '+' : '-'), fg: s.wc };
    // middle row
    if (x === s.x || x === s.x + 3) return { ch: '|', fg: s.wc };
    return { ch: s.label[x - s.x - 1], fg: s.lc };
  }

  const onPath = (x === 15 && y >= 3 && y <= 28)
              || (y === 14 && x >= 15 && x <= 62)
              || (y === 28 && x >= 15 && x <= 62)
              || (x === 62 && y >= 14 && y <= 28);
  if (onPath) return { ch: ':', fg: '#3a3530' };

  const reserved = (x >= 8  && x <= 13 && y >= 1  && y <= 5)
                || (x >= 33 && x <= 38 && y >= 7  && y <= 11)
                || (x >= 60 && x <= 65 && y >= 22 && y <= 26)
                || (x >= 22 && x <= 27 && y >= 16 && y <= 20);
  if (!reserved && ((x * 1664525 + y * 1013904223) >>> 16) % 100 < 8) return { ch: 'T', fg: '#2d5a2d' };

  return { ch: '.', fg: '#1a1a1a' };
}

function isBlocked(x, y) {
  const { ch } = getTileAt(x, y);
  return ch === '#' || ch === '+' || ch === '-' || ch === '|';
}

// Draw a 4×3 station house: +--+ / |XY| / +.-+ (door at bottom-left+1) (§3.6)
function drawStation(x, y, label, wallColor, labelColor) {
  display.draw(x,   y,   '+', wallColor,  BG);
  display.draw(x+1, y,   '-', wallColor,  BG);
  display.draw(x+2, y,   '-', wallColor,  BG);
  display.draw(x+3, y,   '+', wallColor,  BG);
  display.draw(x,   y+1, '|', wallColor,  BG);
  display.draw(x+1, y+1, label[0], labelColor, BG);
  display.draw(x+2, y+1, label[1], labelColor, BG);
  display.draw(x+3, y+1, '|', wallColor,  BG);
  display.draw(x,   y+2, '+', wallColor,  BG);
  display.draw(x+1, y+2, '.', wallColor,  BG);
  display.draw(x+2, y+2, '-', wallColor,  BG);
  display.draw(x+3, y+2, '+', wallColor,  BG);
}

function drawWorld() {
  // Floor tiles — interior cells (§4.2)
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      display.draw(x, y, '.', '#1a1a1a', BG);
    }
  }

  // Path network — §4.4
  const PATH_COLOR = '#3a3530';
  for (let y = 3;  y <= 28; y++) display.draw(15, y, ':', PATH_COLOR, BG);
  for (let x = 15; x <= 62; x++) display.draw(x, 14, ':', PATH_COLOR, BG);
  for (let x = 15; x <= 62; x++) display.draw(x, 28, ':', PATH_COLOR, BG);
  for (let y = 14; y <= 28; y++) display.draw(62, y, ':', PATH_COLOR, BG);

  // Trees — deterministic placement, ~8% density (§4.5)
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      const onPath = (x === 15 && y >= 3 && y <= 28)
                  || (y === 14 && x >= 15 && x <= 62)
                  || (y === 28 && x >= 15 && x <= 62)
                  || (x === 62 && y >= 14 && y <= 28);
      if (onPath) continue;
      const reserved = (x >= 8  && x <= 13 && y >= 1  && y <= 5)
                    || (x >= 33 && x <= 38 && y >= 7  && y <= 11)
                    || (x >= 60 && x <= 65 && y >= 22 && y <= 26)
                    || (x >= 22 && x <= 27 && y >= 16 && y <= 20);
      if (reserved) continue;
      if (((x * 1664525 + y * 1013904223) >>> 16) % 100 < 8) display.draw(x, y, 'T', '#2d5a2d', BG);
    }
  }

  // Outer border: row 0, row 42, col 0, col 79 (§4.1)
  for (let x = 0; x < DISPLAY_WIDTH; x++) {
    display.draw(x, 0,             '#', DIM_GRAY, BG);
    display.draw(x, WORLD_ROWS - 1, '#', DIM_GRAY, BG);
  }
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    display.draw(0,                 y, '#', DIM_GRAY, BG);
    display.draw(DISPLAY_WIDTH - 1, y, '#', DIM_GRAY, BG);
  }

  // Locked stations — all DIM_GRAY (§3.5, §4.2)
  drawStation(10, 30, 'FC', DIM_GRAY, DIM_GRAY);
  drawStation(23, 32, 'ST', DIM_GRAY, DIM_GRAY);
  drawStation(61,  4, 'BK', DIM_GRAY, DIM_GRAY);
  drawStation(56, 16, 'DV', DIM_GRAY, DIM_GRAY);

  // Unlocked stations — theme colors (§3.5, §4.2)
  drawStation( 9,  2, 'RM', '#ff6600', '#ff6600');
  drawStation(34,  8, 'WB', '#cc3300', '#cc3300');
  drawStation(61, 23, 'MT', '#ffd633', '#ffd633');
  drawStation(23, 17, 'OF', '#aaaaaa', '#ffffff');

  // Player @ at spawn point (§3.5)
  display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);

  // Status bar — colored segments (§3.7)
  drawRow(STATUS_ROW, '', BRIGHT_WHITE);
  const seg = (x, text, fg) => { for (let i = 0; i < text.length; i++) display.draw(x + i, STATUS_ROW, text[i], fg, BG); return x + text.length; };
  let sx = 0;
  sx = seg(sx, 'Credits: 10',              '#ffd633') + 4;
  sx = seg(sx, 'Raw: 0',                   '#ff9933') + 4;
  sx = seg(sx, 'Widgets: 0/5',             BRIGHT_WHITE) + 4;
  sx = seg(sx, 'Day 1',                    BRIGHT_WHITE) + 4;
       seg(sx, '[== market open 180s ==]', '#ffd633');

  // Event log (§3.8)
  renderLog();

  // Command hint (§3.9)
  drawRow(HINT_ROW,
    "[arrows: move]  [space: interact]  [i: inventory]  [L: look]  [?: help]",
    '#555555');
}

function startPhaseIn() {
  clearScreen();
  // Pre-fill game area with a barely-visible dot so the scan erases visibly (§3.4)
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      display.draw(x, y, '·', '#222222', BG);
    }
  }
  const TOTAL_TILES     = DISPLAY_WIDTH * WORLD_ROWS;
  const TILES_PER_FRAME = Math.ceil(TOTAL_TILES / (1.3 * 60)); // ≈ 44 → ~1.3 s

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
      const col = index % DISPLAY_WIDTH;
      const row = Math.floor(index / DISPLAY_WIDTH);
      display.draw(col, row, ' ', BRIGHT_WHITE, BG);
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

  // Draw box frame
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
  if (state.gameState !== 'playing') return;
  const DIRS = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
  const d = DIRS[e.key];
  if (!d) return;
  e.preventDefault();
  const nx = state.player.x + d[0];
  const ny = state.player.y + d[1];
  if (isBlocked(nx, ny)) return;
  const { ch, fg } = getTileAt(state.player.x, state.player.y);
  display.draw(state.player.x, state.player.y, ch, fg, BG);
  state.player.x = nx;
  state.player.y = ny;
  display.draw(state.player.x, state.player.y, '@', BRIGHT_WHITE, BG);
});

// ── Tick loop — 1 tick/second (§7.1) ─────────────────────────────────────────

setInterval(() => {
  if (state.gameState !== 'playing') return;
  state.tick++;
  if (state.tick % 10 === 0) saveGame();
}, 1000);
