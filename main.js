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

let gameState = 'title'; // 'title' | 'transitioning' | 'intro' | 'playing'

let promptVisible = true;
let blinkInterval = setInterval(() => {
  promptVisible = !promptVisible;
  drawPrompt(promptVisible);
}, 500);

// ── §3.4 Phase-in transition ──────────────────────────────────────────────────

function drawWorld() {
  // Floor tiles — interior cells (§4.2)
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      display.draw(x, y, '.', '#1a1a1a', BG);
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

  // Player @ centered in game area (§3.5)
  display.draw(
    Math.floor(DISPLAY_WIDTH / 2),
    Math.floor(WORLD_ROWS / 2),
    '@', BRIGHT_WHITE, BG
  );

  // Status bar placeholder (§3.7)
  drawRow(STATUS_ROW,
    "Credits: 0    Raw: 0    Widgets: 0/5    Day 1    [============]",
    BRIGHT_WHITE);

  // Event log (§3.8) — first line per §3.4, remaining rows empty
  drawRow(LOG_START_ROW,     "> The morning bell has rung.", BRIGHT_CYAN);
  for (let r = LOG_START_ROW + 1; r <= LOG_END_ROW; r++) {
    drawRow(r, ">", DIM_GRAY);
  }

  // Command hint (§3.9)
  drawRow(HINT_ROW,
    "[arrows: move]  [space: interact]  [i: inventory]  [L: look]  [?: help]",
    DIM_GRAY);
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
    if (gameState !== 'transitioning') return;
    if (index >= TOTAL_TILES) {
      drawWorld();
      showIntroScreen();
      return;
    }
    // Advance ~44 tiles per frame so the scan completes in ~1.3 s (§3.4)
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
  gameState = 'intro';

  const BOX_W   = 60;
  const INNER_W = BOX_W - 2; // 58
  const BOX_X   = Math.floor((DISPLAY_WIDTH - BOX_W) / 2); // 10

  const TITLE_TEXT  = "-- WIDGETER --";
  const PROMPT_TEXT = "[ press any key to begin ]";

  // Build content row list: null = blank line, otherwise {text, fg, center?}
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

  const BOX_H = rows.length + 2; // +2 for top/bottom borders
  const BOX_Y = Math.floor((DISPLAY_HEIGHT - BOX_H) / 2);

  // Draw one content row (side borders + interior)
  function drawContentRow(i, fg_override) {
    const y   = BOX_Y + 1 + i;
    const row = rows[i];
    display.draw(BOX_X,           y, '|', DIM_GRAY, BG);
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
  display.draw(BOX_X,           BOX_Y, '+', DIM_GRAY, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y, '+', DIM_GRAY, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '-', DIM_GRAY, BG);
  const botY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X,           botY, '+', DIM_GRAY, BG);
  display.draw(BOX_X + BOX_W - 1, botY, '+', DIM_GRAY, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, botY, '-', DIM_GRAY, BG);

  // Fill all interior rows blank, then reveal title immediately
  for (let i = 0; i < rows.length; i++) drawContentRow(i, BG);
  drawContentRow(1); // title

  // Compute where each paragraph sits in rows[]
  // rows: [null, title, null, ...para0..., null, ...para1..., null, ...para2..., null, ...para3..., null, prompt]
  const paraRanges = [];
  let ri = 3;
  for (let i = 0; i < wrapped.length; i++) {
    const blankIdx = i > 0 ? ri++ : null; // blank separator row (skip it in ri)
    paraRanges.push({ blankIdx, start: ri, end: ri + wrapped[i].length });
    ri += wrapped[i].length;
  }
  // ri is now the index of the trailing null before the prompt

  // Cancellable timers for dismissal at any point
  const timers = [];
  let introBlinkInterval = null;

  function cancel() {
    timers.forEach(id => clearTimeout(id));
    timers.length = 0;
    clearInterval(introBlinkInterval);
    introBlinkInterval = null;
  }

  function onIntroKey() {
    if (gameState !== 'intro') return;
    cancel();
    window.removeEventListener('keydown', onIntroKey);
    dismissIntro();
  }
  window.addEventListener('keydown', onIntroKey);

  // Paragraph reveal — 400 ms pause between each
  function revealPara(i) {
    if (gameState !== 'intro') return;
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
    if (gameState !== 'intro') return;
    drawContentRow(PROMPT_IDX - 1); // trailing blank before prompt
    drawContentRow(PROMPT_IDX);     // prompt

    let pv = true;
    introBlinkInterval = setInterval(() => {
      if (gameState !== 'intro') { clearInterval(introBlinkInterval); return; }
      pv = !pv;
      drawContentRow(PROMPT_IDX, pv ? BRIGHT_CYAN : BG);
    }, 500);
  }

  revealPara(0);
}

function dismissIntro() {
  gameState = 'playing';
  // Clear interior of game world, then redraw world content
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      display.draw(x, y, ' ', BRIGHT_WHITE, BG);
    }
  }
  drawWorld();
}

// ── Keypress: title → phase-in (§3.3) ────────────────────────────────────────

function onAnyKey() {
  clearInterval(blinkInterval);
  window.removeEventListener('keydown', onAnyKey);
  gameState = 'transitioning';
  startPhaseIn();
}

window.addEventListener('keydown', onAnyKey);
