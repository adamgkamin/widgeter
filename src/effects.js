// src/effects.js — ASCII screen effects (§3.4)
import { DISPLAY_WIDTH, WORLD_ROWS, BG } from '../constants.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ib(x, y) {
  return x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS;
}

function put(display, tiles, x, y, glyph, fg) {
  if (!ib(x, y)) return;
  display.draw(x, y, glyph, fg, BG);
  if (tiles) tiles.add(`${x},${y}`);
}

const D8 = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];

// ── Effect 1: Spark Burst ─────────────────────────────────────────────────────

class SparkBurst {
  constructor(cx, cy, widgetsMadeNow) {
    this.cx = cx;
    this.cy = cy;
    this.extended = widgetsMadeNow === 5;
    this.frame     = 0;
    this.duration  = this.extended ? 16 : 12;
    this.done      = false;
    this.touchedTiles = new Set();
  }

  render(display) {
    const { cx, cy, frame: f, extended, touchedTiles: tt } = this;
    const maxR = extended ? 3 : 2;

    // Extended: + flash at center on frame 0
    if (f === 0 && extended) put(display, tt, cx, cy, '+', '#ffffff');

    if (f < 3) {
      // Frames 0-2: radius 1, gold sparks
      for (const [dx, dy] of D8) put(display, tt, cx + dx, cy + dy, '*', '#ffd633');
    } else if (f < 6) {
      // Frames 3-5: spread to maxR, orange. Workbench label flash.
      const r = Math.min(f - 1, maxR); // 2, 3, maxR
      for (const [dx, dy] of D8) put(display, tt, cx + dx * r, cy + dy * r, '*', '#ff9933');
      put(display, tt, cx, cy, ' ', '#ffffff');
    } else if (f < 9) {
      // Frames 6-8: dots at maxR, dim ring at r=2
      for (const [dx, dy] of D8) put(display, tt, cx + dx * maxR, cy + dy * maxR, '·', '#ff5555');
      for (const [dx, dy] of D8) put(display, tt, cx + dx * 2,    cy + dy * 2,    '°', '#4d400f');
    } else {
      // Frames 9-11: fading dots
      for (const [dx, dy] of D8) put(display, tt, cx + dx * maxR, cy + dy * maxR, '.', '#333333');
    }
  }

  advance() {
    this.frame++;
    if (this.frame >= this.duration) this.done = true;
  }
}

// ── Effect 2: Coin Drain ──────────────────────────────────────────────────────

class CoinDrain {
  constructor(px, py, rmX, rmY, amount) {
    this.px = px; this.py = py;
    this.rmX = rmX; this.rmY = rmY;
    this.amtStr = `-${amount}cr`;
    this.frame    = 0;
    this.duration = 18;
    this.done     = false;
    this.touchedTiles = new Set();
    this.farAway  = Math.abs(px - rmX) + Math.abs(py - rmY) > 15;
  }

  render(display) {
    const { px, py, rmX, rmY, amtStr, frame: f, farAway, touchedTiles: tt } = this;

    if (farAway) {
      // Just float -Xcr above player for 12 frames
      if (f < 12) {
        const tx = px - Math.floor(amtStr.length / 2);
        for (let i = 0; i < amtStr.length; i++) put(display, tt, tx + i, py - 1, amtStr[i], '#ff5555');
      }
      return;
    }

    // 3 coins drifting from player toward RM door
    const offsets = [-1, 0, 1];
    if (f < 12) {
      for (let ci = 0; ci < 3; ci++) {
        const xOff = offsets[ci];
        const t    = f / 11;
        const cx   = Math.round(px + xOff + (rmX - px) * t);
        const cy   = Math.round(py + (rmY - py) * t);
        const glyph = (f >= 6 && f < 8) ? '¢' : '$';
        const color = f >= 6 ? '#ff9933' : '#ffd633';
        put(display, tt, cx, cy, glyph, color);
        // Trailing dot (frames 2-5)
        if (f > 1 && f < 6) {
          const prevT = (f - 2) / 11;
          const px2 = Math.round(px + xOff + (rmX - px) * prevT);
          const py2 = Math.round(py + (rmY - py) * prevT);
          put(display, tt, px2, py2, '·', '#555555');
        }
      }
    }

    // -Xcr float above shed (frames 5-17)
    if (f >= 5) {
      const tx = rmX - 1;
      const ty = rmY - 2;
      for (let i = 0; i < amtStr.length; i++) put(display, tt, tx + i, ty, amtStr[i], '#ff5555');
    }

    // Shed door pulse (frames 12-17)
    if (f >= 12) {
      const fade = (f - 12) / 5;
      const v = Math.round(0x99 * (1 - fade));
      const hex = v.toString(16).padStart(2, '0');
      put(display, tt, rmX, rmY, '.', `#${hex}5500`);
    }
  }

