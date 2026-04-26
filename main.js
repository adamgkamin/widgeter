import { DISPLAY_WIDTH, DISPLAY_HEIGHT, BG, BRIGHT_WHITE } from './constants.js';

const display = new ROT.Display({
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  fontSize: 16,
  fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  bg: BG,
  fg: BRIGHT_WHITE,
});

document.body.appendChild(display.getContainer());

// Fill every cell with a space to confirm rot.js is mounted (§3.1)
for (let y = 0; y < DISPLAY_HEIGHT; y++) {
  for (let x = 0; x < DISPLAY_WIDTH; x++) {
    display.draw(x, y, ' ', BRIGHT_WHITE, BG);
  }
}
