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

// ── §3.3 Title screen ─────────────────────────────────────────────────────────

const TITLE_ART = [
  "W       W IIII DDDD   GGGG  EEEE  TTTT EEEE  RRRR",
  "W       W  II  D  D  G     E      TT  E     R  R",
  "W   W   W  II  D  D  G GG  EEE    TT  EEE   RRRR",
  "W  W W  W  II  D  D  G  G  E      TT  E     R R",
  " WW   WW  IIII DDDD   GGGG  EEEE   TT  EEEE  R  R",
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

let promptVisible = true;
let blinkInterval = setInterval(() => {
  promptVisible = !promptVisible;
  drawPrompt(promptVisible);
}, 500);

// ── §3.4 Phase-in transition ──────────────────────────────────────────────────

function drawWorld() {
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
  const TOTAL_TILES = DISPLAY_WIDTH * WORLD_ROWS; // 80 × 43 = 3440
  let index = 0;

  function step() {
    if (index >= TOTAL_TILES) {
      drawWorld();
      return;
    }
    // One tile per frame, left to right, top to bottom (§3.4)
    const col = index % DISPLAY_WIDTH;
    const row = Math.floor(index / DISPLAY_WIDTH);
    display.draw(col, row, ' ', BRIGHT_WHITE, BG);
    index++;
    requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ── Keypress: title → phase-in (§3.3) ────────────────────────────────────────

function onAnyKey() {
  clearInterval(blinkInterval);
  window.removeEventListener('keydown', onAnyKey);
  startPhaseIn();
}

window.addEventListener('keydown', onAnyKey);