  advance() {
    this.frame++;
    if (this.frame >= this.duration) this.done = true;
  }
}

// ── Effect 3: Credit Rain ─────────────────────────────────────────────────────

class CreditRain {
  constructor(mktX, mktY, widgetsSold, isFirstSale, earned) {
    this.mktX = mktX; this.mktY = mktY;
    this.count     = Math.min(widgetsSold, 8);
    this.isFirst   = isFirstSale;
    this.big       = widgetsSold >= 5;
    this.amtStr    = earned !== undefined ? `+${earned}cr` : `+${widgetsSold}cr`;
    this.frame     = 0;
    this.duration  = isFirstSale ? 32 : 24;
    this.done      = false;
    this.touchedTiles = new Set();
  }

  render(display) {
    const { mktX, mktY, count, frame: f, isFirst, big, amtStr, touchedTiles: tt } = this;
    const maxUp  = isFirst ? 5 : 4;
    const peakF  = 8; // frame when particles reach peak and switch to *

    // Particles
    for (let i = 0; i < count; i++) {
      const baseX = mktX + (i % 5) - 2;
      const drift = (f >= 4) ? ((i % 2 === 0) ? 1 : -1) : 0;
      const x = baseX + drift;

      if (f < peakF) {
        const rise = Math.min(Math.floor(f / 2), maxUp);
        const y = mktY - rise;
        put(display, tt, x, y, '$', '#66cc66');
        // Trail
        if (f > 1) {
          const prevRise = Math.min(Math.floor((f - 2) / 2), maxUp);
          put(display, tt, x, mktY - prevRise, '·', '#2a5a2a');
        }
      } else if (f < 17) {
        const y = mktY - maxUp;
        put(display, tt, x, y, '*', '#ffd633');
      } else if (f < 21) {
        const y = mktY - maxUp;
        put(display, tt, x, y, '·', '#335533');
      }
    }

    // +Xcr float (frames 8 to ~20)
    const floatEnd = isFirst ? 24 : 20;
    if (f >= peakF && f < floatEnd) {
      const tx = mktX - Math.floor(amtStr.length / 2);
      const ty = mktY - maxUp - 1;
      const late = f > floatEnd - 5;
      for (let i = 0; i < amtStr.length; i++) put(display, tt, tx + i, ty, amtStr[i], late ? '#2a5a2a' : '#66cc66');
      if (big) {
        for (let i = 0; i < amtStr.length; i++) put(display, tt, tx + i, ty + 1, amtStr[i], late ? '#553300' : '#ffd633');
      }
    }

    // Market door pulse (frames 16-23)
    if (f >= 16 && f < 24) {
      const t = (f - 16) / 7;
      const col = t < 0.35 ? '#66cc66' : t < 0.7 ? '#ffd633' : '#334433';
      put(display, tt, mktX, mktY, '.', col);
    }

    // First-sale: ring of * around market at peak (frames 8-14)
    if (isFirst && f >= peakF && f < 15) {
      for (const [dx, dy] of D8) put(display, tt, mktX + dx * 3, mktY + dy * 3, '*', '#ffd633');
    }
  }

