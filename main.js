import { DISPLAY_WIDTH, DISPLAY_HEIGHT, BG, BRIGHT_WHITE, BRIGHT_YELLOW, BRIGHT_CYAN } from './constants.js';

const display = new ROT.Display({
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  fontSize: 16,
  fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  bg: BG,
  fg: BRIGHT_WHITE,
});

document.body.appendChild(display.getContainer());

// §3.3 — Title screen art
const TITLE_ART = [
  "W       W IIII DDDD   GGGG  EEEE  TTTT EEEE  RRRR",
  "W       W  II  D  D  G     E      TT  E     R  R",
  "W   W   W  II  D  D  G GG  EEE    TT  EEE   RRRR",
  "W  W W  W  II  D  D  G  G  E      TT  E     R R",
  " WW   WW  IIII DDDD   GGGG  EEEE   TT  EEEE  R  R",
];
const PROMPT = "[ press any key to start ]";

const ART_MAX_WIDTH = Math.max(...TITLE_ART.map(l => l.length));
const ART_X        = Math.floor((DISPLAY_WIDTH - ART_MAX_WIDTH) / 2);
const TOTAL_HEIGHT = TITLE_ART.length + 2 + 1; // art + 2 blank lines + prompt
const ART_Y        = Math.floor((DISPLAY_HEIGHT - TOTAL_HEIGHT) / 2);
const PROMPT_X     = Math.floor((DISPLAY_WIDTH - PROMPT.length) / 2);
const PROMPT_Y     = ART_Y + TITLE_ART.length + 2;

function clearScreen() {
  for (let y = 0; y < DISPLAY_HEIGHT; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      display.draw(x, y, ' ', BRIGHT_WHITE, BG);
    }
  }
}

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

// Initial render
clearScreen();
drawArt();
drawPrompt(true);

// Blink prompt at 1 Hz — toggle every 500ms (§3.3)
let promptVisible = true;
setInterval(() => {
  promptVisible = !promptVisible;
  drawPrompt(promptVisible);
}, 500);