  advance() {
    this.frame++;
    if (this.frame >= this.duration) this.done = true;
  }
}

// ── Effect 4: Day/Night Sweep ─────────────────────────────────────────────────

class DayNightSweep {
  constructor(direction, getTileMap) {
    this.direction  = direction;
    this.getTileMap = getTileMap;
    this.frame      = 0;
    this.duration   = 20;
    this.done       = false;
    this.touchedTiles = new Set();
  }

  render(display) {
    const { direction: dir, frame: f, getTileMap, touchedTiles: tt } = this;
    const tileMap = getTileMap();
    const colOf   = (step, c) => dir === 'open' ? step * 4 + c : DISPLAY_WIDTH - 1 - step * 4 - c;

    // Restore previous strip from tileMap
    if (f > 0) {
      for (let c = 0; c < 4; c++) {
        const col = colOf(f - 1, c);
        if (col < 0 || col >= DISPLAY_WIDTH) continue;
        for (let row = 0; row < WORLD_ROWS; row++) {
          const t = tileMap[col]?.[row];
          if (t) display.draw(col, row, t.glyph, t.fg, t.bg);
        }
      }
    }

    // Draw current strip
    const fg = dir === 'open' ? '#3a2800' : '#1c1c1c';
    for (let c = 0; c < 4; c++) {
      const col = colOf(f, c);
      if (col < 0 || col >= DISPLAY_WIDTH) continue;
      for (let row = 0; row < WORLD_ROWS; row++) {
        display.draw(col, row, '░', fg, BG);
        tt.add(`${col},${row}`);
      }
    }
  }

  advance() {
    this.frame++;
    if (this.frame >= this.duration) this.done = true;
  }
}

// ── Effects Manager ───────────────────────────────────────────────────────────

export class EffectsManager {
  constructor({ markDirty, renderDirty, getTileMap }) {
    this._markDirty   = markDirty;
    this._renderDirty = renderDirty;
    this._getTileMap  = getTileMap;
    this.effects      = [];
  }

  // Called once per game tick — reserved for tick-level logic
  update() {}

  // Called from requestAnimationFrame loop — advances and renders all active effects
  render(display) {
    if (this.effects.length === 0) return;

    const completedTiles = new Set();

    for (const effect of this.effects) {
      effect.render(display);
      effect.advance();
    }

    this.effects = this.effects.filter(effect => {
      if (effect.done) {
        for (const key of effect.touchedTiles) completedTiles.add(key);
        return false;
      }
      return true;
    });

    if (completedTiles.size > 0) {
      for (const key of completedTiles) {
        const [x, y] = key.split(',').map(Number);
        this._markDirty(x, y);
      }
      this._renderDirty();
    }
  }

  // Trigger: widget completed at workbench
  // cx/cy = workbench center, widgetsMadeNow = state.widgetsMade after increment
  sparkBurst(cx, cy, widgetsMadeNow) {
    this.effects.push(new SparkBurst(cx, cy, widgetsMadeNow));
  }

  // Trigger: RM purchase confirmed
  coinDrain(px, py, rmX, rmY, amount) {
    this.effects.push(new CoinDrain(px, py, rmX, rmY, amount));
  }

  // Trigger: widgets sold at market
  creditRain(mktX, mktY, widgetsSold, isFirstSale, earned) {
    this.effects.push(new CreditRain(mktX, mktY, widgetsSold, isFirstSale, earned));
  }

  // Trigger: market opens ('open') or closes ('close')
  dayNightSweep(direction) {
    // Cancel any in-progress sweep first
    this.effects = this.effects.filter(e => !(e instanceof DayNightSweep));
    this.effects.push(new DayNightSweep(direction, this._getTileMap));
  }
}
