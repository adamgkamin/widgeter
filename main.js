import {
  DISPLAY_WIDTH, DISPLAY_HEIGHT, WORLD_ROWS,
  STATUS_ROW, LOG_START_ROW, LOG_END_ROW, HINT_ROW,
  BG, BRIGHT_WHITE, BRIGHT_YELLOW, BRIGHT_CYAN, BRIGHT_MAGENTA, DIM_GRAY,
  LOG_SCROLL_SPEED,
  COLOR_LF_FRAME, COLOR_LF_LABEL,
  COLOR_HINT_LINE,
  COLOR_STAMPS,
} from './constants.js';
import { EffectsManager } from './src/effects.js';

// ── Display init ──────────────────────────────────────────────────────────────

let display = new ROT.Display({
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  fontSize: 16,
  fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  bg: BG,
  fg: BRIGHT_WHITE,
});

document.getElementById('game-container').appendChild(display.getContainer());

// Fullscreen / resize helpers — module-level so any function can use them
let pauseMenuRedrawFn = null; // set by showPauseMenu, cleared on close
let fsError = '';             // shown in settings menu when requestFullscreen fails
let fsErrorTimer = null;
let resizeDebounceTimer = null;

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

// ── Display scaling — crisp native-resolution rendering (§3.1) ───────────────

function recalculateDisplaySize(availW, availH) {
  availW = availW ?? window.innerWidth;
  availH = availH ?? window.innerHeight;
  const maxFontW = Math.floor(availW / DISPLAY_WIDTH);
  const maxFontH = Math.floor(availH / DISPLAY_HEIGHT);
  const fontSize = Math.max(8, Math.min(maxFontW, maxFontH));
  if (state && state.settings) state.settings.currentFontSize = fontSize;
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  display = new ROT.Display({
    width:      DISPLAY_WIDTH,
    height:     DISPLAY_HEIGHT,
    fontSize,
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    bg:         BG,
    fg:         BRIGHT_WHITE,
  });
  container.appendChild(display.getContainer());
}

function setFullscreen(enabled) {
  if (state && state.settings) state.settings.fullscreen = enabled;
  localStorage.setItem('widgeter.settings.fullscreen', JSON.stringify(enabled));
  if (enabled) {
    // Resize to screen dimensions immediately, then request browser fullscreen
    recalculateDisplaySize(window.screen.width, window.screen.height);
    document.documentElement.requestFullscreen().catch(() => {
      // Browser denied — fsError shows in settings menu, size stays at window-fill
      fsError = 'Fullscreen unavailable in this browser.';
      clearTimeout(fsErrorTimer);
      fsErrorTimer = setTimeout(() => { fsError = ''; if (pauseMenuRedrawFn) pauseMenuRedrawFn(); }, 3000);
      if (pauseMenuRedrawFn) pauseMenuRedrawFn();
    });
  } else {
    recalculateDisplaySize(window.innerWidth, window.innerHeight);
    if (document.fullscreenElement) document.exitFullscreen();
  }
}

function fullRedraw() {
  const gs = state ? state.gameState : 'title';
  if (gs === 'title' || gs === 'title_menu') {
    clearScreen(); drawArt(); drawPrompt(true);
  } else if (gs === 'cottage') {
    clearScreen(); drawCottageInterior(); drawStatusBar(); renderLog();
  } else if (gs !== 'transitioning' && gs !== 'intro') {
    drawWorld(); drawStatusBar(); renderLog();
    // Redraw any open menu
    if (rmMenuRedrawFn)      rmMenuRedrawFn();
    if (wbMenuRedrawFn)      wbMenuRedrawFn();
    if (mtMenuRedrawFn)      mtMenuRedrawFn();
    if (dvMenuRedrawFn)      dvMenuRedrawFn();
    if (storageMenuRedrawFn) storageMenuRedrawFn();
    if (bankMenuRedrawFn)    bankMenuRedrawFn();
    if (gsMenuRedrawFn)      gsMenuRedrawFn();
    if (lfMenuRedrawFn)      lfMenuRedrawFn();
    if (dashboardRedrawFn)   dashboardRedrawFn();
    if (inventoryRedrawFn)   inventoryRedrawFn();
    if (officeMenuRedrawFn)  officeMenuRedrawFn();
    if (npMenuRedrawFn)      npMenuRedrawFn();
  }
  if (pauseMenuRedrawFn) pauseMenuRedrawFn();
}

// Sync state when user exits fullscreen via F11 / browser ESC
document.addEventListener('fullscreenchange', () => {
  const isFS = !!document.fullscreenElement;
  if (state && state.settings && state.settings.fullscreen !== isFS) {
    // User exited/entered fullscreen without going through our menu
    if (state.settings) state.settings.fullscreen = isFS;
    localStorage.setItem('widgeter.settings.fullscreen', JSON.stringify(isFS));
    recalculateDisplaySize(isFS ? window.screen.width : window.innerWidth, isFS ? window.screen.height : window.innerHeight);
    fullRedraw();
  }
});

// Windowed mode: stay crisp when the browser window is resized
window.addEventListener('resize', () => {
  if (document.fullscreenElement) return; // handled by fullscreenchange
  clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    recalculateDisplaySize(window.innerWidth, window.innerHeight);
    fullRedraw();
    if (pauseMenuRedrawFn) pauseMenuRedrawFn();
  }, 200);
});

// ── Game state (§8) ───────────────────────────────────────────────────────────

const state = {
  gameState: 'title', // 'title' | 'transitioning' | 'intro' | 'playing'
  player: {
    x: 15,
    y: 14,
    credits: 10,
    inventory: { rm: 0, widgets: 0 },
    inventoryCaps: { rm: 5, widgets: 5 },
    color:        '#f0f0f0',  // current outfit hex
    colorName:    'DEFAULT',  // current outfit name
    ownedOutfits: [],         // e.g. ['crimson', 'cobalt']
    stamps:            0,
    stampWalkCounter:  0,
    stampLookTiles:    new Set(),
    stampLookMilestone: 0,
    stampEventTimer:   Math.floor(Math.random() * 21) + 40,
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
    storage:         { unlocked: false },
    general_store:   { unlocked: false },
    newspaper:       { unlocked: false, lastManipulationDay: -99, manipulationCooldownDays: 3, pendingManipulation: null },
  },
  newspaper: { todayHeadline: '', tomorrowForecastLabel: '', animTick: 0 },
  rocketWidgets:       0,
  rocketFull:          false,
  courierDestination:  'market',  // 'market' | 'rocket'
  rocketAnimFrame:     0,
  cottage: {
    owned:    false,
    mapX:     40,
    mapY:     21,
    playerX:  10,
    playerY:  5,
    furniture: {},
    visited:   false,
    catX:     9,
    catY:     7,
    matLoggedThisVisit: false,
  },
  bookshelfLog: [],
  officeUnlocked:      false,
  officeTab:           'upgrades', // 'upgrades' | 'workers'
  officeUpgradesPage:  1,          // 1-indexed page within UPGRADES tab
  storage: { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 },
  workbenchWidgets:  0,
  workbenchHammerFrame: 0,
  workbenchHammerTick:  0,
  productionHalted:  false,
  wbFullLogged:      false,
  couriersOwned:        0,
  demand:               50,
  marketPrice:          8,
  widgetsSoldToday:     0,
  demandMetLogged:      false,
  debt:                 0,
  debtDaysUnpaid:       0,
  demandCrashOccurred:  false,
  demandHistory:        [],
  terminalUnlocked:     false,
  derivatives:          { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0, nextSpreadId: 0 },
  volatility:           0.2,
  endingTriggered:      false,
  widgetsMade:          0,
  peakCredits:          0,
  bank: {
    deposit: 0,
    loan: null,
    creditRating:           'B',
    creditRatingScore:      3.0,
    ratingHistory:          [],
    consecutivePositiveDays: 0,
    creditNegativeLogged:   false,
    card: {
      owned: false, limit: 0, balance: 0,
      lastStatementDay: 0, cycleLength: 10,
      minimumPaymentDue: 0, paymentDueDay: 0,
      missedPayments: 0, interestRate: 0.02,
    },
  },
  audio: { muted: false },
  settings: { fullscreen: false, currentFontSize: 16 },
  workers: { apprentices: [], couriers: [] },
  stats: {
    rmLastTen:        [],
    widgetsLastTen:   [],
    creditsLastTen:   [],
    widgetsMadeToday: 0,
    revenueToday:     0,
    costsToday:       0,
    pondStepsWalked:  0,
  },
  skills: {
    apprenticeCount:   0,
    courierCount:      0,
    workerCarryLevel:  0,
    workerSpeedLevel:  0,
    courierCarryLevel: 0,
    courierSpeedLevel: 0,
    storageExp1:    0,
    storageExp2:    0,
    reducedCarry:   0,
    discountDump:   0,
    demandHistory:      0,
    forecast:           0,
    futures:            0,
    optionsBuy:         0,
    optionsWrite:       0,
    volatilitySurface:  0,
    plantStory:         0,
    smearCampaign:      0,
    endurance:    { pips: 0 },
    aquatics:     { purchased: false },
    interfacing:  { pips: 0 },
  },
  craftingTimeRemote: 10,
};

// Transient animation state — not saved to localStorage
state.officeAnim = { apprenticeFlash: 0, courierFlash: 0 };

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
    officeTab:            state.officeTab,
    officeUpgradesPage:   state.officeUpgradesPage,
    storage:              state.storage,
    workbenchWidgets:     state.workbenchWidgets,
    productionHalted:     state.productionHalted,
    wbFullLogged:         state.wbFullLogged,
    couriersOwned:        state.couriersOwned,
    demand:               state.demand,
    marketPrice:          state.marketPrice,
    widgetsSoldToday:     state.widgetsSoldToday,
    demandMetLogged:      state.demandMetLogged,
    debt:                 state.debt,
    debtDaysUnpaid:       state.debtDaysUnpaid,
    demandCrashOccurred:  state.demandCrashOccurred,
    demandHistory:        state.demandHistory,
    terminalUnlocked:     state.terminalUnlocked,
    derivatives:          state.derivatives,
    volatility:           state.volatility,
    endingTriggered:      state.endingTriggered,
    widgetsMade:          state.widgetsMade,
    peakCredits:          state.peakCredits,
    bank:                 state.bank,
    audio:                state.audio,
    settings:             state.settings,
    workers:              state.workers,
    stats:                state.stats,
    rocketWidgets:        state.rocketWidgets,
    rocketFull:           state.rocketFull,
    courierDestination:   state.courierDestination,
    skills:               state.skills,
    craftingTimeRemote:   state.craftingTimeRemote,
    cottage:              state.cottage,
    bookshelfLog:         state.bookshelfLog,
    stamps:               state.player.stamps,
    stampWalkCounter:     state.player.stampWalkCounter,
    stampLookTiles:       Array.from(state.player.stampLookTiles),
    stampLookMilestone:   state.player.stampLookMilestone,
    stampEventTimer:      state.player.stampEventTimer,
    newspaper:            state.newspaper,
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
    state.player.color         = state.player.color         ?? '#f0f0f0';
    state.player.colorName     = state.player.colorName     ?? 'DEFAULT';
    state.player.ownedOutfits  = state.player.ownedOutfits  ?? [];
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
    state.stations             = data.stations          ?? { launch_facility: { unlocked: false }, storage: { unlocked: false }, general_store: { unlocked: false } };
    state.stations.launch_facility = state.stations.launch_facility ?? { unlocked: false };
    state.stations.general_store   = state.stations.general_store   ?? { unlocked: false };
    // Migration: rename old stations.derivatives → stations.terminal
    if (state.stations.derivatives && !state.stations.terminal) {
      state.stations.terminal = state.stations.derivatives;
      delete state.stations.derivatives;
    }
    state.officeUnlocked       = data.officeUnlocked    ?? false;
    state.officeTab            = data.officeTab            ?? 'upgrades';
    state.officeUpgradesPage   = data.officeUpgradesPage   ?? 1;
    state.storage              = data.storage           ?? { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 };
    state.workbenchWidgets     = data.workbenchWidgets  ?? 0;
    state.productionHalted     = data.productionHalted  ?? false;
    state.wbFullLogged         = data.wbFullLogged       ?? false;
    state.couriersOwned        = data.couriersOwned        ?? 0;
    state.demand               = data.demand               ?? 50;
    state.marketPrice          = data.marketPrice          ?? 8;
    state.widgetsSoldToday     = data.widgetsSoldToday     ?? 0;
    state.demandMetLogged      = data.demandMetLogged       ?? false;
    state.debt                 = data.debt                 ?? 0;
    state.debtDaysUnpaid       = data.debtDaysUnpaid       ?? 0;
    state.demandCrashOccurred  = data.demandCrashOccurred  ?? false;
    state.demandHistory        = data.demandHistory        ?? [];
    state.terminalUnlocked     = data.terminalUnlocked ?? data.derivativesUnlocked ?? false;
    state.derivatives                    = data.derivatives ?? { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0 };
    state.derivatives.forwards           = state.derivatives.forwards           ?? [];
    state.derivatives.futures            = state.derivatives.futures            ?? [];
    state.derivatives.options            = state.derivatives.options            ?? [];
    state.derivatives.pnlToday          = state.derivatives.pnlToday          ?? 0;
    state.derivatives.totalPnL          = state.derivatives.totalPnL          ?? 0;
    state.derivatives.marginCallActive  = state.derivatives.marginCallActive  ?? false;
    state.derivatives.marginCallDay     = state.derivatives.marginCallDay     ?? 0;
    state.derivatives.nextSpreadId     = state.derivatives.nextSpreadId     ?? 0;
    state.volatility                     = data.volatility                     ?? 0.2;
    state.endingTriggered                = data.endingTriggered                ?? false;
    state.widgetsMade          = data.widgetsMade          ?? 0;
    state.peakCredits          = data.peakCredits          ?? 0;
    state.bank                 = data.bank                 ?? { deposit: 0, loan: null };
    state.bank.deposit         = state.bank.deposit        ?? 0;
    state.bank.loan            = state.bank.loan           ?? null;
    state.bank.creditRating           = state.bank.creditRating           ?? 'B';
    state.bank.creditRatingScore      = state.bank.creditRatingScore      ?? 3.0;
    state.bank.ratingHistory          = state.bank.ratingHistory          ?? [];
    state.bank.consecutivePositiveDays = state.bank.consecutivePositiveDays ?? 0;
    state.bank.creditNegativeLogged   = false; // transient — not restored from save
    { const _c = state.bank.card = state.bank.card ?? {};
      _c.owned             = _c.owned             ?? false;
      _c.limit             = _c.limit             ?? 0;
      _c.balance           = _c.balance           ?? 0;
      _c.lastStatementDay  = _c.lastStatementDay  ?? 0;
      _c.cycleLength       = _c.cycleLength       ?? 10;
      _c.minimumPaymentDue = _c.minimumPaymentDue ?? 0;
      _c.paymentDueDay     = _c.paymentDueDay     ?? 0;
      _c.missedPayments    = _c.missedPayments    ?? 0;
      _c.interestRate      = _c.interestRate      ?? 0.02; }
    state.audio                = data.audio               ?? { muted: false };
    state.settings             = data.settings            ?? {};
    state.settings.fullscreen  = state.settings.fullscreen  ?? false;
    state.settings.currentFontSize = state.settings.currentFontSize ?? 16;
    // Separate LS key overrides save file so fullscreen survives New Game
    { const lsFS = localStorage.getItem('widgeter.settings.fullscreen');
      if (lsFS !== null) state.settings.fullscreen = JSON.parse(lsFS); }
    state.workers              = data.workers           ?? { apprentices: [], couriers: [] };
    state.workers.couriers     = state.workers.couriers ?? []; // normalise old saves
    // Migrate old saves: ensure nickname field exists on all workers
    for (const w of state.workers.apprentices) w.nickname = w.nickname ?? '';
    for (const c of state.workers.couriers)    c.nickname = c.nickname ?? '';
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
    { const s = data.skills ?? {};
      // Migrate old saves: apprentice/courier counts, workerCarry → level names
      state.skills = {
        apprenticeCount:   s.apprenticeCount   ?? s.apprentice    ?? 0,
        courierCount:      s.courierCount      ?? s.courier       ?? 0,
        workerCarryLevel:  s.workerCarryLevel  ?? Math.min(s.workerCarry  || 0, 5),
        workerSpeedLevel:  s.workerSpeedLevel  ?? Math.min(s.workerSpeed  || 0, 4),
        courierCarryLevel: s.courierCarryLevel ?? Math.min(s.courierCarry || 0, 4),
        courierSpeedLevel: s.courierSpeedLevel ?? Math.min(s.courierSpeed || 0, 4),
        storageExp1:    s.storageExp1    ?? 0,
        storageExp2:    s.storageExp2    ?? 0,
        reducedCarry:   s.reducedCarry   ?? 0,
        discountDump:   s.discountDump   ?? 0,
        demandHistory:     s.demandHistory     ?? 0,
        forecast:          s.forecast          ?? 0,
        futures:           s.futures           ?? 0,
        optionsBuy:        s.optionsBuy        ?? 0,
        optionsWrite:      s.optionsWrite      ?? 0,
        volatilitySurface: s.volatilitySurface ?? 0,
        plantStory:        s.plantStory        ?? 0,
        smearCampaign:     s.smearCampaign     ?? 0,
        endurance:   s.endurance   ?? { pips: 0 },
        aquatics:    s.aquatics    ?? { purchased: false },
        interfacing: s.interfacing ?? { pips: 0 },
      };
      state.skills.endurance.pips        = state.skills.endurance.pips        ?? 0;
      state.skills.aquatics.purchased    = state.skills.aquatics.purchased    ?? false;
      state.skills.interfacing.pips      = state.skills.interfacing.pips      ?? 0;
    }
    state.craftingTimeRemote = data.craftingTimeRemote ?? 10;
    state.stats.pondStepsWalked = state.stats.pondStepsWalked ?? 0;
    state.cottage = data.cottage ?? { owned: false, mapX: 40, mapY: 21, playerX: 10, playerY: 5, furniture: {}, visited: false, catX: 9, catY: 7, matLoggedThisVisit: false };
    state.cottage.owned     = state.cottage.owned     ?? false;
    state.cottage.mapX      = state.cottage.mapX      ?? 40;
    state.cottage.mapY      = state.cottage.mapY      ?? 21;
    state.cottage.playerX   = state.cottage.playerX   ?? 10;
    state.cottage.playerY   = state.cottage.playerY   ?? 5;
    // Migrate old furniture array to object
    if (Array.isArray(state.cottage.furniture)) state.cottage.furniture = {};
    state.cottage.furniture = state.cottage.furniture ?? {};
    state.cottage.visited   = state.cottage.visited   ?? false;
    state.cottage.catX      = state.cottage.catX      ?? 9;
    state.cottage.catY      = state.cottage.catY      ?? 7;
    state.cottage.matLoggedThisVisit = state.cottage.matLoggedThisVisit ?? false;
    state.bookshelfLog = data.bookshelfLog ?? [];
    // Stamps (§13)
    state.player.stamps            = data.stamps            ?? 0;
    state.player.stampWalkCounter  = data.stampWalkCounter  ?? 0;
    state.player.stampLookTiles    = new Set(data.stampLookTiles ?? []);
    state.player.stampLookMilestone = data.stampLookMilestone ?? 0;
    state.player.stampEventTimer   = data.stampEventTimer   ?? (Math.floor(Math.random() * 21) + 40);
    // Newspaper (§13)
    state.newspaper = data.newspaper ?? { todayHeadline: '', tomorrowForecastLabel: '', animTick: 0 };
    state.newspaper.todayHeadline       = state.newspaper.todayHeadline       ?? '';
    state.newspaper.tomorrowForecastLabel = state.newspaper.tomorrowForecastLabel ?? '';
    state.newspaper.animTick            = 0; // transient
    state.stations.newspaper = state.stations.newspaper ?? { unlocked: false, lastManipulationDay: -99, manipulationCooldownDays: 3, pendingManipulation: null };
    state.stations.newspaper.lastManipulationDay    = state.stations.newspaper.lastManipulationDay    ?? -99;
    state.stations.newspaper.manipulationCooldownDays = state.stations.newspaper.manipulationCooldownDays ?? 3;
    state.stations.newspaper.pendingManipulation    = state.stations.newspaper.pendingManipulation    ?? null;
  } catch (_) {
    // corrupt save — start fresh
  }
}

const hasSave = !!localStorage.getItem(SAVE_KEY);
loadGame();

// Resize display to fill the current window at native font size (§3.1)
recalculateDisplaySize(window.innerWidth, window.innerHeight);

// ── Descriptions (§6.1) ───────────────────────────────────────────────────────

let descriptions = null; // loaded async; look mode is gated on this being non-null

fetch('src/content/descriptions.json')
  .then(r => r.json())
  .then(data => { descriptions = data; })
  .catch(() => { descriptions = { glyphs: {}, tiles: {} }; }); // fail gracefully

// ── §3.3 Title screen ─────────────────────────────────────────────────────────

const TITLE_ART = [
  "W       W  IIII  DDD    GGGG  EEEE  TTTTTT  EEEE  RRRR ",
  "W       W   II   D  D  G      E       TT    E     R  R ",
  "W   W   W   II   D  D  G GG   EEE     TT    EEE   RRRR ",
  "W  W W  W   II   D  D  G  G   E       TT    E     R R  ",
  " WW   WW   IIII  DDD    GGGG  EEEE    TT    EEEE  R  R ",
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

// worst-case: "Credits: 9999.0  Raw: 5  Widgets: 5/5  Price: 20cr" (50) + "[== market open 180s ==]" (24) = 74 chars ≤ 78
function drawStatusBar() {
  drawRow(STATUS_ROW, '', BRIGHT_WHITE);
  const inv = state.player.inventory;
  const cap = state.player.inventoryCaps;
  const widgetFg = inv.widgets >= cap.widgets ? '#ff5555' : BRIGHT_WHITE;
  const seg = (x, text, fg) => {
    for (let i = 0; i < text.length; i++) display.draw(x + i, STATUS_ROW, text[i], fg, BG);
    return x + text.length;
  };
  let sx = 0;
  sx = seg(sx, `Credits: ${formatCredits(state.player.credits)}`, BRIGHT_YELLOW) + 2;
  sx = seg(sx, `Raw: ${inv.rm}`, '#ff9933') + 2;
  sx = seg(sx, `Widgets: ${inv.widgets}/${cap.widgets}`, widgetFg) + 2;
       seg(sx, `Price: ${state.marketPrice}cr`, '#66cc66');
  drawTimeIndicator();
}

// ── Tile map (§4.2) ───────────────────────────────────────────────────────────

// Station definitions — single source of truth for layout and colors
const STATION_DEFS = [
  { x: 66, y: 34, label: 'LF', wc: DIM_GRAY, lc: DIM_GRAY },
  { x: 23, y: 32, label: 'ST', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x: 61, y:  4, label: 'BK', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x: 56, y: 16, label: 'TR', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x:  8, y: 35, label: 'GS', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x:  9, y:  2, label: 'RM', wc: '#ff6600', lc: '#ff6600' },
  { x: 34, y:  8, label: 'WB', wc: '#cc3300', lc: '#cc3300' },
  { x: 61, y: 23, label: 'MT', wc: '#ffd633', lc: '#ffd633' },
  { x: 23, y: 17, label: 'OF', wc: '#aaaaaa', lc: '#ffffff' },
  { x: 45, y: 32, label: 'NP', wc: DIM_GRAY,  lc: DIM_GRAY  },
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
                    || (x >= 64 && x <= 71 && y >= 32 && y <= 38); // LF clearance
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

  // Cottage — §4.2
  if (state.cottage.owned) placeCottageTiles();

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
    if (st2) { st2.wc = '#66ccff'; st2.lc = '#aaddff'; }
    if (state.stations.general_store?.unlocked) {
      const gs2 = STATION_DEFS.find(s => s.label === 'GS');
      if (gs2) { gs2.wc = '#aa66ff'; gs2.lc = '#cc99ff'; }
    }
  }
  if (state.phase >= 3) {
    const bk3 = STATION_DEFS.find(s => s.label === 'BK');
    if (bk3) { bk3.wc = '#66cc66'; bk3.lc = '#aaffaa'; }
  }
  if (state.phase >= 4) {
    const dv4 = STATION_DEFS.find(s => s.label === 'TR');
    if (dv4) { dv4.wc = '#cc66cc'; dv4.lc = '#cc66cc'; }
  }
  if (state.phase >= 5) {
    const lf5 = STATION_DEFS.find(s => s.label === 'LF');
    if (lf5) { lf5.wc = COLOR_LF_FRAME; lf5.lc = COLOR_LF_LABEL; lf5.dc = '#cc3333'; }
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
    TR: { wall: "A glass-fronted building with screens displaying numbers you don't yet understand. The door is locked. A small plaque reads: 'AUTHORIZED PERSONNEL ONLY.'" },
    LF: state.phase >= 5
      ? { wall: 'A reinforced wall. Built to withstand something significant.', door: 'The entrance to the Launch Facility. The air smells of fuel and ambition.' }
      : { wall: 'A large structure, shrouded in canvas. Something tall is underneath. The canvas smells of grease and oxidizer.' },
    GS: state.stations.general_store?.unlocked
      ? { wall: 'The shop front. A few items are visible through the window.', door: 'The General Store entrance. A small bell above the door is silent for now.' }
      : { wall: "A small shop, shuttered. A sign in the window reads: 'OPENING SOON.' The display inside is covered with a cloth." },
    NP: state.stations.newspaper?.unlocked
      ? { wall: 'The press building. You can hear machinery inside.', door: 'The Newspaper office entrance. The smell of ink is strong.' }
      : { wall: "A small print shop, dark. A sign reads: 'THE DAILY WIDGET — COMING SOON.' Ink stains on the doorstep." },
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
    tileMap[s.x+1][s.y+2] = mk('.',        s.dc || s.wc, true);  // door — walkable
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

  // Apply AQUATICS: mark pond tiles player-walkable
  if (state.skills.aquatics?.purchased) {
    for (const t of shimmerTiles) tileMap[t.x][t.y].playerWalkable = true;
  }
}

// Inject cottage tiles into the live tileMap and mark them dirty.
// Called from buildTileMap() and immediately after purchase so the cottage
// appears without waiting for the next full drawWorld() call.
function placeCottageTiles() {
  const cx = state.cottage.mapX, cy = state.cottage.mapY;
  const RC = '#cc3333', WC_COT = '#886633';
  const mk = (g, fg, w) => ({ glyph: g, fg, bg: BG, walkable: w });
  const ROOF = [' ', '/', '\\', '/', '\\', ' '];
  for (let i = 0; i < 6; i++) tileMap[cx+i][cy] = mk(ROOF[i], RC, true);
  tileMap[cx  ][cy+1] = mk('+', WC_COT, false);
  tileMap[cx+1][cy+1] = mk('-', WC_COT, false);
  tileMap[cx+2][cy+1] = mk('-', WC_COT, false);
  tileMap[cx+3][cy+1] = mk('-', WC_COT, false);
  tileMap[cx+4][cy+1] = mk('-', WC_COT, false);
  tileMap[cx+5][cy+1] = mk('+', WC_COT, false);
  tileMap[cx  ][cy+2] = mk('|', WC_COT, false);
  for (let i = 1; i <= 4; i++) tileMap[cx+i][cy+2] = mk(' ', WC_COT, false);
  tileMap[cx+5][cy+2] = mk('|', WC_COT, false);
  tileMap[cx  ][cy+3] = mk('+', WC_COT, false);
  tileMap[cx+1][cy+3] = mk('-', WC_COT, false);
  tileMap[cx+2][cy+3] = mk('-', WC_COT, false);
  tileMap[cx+3][cy+3] = mk('.', WC_COT, true); // door
  tileMap[cx+4][cy+3] = mk('-', WC_COT, false);
  tileMap[cx+5][cy+3] = mk('+', WC_COT, false);
  // Mark all cottage tile positions dirty so the next renderDirty() shows them
  for (let dx = 0; dx < 6; dx++)
    for (let dy = 0; dy < 4; dy++)
      markDirty(cx + dx, cy + dy);
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
  display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);

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
    COLOR_HINT_LINE);
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
  state.player = { x: 15, y: 14, credits: 10, inventory: { rm: 0, widgets: 0 }, inventoryCaps: { rm: 5, widgets: 5 }, color: '#f0f0f0', colorName: 'DEFAULT', ownedOutfits: [] };
  state.day = 1; state.tick = 0; state.dayTick = 0;
  state.marketOpen = true; state.phase = 1;
  state.lifetimeCreditsEarned = 0; state.logLines = []; state.bellFiredToday = false;
  state.lastAmbientTick = 0; state.lastNarrativeTick = 0; state.nextAmbientDelay = 45; state.stepsWalked = 0;
  state.stations = {
    launch_facility: { unlocked: false }, storage: { unlocked: false }, general_store: { unlocked: false },
    newspaper: { unlocked: false, lastManipulationDay: -99, manipulationCooldownDays: 3, pendingManipulation: null },
  };
  state.newspaper = { todayHeadline: '', tomorrowForecastLabel: '', animTick: 0 };
  const gsDef = STATION_DEFS.find(s => s.label === 'GS');
  if (gsDef) { gsDef.wc = DIM_GRAY; gsDef.lc = DIM_GRAY; }
  const npDef = STATION_DEFS.find(s => s.label === 'NP');
  if (npDef) { npDef.wc = DIM_GRAY; npDef.lc = DIM_GRAY; delete npDef.dc; }
  state.rocketWidgets      = 0;
  state.rocketFull         = false;
  state.courierDestination = 'market';
  state.rocketAnimFrame    = 0;
  state.officeUnlocked     = false;
  state.officeTab          = 'upgrades';
  state.officeUpgradesPage = 1;
  state.storage = { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 };
  state.workbenchWidgets    = 0;
  state.workbenchHammerFrame = 0;
  state.workbenchHammerTick  = 0;
  state.productionHalted = false;
  state.wbFullLogged     = false;
  state.couriersOwned    = 0;
  state.demand           = 50;
  state.marketPrice      = 8;
  state.widgetsSoldToday = 0;
  state.demandMetLogged      = false;
  state.debt                 = 0;
  state.debtDaysUnpaid       = 0;
  state.demandCrashOccurred  = false;
  state.demandHistory        = [];
  state.terminalUnlocked     = false;
  state.derivatives          = { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0 };
  state.volatility           = 0.2;
  state.endingTriggered      = false;
  state.widgetsMade          = 0;
  state.peakCredits          = 0;
  state.bank                 = {
    deposit: 0, loan: null,
    creditRating: 'B', creditRatingScore: 3.0,
    ratingHistory: [], consecutivePositiveDays: 0,
    creditNegativeLogged: false,
    card: { owned:false, limit:0, balance:0, lastStatementDay:0, cycleLength:10,
            minimumPaymentDue:0, paymentDueDay:0, missedPayments:0, interestRate:0.02 },
  };
  state.audio            = { muted: false };
  { const savedFS = localStorage.getItem('widgeter.settings.fullscreen');
    state.settings = { fullscreen: savedFS ? JSON.parse(savedFS) : false, currentFontSize: state.settings?.currentFontSize ?? 16 }; }
  state.workers = { apprentices: [], couriers: [] };
  state.stats = { rmLastTen: [], widgetsLastTen: [], creditsLastTen: [], widgetsMadeToday: 0, revenueToday: 0, costsToday: 0 };
  state.skills = { apprenticeCount: 0, courierCount: 0, workerCarryLevel: 0, workerSpeedLevel: 0, courierCarryLevel: 0, courierSpeedLevel: 0, storageExp1: 0, storageExp2: 0, reducedCarry: 0, discountDump: 0, demandHistory: 0, forecast: 0, futures: 0, optionsBuy: 0, optionsWrite: 0, volatilitySurface: 0, plantStory: 0, smearCampaign: 0, endurance: { pips: 0 }, aquatics: { purchased: false }, interfacing: { pips: 0 } };
  state.craftingTimeRemote = 10;
  state.stats.pondStepsWalked = 0;
  state.cottage = { owned: false, mapX: 40, mapY: 21, playerX: 10, playerY: 5, furniture: {}, visited: false, catX: 9, catY: 7, matLoggedThisVisit: false };
  state.bookshelfLog = [];
  state.officeAnim = { apprenticeFlash: 0, courierFlash: 0 };
  state.player.stamps            = 0;
  state.player.stampWalkCounter  = 0;
  state.player.stampLookTiles    = new Set();
  state.player.stampLookMilestone = 0;
  state.player.stampEventTimer   = Math.floor(Math.random() * 21) + 40;
  const lfDef = STATION_DEFS.find(s => s.label === 'LF');
  const stDef = STATION_DEFS.find(s => s.label === 'ST');
  const bkDef = STATION_DEFS.find(s => s.label === 'BK');
  const trDef = STATION_DEFS.find(s => s.label === 'TR');
  if (lfDef) { lfDef.wc = DIM_GRAY; lfDef.lc = DIM_GRAY; }
  if (stDef) { stDef.wc = DIM_GRAY; stDef.lc = DIM_GRAY; }
  if (bkDef) { bkDef.wc = DIM_GRAY; bkDef.lc = DIM_GRAY; }
  if (trDef) { trDef.wc = DIM_GRAY; trDef.lc = DIM_GRAY; }
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
  // Apply fullscreen preference — browsers require a user gesture before requestFullscreen
  if (state.settings.fullscreen) setFullscreen(true);
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
  if (state.gameState === 'cottage') {
    // Escape: close overlays or exit cottage
    if (e.key === 'Escape') {
      e.preventDefault();
      if (bookshelfOverlayActive) { bookshelfOverlayActive = false; drawCottageInterior(); }
      else if (cottageLookActive) { cottageLookActive = false; drawCottageInterior(); }
      else exitCottage();
      return;
    }
    // o: toggle look mode
    if (e.key === 'o') {
      e.preventDefault();
      if (bookshelfOverlayActive) return;
      cottageLookActive = !cottageLookActive;
      if (cottageLookActive) { cottageLookX = state.cottage.playerX; cottageLookY = state.cottage.playerY; }
      drawCottageInterior(); return;
    }
    const DIRS = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
    const d = DIRS[e.key];
    if (d) {
      e.preventDefault();
      if (bookshelfOverlayActive) return;
      if (cottageLookActive) {
        const nx = cottageLookX + d[0], ny = cottageLookY + d[1];
        if (nx >= 0 && nx <= 19 && ny >= 0 && ny <= 11) { cottageLookX = nx; cottageLookY = ny; drawCottageInterior(); }
        return;
      }
      const nx = state.cottage.playerX + d[0], ny = state.cottage.playerY + d[1];
      if (nx >= 1 && nx <= 18 && ny >= 1 && ny <= 9) {
        const destWalkable = !interiorTileMap[nx] || !interiorTileMap[nx][ny] || interiorTileMap[nx][ny].walkable;
        if (!destWalkable) return;
        state.cottage.playerX = nx; state.cottage.playerY = ny;
        // Welcome mat check
        if (state.cottage.furniture.mat && ny===9 && nx>=9 && nx<=14 && !state.cottage.matLoggedThisVisit) {
          state.cottage.matLoggedThisVisit = true; addLog('Welcome home.', '#aa66ff'); renderLog();
        }
        drawCottageInterior();
      } else if (d[1]===1 && state.cottage.playerY===9) {
        exitCottage();
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      if (bookshelfOverlayActive) { bookshelfOverlayActive = false; drawCottageInterior(); return; }
      if (cottageLookActive) { cottageLookActive = false; drawCottageInterior(); return; }
      if (!handleCottageInteract()) exitCottage();
    }
    return;
  }
  if (state.gameState === 'crafting' && e.key === 'Escape') { cancelCrafting(); return; }
  if (state.gameState === 'crafting') {
    const ARROW = { ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true };
    if (ARROW[e.key]) {
      e.preventDefault();
      addLog("You can't move — you're mid-craft. Press Esc to cancel.", '#ff5555');
    }
    return;
  }
  if (state.gameState === 'menu') return; // arrow keys must not reach movement when any menu is open
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
  const destTile = tileMap[nx][ny];
  const canStep  = destTile.walkable || (destTile.glyph === '~' && destTile.playerWalkable);
  if (!canStep) return;
  markDirty(state.player.x, state.player.y);
  state.player.x = nx;
  state.player.y = ny;
  markDirty(state.player.x, state.player.y);
  renderDirty();
  display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
  if (destTile.glyph === '~') state.stats.pondStepsWalked = (state.stats.pondStepsWalked || 0) + 1;
  state.stepsWalked++;
  state.lastNarrativeTick = state.tick;
  // Stamps: 1 per 15 steps (§13)
  state.player.stampWalkCounter = (state.player.stampWalkCounter || 0) + 1;
  if (state.player.stampWalkCounter >= 15) { state.player.stampWalkCounter = 0; awardStamp(1, false); }
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
const CRAFT_TICKS = 3; // ticks per widget at workbench (§5.2)
let craftQueue      = 0;
let craftProgress   = 0;
let craftTotal      = 0;
let activeCraftTicks = CRAFT_TICKS; // current session craft time (remote may differ)
let craftingRemote  = false;

function drawLookCursor(inverted) {
  const onPlayer = lookX === state.player.x && lookY === state.player.y;
  const glyph  = onPlayer ? '@'          : tileMap[lookX][lookY].glyph;
  const tileFg = onPlayer ? (state.player.color || BRIGHT_WHITE) : tileMap[lookX][lookY].fg;
  const tileBg = tileMap[lookX][lookY].bg;
  display.draw(lookX, lookY, glyph, inverted ? tileBg : tileFg, inverted ? tileFg : tileBg);
}

function restoreLookTile() {
  markDirty(lookX, lookY);
  renderDirty();
  if (lookX === state.player.x && lookY === state.player.y)
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
}

// Priority: tileMap[x][y].description → tiles["x,y"] → glyphs[g].variants[hash] → glyphs[g].default → fallback (§6.1, §6.2, §6.5)
function getDescription(x, y, glyph) {
  if (!descriptions) return 'Nothing remarkable.';
  // Dynamic @ description reflects current outfit
  if (glyph === '@' && x === state.player.x && y === state.player.y) {
    if (state.player.colorName && state.player.colorName !== 'DEFAULT') {
      return `That's you. You look tired, but sharp in ${state.player.colorName.toLowerCase()}.`;
    }
    return "That's you. You look tired.";
  }
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

function trackLookStamp(x, y) {
  const key = `${x},${y}`;
  if (!state.player.stampLookTiles.has(key)) {
    state.player.stampLookTiles.add(key);
    while (state.player.stampLookTiles.size >= state.player.stampLookMilestone + 8) {
      state.player.stampLookMilestone += 8;
      awardStamp(1, false);
    }
  }
}

function enterLookMode() {
  if (!descriptions) return; // wait for JSON to load
  state.gameState = 'look';
  lookX = state.player.x;
  lookY = state.player.y;
  trackLookStamp(lookX, lookY);
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
  trackLookStamp(lookX, lookY);
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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
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
  const walls = [
    [s.x,   s.y],   [s.x+1, s.y],   [s.x+2, s.y],   [s.x+3, s.y],
    [s.x,   s.y+1], [s.x+3, s.y+1],
    [s.x,   s.y+2], [s.x+2, s.y+2], [s.x+3, s.y+2],
  ];
  return walls.some(([wx, wy]) => Math.abs(px - wx) <= 1 && Math.abs(py - wy) <= 1);
}

function openRMShedMenu() {
  state.gameState = 'rm_menu';

  const COST  = 3;
  const TC    = '#ff6600'; // theme color
  const DC    = '#333333';
  const BOX_W = 54;
  const IW    = 52;
  const AW    = 14; // art pane width
  const IPW   = 37; // info pane width
  const BOX_H = 22;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1; // right pane absolute x

  const RM_ART = [
    '  +------+    ',
    '  |  __  |    ',
    '  | |  | |    ',
    '  | |  | |    ',
    '  +-+--+-+    ',
    '   /    \\     ',
    '  / SHED \\    ',
    ' /________\\   ',
    '  |  RM  |    ',
    '  +------+    ',
  ];

  function drawArtRow(r, ay) {
    const s = RM_ART[r];
    for (let i = 0; i < AW; i++) {
      let fg = '#aaaaaa';
      if (r === 6 && i >= 4 && i <= 7) fg = TC;  // SHED
      if (r === 8 && i >= 5 && i <= 6) fg = TC;  // RM
      display.draw(BOX_X + 1 + i, ay, s[i] || ' ', fg, BG);
    }
  }

  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }

  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', fg, BG);
  }

  function crow(ay, r) {
    border(ay);
    drawArtRow(r, ay);
    display.draw(BOX_X + 1 + AW, ay, '│', DC, BG);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }

  function drp(ay, text, fg) {
    const p = menuPad(text, IPW);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }

  function arow(ay, label, cost, fg) {
    const gap  = Math.max(1, IW - label.length - (cost ? cost.length : 0));
    const line = cost ? label + ' '.repeat(gap) + cost : label;
    irow(ay, line, fg);
  }

  function redraw() {
    const rm      = state.player.inventory.rm;
    const rmCap   = state.player.inventoryCaps.rm;
    const rmSpace = rmCap - rm;
    const maxBuy  = Math.min(rmSpace, Math.floor(state.player.credits / COST));
    const canBuy1 = state.player.credits >= COST && rmSpace > 0;

    // Clear interior
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);

    // Row 0: ╔═…═╗
    display.draw(BOX_X, BOX_Y, '╔', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);

    // Row 1: header
    { const ay = BOX_Y + 1;
      border(ay);
      const title = 'Raw Materials Shed', hint = 'press esc to exit';
      const sp = IW - title.length - hint.length;
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? '#f0f0f0' : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    // Row 2: ═ separator
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Rows 3-12: content (art + divider + info)
    for (let r = 0; r < 10; r++) crow(BOX_Y + 3 + r, r);

    // Populate info pane
    drp(BOX_Y + 4, 'RAW MATERIALS', TC);
    drp(BOX_Y + 5, 'In inventory:', '#555555');

    // Large number: rm/cap (5 rows tall, starts at +6, ends at +10)
    const numStr = `${rm}/${rmCap}`;
    renderLargeNumber(display, RPX, BOX_Y + 6, numStr, TC, IPW);

    drp(BOX_Y + 11, `Cost per unit:  ${formatCredits(COST)}cr`, '#f0f0f0');
    drp(BOX_Y + 12, '', DC);

    // Row 13: ─ action separator
    { const ay = BOX_Y + 13; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Action rows 14-18
    const c1 = `-${formatCredits(COST)}cr`;
    const cm = maxBuy > 0 ? `-${formatCredits(maxBuy * COST)}cr` : '';
    const cardAvail = state.bank.card?.owned ? Math.max(0, state.bank.card.limit - state.bank.card.balance) : 0;
    const canBuyCard = state.bank.card?.owned && cardAvail >= COST && rmSpace > 0;
    arow(BOX_Y + 14, `1. Buy 1 RM`, c1, canBuy1 ? '#66cc66' : '#ff5555');
    arow(BOX_Y + 15, `2. Buy max (${maxBuy})`, cm, canBuy1 && maxBuy > 0 ? '#66cc66' : '#ff5555');
    arow(BOX_Y + 16, '3. Buy custom amount', '', canBuy1 ? '#66cc66' : '#ff5555');
    arow(BOX_Y + 17, '4. Cancel', '', '#555555');
    arow(BOX_Y + 18, `5. Buy 1 RM on card`, canBuyCard ? `-${COST}cr (card)` : '', canBuyCard ? '#66ccff' : '#444444');

    // Row 19: ═ bottom rule
    { const ay = BOX_Y + 19; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 20: status
    let statusText, statusFg;
    if (rmSpace <= 0)                { statusText = 'Inventory full.'; statusFg = '#ff5555'; }
    else if (state.player.credits < COST && !canBuyCard) { statusText = 'Insufficient credits.'; statusFg = '#ff5555'; }
    else                             { statusText = 'Walk to shed. Press space to purchase.'; statusFg = '#555555'; }
    { const ay = BOX_Y + 20; border(ay);
      const centered = menuPad(statusText.length < IW ? ' '.repeat(Math.floor((IW-statusText.length)/2)) + statusText : statusText, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, centered[i] || ' ', statusFg, BG); }

    // Row 21: ╚═…═╝
    display.draw(BOX_X, BOX_Y + 21, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 21, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 21, '═', TC, BG);
  }

  function closeRM() {
    rmMenuRedrawFn = null;
    window.removeEventListener('keydown', rmKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  function rmKeyHandler(e) {
    if (e.key === 'Escape' || e.key === '4') { closeRM(); return; }
    const rm      = state.player.inventory.rm;
    const rmCap   = state.player.inventoryCaps.rm;
    const rmSpace = rmCap - rm;
    const maxBuy  = Math.min(rmSpace, Math.floor(state.player.credits / COST));
    const canBuy1 = state.player.credits >= COST && rmSpace > 0;

    if (e.key === '1' && canBuy1) {
      state.player.credits -= COST; state.player.inventory.rm++;
      addLog('You buy 1 raw material.', '#ff9933'); drawStatusBar();
      { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(state.player.x, state.player.y, rmD.x+1, rmD.y+2, COST); }
      return;
    }
    if (e.key === '2' && maxBuy > 0 && canBuy1) {
      state.player.credits -= maxBuy * COST; state.player.inventory.rm += maxBuy;
      addLog(`You buy ${maxBuy} raw material${maxBuy !== 1 ? 's' : ''}.`, '#ff9933'); drawStatusBar();
      return;
    }
    if (e.key === '3' && canBuy1) {
      window.removeEventListener('keydown', rmKeyHandler);
      showNumericPrompt(`Buy RM (max ${maxBuy})`, maxBuy,
        (n) => { state.player.credits -= n * COST; state.player.inventory.rm += n;
                 addLog(`You buy ${n} raw material${n !== 1 ? 's' : ''}.`, '#ff9933'); drawStatusBar();
                 openRMShedMenu(); },
        () => openRMShedMenu()
      );
    }
    if (e.key === '5') {
      const card = state.bank.card;
      if (!card?.owned) return;
      const avail = Math.max(0, card.limit - card.balance);
      if (avail < COST || rmSpace <= 0) return;
      card.balance = Math.round((card.balance + COST) * 10) / 10;
      state.player.inventory.rm++;
      addLog('You buy 1 RM on card.', '#66ccff'); drawStatusBar();
      { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(state.player.x, state.player.y, rmD.x+1, rmD.y+2, COST); }
      redraw();
    }
  }

  rmMenuRedrawFn = redraw;
  redraw();
  window.addEventListener('keydown', rmKeyHandler);
}

// WB label tile positions for pulse effect (middle row of WB station at x=34,y=8)
const WB_LABEL_TILES = [[35, 9], [36, 9]];

function pulseWB() {
  WB_LABEL_TILES.forEach(([x, y]) => display.draw(x, y, tileMap[x][y].glyph, '#ffffff', BG));
  setTimeout(() => {
    WB_LABEL_TILES.forEach(([x, y]) => { markDirty(x, y); });
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
  }, 200);
}

function startCrafting(n, ticks = CRAFT_TICKS, remote = false) {
  state.player.inventory.rm--;
  craftQueue       = n - 1;
  craftProgress    = 0;
  craftTotal       = n;
  activeCraftTicks = ticks;
  craftingRemote   = remote;
  state.gameState  = 'crafting';
  drawStatusBar();
  addLog(`Crafting ${n} widget${n !== 1 ? 's' : ''}...`, BRIGHT_CYAN);
}

function cancelCrafting() {
  craftQueue = 0; craftProgress = 0;
  state.workbenchHammerFrame = 0; state.workbenchHammerTick = 0;
  if (!craftingRemote) {
    WB_LABEL_TILES.forEach(([x, y]) => { markDirty(x, y); });
    renderDirty();
  }
  display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
  addLog('Crafting cancelled. Current widget lost.', '#ff5555');
  craftingRemote = false;
  state.gameState = 'playing';
  if (wbMenuCloseFn) { wbMenuCloseFn(); wbMenuRedrawFn = null; wbMenuCloseFn = null; }
}

function openWorkbenchMenu(isRemote = false) {
  state.gameState = 'wb_menu';
  const craftTime = isRemote ? state.craftingTimeRemote : CRAFT_TICKS;

  const TC    = '#cc3300';
  const DC    = '#333333';
  const BOX_W = 54;
  const IW    = 52;
  const AW    = 14;
  const IPW   = 37;
  const BOX_H = 21;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;

  const WB_ART = [
    '    ______    ',
    '   /      \\   ',
    '  | BENCH  |  ',
    '  |--------|  ',
    '  | ~~~~~~ |  ',
    '  | ~~~~~~ |  ',
    '  |________|  ',
    '  ||      ||  ',
    '  ||      ||  ',
    '  ++      ++  ',
  ];

  const HAMMER_FRAMES = [
    // Frame 0 — hammer raised, held high
    ['   _____      ', '  |     |     ', '  |_____|     ', '     |        ', '     |        '],
    // Frame 1 — hammer descending fast
    ['              ', '   _____      ', '  |     |     ', '  |_____|     ', '     |        '],
    // Frame 2 — impact
    ['  * . * . *   ', '  _________   ', ' |_________|  ', '  - - - - -   ', '     | |      '],
    // Frame 3 — rebound
    ['              ', '   _____      ', '  |     |     ', '  |_____|     ', '     |        '],
  ];

  // Per-frame, per-rowIdx (0-4) base color; null = per-char (spark row)
  const HAMMER_COLORS = [
    ['#aaaaaa', '#aaaaaa', '#aaaaaa', '#cc6600', '#cc6600'], // frame 0
    ['#aaaaaa', '#aaaaaa', '#aaaaaa', '#aaaaaa', '#cc6600'], // frame 1
    [null,      '#ffffff', '#ffffff', '#ff9933', '#cc6600'], // frame 2 (row 0 = per-char sparks)
    ['#aaaaaa', '#aaaaaa', '#aaaaaa', '#aaaaaa', '#cc6600'], // frame 3
  ];

  function drawHammerRow(r, ay) {
    const frame  = state.workbenchHammerFrame;
    const rowIdx = r - 2;
    const s      = HAMMER_FRAMES[frame][rowIdx];
    const base   = HAMMER_COLORS[frame][rowIdx];
    for (let i = 0; i < AW; i++) {
      const ch = s[i] || ' ';
      let fg;
      if (base === null) { // spark row (frame 2, rowIdx 0)
        fg = ch === '*' ? '#ffd633' : ch === '.' ? '#ff9933' : '#aaaaaa';
      } else {
        fg = base;
      }
      display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
    }
  }

  function drawArtRow(r, ay) {
    if (state.gameState === 'crafting' && r >= 2 && r <= 6) {
      drawHammerRow(r, ay);
      return;
    }
    const s = WB_ART[r];
    for (let i = 0; i < AW; i++) {
      let fg = '#aaaaaa';
      if (r === 2 && i >= 4 && i <= 8) fg = TC;
      if ((r === 4 || r === 5) && i >= 4 && i <= 9) fg = '#ff9933';
      display.draw(BOX_X + 1 + i, ay, s[i] || ' ', fg, BG);
    }
  }

  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }

  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', fg, BG);
  }

  function crow(ay, r) {
    border(ay);
    drawArtRow(r, ay);
    display.draw(BOX_X + 1 + AW, ay, '│', DC, BG);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }

  function drp(ay, text, fg) {
    const p = menuPad(text, IPW);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }

  function arow(ay, label, cost, fg) {
    const gap  = Math.max(1, IW - label.length - (cost ? cost.length : 0));
    const line = cost ? label + ' '.repeat(gap) + cost : label;
    irow(ay, line, fg);
  }

  function redraw() {
    const rm          = state.player.inventory.rm;
    const widgetCap   = state.player.inventoryCaps.widgets;
    const widgetSpace = widgetCap - state.player.inventory.widgets;
    const maxCraft    = Math.min(rm, widgetSpace);
    const canCraft1   = rm >= 1 && widgetSpace > 0;
    const isCrafting  = state.gameState === 'crafting';

    // Clear interior
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);

    // Row 0: ╔═…═╗
    display.draw(BOX_X, BOX_Y, '╔', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);

    // Row 1: header
    { const ay = BOX_Y + 1;
      border(ay);
      const title = 'Workbench', hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? '#f0f0f0' : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    // Row 2: ═ separator
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Rows 3-12: art + divider + info
    for (let r = 0; r < 10; r++) crow(BOX_Y + 3 + r, r);

    // Info pane
    drp(BOX_Y + 4, 'WORKBENCH', TC);
    drp(BOX_Y + 5, 'Materials:', '#555555');
    // Large number — 5 rows tall, starts at +6, ends at +10
    {
      renderLargeNumber(display, RPX, BOX_Y + 6, String(rm), '#ff9933', IPW);
    }
    drp(BOX_Y + 11, `Time per widget:  ${craftTime}s${isRemote ? '  (remote)' : ''}`, '#f0f0f0');
    drp(BOX_Y + 12, `Widget cap:  ${widgetCap}`, '#555555');

    // Row 13: ─ separator
    { const ay = BOX_Y + 13; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Action rows 14-17
    if (isCrafting) {
      const BAR_W    = 20;
      const filled   = Math.floor((craftProgress / activeCraftTicks) * BAR_W);
      const secsLeft = activeCraftTicks - craftProgress;
      const widgetNum = craftTotal - craftQueue;
      irow(BOX_Y + 14, `Crafting widget ${widgetNum} of ${craftTotal}`, '#f0f0f0');
      { const ay = BOX_Y + 15;
        border(ay);
        let bx = BOX_X + 1;
        display.draw(bx++, ay, '[', '#555555', BG);
        for (let i = 0; i < BAR_W; i++) {
          display.draw(bx++, ay, i < filled ? '█' : '░', i < filled ? '#ff9933' : '#333333', BG);
        }
        display.draw(bx++, ay, ']', '#555555', BG);
        const secsStr = `  ${secsLeft}s`;
        for (let i = 0; i < secsStr.length; i++) display.draw(bx++, ay, secsStr[i], '#f0f0f0', BG);
        while (bx < BOX_X + 1 + IW) display.draw(bx++, ay, ' ', BRIGHT_WHITE, BG);
      }
      irow(BOX_Y + 16, '', BRIGHT_WHITE);
      irow(BOX_Y + 17, 'ESC to cancel (widget lost)', '#ff5555');
    } else {
      arow(BOX_Y + 14, '1. Craft 1', `1 RM → 1 widget, ${craftTime}s`, canCraft1 ? '#66cc66' : '#ff5555');
      arow(BOX_Y + 15, `2. Craft max  (${maxCraft})`, '', canCraft1 && maxCraft > 0 ? '#66cc66' : '#ff5555');
      arow(BOX_Y + 16, '3. Craft custom amount', '', canCraft1 ? '#66cc66' : '#ff5555');
      arow(BOX_Y + 17, '4. Cancel', '', '#555555');
    }

    // Row 18: ═ rule
    { const ay = BOX_Y + 18; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 19: status
    let statusText, statusFg;
    if (isCrafting)            { statusText = 'Crafting in progress.'; statusFg = '#ff9933'; }
    else if (rm === 0)         { statusText = 'No raw materials.'; statusFg = '#ff5555'; }
    else if (widgetSpace <= 0) { statusText = 'Widget inventory full.'; statusFg = '#ff5555'; }
    else                       { statusText = 'Ready to craft.'; statusFg = '#555555'; }
    { const ay = BOX_Y + 19; border(ay);
      const centered = menuPad(statusText.length < IW ? ' '.repeat(Math.floor((IW - statusText.length) / 2)) + statusText : statusText, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, centered[i] || ' ', statusFg, BG); }

    // Row 20: ╚═…═╝
    display.draw(BOX_X, BOX_Y + 20, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 20, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 20, '═', TC, BG);
  }

  function closeWB() {
    window.removeEventListener('keydown', wbKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
  }

  function wbKeyHandler(e) {
    if (state.gameState === 'crafting') return;
    if (e.key === 'Escape' || e.key === '4') {
      closeWB();
      wbMenuRedrawFn = null; wbMenuCloseFn = null;
      state.gameState = 'playing';
      return;
    }
    const rm          = state.player.inventory.rm;
    const widgetSpace = state.player.inventoryCaps.widgets - state.player.inventory.widgets;
    const maxCraft    = Math.min(rm, widgetSpace);
    const canCraft1   = rm >= 1 && widgetSpace > 0;

    if (e.key === '1' && canCraft1) {
      window.removeEventListener('keydown', wbKeyHandler);
      startCrafting(1, craftTime, isRemote);
      return;
    }
    if (e.key === '2' && canCraft1 && maxCraft > 0) {
      window.removeEventListener('keydown', wbKeyHandler);
      startCrafting(maxCraft, craftTime, isRemote);
      return;
    }
    if (e.key === '3' && canCraft1) {
      window.removeEventListener('keydown', wbKeyHandler);
      showNumericPrompt(`Craft how many? (max ${maxCraft})`, maxCraft,
        (n) => { startCrafting(n, craftTime, isRemote); },
        () => openWorkbenchMenu(isRemote)
      );
      return;
    }
  }

  wbMenuRedrawFn = redraw;
  wbMenuCloseFn  = closeWB;
  redraw();
  window.addEventListener('keydown', wbKeyHandler);
}

function colorInStation(label, wc, lc, dc) {
  const s = STATION_DEFS.find(sd => sd.label === label);
  if (!s) return;
  const doorColor = dc || wc;
  s.wc = wc; s.lc = lc; s.dc = dc;
  const tiles = [
    [s.x,   s.y,   '+', wc,        false], [s.x+1, s.y,   '-', wc,        false],
    [s.x+2, s.y,   '-', wc,        false], [s.x+3, s.y,   '+', wc,        false],
    [s.x,   s.y+1, '|', wc,        false], [s.x+1, s.y+1, s.label[0], lc, false],
    [s.x+2, s.y+1, s.label[1], lc, false], [s.x+3, s.y+1, '|', wc,        false],
    [s.x,   s.y+2, '+', wc,        false], [s.x+1, s.y+2, '.', doorColor,  true],
    [s.x+2, s.y+2, '-', wc,        false], [s.x+3, s.y+2, '+', wc,        false],
  ];
  for (const [tx, ty, g, fg, w] of tiles) {
    tileMap[tx][ty] = { glyph: g, fg, bg: BG, walkable: w };
    markDirty(tx, ty);
  }
  renderDirty();
  display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
  for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
  for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
}

function checkPhase2Trigger() {
  if (state.lifetimeCreditsEarned >= 100 && state.phase === 1) {
    state.phase = 2;
    state.officeUnlocked = true;
    logHistory('Hired first worker.');
    state.stations.storage.unlocked       = true;
    state.stations.general_store.unlocked = true;
    addLog('Something stirs. The Office door swings open.', '#cc66cc');
    setTimeout(() => addLog('You can afford to hire help.', '#cc66cc'), 2000);
    setTimeout(() => {
      addLog('The Storage Warehouse is now available.', '#cc66cc');
      colorInStation('ST', '#66ccff', '#aaddff');
    }, 4000);
    setTimeout(() => {
      addLog('A light is on in the shop at the south-west corner. Someone is open for business.', '#aa66ff');
      colorInStation('GS', '#aa66ff', '#cc99ff');
    }, 7000);
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
  if (state.demand < 20 && !state.demandCrashOccurred) logHistory('The market collapsed.');
  if (state.demand < 20) state.demandCrashOccurred = true;
  state.demandHistory.push({ day: state.day, demand: state.demand, price: state.marketPrice });
  if (state.demandHistory.length > 30) state.demandHistory.shift();
}

function checkPhase3Trigger() {
  if (state.phase === 2 && (state.lifetimeCreditsEarned >= 500 || (state.couriersOwned >= 1 && state.day >= 2))) {
    state.phase = 3;
    state.stations.bank = { unlocked: true };
    state.stations.newspaper.unlocked = true;
    logHistory('The market began fluctuating.');
    calculateDailyDemand();
    addLog('The bank lights come on for the first time.', '#66cc66');
    setTimeout(() => addLog('New possibilities are available.', '#66cc66'), 2000);
    setTimeout(() => colorInStation('BK', '#66cc66', '#aaffaa'), 4000);
    setTimeout(() => {
      addLog('> The Newspaper office has a light on. Someone is printing something.', '#ccaa44');
      colorInStation('NP', '#ccaa44', '#ffdd66');
    }, 5000);
  }
}

function checkPhase4Trigger() {
  if (state.phase === 3 && (state.demandCrashOccurred || state.lifetimeCreditsEarned >= 2000)) {
    state.phase = 4;
    state.terminalUnlocked = true;
    state.stations.terminal = { unlocked: true };
    logHistory('A man in a clean suit appeared.');
    addLog('A man in a clean suit appears at the market.', '#cc66cc');
    setTimeout(() => addLog("He offers you a contract. Lock in tomorrow's price, he says.", '#cc66cc'), 2000);
    setTimeout(() => {
      addLog('The Terminal is now open.', '#cc66cc');
      colorInStation('TR', '#cc66cc', '#cc66cc');
    }, 4000);
  }
}

function checkPhase5Trigger() {
  if (state.phase === 4 && state.lifetimeCreditsEarned >= 10000) {
    state.phase = 5;
    logHistory('The launch facility opened.');
    addLog('Something has been under construction this whole time.', '#cc66cc');
    setTimeout(() => addLog('The structure in the corner. You always wondered.', '#cc66cc'), 3000);
    setTimeout(() => {
      addLog('The Launch Facility is ready.', '#cc66cc');
      colorInStation('LF', COLOR_LF_FRAME, COLOR_LF_LABEL, '#cc3333');
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
  if (isFirstSale) { addLog('Congrats on your first sale.', '#cc66cc'); logHistory('Sold the first widget.'); }
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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
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
  state.gameState = 'mt_menu';

  const TC    = '#ffd633';
  const DC    = '#333333';
  const BOX_W = 54;
  const IW    = 52;
  const AW    = 14;
  const IPW   = 37;
  const BOX_H = 24;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;

  const MT_ART = [
    '  _________   ',
    ' |  MARKET |  ',
    ' |_________|  ',
    ' | $ | $ | |  ',
    ' |---|---| |  ',
    ' | $ | $ | |  ',
    ' |___|___|_|  ',
    '   |     |    ',
    '   |     |    ',
    '  _|_____|_   ',
  ];

  function drawArtRow(r, ay) {
    const s        = MT_ART[r];
    const dollarFg = state.marketOpen ? '#66cc66' : '#555555';
    for (let i = 0; i < AW; i++) {
      let fg = '#aaaaaa';
      if (r === 1 && i >= 4 && i <= 9) fg = TC;
      if ((r === 3 || r === 5) && (i === 3 || i === 7)) fg = dollarFg;
      display.draw(BOX_X + 1 + i, ay, s[i] || ' ', fg, BG);
    }
  }

  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }

  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', fg, BG);
  }

  function crow(ay, r) {
    border(ay);
    drawArtRow(r, ay);
    display.draw(BOX_X + 1 + AW, ay, '│', DC, BG);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }

  function drp(ay, text, fg) {
    const p = menuPad(text, IPW);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }

  function arow(ay, label, cost, fg) {
    const gap  = Math.max(1, IW - label.length - (cost ? cost.length : 0));
    const line = cost ? label + ' '.repeat(gap) + cost : label;
    irow(ay, line, fg);
  }

  function redraw() {
    const widgets    = state.player.inventory.widgets;
    const price      = state.phase >= 3 ? state.marketPrice : 8.0;
    const demandMet  = state.phase >= 3 && state.widgetsSoldToday >= state.demand;
    const avail      = state.phase >= 3
      ? Math.max(0, Math.min(widgets, state.demand - state.widgetsSoldToday))
      : widgets;
    const cantSell   = avail === 0 || demandMet;
    const dl         = state.phase >= 3 ? demandLabel(state.demand) : null;
    const secsLeft   = state.marketOpen ? (180 - state.dayTick) : (240 - state.dayTick);

    // Clear interior
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);

    // Row 0: ╔═╗
    display.draw(BOX_X, BOX_Y, '╔', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);

    // Row 1: header
    { const ay = BOX_Y + 1;
      border(ay);
      const title = 'Widget Market', hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? '#f0f0f0' : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    // Row 2: ═ separator
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Rows 3-12: art + divider + info
    for (let r = 0; r < 10; r++) crow(BOX_Y + 3 + r, r);

    // Info pane
    drp(BOX_Y + 4, 'WIDGET MARKET', TC);
    if (mtMenuBlinkOn) {
      drp(BOX_Y + 5, state.marketOpen ? 'OPEN' : 'CLOSED', state.marketOpen ? '#66cc66' : '#ff5555');
    }
    drp(BOX_Y + 6, 'Widgets in hand:', '#555555');
    // Large number — 5 rows tall, starts at +7, ends at +11
    const wStr = String(widgets);
    renderLargeNumber(display, RPX, BOX_Y + 7, wStr, '#f0f0f0', IPW);
    drp(BOX_Y + 12, `Price today:  ${formatCredits(price)}cr`, TC);

    // Row 13: ─ separator
    { const ay = BOX_Y + 13; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Rows 14-15: demand section
    if (state.phase >= 3) {
      irow(BOX_Y + 14, `Demand today:  ${state.demand} widgets`, dl ? dl.fg : '#f0f0f0');
      irow(BOX_Y + 15, `Sold today:   ${state.widgetsSoldToday} / ${state.demand}`, '#555555');
    } else {
      irow(BOX_Y + 14, '', BRIGHT_WHITE);
      irow(BOX_Y + 15, '', BRIGHT_WHITE);
    }

    // Row 16: ─ separator
    { const ay = BOX_Y + 16; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Action rows 17-20
    if (!state.marketOpen) {
      irow(BOX_Y + 17, 'The market is shuttered.', '#555555');
      irow(BOX_Y + 18, 'Opens at dawn.', '#555555');
      irow(BOX_Y + 19, `Dawn in:  ${secsLeft}s`, '#cc66cc');
      arow(BOX_Y + 20, '1. Cancel', '', '#555555');
    } else if (cantSell) {
      irow(BOX_Y + 17, demandMet ? 'Daily demand satisfied. No more sales.' : 'Nothing to sell.', '#555555');
      irow(BOX_Y + 18, '', BRIGHT_WHITE);
      irow(BOX_Y + 19, '', BRIGHT_WHITE);
      arow(BOX_Y + 20, '1. Cancel', '', '#555555');
    } else {
      arow(BOX_Y + 17, '1. Sell 1', `+${formatCredits(price)}cr`, '#66cc66');
      arow(BOX_Y + 18, `2. Sell max  (${avail})`, `+${formatCredits(avail * price)}cr`, '#66cc66');
      arow(BOX_Y + 19, '3. Sell custom amount', '', '#66cc66');
      arow(BOX_Y + 20, '4. Cancel', '', '#555555');
    }

    // Row 21: ═ rule
    { const ay = BOX_Y + 21; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 22: status
    let statusText, statusFg;
    if (!state.marketOpen)  { statusText = 'Come back at dawn.'; statusFg = '#555555'; }
    else if (demandMet)     { statusText = 'Daily demand satisfied. No more sales today.'; statusFg = TC; }
    else                    { statusText = 'Sell widgets here during market hours.'; statusFg = '#555555'; }
    { const ay = BOX_Y + 22; border(ay);
      const centered = menuPad(statusText.length < IW ? ' '.repeat(Math.floor((IW - statusText.length) / 2)) + statusText : statusText, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, centered[i] || ' ', statusFg, BG); }

    // Row 23: ╚═╝
    display.draw(BOX_X, BOX_Y + 23, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 23, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 23, '═', TC, BG);
  }

  function closeMT() {
    mtMenuRedrawFn = null;
    window.removeEventListener('keydown', mtKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  function mtKeyHandler(e) {
    if (e.key === 'Escape' || e.key === '4') {
      // '4' only cancels when in the sell-capable state
      const avail = state.phase >= 3
        ? Math.max(0, Math.min(state.player.inventory.widgets, state.demand - state.widgetsSoldToday))
        : state.player.inventory.widgets;
      if (e.key === '4' && state.marketOpen && avail > 0) { closeMT(); return; }
      if (e.key === 'Escape') { closeMT(); return; }
    }
    if (!state.marketOpen) { if (e.key === '1') closeMT(); return; }

    const widgets = state.player.inventory.widgets;
    const price   = state.phase >= 3 ? state.marketPrice : 8.0;
    const demandMet = state.phase >= 3 && state.widgetsSoldToday >= state.demand;
    const avail   = state.phase >= 3
      ? Math.max(0, Math.min(widgets, state.demand - state.widgetsSoldToday))
      : widgets;
    const cantSell = avail === 0 || demandMet;

    if (cantSell) { if (e.key === '1') closeMT(); return; }

    if (e.key === '1') { sellWidgets(1); redraw(); return; }
    if (e.key === '2') { sellWidgets(avail); redraw(); return; }
    if (e.key === '3') {
      window.removeEventListener('keydown', mtKeyHandler);
      showNumericPrompt(`Sell how many? (max ${avail})`, avail,
        (n) => { sellWidgets(n); openMarketMenu(); },
        () => openMarketMenu()
      );
      return;
    }
    if (e.key === '4') { closeMT(); return; }
  }

  mtMenuRedrawFn = redraw;
  mtMenuBlinkOn  = true;
  redraw();
  window.addEventListener('keydown', mtKeyHandler);
}

// ── Office skill tree (§5.3) ──────────────────────────────────────────────────

// Carry cap and speed lookup tables indexed by skill level (§5.3)
const WORKER_CARRY_CAPS  = [3, 5, 8, 12, 16, 20];        // workerCarryLevel 0–5
const WORKER_SPEEDS      = [1.0, 1.25, 1.5, 1.75, 2.0];  // workerSpeedLevel 0–4
const COURIER_CARRY_CAPS = [10, 15, 25, 40, 60];          // courierCarryLevel 0–4
const COURIER_SPEEDS     = [1.0, 1.25, 1.5, 2.0, 2.5];   // courierSpeedLevel 0–4

const OFFICE_NODES = [
  // Apprentices — 5 separate hire tiers (credit cost)
  { key: 'apprentice1', name: 'Hire Apprentice 1', cost:   50, minPhase: 2, countKey: 'apprenticeCount', tier: 1 },
  { key: 'apprentice2', name: 'Hire Apprentice 2', cost:  100, minPhase: 2, countKey: 'apprenticeCount', tier: 2 },
  { key: 'apprentice3', name: 'Hire Apprentice 3', cost:  200, minPhase: 2, countKey: 'apprenticeCount', tier: 3 },
  { key: 'apprentice4', name: 'Hire Apprentice 4', cost:  500, minPhase: 3, countKey: 'apprenticeCount', tier: 4 },
  { key: 'apprentice5', name: 'Hire Apprentice 5', cost: 1000, minPhase: 3, countKey: 'apprenticeCount', tier: 5 },
  // Worker upgrades — scaling repeatable (costs array indexed by current level)
  { key: 'workerCarry', name: 'Increase Apprentice Inventory', levelKey: 'workerCarryLevel', costs: [40, 60, 100, 160, 250], max: 5, minPhase: 2 },
  { key: 'workerSpeed', name: 'Train Apprentice Speed',        levelKey: 'workerSpeedLevel', costs: [60, 100, 160, 250],     max: 4, minPhase: 2 },
  // Storage (unchanged)
  { key: 'storageExp1',  name: 'Storage Expansion I',  cost: 200, max: 1, minPhase: 3 },
  { key: 'storageExp2',  name: 'Storage Expansion II', cost: 500, max: 1, minPhase: 3, requires: 'storageExp1', requiresLabel: 'Expansion I' },
  { key: 'reducedCarry', name: 'Reduced Carry Cost',   cost: 300, max: 1, minPhase: 3 },
  { key: 'discountDump', name: 'Market Discount Dump', cost: 250, max: 1, minPhase: 3 },
  // Couriers — 4 separate build tiers (widget cost from storage)
  { key: 'courier1', name: 'Build Courier 1', widgetCost:  20, minPhase: 2, countKey: 'courierCount', tier: 1 },
  { key: 'courier2', name: 'Build Courier 2', widgetCost:  50, minPhase: 2, countKey: 'courierCount', tier: 2 },
  { key: 'courier3', name: 'Build Courier 3', widgetCost: 100, minPhase: 2, countKey: 'courierCount', tier: 3 },
  { key: 'courier4', name: 'Build Courier 4', widgetCost: 200, minPhase: 2, countKey: 'courierCount', tier: 4 },
  // Courier upgrades — widget cost (not credits)
  { key: 'courierCarry', name: 'Increase Courier Inventory', levelKey: 'courierCarryLevel', costs: [15, 30, 60, 100],  max: 4, minPhase: 2, widgetUpgrade: true },
  { key: 'courierSpeed', name: 'Overclock Courier Speed',    levelKey: 'courierSpeedLevel', costs: [20, 40, 80, 150],  max: 4, minPhase: 2, widgetUpgrade: true },
  // Marketing
  { key: 'demandHistory', name: 'Demand History',   cost:   50, max: 1, minPhase: 3 },
  { key: 'forecast',      name: '7-Day Forecast',   cost: 1500, max: 1, minPhase: 3 },
  { key: 'plantStory',    name: 'Plant a Story',    cost: 1500, max: 1, minPhase: 3 },
  { key: 'smearCampaign', name: 'Run a Smear',      cost: 4000, max: 1, minPhase: 3, requires: 'plantStory', requiresLabel: 'Plant a Story first' },
  // Trading
  { key: 'futures',           name: 'Futures Trading',      cost: 1000, max: 1, minPhase: 4 },
  { key: 'optionsBuy',        name: 'Options — Buy Side',   cost: 2500, max: 1, minPhase: 4 },
  { key: 'optionsWrite',      name: 'Options — Write Side', cost: 5000, max: 1, minPhase: 4, requires: 'optionsBuy', requiresLabel: 'Buy Side first' },
  { key: 'volatilitySurface', name: 'Volatility Surface',   cost: 3000, max: 1, minPhase: 4 },
];

function showOfficeMenu() {
  state.gameState = 'menu';

  // Workers tab navigation state (transient, not saved)
  let workerSel       = 0;
  let workerPageStart = 0;
  let renameMode      = false;
  let renameBuf       = '';
  let renameTarget    = -1;

  const TC    = '#aaaaaa';
  const LC    = '#ffffff';
  const DC    = '#333333';
  const BOX_W = 54;
  const IW    = 52;
  const AW    = 14;
  const IPW   = 37;
  const BOX_H = 40;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;
  const PAGE_ROWS = 21;
  const CONT_X    = BOX_X + 1;
  // Navigation state lives on `state` so it persists across redraws and is saved
  if (!state.officeTab)          state.officeTab          = 'upgrades';
  if (!state.officeUpgradesPage) state.officeUpgradesPage = 1;

  const OF_ART = [
    '  _________   ',
    ' |  OFFICE |  ',
    ' |---------|  ',
    ' | [=====] |  ',
    ' | [=====] |  ',
    ' |  _   _  |  ',
    ' | |_| |_| |  ',
    ' |_________|  ',
    '   |     |    ',
    '  _|_____|_   ',
  ];

  // LOGISTICS and TRANSPORT sections are rendered on page 1 (custom dual-panel).
  // Page 2+ uses only these sections:
  const SECTIONS = [
    { header: 'WAREHOUSING', items: [
      { k: null, label: 'Launch Facility', cost: 'AUTO', specialFn: () => state.phase >= 5 },
      { k: '8', nk: 'storageExp1'  },
      { k: '9', nk: 'storageExp2'  },
      { k: 'a', nk: 'reducedCarry' },
      { k: 'b', nk: 'discountDump' },
    ]},
    { header: 'MARKETING', items: [
      { k: 'j', nk: 'demandHistory' },
      { k: 'l', nk: 'forecast'      },
      { k: 's', nk: 'plantStory'    },
      { k: 't', nk: 'smearCampaign' },
    ]},
    { header: 'TRADING', items: [
      { k: 'm', nk: 'futures'           },
      { k: 'n', nk: 'optionsBuy'        },
      { k: 'q', nk: 'optionsWrite'      },
      { k: 'r', nk: 'volatilitySurface' },
    ]},
  ];

  function drawArtRow(r, ay) {
    const s = OF_ART[r];
    for (let i = 0; i < AW; i++) {
      let fg = TC;
      if (r === 1 && i >= 4 && i <= 9) fg = LC;                       // OFFICE
      if ((r === 3 || r === 4) && i >= 3 && i <= 9) fg = '#66ccff';   // [=====]
      if (r === 6 && ((i >= 3 && i <= 5) || (i >= 7 && i <= 9))) fg = '#555555'; // |_|
      display.draw(BOX_X + 1 + i, ay, s[i] || ' ', fg, BG);
    }
  }

  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }

  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', fg, BG);
  }

  function crow(ay, r) {
    border(ay);
    drawArtRow(r, ay);
    display.draw(BOX_X + 1 + AW, ay, '│', DC, BG);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }

  function drp(ay, text, fg) {
    const p = menuPad(text, IPW);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }

  function nodeStatus(nk) {
    const node = OFFICE_NODES.find(n => n.key === nk);
    if (!node) return { fg: DC, status: '[unknown]' };
    if (!state.officeUnlocked || state.phase < node.minPhase)
      return { fg: DC, status: `[phase ${node.minPhase}]` };

    // Count-tracked nodes (apprenticeN / courierN)
    if (node.countKey) {
      const count = state.skills[node.countKey] || 0;
      if (count >= node.tier) return { fg: '#888888', status: '[owned]' };
      if (count < node.tier - 1) return { fg: DC, status: '[locked]' };
      if (node.widgetCost != null) {
        if (state.storage.widgets < node.widgetCost)
          return { fg: '#ff5555', status: '[not enough widgets]' };
        return { fg: '#66cc66', status: '[build]' };
      }
      if (state.player.credits < node.cost)
        return { fg: '#ff5555', status: `[${Math.ceil(node.cost - state.player.credits)}cr more]` };
      return { fg: '#66cc66', status: '[available]' };
    }

    // Scaling repeatable nodes (workerCarry, workerSpeed, courierCarry, courierSpeed)
    if (node.levelKey) {
      const level = state.skills[node.levelKey] || 0;
      if (level >= node.max) return { fg: '#888888', status: '[max]' };
      const cost = node.costs[level];
      if (state.player.credits < cost)
        return { fg: '#ff5555', status: `[${Math.ceil(cost - state.player.credits)}cr more]` };
      return { fg: '#66cc66', status: '[available]' };
    }

    // Standard flat-cost nodes
    const level = state.skills[nk] || 0;
    if (node.requires && !state.skills[node.requires])
      return { fg: DC, status: `[needs ${node.requiresLabel}]` };
    if (level >= (node.max || 1))
      return { fg: '#888888', status: node.max === 1 ? '[owned]' : '[max]' };
    if (state.player.credits < node.cost)
      return { fg: '#ff5555', status: `[${Math.ceil(node.cost - state.player.credits)}cr more]` };
    return { fg: '#66cc66', status: '[available]' };
  }

  function buildSectionRows(sec) {
    const rows = [];
    const hasAvail = sec.items.some(item => {
      if (!item.nk) return false;
      const { fg } = nodeStatus(item.nk);
      return fg === '#66cc66';
    });
    rows.push({ type: 'hdr', text: `[${sec.header}]`, fg: hasAvail ? '#ffd633' : DC });
    for (const item of sec.items) {
      if (item.nk) {
        const node = OFFICE_NODES.find(n => n.key === item.nk);
        if (!node) continue;
        const { fg, status } = nodeStatus(item.nk);
        let label = node.name;
        let costStr;
        if (node.levelKey) {
          const level = state.skills[node.levelKey] || 0;
          if (level > 0) label += ` (${level}/${node.max})`;
          costStr = level < node.max ? `${node.costs[level]}cr` : '';
        } else if (node.widgetCost != null) {
          costStr = `${node.widgetCost} WG`;
        } else if (node.cost != null) {
          costStr = `${node.cost}cr`;
        } else {
          costStr = '';
        }
        rows.push({ type: 'node', k: item.k, label, cost: costStr, fg, status });
      } else {
        const owned = item.specialFn();
        rows.push({ type: 'node', k: null, label: item.label, cost: item.cost, fg: owned ? '#888888' : DC, status: owned ? '[owned]' : '[locked]' });
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
    const lbl = (label.length > 27 ? label.slice(0, 24) + '...' : label).padEnd(27);
    return (kp + lbl + ' ' + co + ' ' + st).slice(0, IW).padEnd(IW);
  }

  // ── Page 1 dual-panel render (§5.3) ──────────────────────────────────────────
  function renderOfficePage1(rowBase) {
    const LW = 25, RW = 26, DIV = 25;

    // Uniform-color dual row
    function dualRow(ay, lStr, lFg, rStr, rFg) {
      border(ay);
      const lp = menuPad(lStr, LW);
      for (let i = 0; i < LW; i++) display.draw(BOX_X + 1 + i, ay, lp[i] || ' ', lFg, BG);
      display.draw(BOX_X + 1 + DIV, ay, '│', DC, BG);
      const rp = menuPad(rStr, RW);
      for (let i = 0; i < RW; i++) display.draw(BOX_X + 1 + DIV + 1 + i, ay, rp[i] || ' ', rFg, BG);
    }

    // Split-color dual row: label in one color, value in another
    function splitRow(ay, lLbl, lVal, lLFg, lVFg, rLbl, rVal, rLFg, rVFg) {
      border(ay);
      const lFull = menuPad(lLbl + lVal, LW);
      for (let i = 0; i < LW; i++)
        display.draw(BOX_X + 1 + i, ay, lFull[i] || ' ', i < lLbl.length ? lLFg : lVFg, BG);
      display.draw(BOX_X + 1 + DIV, ay, '│', DC, BG);
      const rFull = menuPad(rLbl + rVal, RW);
      for (let i = 0; i < RW; i++)
        display.draw(BOX_X + 1 + DIV + 1 + i, ay, rFull[i] || ' ', i < rLbl.length ? rLFg : rVFg, BG);
    }

    // Raw per-cell dual row (for art rows)
    function rawRow(ay, lCells, rCells) {
      border(ay);
      for (let i = 0; i < LW; i++) {
        const c = lCells[i] || { ch: ' ', fg: DC };
        display.draw(BOX_X + 1 + i, ay, c.ch, c.fg, BG);
      }
      display.draw(BOX_X + 1 + DIV, ay, '│', DC, BG);
      for (let i = 0; i < RW; i++) {
        const c = rCells[i] || { ch: ' ', fg: DC };
        display.draw(BOX_X + 1 + DIV + 1 + i, ay, c.ch, c.fg, BG);
      }
    }

    // Figure art strings (5 chars each, row 0=head/top row 1=body row 2=legs)
    const APP_FIG = {
      working: [' o   ', '/|\\  ', '/ \\  '],
      idle:    [' o   ', ' |   ', '/ \\  '],
      empty:   [' _   ', '[ ]  ', '     '],
    };
    const COU_FIG = {
      delivering: ['[=]  ', '>>=  ', '===  '],
      idle:       ['[=]  ', ' |   ', '===  '],
      empty:      [' _   ', '[ ]  ', '     '],
    };

    // Flash colors: 3=#fff 2=theme 1=theme@60% 0=normal
    const aFlash = state.officeAnim.apprenticeFlash;
    const aFlashC = aFlash === 3 ? '#ffffff' : aFlash === 2 ? '#66ccff' : aFlash === 1 ? '#3d7a99' : null;
    const cFlash = state.officeAnim.courierFlash;
    const cFlashC = cFlash === 3 ? '#ffffff' : cFlash === 2 ? '#cc66cc' : cFlash === 1 ? '#7a3d7a' : null;

    const FIG_POS = [1, 9, 17]; // figure start columns within panel

    function buildAppFigRow(ri) {
      const cells = Array.from({ length: LW }, () => ({ ch: ' ', fg: '#222222' }));
      for (let s = 0; s < 3; s++) {
        const w = state.workers.apprentices[s];
        let type, color;
        if (!w) {
          type = 'empty'; color = '#222222';
        } else if (w.paused || w.workerState === 'idle') {
          type = 'idle'; color = aFlashC || '#333333';
        } else {
          type = 'working'; color = aFlashC || '#66ccff';
        }
        const str = APP_FIG[type][ri];
        for (let ci = 0; ci < 5; ci++) cells[FIG_POS[s] + ci] = { ch: str[ci] || ' ', fg: color };
      }
      // Overflow indicator: show "+N" after third figure slot when count > 3
      const overflow = appCount - 3;
      if (ri === 0 && overflow > 0) {
        const ovStr = '+' + overflow;
        for (let ci = 0; ci < ovStr.length && 22 + ci < LW; ci++)
          cells[22 + ci] = { ch: ovStr[ci], fg: '#555555' };
      }
      return cells;
    }

    function buildCouFigRow(ri) {
      const cells = Array.from({ length: RW }, () => ({ ch: ' ', fg: '#222222' }));
      for (let s = 0; s < 3; s++) {
        const c = state.workers.couriers[s];
        let type, color;
        if (!c) {
          type = 'empty'; color = '#222222';
        } else {
          const dlv = c.courierState === 'delivering';
          type = dlv ? 'delivering' : 'idle';
          if (cFlashC) {
            color = cFlashC;
          } else if (dlv) {
            color = ri === 0 ? '#cc66cc' : ri === 1 ? '#ffd633' : '#aaaaaa';
          } else {
            color = '#555555';
          }
        }
        const str = COU_FIG[type][ri];
        for (let ci = 0; ci < 5; ci++) cells[FIG_POS[s] + ci] = { ch: str[ci] || ' ', fg: color };
      }
      // Overflow indicator: show "+N" after third figure slot when count > 3
      const overflow = courCount - 3;
      if (ri === 0 && overflow > 0) {
        const ovStr = '+' + overflow;
        for (let ci = 0; ci < ovStr.length && 22 + ci < RW; ci++)
          cells[22 + ci] = { ch: ovStr[ci], fg: '#555555' };
      }
      return cells;
    }

    // Upgrade option info helpers — returns { n, nfg, c, cfg }
    const appCount = state.workers.apprentices.length;
    const courCount = state.workers.couriers.length;

    function appHireInfo() {
      if (appCount >= 5) return { n: '[+] Hire Another Appr.', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const node = OFFICE_NODES.find(nd => nd.countKey === 'apprenticeCount' && nd.tier === appCount + 1);
      if (!node || state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '          ', cfg: '#222222' };
      const lbl = appCount === 0 ? '[+] Hire Apprentice' : '[+] Hire Another Appr.';
      const ok = state.player.credits >= node.cost;
      return { n: lbl, nfg: ok ? '#66cc66' : '#ff5555', c: `    Cost: ${node.cost}cr`, cfg: '#555555' };
    }
    function appCarryInfo() {
      const node = OFFICE_NODES.find(nd => nd.key === 'workerCarry');
      const lv = state.skills.workerCarryLevel || 0;
      if (state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '          ', cfg: '#222222' };
      if (lv >= node.max) return { n: '[^] Appr. Inventory', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const cost = node.costs[lv];
      const ok = state.player.credits >= cost;
      return { n: '[^] Appr. Inventory', nfg: ok ? '#66cc66' : '#ff5555', c: `    Cost: ${cost}cr (${lv}/${node.max})`, cfg: '#555555' };
    }
    function appSpeedInfo() {
      const node = OFFICE_NODES.find(nd => nd.key === 'workerSpeed');
      const lv = state.skills.workerSpeedLevel || 0;
      if (state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '          ', cfg: '#222222' };
      if (lv >= node.max) return { n: '[>] Train Speed', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const cost = node.costs[lv];
      const ok = state.player.credits >= cost;
      return { n: '[>] Train Speed', nfg: ok ? '#66cc66' : '#ff5555', c: `    Cost: ${cost}cr (${lv}/${node.max})`, cfg: '#555555' };
    }
    function courBuildInfo() {
      if (courCount >= 4) return { n: '[+] Build Another Courier', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const node = OFFICE_NODES.find(nd => nd.countKey === 'courierCount' && nd.tier === courCount + 1);
      if (!node || state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '           ', cfg: '#222222' };
      const lbl = courCount === 0 ? '[+] Build Courier' : '[+] Build Another Courier';
      const wg = state.storage.widgets;
      const ok = wg >= node.widgetCost;
      const c = ok ? `    Cost: ${node.widgetCost} WG (storage)` : `Need ${node.widgetCost} WG from storage (have ${wg})`;
      return { n: lbl, nfg: ok ? '#66cc66' : '#ff5555', c, cfg: ok ? '#555555' : '#ff5555' };
    }
    function courCarryInfo() {
      const node = OFFICE_NODES.find(nd => nd.key === 'courierCarry');
      const lv = state.skills.courierCarryLevel || 0;
      if (state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '           ', cfg: '#222222' };
      if (lv >= node.max) return { n: '[^] Courier Inv.', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const cost = node.costs[lv];
      const wg = state.storage.widgets;
      const ok = wg >= cost;
      const c = ok ? `    Cost: ${cost} WG (storage)(${lv}/${node.max})` : `Need ${cost} WG from storage (have ${wg})`;
      return { n: '[^] Courier Inv.', nfg: ok ? '#66cc66' : '#ff5555', c, cfg: ok ? '#555555' : '#ff5555' };
    }
    function courSpeedInfo() {
      const node = OFFICE_NODES.find(nd => nd.key === 'courierSpeed');
      const lv = state.skills.courierSpeedLevel || 0;
      if (state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '           ', cfg: '#222222' };
      if (lv >= node.max) return { n: '[~] Overclock Speed', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const cost = node.costs[lv];
      const wg = state.storage.widgets;
      const ok = wg >= cost;
      const c = ok ? `    Cost: ${cost} WG (storage)(${lv}/${node.max})` : `Need ${cost} WG from storage (have ${wg})`;
      return { n: '[~] Overclock Speed', nfg: ok ? '#66cc66' : '#ff5555', c, cfg: ok ? '#555555' : '#ff5555' };
    }

    let r = rowBase;
    // Row 0: panel headers
    dualRow(r++, 'APPRENTICES', '#66ccff', 'COURIERS', '#cc66cc');
    // Row 1: rules
    dualRow(r++, '─'.repeat(LW), DC, '─'.repeat(RW), DC);
    // Rows 2–4: ASCII figure art (3 rows)
    for (let ai = 0; ai < 3; ai++) rawRow(r++, buildAppFigRow(ai), buildCouFigRow(ai));
    // Row 5: blank separator
    dualRow(r++, '', DC, '', DC);
    // Rows 6–8: live stats
    const appCarryVal = WORKER_CARRY_CAPS[state.skills.workerCarryLevel || 0];
    const appSpdVal   = WORKER_SPEEDS[state.skills.workerSpeedLevel || 0];
    const courCarryVal = COURIER_CARRY_CAPS[state.skills.courierCarryLevel || 0];
    const courSpdVal   = COURIER_SPEEDS[state.skills.courierSpeedLevel || 0];
    splitRow(r++, 'Hired:  ', `${appCount} / 5`,          '#555555', '#66ccff', 'Built:  ', `${courCount} / 4`,       '#555555', '#cc66cc');
    splitRow(r++, 'Carry:  ', `${appCarryVal} widgets`,   '#555555', '#66ccff', 'Carry:  ', `${courCarryVal} widgets`, '#555555', '#cc66cc');
    splitRow(r++, 'Speed:  ', `${appSpdVal.toFixed(1)} t/s`, '#555555', '#66ccff', 'Speed:  ', `${courSpdVal.toFixed(1)} t/s`, '#555555', '#cc66cc');
    // Row 9: stats separator rule
    dualRow(r++, '─'.repeat(LW), DC, '─'.repeat(RW), DC);
    // Rows 10–15: upgrade options (3 per panel × 2 rows each)
    const aH = appHireInfo(), aC = appCarryInfo(), aS = appSpeedInfo();
    const cB = courBuildInfo(), cI = courCarryInfo(), cSp = courSpeedInfo();
    dualRow(r++, aH.n, aH.nfg, cB.n, cB.nfg);
    dualRow(r++, aH.c, aH.cfg, cB.c, cB.cfg);
    dualRow(r++, aC.n, aC.nfg, cI.n, cI.nfg);
    dualRow(r++, aC.c, aC.cfg, cI.c, cI.cfg);
    dualRow(r++, aS.n, aS.nfg, cSp.n, cSp.nfg);
    dualRow(r++, aS.c, aS.cfg, cSp.c, cSp.cfg);
    // Row 16: bottom rule
    dualRow(r++, '─'.repeat(LW), DC, '─'.repeat(RW), DC);
    // Row 17: key hints
    dualRow(r++, '1:hire  2:carry  3:speed', DC, '4:build  5:inv  6:spd', DC);
    // r is now rowBase + 18
  }

  function redraw() {
    // Clear interior
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);

    // Row 0: ╔═╗
    display.draw(BOX_X, BOX_Y, '╔', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);

    // Row 1: header
    { const ay = BOX_Y + 1;
      border(ay);
      const tabLabel = state.officeTab === 'upgrades'
        ? `[UPGRADES p.${state.officeUpgradesPage}]`
        : `[WORKERS]`;
      const title = `The Office ${tabLabel}`, hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? LC : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    // Row 2: ═ separator
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 3: tab bar
    { const ay = BOX_Y + 3;
      border(ay);
      const isUpg    = state.officeTab === 'upgrades';
      const pg       = state.officeUpgradesPage;
      const upgLabel = isUpg ? `>> [ UPGRADES p.${pg} ] <<` : `[ UPGRADES ]`;
      const wrkLabel = !isUpg ? `>> [ WORKERS ] <<`           : `[ WORKERS ]`;
      const HALF     = Math.floor(IW / 2);
      const center   = (str, w) => { const pad = Math.max(0, w - str.length); const l = Math.floor(pad/2); return ' '.repeat(l) + str + ' '.repeat(pad - l); };
      const leftStr  = center(upgLabel, HALF);
      const rightStr = center(wrkLabel, IW - HALF);
      for (let i = 0; i < IW; i++) {
        const inLeft = i < HALF;
        const ch     = (inLeft ? leftStr : rightStr)[inLeft ? i : i - HALF] || ' ';
        const active = (inLeft && isUpg) || (!inLeft && !isUpg);
        display.draw(BOX_X + 1 + i, ay, ch, active ? LC : DC, BG);
      }
    }

    // Row 4: ─ separator
    { const ay = BOX_Y + 4; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Rows 5-14: building art + info pane
    for (let r = 0; r < 10; r++) crow(BOX_Y + 5 + r, r);
    drp(BOX_Y + 6, 'THE OFFICE', LC);
    drp(BOX_Y + 7, 'Credits available:', '#555555');
    const crStr = String(Math.floor(state.player.credits));
    renderLargeNumber(display, RPX, BOX_Y + 8, crStr, '#ffd633', IPW);
    drp(BOX_Y + 13, `Phase:  ${state.phase}`, '#555555');
    drp(BOX_Y + 14, `Lifetime:  ${formatCredits(state.lifetimeCreditsEarned)}cr`, '#555555');

    // Row 15: ─ separator
    { const ay = BOX_Y + 15; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    if (state.officeTab === 'upgrades') {
      if (state.officeUpgradesPage === 1) {
        // Custom dual-panel page 1
        renderOfficePage1(BOX_Y + 16);
        // Blank remaining PAGE_ROWS rows (18 used of 21)
        for (let i = 18; i < PAGE_ROWS; i++) {
          const ay = BOX_Y + 16 + i;
          border(ay);
          for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, ay, ' ', BRIGHT_WHITE, BG);
        }
      } else {
        // Pages 2+ — SECTIONS-based (WAREHOUSING, MARKETING, TRADING)
        const pages = getPages();
        const secPageCount = pages.length;
        if (state.officeUpgradesPage > 1 + secPageCount) state.officeUpgradesPage = 2;
        const pg = pages[state.officeUpgradesPage - 2] || [];

        for (let i = 0; i < pg.length && i < PAGE_ROWS; i++) {
          const row = pg[i];
          const ay  = BOX_Y + 16 + i;
          if (row.type === 'blank') { border(ay); continue; }
          if (row.type === 'hdr')   { irow(ay, row.text, row.fg); }
          else                      { irow(ay, menuLine(row.k, row.label, row.cost, row.status), row.fg); }
        }
        for (let i = pg.length; i < PAGE_ROWS; i++) {
          const ay = BOX_Y + 16 + i;
          border(ay);
          for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, ay, ' ', BRIGHT_WHITE, BG);
        }
      }

      // Row 37: ─ separator
      { const ay = BOX_Y + 37; border(ay);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

      // Row 38: footer
      const secPageCount2 = Math.max(1, getPages().length);
      const totalPages    = 1 + secPageCount2;
      let footer;
      if (state.officeUpgradesPage === 1) {
        footer = `[ page 1/${totalPages} — TAB for next page ]`;
      } else {
        const allOwned = SECTIONS.every(sec => sec.items.every(item => {
          if (!item.nk) return true;
          return nodeStatus(item.nk).fg === '#888888';
        }));
        footer = allOwned
          ? `[ page ${state.officeUpgradesPage}/${totalPages} — All complete. TAB to cycle ]`
          : `[ page ${state.officeUpgradesPage}/${totalPages} — TAB to cycle ]`;
      }
      { const ay = BOX_Y + 38; border(ay);
        const centered = menuPad(footer.length < IW ? ' '.repeat(Math.floor((IW - footer.length) / 2)) + footer : footer, IW);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, centered[i] || ' ', DC, BG); }

    } else { // WORKERS tab
      const allW = [
        ...state.workers.apprentices.map((w, i) => ({ type: 'appr', idx: i, w })),
        ...state.workers.couriers.map((c, i)    => ({ type: 'cour', idx: i, w: c })),
      ];
      const nW = allW.length;
      const PER_PAGE = Math.floor(PAGE_ROWS / 4); // 5 workers visible at once
      workerSel        = Math.max(0, Math.min(workerSel, nW - 1));
      if (nW > 0 && workerSel < workerPageStart) workerPageStart = workerSel;
      if (nW > 0 && workerSel >= workerPageStart + PER_PAGE) workerPageStart = workerSel - PER_PAGE + 1;
      workerPageStart  = Math.max(0, Math.min(workerPageStart, Math.max(0, nW - PER_PAGE)));

      // Clear content rows
      for (let r = 0; r < PAGE_ROWS; r++) {
        border(BOX_Y + 16 + r);
        for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + 16 + r, ' ', BRIGHT_WHITE, BG);
      }

      if (nW === 0) {
        irow(BOX_Y + 16 + Math.floor(PAGE_ROWS / 2), 'No workers hired.', DC);
      } else {
        const carryMax     = WORKER_CARRY_CAPS[state.skills.workerCarryLevel || 0];
        const courCarryMax = COURIER_CARRY_CAPS[state.skills.courierCarryLevel || 0];
        const STATE_COLOR  = { fetching:'#ff9933', crafting:'#ff6600', returning:'#555555', idle:'#333333', loading:'#cc66cc', delivering:'#ffd633' };
        let contentRow = 0;

        // Scroll-up indicator
        if (workerPageStart > 0) {
          irow(BOX_Y + 16 + contentRow, menuPad('  ▲ more above', IW), DC);
          contentRow++;
        }

        for (let wi = workerPageStart; wi < Math.min(workerPageStart + PER_PAGE, nW); wi++) {
          const { type, idx, w } = allW[wi];
          const isSel = wi === workerSel;
          const base  = BOX_Y + 16 + contentRow;

          // Row 0: rule
          const ruleFg = isSel ? '#666666' : DC;
          { border(base); const rule = menuPad('─'.repeat(IW), IW); for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, base, rule[i], ruleFg, BG); }

          // Row 1: info
          const label    = workerLabel(w, idx, type).slice(0, 12).padEnd(12);
          const selMark  = isSel ? '>' : ' ';
          const glyph    = type === 'appr' ? '[a]' : '[c]';
          const glyphFg  = type === 'appr' ? (w.workerState && w.workerState !== 'idle' ? '#66ccff' : '#333333')
                                            : (w.courierState && w.courierState !== 'idle' ? '#cc66cc' : '#333333');
          const rawState = type === 'appr' ? (w.paused ? 'PAUSED' : w.workerState || 'idle') : (w.courierState || 'idle');
          const stateFg  = w.paused ? '#ff5555' : (STATE_COLOR[rawState] || '#333333');
          const stateStr = rawState.toUpperCase().slice(0, 10).padEnd(10);
          const posStr   = `(${w.x},${w.y})`;
          const infoLine = `${selMark}${glyph} ${label}  ${stateStr}${posStr}`;
          { border(base + 1);
            const padded = menuPad(infoLine, IW);
            for (let i = 0; i < IW; i++) {
              let fg = BRIGHT_WHITE;
              if (i === 0) fg = isSel ? '#ffd633' : DC;
              else if (i >= 1 && i <= 3) fg = glyphFg;
              else if (i >= 5 && i <= 16) fg = isSel ? LC : BRIGHT_WHITE;
              else if (i >= 19 && i <= 28) fg = stateFg;
              else if (i >= 29) fg = '#333333';
              display.draw(BOX_X + 1 + i, base + 1, padded[i] || ' ', fg, BG);
            }
          }

          // Row 2: stats
          let statsLine;
          if (type === 'appr') {
            const task = w.workerState === 'fetching' ? 'RM→WB' : w.workerState === 'crafting' ? 'making widget' : w.workerState === 'returning' ? 'WB→STG' : 'waiting';
            statsLine = `    Carry: ${w.carryRM}/${carryMax}   Speed: ${WORKER_SPEEDS[state.skills.workerSpeedLevel||0].toFixed(1)}   ${task}`;
          } else {
            const task = w.courierState === 'loading' ? 'at STG' : w.courierState === 'delivering' ? 'STG→MKT' : w.courierState === 'returning' ? 'MKT→STG' : 'waiting';
            statsLine = `    Carry: ${w.carryWidgets}/${courCarryMax}   Speed: ${COURIER_SPEEDS[state.skills.courierSpeedLevel||0].toFixed(1)}   ${task}`;
          }
          irow(base + 2, statsLine, '#555555');

          // Row 3: hints
          const hintLine = isSel
            ? (type === 'appr' ? '    [1:pause/resume]  [2:rename]  [↑↓:navigate]' : '    [2:rename]  [↑↓:navigate]')
            : '    ↑↓ to select';
          irow(base + 3, hintLine, DC);

          contentRow += 4;
        }

        // Scroll-down indicator
        if (workerPageStart + PER_PAGE < nW) {
          const lastRow = BOX_Y + 16 + Math.min(contentRow, PAGE_ROWS - 1);
          irow(lastRow, menuPad('  ▼ more below', IW), DC);
        }
      }

      { const ay = BOX_Y + 37; border(ay);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }
      // Row 38: footer or rename prompt
      { const ay = BOX_Y + 38; border(ay);
        let line;
        if (renameMode) {
          const displayBuf = renameBuf.slice(0, 14).padEnd(14, '_');
          line = menuPad(`Rename: [${displayBuf}]  Enter/Esc`, IW);
        } else {
          line = menuPad(nW > 0 ? '← →: tabs   ↑↓: select   1:pause  2:rename  ESC' : '← →: switch to UPGRADES tab', IW);
        }
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, line[i] || ' ', renameMode ? '#ffd633' : DC, BG); }
    }

    // Row 39: ╚═╝
    display.draw(BOX_X, BOX_Y + 39, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 39, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 39, '═', TC, BG);
  }

  officeMenuRedrawFn = redraw;
  redraw();

  function closeOffice() {
    officeMenuRedrawFn = null;
    window.removeEventListener('keydown', officeKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  function officeKeyHandler(e) {
    if (e.key === 'Escape') { closeOffice(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (state.officeTab === 'upgrades') { state.officeTab = 'workers'; redraw(); } return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); if (state.officeTab === 'workers')  { state.officeTab = 'upgrades'; redraw(); } return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (state.officeTab === 'upgrades') {
        const secPageCount = Math.max(1, getPages().length);
        const totalPages   = 1 + secPageCount;
        state.officeUpgradesPage = (state.officeUpgradesPage % totalPages) + 1;
        redraw();
      }
      return;
    }

    if (state.officeTab === 'workers') {
      const allW = [
        ...state.workers.apprentices.map((w, i) => ({ type: 'appr', idx: i, w })),
        ...state.workers.couriers.map((c, i)    => ({ type: 'cour', idx: i, w: c })),
      ];

      // Rename mode captures all input
      if (renameMode) {
        if (e.key === 'Enter') {
          if (renameTarget >= 0 && renameTarget < allW.length)
            allW[renameTarget].w.nickname = renameBuf.trim();
          renameMode = false; renameBuf = ''; renameTarget = -1;
          redraw();
        } else if (e.key === 'Escape') {
          renameMode = false; renameBuf = ''; renameTarget = -1; redraw();
        } else if (e.key === 'Backspace') {
          renameBuf = renameBuf.slice(0, -1); redraw();
        } else if (e.key.length === 1 && renameBuf.length < 14) {
          renameBuf += e.key; redraw();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        workerSel = Math.min(workerSel + 1, Math.max(0, allW.length - 1));
        redraw(); return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        workerSel = Math.max(0, workerSel - 1);
        redraw(); return;
      }
      if (e.key === '1' && allW[workerSel] && allW[workerSel].type === 'appr') {
        const { idx, w } = allW[workerSel];
        w.paused = !w.paused;
        addLog(`${workerLabel(w, idx, 'appr')} ${w.paused ? 'paused' : 'resumed'}.`, '#66ccff');
        redraw(); return;
      }
      if (e.key === '2' && allW[workerSel]) {
        renameMode = true;
        renameBuf  = allW[workerSel].w.nickname || '';
        renameTarget = workerSel;
        redraw(); return;
      }
      return;
    }

    // ── UPGRADES tab ──────────────────────────────────────────────────────────
    if (state.officeTab === 'upgrades' && state.officeUpgradesPage === 1) {
      // Page 1: keys 1-6 for apprentice/courier actions
      if (e.key === '1') {
        const count = state.skills.apprenticeCount;
        if (count >= 5) return;
        const node = OFFICE_NODES.find(n => n.countKey === 'apprenticeCount' && n.tier === count + 1);
        if (!node || !state.officeUnlocked || state.phase < node.minPhase) return;
        if (state.player.credits < node.cost) return;
        state.player.credits -= node.cost;
        state.skills.apprenticeCount = count + 1;
        const ofDef = STATION_DEFS.find(s => s.label === 'OF');
        state.workers.apprentices.push({ x: ofDef.x+1, y: ofDef.y+2, workerState: 'idle', carryRM: 0, carryWidgets: 0, target: {x:0,y:0}, craftTimer: 0, paused: false, nickname: '' });
        addLog('Apprentice hired.', '#cc66cc');
        state.officeAnim.apprenticeFlash = 3;
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '2') {
        const node = OFFICE_NODES.find(n => n.key === 'workerCarry');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.workerCarryLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (state.player.credits < cost) return;
        state.player.credits -= cost;
        state.skills.workerCarryLevel = lv + 1;
        addLog(`> Increase Apprentice Inventory level ${lv + 1}.`, '#cc66cc');
        state.officeAnim.apprenticeFlash = 3;
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '3') {
        const node = OFFICE_NODES.find(n => n.key === 'workerSpeed');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.workerSpeedLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (state.player.credits < cost) return;
        state.player.credits -= cost;
        state.skills.workerSpeedLevel = lv + 1;
        addLog(`> Train Apprentice Speed level ${lv + 1}.`, '#cc66cc');
        state.officeAnim.apprenticeFlash = 3;
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '4') {
        const count = state.skills.courierCount;
        if (count >= 4) return;
        const node = OFFICE_NODES.find(n => n.countKey === 'courierCount' && n.tier === count + 1);
        if (!node || !state.officeUnlocked || state.phase < node.minPhase) return;
        if (state.storage.widgets < node.widgetCost) {
          addLog(`Not enough widgets. Need ${node.widgetCost} WG.`, '#ff5555');
          redraw(); return;
        }
        state.storage.widgets -= node.widgetCost; // cost deducted from state.storage.widgets
        state.skills.courierCount = count + 1;
        const ofDef = STATION_DEFS.find(s => s.label === 'OF');
        state.workers.couriers.push({ x: ofDef.x+1, y: ofDef.y+2, courierState: 'idle', carryWidgets: 0, target: {x:0,y:0}, nickname: '' });
        state.couriersOwned++;
        addLog(`> ${node.widgetCost} widgets consumed. Courier built.`, '#cc66cc');
        state.officeAnim.courierFlash = 3;
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '5') {
        const node = OFFICE_NODES.find(n => n.key === 'courierCarry');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.courierCarryLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (state.storage.widgets < cost) {
          addLog(`Not enough widgets. Need ${cost} WG.`, '#ff5555');
          redraw(); return;
        }
        state.storage.widgets -= cost; // cost deducted from state.storage.widgets
        state.skills.courierCarryLevel = lv + 1;
        addLog(`> ${cost} widgets consumed. Increase Courier Inventory purchased.`, '#cc66cc');
        state.officeAnim.courierFlash = 3;
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '6') {
        const node = OFFICE_NODES.find(n => n.key === 'courierSpeed');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.courierSpeedLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (state.storage.widgets < cost) {
          addLog(`Not enough widgets. Need ${cost} WG.`, '#ff5555');
          redraw(); return;
        }
        state.storage.widgets -= cost; // cost deducted from state.storage.widgets
        state.skills.courierSpeedLevel = lv + 1;
        addLog(`> ${cost} widgets consumed. Overclock Courier Speed purchased.`, '#cc66cc');
        state.officeAnim.courierFlash = 3;
        drawStatusBar(); redraw(); return;
      }
      return; // page 1 consumes all keys — don't fall through
    }

    // Pages 2+: SECTIONS-based key handlers
    for (const sec of SECTIONS) {
      for (const item of sec.items) {
        if (!item.k || item.k !== e.key || !item.nk) continue;
        const node = OFFICE_NODES.find(n => n.key === item.nk);
        if (!node || !state.officeUnlocked || state.phase < node.minPhase) return;

        // Standard flat-cost nodes
        if (node.requires && !state.skills[node.requires]) return;
        const level = state.skills[item.nk] || 0;
        if (level >= (node.max || 1) || state.player.credits < node.cost) return;
        state.player.credits -= node.cost;
        state.skills[item.nk] = level + 1;
        if (item.nk === 'storageExp1') { state.storage.widgetCap = 100; state.storage.rmCap = 100; }
        if (item.nk === 'storageExp2') { state.storage.widgetCap = 200; state.storage.rmCap = 200; }
        addLog(`${node.name} purchased.`, '#cc66cc');
        drawStatusBar(); redraw(); return;
      }
    }
  }
  window.addEventListener('keydown', officeKeyHandler);
}

// ── Stamps currency helpers (§13) ─────────────────────────────────────────────

let stampMsgRecent = [];

function pickStampMsg() {
  const pool = [
    '> You find a stamp caught in the fence post.',
    '> A stamp blows past. You catch it.',
    '> Someone left a stamp under the workbench.',
    '> You find a stamp on the path. Still good.',
    '> There\'s a stamp wedged in the market doorframe.',
    '> A stamp falls from somewhere above you.',
    '> You notice a stamp half-buried in the dirt.',
    '> A stamp was folded into your pocket at some point.',
    '> There is a stamp on the ground near the shed.',
    '> A stamp is stuck to the bottom of your boot.',
    '> You find a stamp between two floorboards.',
    '> A stamp rests in the hollow of the old tree.',
    '> Someone has left a stamp on the market counter.',
  ];
  if (state.cottage.owned)            pool.push('> You find a stamp under the rug in your cottage.');
  if (state.cottage.furniture?.cat)   pool.push('> Your cat knocks a stamp off the bookshelf.');
  const available = pool.filter(m => !stampMsgRecent.includes(m));
  const pick = (available.length > 0 ? available : pool)[Math.floor(Math.random() * (available.length || pool.length))];
  stampMsgRecent.push(pick);
  if (stampMsgRecent.length > 6) stampMsgRecent.shift();
  return pick;
}

function awardStamp(amount, announce) {
  state.player.stamps += amount;
  if (announce) addLog(pickStampMsg(), COLOR_STAMPS);
  if (state.gameState === 'inventory' && inventoryRedrawFn) inventoryRedrawFn();
}

function handlePonder() {
  const inv = state.player.inventory;
  let hint;
  // Phase 5 — rocket hints
  if (state.phase >= 5) {
    const rw = state.rocketWidgets;
    if (rw >= 50000) { hint = 'The rocket is ready. [launch sequence coming soon]'; }
    else if (state.courierDestination === 'market') { hint = 'The rocket waits. Credits won\'t matter where it\'s going.'; }
    else if (rw >= 45000) { hint = 'Almost. Everything you built was for this.'; }
    else if (rw >= 25000) { hint = 'Over halfway. You can feel something building.'; }
    else if (rw >= 5000)  { hint = 'You are committed now.'; }
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

  // Newspaper hints (§13)
  if (state.phase >= 3 && state.stations.newspaper?.unlocked) {
    const np = state.stations.newspaper;
    if (np.pendingManipulation) {
      wrapLog('> Tomorrow\'s headline is already written.', '#ccaa44'); return;
    } else if (state.skills.plantStory) {
      const onCooldown = (state.day - np.lastManipulationDay) < 3;
      if (!onCooldown) { wrapLog('> The press is ready. The market is listening.', '#ccaa44'); return; }
    } else {
      wrapLog('> The paper prints what it\'s given. For now.', '#ccaa44'); return;
    }
  }

  // Phase 3 urgent hints first
  if (state.phase >= 3 && state.bank.card?.owned && state.bank.card.missedPayments > 0) {
    hint = 'The bank noted a missed payment. It won\'t forget.';
  } else if (state.phase >= 3 && state.bank.card?.owned && state.bank.card.balance > state.bank.card.limit * 0.8) {
    hint = 'The card is nearly maxed. Every day you carry it, interest compounds.';
  } else if (state.phase >= 3 && getBankRatingIdx() <= 2) {
    hint = 'Your credit record is showing strain. The bank has noticed.';
  } else if (state.phase >= 3 && getBankRatingIdx() >= 6) {
    hint = 'Strong fundamentals. The bank will lend on better terms now.';
  } else if (state.phase >= 3 && state.bank.loan && (state.bank.loan.deadline - state.day) <= 5) {
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
  } else if (state.player.credits >= 500 && !(state.skills.endurance?.pips) && !(state.skills.aquatics?.purchased) && !(state.skills.interfacing?.pips)) {
    hint = 'You wonder if there\'s more to you than widgets.';
  } else if (state.cottage.owned && !state.cottage.visited) {
    hint = 'Your cottage is waiting. The door is open.';
    wrapLog(hint, '#aa66ff'); return;
  } else if (state.phase >= 2 && state.player.color === '#f0f0f0' && state.player.credits >= 100) {
    hint = 'The shop on the south-west corner has its light on.';
    wrapLog(hint, '#aa66ff'); return;
  } else if (state.skills.aquatics?.purchased && (state.stats.pondStepsWalked || 0) === 0) {
    hint = 'The pond looks different now.';
  } else if ((state.skills.interfacing?.pips || 0) >= 3) {
    hint = 'The workbench is a formality at this point.';
  } else {
    hint = 'Keep working. The numbers will move.';
  }
  wrapLog(hint, '#66ccff');
}

// ── Interior state (§4.2) ────────────────────────────────────────────────────
let interiorTileMap  = [];     // [x][y] = {walkable, glyph, fg, description, furniture}
let fireplaceFrame   = 0;      // 0 or 1
let candlePhase      = false;  // toggles glow dot
let cottageLookActive = false;
let cottageLookX     = 1;
let cottageLookY     = 1;
let bookshelfOverlayActive = false;

// Outfit definitions — ten purchasable colors for the player @ glyph
const OUTFITS = [
  { key: 'crimson', name: 'CRIMSON', color: '#cc2233' },
  { key: 'cobalt',  name: 'COBALT',  color: '#2255cc' },
  { key: 'amber',   name: 'AMBER',   color: '#cc7700' },
  { key: 'forest',  name: 'FOREST',  color: '#226622' },
  { key: 'rose',    name: 'ROSE',    color: '#cc5588' },
  { key: 'slate',   name: 'SLATE',   color: '#667788' },
  { key: 'gold',    name: 'GOLD',    color: '#ccaa00' },
  { key: 'teal',    name: 'TEAL',    color: '#229988' },
  { key: 'ivory',   name: 'IVORY',   color: '#ddddcc' },
  { key: 'violet',  name: 'VIOLET',  color: '#8844cc' },
];

// HOME GOODS catalog (§4.2) — 12 purchasable items in order A–L. Prices in stamps (§13).
const FURNITURE_DEFS = [
  { key: 'cottage',      name: 'COTTAGE',       price: 150, glyph: '⌂', color: '#886633' },
  { key: 'rug',          name: 'BRAIDED RUG',   price:   8, glyph: '≈', color: '#886633' },
  { key: 'table',        name: 'WOODEN TABLE',  price:  12, glyph: '=', color: '#aa7744' },
  { key: 'fireplace',    name: 'FIREPLACE',     price:  32, glyph: '{', color: '#ff9933' },
  { key: 'bookshelf',    name: 'BOOKSHELF',     price:  20, glyph: '[', color: '#886633' },
  { key: 'clock',        name: 'CLOCK',         price:   8, glyph: 'o', color: '#aaaaaa' },
  { key: 'cat',          name: 'PET (CAT)',     price:  24, glyph: 'f', color: '#cc9933' },
  { key: 'kitchen',      name: 'KITCHEN',       price:  36, glyph: '#', color: '#aaaaaa' },
  { key: 'bed',          name: 'BED',           price:  24, glyph: 'z', color: '#6688cc' },
  { key: 'candles',      name: 'CANDLES',       price:   4, glyph: 'i', color: '#ffd633' },
  { key: 'rockingchair', name: 'ROCKING CHAIR', price:  12, glyph: '~', color: '#aa7744' },
  { key: 'mat',          name: 'WELCOME MAT',   price:   8, glyph: '-', color: '#aa7744' },
];

function openGeneralStoreMenu() {
  if (!state.stations.general_store?.unlocked) return;
  state.gameState = 'menu';

  const TC    = '#aa66ff';
  const DC    = '#333333';
  const LC    = '#ffffff';
  const AC    = '#cc99ff';
  const BOX_W = 54;
  const IW    = 52;
  const AW    = 14;
  const IPW   = 37;
  const BOX_H = 25;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;

  let gsTab = 'clothing'; // 'clothing' | 'home_goods'

  const GS_ART = [
    '  +--------+  ', ' /  GENERAL\\ ', '/    STORE  \\ ',
    '  |--------|  ', '  | [~~~~] |  ', '  | [~~~~] |  ',
    '  | [~~~~] |  ', '  |--------|  ', '  +--------+  ', '              ',
  ];
  function drawArtRow(r, ay) {
    const s = GS_ART[r];
    for (let i = 0; i < AW; i++) {
      let fg = TC;
      if (r===1&&i>=4&&i<=10) fg=AC; if (r===2&&i>=5&&i<=9) fg=AC;
      if (r>=4&&r<=6&&i>=5&&i<=8) fg=OUTFITS[(state.tick+(r-4))%OUTFITS.length].color;
      display.draw(BOX_X+1+i, ay, s[i]||' ', fg, BG);
    }
  }
  function border(ay) { display.draw(BOX_X,ay,'║',TC,BG); display.draw(BOX_X+BOX_W-1,ay,'║',TC,BG); }
  function crow(ay,r) { border(ay); drawArtRow(r,ay); display.draw(BOX_X+1+AW,ay,'│',DC,BG); for(let i=0;i<IPW;i++) display.draw(RPX+i,ay,' ',BRIGHT_WHITE,BG); }
  function drp(ay,text,fg) { const p=menuPad(text,IPW); for(let i=0;i<IPW;i++) display.draw(RPX+i,ay,p[i]||' ',fg,BG); }

  function drawOutfitCell(cx, ay, outfit, idx) {
    const letter=('abcdefghij')[idx], owned=state.player.ownedOutfits.includes(outfit.key), equipped=state.player.colorName===outfit.name, canAfford=state.player.stamps>=10;
    let marker=' ',markerFg=BRIGHT_WHITE,bracketFg=canAfford?TC:DC;
    if(equipped){marker='»';markerFg=LC;bracketFg=LC;}else if(owned){marker='✓';markerFg='#66cc66';bracketFg=TC;}
    const nameFg=equipped?LC:(owned?'#aaaaaa':(canAfford?'#aaaaaa':'#555555'));
    const name13=outfit.name.padEnd(13);
    display.draw(cx,ay,letter,equipped?LC:'#555555',BG); display.draw(cx+1,ay,')','#555555',BG); display.draw(cx+2,ay,' ',BRIGHT_WHITE,BG);
    display.draw(cx+3,ay,'[',bracketFg,BG); display.draw(cx+4,ay,'@',outfit.color,BG); display.draw(cx+5,ay,' ',BRIGHT_WHITE,BG);
    for(let i=0;i<13;i++) display.draw(cx+6+i,ay,name13[i],nameFg,BG);
    display.draw(cx+19,ay,' ',BRIGHT_WHITE,BG); display.draw(cx+20,ay,marker,markerFg,BG); display.draw(cx+21,ay,' ',BRIGHT_WHITE,BG); display.draw(cx+22,ay,']',bracketFg,BG);
    return cx+23;
  }

  function drawHGCell(cx, ay, item, letter) {
    const isCottage = item.key === 'cottage';
    const owned     = isCottage ? state.cottage.owned : !!state.cottage.furniture[item.key];
    const locked    = !isCottage && !state.cottage.owned;
    const canAfford = state.player.stamps >= item.price;
    const letterFg  = owned ? '#888888' : (canAfford && !locked ? TC : '#555555');
    display.draw(cx,  ay, letter,  letterFg, BG);
    display.draw(cx+1,ay, ')',     '#555555', BG);
    display.draw(cx+2,ay, ' ',    BRIGHT_WHITE, BG);
    const name13 = item.name.padEnd(13).slice(0, 13);
    const nameFg = owned ? '#888888' : (locked ? '#444444' : (canAfford ? '#aaaaaa' : '#666666'));
    for (let i = 0; i < 13; i++) display.draw(cx+3+i, ay, name13[i]||' ', nameFg, BG);
    if (owned) {
      if (isCottage) { const s='VISIT  '; for(let i=0;i<7;i++) display.draw(cx+16+i,ay,s[i],TC,BG); }
      else { display.draw(cx+16,ay,'✓','#66cc66',BG); for(let i=1;i<7;i++) display.draw(cx+16+i,ay,' ',BRIGHT_WHITE,BG); }
    } else {
      const priceStr = (item.price+' ·').padStart(7);
      const priceFg  = locked ? '#444444' : (canAfford ? '#66cc66' : '#ff5555');
      for (let i=0;i<7;i++) display.draw(cx+16+i,ay,priceStr[i]||' ',priceFg,BG);
    }
  }

  function redraw() {
    for(let r=1;r<BOX_H-1;r++) for(let x=1;x<BOX_W-1;x++) display.draw(BOX_X+x,BOX_Y+r,' ',BRIGHT_WHITE,BG);
    // Row 0
    display.draw(BOX_X,BOX_Y,'╔',TC,BG); display.draw(BOX_X+BOX_W-1,BOX_Y,'╗',TC,BG);
    for(let i=1;i<BOX_W-1;i++) display.draw(BOX_X+i,BOX_Y,'═',TC,BG);
    // Row 1: header
    { const ay=BOX_Y+1; border(ay);
      const title='GENERAL STORE',hint='press esc to exit';
      for(let i=0;i<IW;i++){const ch=i<title.length?title[i]:(i>=IW-hint.length?hint[i-(IW-hint.length)]:'');const fg=i<title.length?LC:(i>=IW-hint.length?DC:BRIGHT_WHITE);display.draw(BOX_X+1+i,ay,ch||' ',fg,BG);} }
    // Row 2: ═
    { const ay=BOX_Y+2; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,'═',DC,BG); }
    // Row 3: tab bar
    { const ay=BOX_Y+3; border(ay);
      const LEFT='[ CLOTHING ]',RIGHT='[ HOME GOODS ]';
      const lp=Math.floor((25-LEFT.length)/2), rp=Math.floor((26-RIGHT.length)/2);
      for(let i=0;i<25;i++){const ci=i-lp;const ch=(ci>=0&&ci<LEFT.length)?LEFT[ci]:' ';const fg=(gsTab==='clothing'&&ch!==' ')?TC:DC;display.draw(BOX_X+1+i,ay,ch,fg,BG);}
      display.draw(BOX_X+26,ay,'│',DC,BG);
      for(let i=0;i<26;i++){const ci=i-rp;const ch=(ci>=0&&ci<RIGHT.length)?RIGHT[ci]:' ';const fg=(gsTab==='home_goods'&&ch!==' ')?TC:DC;display.draw(BOX_X+27+i,ay,ch,fg,BG);}
    }
    // Row 4: ─
    { const ay=BOX_Y+4; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,'─',DC,BG); }
    // Rows 5-14: art
    for(let r=0;r<10;r++) crow(BOX_Y+5+r,r);
    // Stamp balance in art pane last row (r=9, BOX_Y+14)
    { const ay=BOX_Y+14; const stStr = `Stamps:${state.player.stamps} ·`.slice(0,AW);
      for(let i=0;i<AW;i++) display.draw(BOX_X+1+i, ay, stStr[i]||' ', COLOR_STAMPS, BG); }
    // Right pane
    if(gsTab==='clothing'){
      drp(BOX_Y+6,'CLOTHING SHOP',TC); drp(BOX_Y+7,'Change your look.','#555555');
      drp(BOX_Y+9,'Each item: 10 stamps','#555555'); drp(BOX_Y+11,'Current look:','#555555');
      { const ay=BOX_Y+12; const cn=(state.player.colorName==='DEFAULT')?'default white':state.player.colorName.toLowerCase();
        drp(ay,`@ ${cn}`,'#555555'); display.draw(RPX,ay,'@',state.player.color||BRIGHT_WHITE,BG); }
    } else {
      drp(BOX_Y+6,'HOME GOODS',TC); drp(BOX_Y+7,'Items for a life well-built.','#555555');
      drp(BOX_Y+9,'Buy items A–L below.','#555555');
      drp(BOX_Y+10,'Cottage required for B–L.','#555555');
      if(state.cottage.owned) drp(BOX_Y+12,'Cottage: OWNED','#66cc66');
      else drp(BOX_Y+12,'Cottage: not yet','#555555');
    }
    // Row 15: ─
    { const ay=BOX_Y+15; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,'─',DC,BG); }
    // Rows 16-21: grid (6 rows)
    const letters='abcdefghijkl';
    if(gsTab==='clothing'){
      for(let row=0;row<5;row++){
        const ay=BOX_Y+16+row; border(ay);
        let cx=BOX_X+3;
        cx=drawOutfitCell(cx,ay,OUTFITS[row*2],row*2); cx+=2;
        cx=drawOutfitCell(cx,ay,OUTFITS[row*2+1],row*2+1);
        while(cx<BOX_X+1+IW) display.draw(cx++,ay,' ',BRIGHT_WHITE,BG);
      }
      { const ay=BOX_Y+21; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,' ',BRIGHT_WHITE,BG); }
    } else {
      for(let row=0;row<6;row++){
        const ay=BOX_Y+16+row; border(ay);
        const li=row*2, ri=row*2+1;
        for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,' ',BRIGHT_WHITE,BG);
        if(li<FURNITURE_DEFS.length) drawHGCell(BOX_X+3,ay,FURNITURE_DEFS[li],letters[li]);
        if(ri<FURNITURE_DEFS.length) drawHGCell(BOX_X+28,ay,FURNITURE_DEFS[ri],letters[ri]);
      }
    }
    // Row 22: ═
    { const ay=BOX_Y+22; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,'═',DC,BG); }
    // Row 23: footer
    { const ay=BOX_Y+23; border(ay);
      const txt=gsTab==='clothing'?'a–j: buy/equip  →: home goods  ESC: exit':'a–l: buy/visit  ←: clothing  ESC: exit';
      const pad=' '.repeat(Math.max(0,Math.floor((IW-txt.length)/2)));
      const padded=menuPad(pad+txt,IW);
      for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,padded[i]||' ','#555555',BG); }
    // Row 24: ╚═╝
    display.draw(BOX_X,BOX_Y+24,'╚',TC,BG); display.draw(BOX_X+BOX_W-1,BOX_Y+24,'╝',TC,BG);
    for(let i=1;i<BOX_W-1;i++) display.draw(BOX_X+i,BOX_Y+24,'═',TC,BG);
  }

  gsMenuRedrawFn = redraw;
  redraw();

  function closeGS() {
    gsMenuRedrawFn = null;
    window.removeEventListener('keydown', gsKeyHandler);
    for(let y=BOX_Y;y<BOX_Y+BOX_H;y++) for(let x=BOX_X;x<BOX_X+BOX_W;x++) if(x>=0&&x<DISPLAY_WIDTH&&y>=0&&y<WORLD_ROWS) markDirty(x,y);
    renderDirty();
    display.draw(state.player.x,state.player.y,'@',state.player.color||BRIGHT_WHITE,BG);
    state.gameState='playing';
  }

  function gsKeyHandler(e) {
    if (e.key === 'Escape') { closeGS(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (gsTab === 'clothing') { gsTab = 'home_goods'; redraw(); } return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); if (gsTab === 'home_goods') { gsTab = 'clothing'; redraw(); } return; }

    if (gsTab === 'home_goods') {
      const idx = 'abcdefghijkl'.indexOf(e.key);
      if (idx < 0 || !FURNITURE_DEFS[idx]) return;
      const item = FURNITURE_DEFS[idx];
      const isCottage = item.key === 'cottage';
      const owned = isCottage ? state.cottage.owned : !!state.cottage.furniture[item.key];
      if (owned) {
        if (isCottage) { closeGS(); enterCottage(); }
        else { addLog(`You already have a ${item.name.toLowerCase()}.`, '#555555'); }
        return;
      }
      if (!isCottage && !state.cottage.owned) { addLog('You need a cottage first.', '#555555'); return; }
      if (state.player.stamps < item.price) { addLog(`You need ${item.price - state.player.stamps} more stamps.`, '#ff5555'); return; }
      state.player.stamps -= item.price;
      if (isCottage) {
        state.cottage.owned = true;
        placeCottageTiles();
        renderDirty();
        logHistory('Bought a cottage.');
        addLog('You purchase the cottage. The deed changes hands.', '#ddcc99');
      } else {
        state.cottage.furniture[item.key] = true;
        if (item.key === 'cat') { state.cottage.catX = 9; state.cottage.catY = 7; }
        logHistory(`Brought home a ${item.name.toLowerCase()}.`);
        addLog(`${item.name} placed in your cottage.`, '#aa66ff');
        buildInteriorTileMap();
      }
      drawStatusBar(); redraw(); return;
    }

    // CLOTHING tab: a–j
    const letterIdx = 'abcdefghij'.indexOf(e.key);
    if (letterIdx < 0) return;
    const outfit = OUTFITS[letterIdx]; if (!outfit) return;
    const owned=state.player.ownedOutfits.includes(outfit.key), equipped=state.player.colorName===outfit.name;
    if (equipped) { addLog("You're already wearing that.",'#555555'); return; }
    if (owned) {
      state.player.color=outfit.color; state.player.colorName=outfit.name;
      markDirty(state.player.x,state.player.y); renderDirty(); display.draw(state.player.x,state.player.y,'@',state.player.color,BG);
      addLog(`You change into something ${outfit.name.toLowerCase()}.`,outfit.color); redraw(); return;
    }
    if (state.player.stamps<10) { addLog(`You need ${10-state.player.stamps} more stamps.`,'#ff5555'); return; }
    state.player.stamps-=10; state.player.ownedOutfits.push(outfit.key); state.player.color=outfit.color; state.player.colorName=outfit.name;
    markDirty(state.player.x,state.player.y); renderDirty(); display.draw(state.player.x,state.player.y,'@',state.player.color,BG);
    addLog(`You purchase and put on the ${outfit.name.toLowerCase()} outfit.`,outfit.color); drawStatusBar(); redraw();
  }
  window.addEventListener('keydown', gsKeyHandler);
}

function openStorageMenu() {
  if (!state.stations.storage.unlocked) return;
  state.gameState = 'menu';

  const TC    = '#66ccff';
  const DC    = '#333333';
  const LC    = '#ffffff';
  const BOX_W = 54;
  const IW    = 52;
  const AW    = 14;
  const IPW   = 37;
  const BOX_H = 24;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;

  const ST_ART = [
    '  _________   ',
    ' |  STORE  |  ',
    ' |---------|  ',
    ' |         |  ',
    ' |  [###]  |  ',
    ' |  [###]  |  ',
    ' |  [###]  |  ',
    ' |         |  ',
    ' |_________|  ',
    '              ',
  ];

  function crateFg() {
    const st = state.storage;
    const fill = Math.max(
      st.widgetCap > 0 ? st.widgets / st.widgetCap : 0,
      st.rmCap    > 0 ? st.rm      / st.rmCap     : 0
    );
    if (fill >= 1.0) return '#ff5555';
    if (fill >= 0.7) return '#ff9933';
    if (fill >= 0.4) return '#ffd633';
    return '#66cc66';
  }

  function drawArtRow(r, ay) {
    const s = ST_ART[r];
    for (let i = 0; i < AW; i++) {
      let fg = TC;
      if (r === 1 && i >= 4 && i <= 8) fg = LC;               // STORE text
      if (r >= 4 && r <= 6 && i >= 5 && i <= 7) fg = crateFg(); // [###] fill
      display.draw(BOX_X + 1 + i, ay, s[i] || ' ', fg, BG);
    }
  }

  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }

  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', fg, BG);
  }

  function crow(ay, r) {
    border(ay);
    drawArtRow(r, ay);
    display.draw(BOX_X + 1 + AW, ay, '│', DC, BG);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }

  function drp(ay, text, fg) {
    const p = menuPad(text, IPW);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }

  function redraw() {
    const st  = state.storage;
    const inv = state.player.inventory;
    const cap = state.player.inventoryCaps;

    // Clear interior
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);

    // Row 0: ╔═╗
    display.draw(BOX_X, BOX_Y, '╔', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);

    // Row 1: header
    { const ay = BOX_Y + 1;
      border(ay);
      const title = 'Storage', hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? LC : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    // Row 2: ═ separator
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Rows 3-12: art + divider + info
    for (let r = 0; r < 10; r++) crow(BOX_Y + 3 + r, r);

    // Info pane
    drp(BOX_Y + 4, 'STORAGE', LC);
    drp(BOX_Y + 5, 'Widgets in storage:', DC);
    const wStr = String(st.widgets);
    renderLargeNumber(display, RPX, BOX_Y + 6, wStr, TC, IPW);
    drp(BOX_Y + 12, `RM: ${st.rm}/${st.rmCap}   Wgt: ${st.widgets}/${st.widgetCap}`, DC);

    // Row 13: ─ separator
    { const ay = BOX_Y + 13; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Rows 14-15: inventory status
    irow(BOX_Y + 14, `In hand:     RM ${inv.rm}/${cap.rm}   Widgets ${inv.widgets}/${cap.widgets}`, DC);
    irow(BOX_Y + 15, `In storage:  RM ${st.rm}/${st.rmCap}   Widgets ${st.widgets}/${st.widgetCap}`, DC);

    // Row 16: ─ separator
    { const ay = BOX_Y + 16; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Action rows 17-20
    const canTakeW = st.widgets > 0 && inv.widgets < cap.widgets;
    const canDepW  = inv.widgets > 0 && st.widgets < st.widgetCap;
    const canTakeR = st.rm > 0 && inv.rm < cap.rm;
    const canDepR  = inv.rm > 0 && st.rm < st.rmCap;

    irow(BOX_Y + 17, '1. Take all widgets', canTakeW ? TC : '#555555');
    irow(BOX_Y + 18, '2. Deposit all widgets', canDepW ? TC : '#555555');
    irow(BOX_Y + 19, '3. Take all raw materials', canTakeR ? '#ff9933' : '#555555');
    irow(BOX_Y + 20, '4. Deposit all raw materials', canDepR ? '#ff9933' : '#555555');

    // Row 21: ═ separator
    { const ay = BOX_Y + 21; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 22: footer
    { const ay = BOX_Y + 22; border(ay);
      const txt = 'Auto-halt: production pauses when storage is full.';
      const centered = menuPad(txt.length < IW ? ' '.repeat(Math.floor((IW - txt.length) / 2)) + txt : txt, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, centered[i] || ' ', '#555555', BG); }

    // Row 23: ╚═╝
    display.draw(BOX_X, BOX_Y + 23, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 23, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 23, '═', TC, BG);
  }

  storageMenuRedrawFn = redraw;
  redraw();

  function closeStorage() {
    storageMenuRedrawFn = null;
    window.removeEventListener('keydown', storageKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function storageKeyHandler(e) {
    if (e.key === 'Escape') { closeStorage(); return; }
    const inv = state.player.inventory;
    const cap = state.player.inventoryCaps;
    const st  = state.storage;
    if (e.key === '1') {
      const take = Math.min(st.widgets, cap.widgets - inv.widgets);
      if (take > 0) { st.widgets -= take; inv.widgets += take;
        addLog(`You take ${take} widget${take !== 1 ? 's' : ''} from storage.`, TC);
        drawStatusBar(); redraw(); }
    } else if (e.key === '2') {
      const dep = Math.min(inv.widgets, st.widgetCap - st.widgets);
      if (dep > 0) { inv.widgets -= dep; st.widgets += dep;
        addLog(`You deposit ${dep} widget${dep !== 1 ? 's' : ''} into storage.`, TC);
        drawStatusBar(); redraw(); }
    } else if (e.key === '3') {
      const take = Math.min(st.rm, cap.rm - inv.rm);
      if (take > 0) { st.rm -= take; inv.rm += take;
        addLog(`You take ${take} raw material${take !== 1 ? 's' : ''} from storage.`, '#ff9933');
        drawStatusBar(); redraw(); }
    } else if (e.key === '4') {
      const dep = Math.min(inv.rm, st.rmCap - st.rm);
      if (dep > 0) { inv.rm -= dep; st.rm += dep;
        addLog(`You deposit ${dep} raw material${dep !== 1 ? 's' : ''} into storage.`, '#ff9933');
        drawStatusBar(); redraw(); }
    }
  }
  window.addEventListener('keydown', storageKeyHandler);
}

function showWorkerManagement() {
  state.gameState = 'menu';
  const apprentices = state.workers.apprentices;
  const n           = apprentices.length;
  const carryMax    = WORKER_CARRY_CAPS[state.skills.workerCarryLevel || 0];

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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
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

// ── Bank credit rating system (§5.4) ─────────────────────────────────────────

const RATING_TIERS = ['F','D','C','B','BB','BBB','A','AA','AAA'];
const RATING_INFO = [
  { tier:'F',   loanFactor:0,    rate:0,     cardLimit:0    },
  { tier:'D',   loanFactor:0,    rate:0,     cardLimit:0    },
  { tier:'C',   loanFactor:0.25, rate:0.012, cardLimit:0    },
  { tier:'B',   loanFactor:0.5,  rate:0.010, cardLimit:50   },
  { tier:'BB',  loanFactor:0.6,  rate:0.009, cardLimit:100  },
  { tier:'BBB', loanFactor:0.75, rate:0.008, cardLimit:200  },
  { tier:'A',   loanFactor:1.0,  rate:0.007, cardLimit:400  },
  { tier:'AA',  loanFactor:1.25, rate:0.006, cardLimit:800  },
  { tier:'AAA', loanFactor:1.5,  rate:0.005, cardLimit:1600 },
];

function getBankRatingIdx() {
  return Math.round(Math.max(0, Math.min(8, state.bank.creditRatingScore)));
}
function getRatingColor(tier) {
  const map = { F:'#ff5555', D:'#ff7733', C:'#ffaa44', B:'#f0f0f0', BB:'#aaddff', BBB:'#66ccff', A:'#66cc66', AA:'#aaffaa', AAA:'#ffd633' };
  return map[tier] ?? '#f0f0f0';
}
function getLoanTerms() { return RATING_INFO[getBankRatingIdx()]; }
function changeRating(delta, reason) {
  const prevIdx = getBankRatingIdx();
  state.bank.creditRatingScore = Math.max(0, Math.min(8, state.bank.creditRatingScore + delta));
  const newIdx  = getBankRatingIdx();
  const newTier = RATING_TIERS[newIdx];
  state.bank.creditRating = newTier;
  if (newIdx !== prevIdx) {
    const prevTier = RATING_TIERS[prevIdx];
    const up = newIdx > prevIdx;
    if (state.bank.ratingHistory.length >= 20) state.bank.ratingHistory.shift();
    state.bank.ratingHistory.push({ day: state.day, from: prevTier, to: newTier, reason });
    addLog(`Credit rating: ${prevTier} → ${newTier}. ${reason}.`, up ? '#66cc66' : '#ff5555');
    if (up && state.bank.card.owned) {
      const newLimit = RATING_INFO[newIdx].cardLimit;
      if (newLimit > state.bank.card.limit) {
        state.bank.card.limit = newLimit;
        addLog(`Card credit limit raised to ${newLimit}cr.`, '#66ccff');
      }
    }
  }
  if (bankMenuRedrawFn) bankMenuRedrawFn();
}

// ── Bank menu (§5.4) ─────────────────────────────────────────────────────────

function openBankMenu() {
  if (!state.stations.bank || !state.stations.bank.unlocked) return;
  state.gameState = 'menu';

  const TC    = '#66cc66';
  const CC    = '#66ccff';
  const DC    = '#333333';
  const LC    = '#ffffff';
  const BOX_W = 54;
  const IW    = 52;
  const AW    = 14;
  const IPW   = 37;
  const BOX_H = 36;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;

  const BK_ART = [
    '  _________   ',
    ' |  BANK   |  ',
    ' |---------|  ',
    ' |  _____  |  ',
    ' | |VAULT| |  ',
    ' | |     | |  ',
    ' | |_____| |  ',
    ' |---------|  ',
    ' |_________|  ',
    '              ',
  ];

  function drawArtRow(r, ay) {
    const s = BK_ART[r];
    for (let i = 0; i < AW; i++) {
      let fg = TC;
      if (r === 1 && i >= 4 && i <= 7) fg = LC;
      if (r === 4 && i >= 4 && i <= 8) fg = '#ffd633';
      display.draw(BOX_X + 1 + i, ay, s[i] || ' ', fg, BG);
    }
  }
  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }
  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', fg, BG);
  }
  function crow(ay, r) {
    border(ay);
    drawArtRow(r, ay);
    display.draw(BOX_X + 1 + AW, ay, '│', DC, BG);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }
  function drp(ay, text, fg) {
    const p = menuPad(text, IPW);
    for (let i = 0; i < IPW; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }
  function sep(ay, label) {
    border(ay);
    const bar = label ? `─── ${label} ` : '';
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, i < bar.length ? bar[i] : '─', DC, BG);
  }

  function redraw() {
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);

    // Row 0: ╔═╗
    display.draw(BOX_X, BOX_Y, '╔', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);

    // Row 1: header
    { const ay = BOX_Y + 1; border(ay);
      const title = 'The Bank', hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? LC : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    // Row 2: ═
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Rows 3-12: art + credit rating info
    for (let r = 0; r < 10; r++) crow(BOX_Y + 3 + r, r);

    const rIdx  = getBankRatingIdx();
    const rTier = RATING_TIERS[rIdx];
    const rCol  = getRatingColor(rTier);
    const dep   = state.bank.deposit;
    const loan  = state.bank.loan;
    const card  = state.bank.card;

    drp(BOX_Y + 3, 'CREDIT RATING', DC);
    // Tier label centered
    { const lbl = rTier;
      const cx = RPX + Math.floor((IPW - lbl.length) / 2);
      for (let i = 0; i < lbl.length; i++) display.draw(cx + i, BOX_Y + 4, lbl[i], rCol, BG);
    }
    // Rating bar: F D C B BB BBB A AA AAA
    { const tiers = RATING_TIERS;
      let bx = RPX;
      for (let ti = 0; ti < tiers.length; ti++) {
        const t = tiers[ti];
        const fc = ti === rIdx ? getRatingColor(t) : '#333333';
        const bracket = ti === rIdx;
        if (bracket) display.draw(bx++, BOX_Y + 5, '[', '#555555', BG);
        for (let ci = 0; ci < t.length; ci++) display.draw(bx++, BOX_Y + 5, t[ci], fc, BG);
        if (bracket) display.draw(bx++, BOX_Y + 5, ']', '#555555', BG);
        else if (ti < tiers.length - 1) display.draw(bx++, BOX_Y + 5, ' ', DC, BG);
      }
    }
    { const score = state.bank.creditRatingScore.toFixed(1);
      const cpd = state.bank.consecutivePositiveDays;
      const trend = cpd >= 3 ? ' ▲ ' + cpd + 'd' : '';
      drp(BOX_Y + 6, `Score: ${score}${trend}`, '#555555');
    }
    // Last rating change
    { const hist = state.bank.ratingHistory;
      const last = hist.length > 0 ? hist[hist.length - 1] : null;
      drp(BOX_Y + 7, last ? `Δ day ${last.day}: ${last.from}→${last.to}` : 'No changes on record.', '#444444');
    }
    drp(BOX_Y + 8, '', DC);
    drp(BOX_Y + 9, `Deposit: ${dep.toFixed(1)}cr`, dep > 0 ? TC : DC);
    drp(BOX_Y + 10, loan
      ? (loan.deadline >= state.day
          ? `Loan: ${loan.remaining.toFixed(1)}cr @ ${(loan.rate*100).toFixed(1)}%`
          : `OVERDUE: ${loan.remaining.toFixed(1)}cr`)
      : 'No active loan.', loan ? (loan.deadline >= state.day ? '#ffd633' : '#ff5555') : DC);
    drp(BOX_Y + 11, card.owned
      ? `Card: ${card.balance.toFixed(1)}/${card.limit}cr`
      : (rIdx >= 3 ? 'Card: apply below (tier B+)' : 'Card: not available'), card.owned ? CC : '#444444');
    drp(BOX_Y + 12, '', DC);

    // Row 13: ─ DEPOSITS
    sep(BOX_Y + 13, 'DEPOSITS');
    const availDep = Math.max(0, state.player.credits - 10);
    irow(BOX_Y + 14, `Deposit on account: ${dep.toFixed(1)}cr`, TC);
    irow(BOX_Y + 15, `1. Deposit all              ${availDep > 0 ? `[+${availDep}cr]` : '[need >10cr]'}`, availDep > 0 ? TC : '#555555');
    irow(BOX_Y + 16, `2. Deposit amount           ${availDep > 0 ? '[enter amount]' : '[need >10cr]'}`, availDep > 0 ? TC : '#555555');
    irow(BOX_Y + 17, `3. Withdraw all             ${dep > 0 ? `[${dep.toFixed(1)}cr]` : '[no deposit]'}`, dep > 0 ? TC : '#555555');

    // Row 18: ─ LOANS
    sep(BOX_Y + 18, 'LOANS');
    const terms     = getLoanTerms();
    const loanLimit = terms.loanFactor > 0 ? Math.floor(state.lifetimeCreditsEarned * terms.loanFactor) : 0;
    const loanRate  = terms.rate;
    if (loan) {
      const daysLeft = loan.deadline - state.day;
      if (daysLeft >= 0) {
        irow(BOX_Y + 19, `Active loan: ${loan.remaining.toFixed(1)}cr @ ${(loan.rate*100).toFixed(1)}%/day`, '#ffd633');
        irow(BOX_Y + 20, `  Deadline day ${loan.deadline} — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`, '#ffd633');
      } else {
        irow(BOX_Y + 19, `OVERDUE LOAN: ${loan.remaining.toFixed(1)}cr @ ${(loan.rate*100).toFixed(1)}%/day`, '#ff5555');
        irow(BOX_Y + 20, `  ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} overdue — REPAY IMMEDIATELY`, '#ff5555');
      }
    } else {
      irow(BOX_Y + 19, loanLimit > 0 ? `Loan limit: ${loanLimit}cr  Rate: ${(loanRate*100).toFixed(1)}%/day` : 'No loans available at current rating.', loanLimit > 0 ? DC : '#555555');
      irow(BOX_Y + 20, '', BRIGHT_WHITE);
    }
    const can4 = !loan && loanLimit > 0;
    const can5 = !!loan;
    const dL   = loan ? loan.deadline - state.day : 999;
    const can6 = !!loan && dL <= 5 && loan.rate < 0.05;
    irow(BOX_Y + 21, `4. Take loan                ${can4 ? `[limit: ${loanLimit}cr]` : (loan ? '[loan active]' : '[no limit at this tier]')}`, can4 ? TC : '#555555');
    irow(BOX_Y + 22, `5. Repay loan               ${can5 ? `[owed: ${loan.remaining.toFixed(1)}cr]` : '[no loan]'}`, can5 ? (state.player.credits >= loan.remaining ? TC : '#ff9933') : '#555555');
    irow(BOX_Y + 23, `6. Refinance                ${can6 ? '[within refi window]' : (!loan ? '[no loan]' : (loan.rate >= 0.05 ? '[rate cap reached]' : '[>5 days left]'))}`, can6 ? '#ff9933' : '#555555');

    // Row 24: ─ CREDIT CARD
    sep(BOX_Y + 24, 'CREDIT CARD');
    if (!card.owned) {
      const canApply = rIdx >= 3 && RATING_INFO[rIdx].cardLimit > 0;
      irow(BOX_Y + 25, canApply ? `Card available: ${RATING_INFO[rIdx].cardLimit}cr limit at tier ${rTier}` : 'Card requires tier B or better.', canApply ? CC : '#444444');
      irow(BOX_Y + 26, `7. Apply for card           ${canApply ? '[get ' + RATING_INFO[rIdx].cardLimit + 'cr limit]' : '[tier too low]'}`, canApply ? CC : '#555555');
      irow(BOX_Y + 27, '', BRIGHT_WHITE);
      irow(BOX_Y + 28, '', BRIGHT_WHITE);
    } else {
      const avail  = Math.max(0, card.limit - card.balance);
      const minPay = card.minimumPaymentDue;
      irow(BOX_Y + 25, `Card balance: ${card.balance.toFixed(1)}cr  Limit: ${card.limit}cr  Available: ${avail.toFixed(1)}cr`, CC);
      irow(BOX_Y + 26, minPay > 0 ? `  Min payment: ${minPay.toFixed(1)}cr due day ${card.paymentDueDay}` : (card.balance > 0 ? '  Statement pending — no payment due yet.' : '  No balance. Good standing.'), minPay > 0 ? '#ff9933' : DC);
      const can7 = minPay > 0 && state.player.credits >= minPay;
      const can8 = card.balance > 0 && state.player.credits > 0;
      irow(BOX_Y + 27, `7. Pay minimum              ${can7 ? `[${minPay.toFixed(1)}cr]` : (minPay > 0 ? '[insufficient credits]' : '[none due]')}`, can7 ? CC : '#555555');
      irow(BOX_Y + 28, `8. Pay full balance         ${can8 ? `[${Math.min(card.balance, state.player.credits).toFixed(1)}cr]` : '[no balance]'}`, can8 ? CC : '#555555');
    }

    // Row 29: ─ RATING LOG
    sep(BOX_Y + 29, 'RATING LOG');
    const hist = state.bank.ratingHistory;
    const shown = hist.slice(-3);
    for (let i = 0; i < 3; i++) {
      const e = shown[i];
      if (e) {
        const up = RATING_TIERS.indexOf(e.to) > RATING_TIERS.indexOf(e.from);
        irow(BOX_Y + 30 + i, `Day ${String(e.day).padStart(3,' ')} ${e.from}→${e.to}  ${e.reason}`, up ? '#66cc66' : '#ff5555');
      } else {
        irow(BOX_Y + 30 + i, '', BRIGHT_WHITE);
      }
    }

    // Row 33: ═ footer
    { const ay = BOX_Y + 33; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 34: footer text
    { const ay = BOX_Y + 34; border(ay);
      const txt = state.debt > 0 ? `Outstanding debt: ${formatCredits(state.debt)}cr — pay to improve rating` : `Rating affects loan limits, rates, and card access.`;
      const fc  = state.debt > 0 ? '#ff5555' : '#555555';
      const pad = menuPad(txt.length < IW ? ' '.repeat(Math.floor((IW-txt.length)/2))+txt : txt, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, pad[i] || ' ', fc, BG);
    }

    // Row 35: ╚═╝
    display.draw(BOX_X, BOX_Y + 35, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 35, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 35, '═', TC, BG);
  }

  bankMenuRedrawFn = redraw;
  redraw();

  function closeBank() {
    bankMenuRedrawFn = null;
    window.removeEventListener('keydown', bankKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function bankKeyHandler(e) {
    if (e.key === 'Escape') { closeBank(); return; }
    const loan = state.bank.loan;
    const card = state.bank.card;

    if (e.key === '1') {
      const amt = Math.max(0, state.player.credits - 10);
      if (amt <= 0) return;
      state.bank.deposit   = Math.round((state.bank.deposit + amt) * 10) / 10;
      state.player.credits = 10;
      addLog(`Deposited ${amt}cr.`, TC);
      drawStatusBar(); redraw(); return;
    }
    if (e.key === '2') {
      const maxDep = Math.max(0, state.player.credits - 10);
      if (maxDep <= 0) return;
      window.removeEventListener('keydown', bankKeyHandler);
      bankMenuRedrawFn = null;
      showNumericPrompt('Deposit Amount', maxDep,
        (val) => { state.bank.deposit = Math.round((state.bank.deposit + val) * 10) / 10; state.player.credits -= val; addLog(`Deposited ${val}cr.`, TC); drawStatusBar(); openBankMenu(); },
        () => openBankMenu());
      return;
    }
    if (e.key === '3') {
      if (state.bank.deposit <= 0) return;
      const amt = state.bank.deposit;
      state.player.credits = Math.round((state.player.credits + amt) * 10) / 10;
      state.bank.deposit   = 0;
      addLog(`Withdrew ${amt.toFixed(1)}cr.`, TC);
      drawStatusBar(); redraw(); return;
    }
    if (e.key === '4') {
      if (loan) return;
      const terms     = getLoanTerms();
      const loanLimit = terms.loanFactor > 0 ? Math.floor(state.lifetimeCreditsEarned * terms.loanFactor) : 0;
      if (loanLimit <= 0) return;
      window.removeEventListener('keydown', bankKeyHandler);
      bankMenuRedrawFn = null;
      showNumericPrompt('Loan Amount', loanLimit,
        (val) => {
          state.bank.loan = { principal: val, remaining: val, rate: terms.rate, dayTaken: state.day, deadline: state.day + 20, refinanceCount: 0, overdueDays: 0 };
          state.player.credits += val;
          addLog(`Loan of ${val}cr approved at ${(terms.rate*100).toFixed(1)}%/day. Repay within 20 days.`, '#ffd633');
          drawStatusBar(); openBankMenu();
        },
        () => openBankMenu());
      return;
    }
    if (e.key === '5') {
      if (!loan || state.player.credits <= 0) return;
      const wasOnTime = state.day <= loan.deadline;
      if (state.player.credits >= loan.remaining) {
        state.player.credits -= loan.remaining;
        addLog(`Loan of ${loan.remaining.toFixed(1)}cr repaid in full.`, TC);
        state.bank.loan = null;
        if (wasOnTime) changeRating(+1.0, 'Loan repaid on time');
      } else {
        const partial = state.player.credits;
        loan.remaining = Math.round((loan.remaining - partial) * 10) / 10;
        state.player.credits = 0;
        addLog(`Partial repayment: ${partial}cr. Remaining: ${loan.remaining.toFixed(1)}cr.`, '#ff9933');
      }
      drawStatusBar(); redraw(); return;
    }
    if (e.key === '6') {
      if (!loan) return;
      const daysLeft = loan.deadline - state.day;
      if (daysLeft > 5 || loan.rate >= 0.05) return;
      loan.rate = Math.round((loan.rate + 0.005) * 1000) / 1000;
      loan.deadline = state.day + 20;
      loan.refinanceCount++;
      addLog(`Loan refinanced at ${(loan.rate * 100).toFixed(1)}%/day. New deadline: day ${loan.deadline}.`, '#ff9933');
      redraw(); return;
    }
    if (e.key === '7') {
      if (!card.owned) {
        const rIdx = getBankRatingIdx();
        if (rIdx < 3) return;
        const limit = RATING_INFO[rIdx].cardLimit;
        if (limit <= 0) return;
        card.owned = true; card.limit = limit; card.balance = 0;
        card.lastStatementDay = state.day; card.minimumPaymentDue = 0; card.paymentDueDay = 0;
        addLog(`Credit card approved. Limit: ${limit}cr.`, CC);
        drawStatusBar(); redraw();
      } else {
        // Pay minimum payment
        if (card.minimumPaymentDue <= 0) return;
        const pay = Math.min(card.minimumPaymentDue, state.player.credits);
        if (pay <= 0) return;
        state.player.credits = Math.round((state.player.credits - pay) * 10) / 10;
        card.balance         = Math.round((card.balance - pay) * 10) / 10;
        card.minimumPaymentDue = Math.max(0, Math.round((card.minimumPaymentDue - pay) * 10) / 10);
        addLog(`Card payment: ${pay.toFixed(1)}cr paid.`, CC);
        if (card.minimumPaymentDue === 0) changeRating(+0.5, 'Card payment made on time');
        drawStatusBar(); redraw();
      }
      return;
    }
    if (e.key === '8') {
      if (!card.owned || card.balance <= 0 || state.player.credits <= 0) return;
      const pay = Math.min(card.balance, state.player.credits);
      state.player.credits = Math.round((state.player.credits - pay) * 10) / 10;
      card.balance         = Math.round((card.balance - pay) * 10) / 10;
      if (card.minimumPaymentDue > 0 && card.balance <= 0) {
        card.minimumPaymentDue = 0;
        changeRating(+0.5, 'Card balance paid in full');
      }
      addLog(`Card balance paid: ${pay.toFixed(1)}cr. Remaining: ${card.balance.toFixed(1)}cr.`, CC);
      drawStatusBar(); redraw(); return;
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

  state.bank.creditRatingScore = 0;
  state.bank.creditRating = 'F';
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
let dvMenuRedrawFn     = null;
let inventoryRedrawFn  = null;
let lfMenuRedrawFn     = null;
let rmMenuRedrawFn     = null;
let wbMenuRedrawFn     = null;
let wbMenuCloseFn      = null;
let mtMenuRedrawFn     = null;
let mtMenuBlinkOn      = true;
let storageMenuRedrawFn = null;
let bankMenuRedrawFn    = null;
let gsMenuRedrawFn      = null;
let officeMenuRedrawFn  = null;
let npMenuRedrawFn      = null;

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
    renderDirty(); display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
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
    renderDirty(); display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }
  function dashKeyHandler(e) { if (e.key === 'Escape') closeDash(); }
  window.addEventListener('keydown', dashKeyHandler);
}

function openDerivativesMenu() {
  if (!state.stations.terminal?.unlocked) return;
  state.gameState = 'dv_menu';

  // ── Constants ─────────────────────────────────────────────────────────────
  const TC  = '#cc66cc', DC = '#333333', WC = '#555555';
  const BOX_W = 70, BOX_H = 38, IW = 68, AW = 14, RPW = 53;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);   // = 5
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2)); // = 2
  const CONT_X = BOX_X + 1;
  const RPX    = BOX_X + 1 + AW + 1; // right pane absolute x
  const EXPIRIES = [1, 3, 7, 14];

  // ── Tab state ─────────────────────────────────────────────────────────────
  const TABS = ['chart', 'positions', 'trade', 'spreads'];
  let tab = 'chart';

  // ── Trade form state ──────────────────────────────────────────────────────
  let tradeInst = null; // null | 'forward'|'futures'|'call_buy'|'put_buy'|'call_write'|'put_write'
  let tradeForm = {
    qty: 10, dir: 'long', contracts: 1,
    strike: Math.round(state.marketPrice * 10) / 10,
    expiryIdx: 2, focus: 0,
  };

  // ── Spread state ──────────────────────────────────────────────────────────
  const sp0 = Math.round(state.marketPrice * 10) / 10;
  let spreadFocus = 'bullCall'; // which card is editable
  let spreadConfirm = null;     // null | spread config object
  const ss = {
    bullCall: { buyStrike: sp0,       writeStrike: Math.round((sp0+1)*10)/10, expiryIdx: 2 },
    bearPut:  { buyStrike: Math.round((sp0+1)*10)/10, writeStrike: sp0, expiryIdx: 2 },
    straddle: { strike: sp0,                                                   expiryIdx: 2 },
    strangle: { callStrike: Math.round((sp0+1)*10)/10, putStrike: Math.round((sp0-1)*10)/10, expiryIdx: 2 },
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function r10(n) { return Math.round(n * 10) / 10; }
  function pnlFg(v) { return v > 0 ? '#66cc66' : v < 0 ? '#ff5555' : WC; }
  function pStr(v)  { return (v >= 0 ? '+' : '') + formatCredits(v); }

  function border(ay) {
    display.draw(BOX_X,           ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }
  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, p[i] || ' ', fg, BG);
  }
  function crow(ay, r) {
    border(ay);
    drawArtRow(r, ay);
    display.draw(BOX_X + 1 + AW, ay, '│', DC, BG);
    for (let i = 0; i < RPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }
  function drp(ay, text, fg) {
    const p = menuPad(text, RPW);
    for (let i = 0; i < RPW; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }
  function arwR(ay, label, val, fg) {
    const gap = Math.max(1, RPW - label.length - (val ? val.length : 0));
    drp(ay, val ? label + ' '.repeat(gap) + val : label, fg);
  }
  function sep(ay)  { irow(ay, '─'.repeat(IW), DC); }
  function rSep(ay) { drp(ay, '─'.repeat(RPW), DC); }

  // ── Terminal art (14 chars × 10 rows) ─────────────────────────────────────
  const DV_ART = [
    '  ╔════════╗  ',
    '  ║ ▲  ▼   ║  ',
    '  ║ /\\/\\   ║  ',
    '  ║/    \\  ║  ',
    '  ║        ║  ',
    '  ╚════════╝  ',
    '    ╔══╗      ',
    '  ══╝  ╚══    ',
    '  [TERMINAL]  ',
    '              ',
  ];
  function drawArtRow(r, ay) {
    const s = DV_ART[r];
    const FRAME = new Set('╔╗╚╝═║');
    for (let i = 0; i < AW; i++) {
      const ch = s[i] || ' ';
      let fg = '#aaaaaa';
      if (FRAME.has(ch))                         fg = TC;
      if (r === 1 && i === 4)                    fg = '#66cc66';  // ▲
      if (r === 1 && i === 8)                    fg = '#ff5555';  // ▼
      if (r === 2 && i >= 4 && i <= 7)           fg = '#ffd633';  // /\/\
      if (r === 8 && i >= 2 && i <= 11)          fg = TC;         // [TERMINAL]
      display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
    }
  }

  // ── Tab bar (68 chars) ────────────────────────────────────────────────────
  const TAB_BAR = '   [ CHART ]   │   [ POSITIONS ]   │   [ TRADE ]   │   [ SPREADS ]  ';
  const TAB_RANGES = { chart:[3,11], positions:[19,31], trade:[39,47], spreads:[55,65] };

  // ── Frame drawing ─────────────────────────────────────────────────────────
  function drawFrame() {
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);
    display.draw(BOX_X, BOX_Y, '╔', TC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);
    { const ay = BOX_Y + 1; border(ay);
      const title = 'DERIVATIVES TERMINAL', hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? BRIGHT_WHITE : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(CONT_X + i, BOX_Y + 1, ch, fg, BG);
      }
    }
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, '═', DC, BG); }
    { const ay = BOX_Y + 3; border(ay);
      const [s, e] = TAB_RANGES[tab];
      for (let i = 0; i < IW; i++)
        display.draw(CONT_X + i, ay, TAB_BAR[i] || ' ', (i >= s && i <= e) ? TC : DC, BG);
    }
    { const ay = BOX_Y + 4; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, '═', DC, BG); }
    { const ay = BOX_Y + BOX_H - 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, '═', DC, BG); }
    display.draw(BOX_X, BOX_Y + BOX_H - 1, '╚', TC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y + BOX_H - 1, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + BOX_H - 1, '═', TC, BG);
  }

  // ── CHART tab ─────────────────────────────────────────────────────────────
  function redrawChart() {
    const CY = BOX_Y + 5; // content start row
    const hist = state.demandHistory.slice(-13);
    const allDays = [...hist, { day: state.day, demand: state.demand, price: state.marketPrice }];

    if (allDays.length < 2) {
      for (let r = 0; r < 26; r++) { if (CY+r >= BOX_Y+BOX_H-2) break; irow(CY+r, '', BRIGHT_WHITE); }
      const msg = 'Insufficient price history. Check back tomorrow.';
      irow(CY + 5, menuPad(' '.repeat(Math.floor((IW-msg.length)/2)) + msg, IW), WC);
      return;
    }

    const prices = allDays.map(d => d.price);
    const rawMin = Math.min(...prices), rawMax = Math.max(...prices);
    const minP = rawMin * 0.95, maxP = rawMax * 1.05;
    const range = maxP - minP || 1;
    const prToRow = (p) => Math.min(7, Math.max(0, Math.round((maxP - p) / range * 7)));

    const volPct = Math.round(state.volatility * 100);
    const ttlL = 'WIDGET PRICE — LAST 14 DAYS';
    const ttlR = `vol: ${volPct}%`;
    irow(CY, menuPad(ttlL, IW - ttlR.length) + ttlR, TC);
    irow(CY+1, '', BRIGHT_WHITE);

    // Y-axis width + chart area
    const YAX = 8; // "  8.4cr " → 7 chars + │ = 8
    const CNDW = 3, CNDG = 1; // candle width, gap
    const N = allDays.length;

    for (let chartRow = 0; chartRow < 8; chartRow++) {
      const ay = CY + 2 + chartRow;
      border(ay);
      // Y-axis label
      const yP = maxP - (chartRow / 7) * range;
      const yLbl = (chartRow === 0 || chartRow === 3 || chartRow === 7)
        ? (formatCredits(yP) + 'cr').padStart(YAX - 1) + '│'
        : ' '.repeat(YAX - 1) + '│';
      for (let i = 0; i < YAX; i++) display.draw(CONT_X + i, ay, yLbl[i] || ' ', '#555555', BG);
      // Candles
      for (let ci = 0; ci < N; ci++) {
        const d = allDays[ci];
        const openP  = ci > 0 ? allDays[ci-1].price : d.price;
        const closeP = d.price;
        const highP  = closeP * 1.05, lowP = closeP * 0.95;
        const closeRow = prToRow(closeP), openRow  = prToRow(openP);
        const highRow  = prToRow(highP),  lowRow   = prToRow(lowP);
        const bodyTop  = Math.min(openRow, closeRow);
        const bodyBot  = Math.max(openRow, closeRow);
        const inBody   = chartRow >= bodyTop && chartRow <= bodyBot;
        const inWick   = !inBody && chartRow >= highRow && chartRow <= lowRow;
        const candleColor = closeP > openP ? '#66cc66' : (closeP < openP ? '#ff5555' : '#ffd633');
        const cx = CONT_X + YAX + ci * (CNDW + CNDG);
        if (cx + CNDW > CONT_X + IW) break;
        if (inBody) {
          const bc = bodyTop === bodyBot ? '─' : '█';
          for (let bi = 0; bi < CNDW; bi++) display.draw(cx+bi, ay, bc, candleColor, BG);
        } else if (inWick) {
          display.draw(cx,   ay, ' ', '#aaaaaa', BG);
          display.draw(cx+1, ay, '│', '#aaaaaa', BG);
          display.draw(cx+2, ay, ' ', '#aaaaaa', BG);
        } else {
          for (let bi = 0; bi < CNDW; bi++) display.draw(cx+bi, ay, ' ', BRIGHT_WHITE, BG);
        }
      }
      // Fill trailing space
      const usedX = CONT_X + YAX + N * (CNDW + CNDG) - CNDG;
      for (let x = usedX; x < CONT_X + IW; x++) display.draw(x, ay, ' ', BRIGHT_WHITE, BG);
    }

    // X-axis day numbers
    { const ay = CY+10; border(ay);
      for (let i = 0; i < YAX; i++) display.draw(CONT_X+i, ay, ' ', BRIGHT_WHITE, BG);
      for (let ci = 0; ci < N; ci++) {
        const dn = String(allDays[ci].day).slice(-2).padStart(2);
        const cx = CONT_X + YAX + ci * (CNDW + CNDG);
        if (cx+2 > CONT_X+IW) break;
        display.draw(cx,   ay, dn[0], DC, BG);
        display.draw(cx+1, ay, dn[1], DC, BG);
        if (cx+2 < CONT_X+IW) display.draw(cx+2, ay, ' ', BRIGHT_WHITE, BG);
      }
      const ex = CONT_X + YAX + N*(CNDW+CNDG)-CNDG;
      for (let x = ex; x < CONT_X+IW; x++) display.draw(x, ay, ' ', BRIGHT_WHITE, BG);
    }
    irow(CY+11, '', BRIGHT_WHITE);

    // Summary
    const avgP = r10(prices.reduce((s,p)=>s+p,0)/prices.length);
    const sumLine = `Today: ${formatCredits(state.marketPrice)}cr   High: ${formatCredits(rawMax)}cr   Low: ${formatCredits(rawMin)}cr   Avg: ${formatCredits(avgP)}cr`;
    irow(CY+12, sumLine, BRIGHT_WHITE);
    irow(CY+13, '', BRIGHT_WHITE);

    // Price display
    const prLabel = `Price: ${formatCredits(state.marketPrice)}cr`;
    const volLabel = `Vol: ${volPct}%`;
    const dlPh3 = state.phase >= 3 ? demandLabel(state.demand) : { text: 'N/A', fg: WC };
    irow(CY+14, menuPad(prLabel, IW-volLabel.length)+volLabel, '#ffd633');
    irow(CY+15, `Demand: ${state.demand} (${dlPh3.text})`, dlPh3.fg);
    const allPos = state.derivatives.forwards.length + state.derivatives.futures.length + state.derivatives.options.length;
    irow(CY+16, `Open positions: ${allPos}`, allPos > 0 ? TC : WC);
    for (let r = 17; CY+r < BOX_Y+BOX_H-2; r++) irow(CY+r, '', BRIGHT_WHITE);
  }

  // ── POSITIONS tab ─────────────────────────────────────────────────────────
  function redrawPositions() {
    const CY = BOX_Y + 5;
    const spot = state.marketPrice;
    for (let r = 0; r < 10; r++) crow(CY+r, r);

    // Right pane rows
    let row = CY;
    function rw(text, fg) {
      if (row >= BOX_Y+BOX_H-2) return;
      drp(row++, text, fg);
    }
    function rDiv() { rw('─'.repeat(RPW), DC); }

    const fwds = state.derivatives.forwards;
    const futs  = state.derivatives.futures;
    const opts  = state.derivatives.options;

    rw('FORWARDS (' + fwds.length + ' open)', '#ffd633');
    rDiv();
    if (fwds.length === 0) { rw('  -- none --', DC); }
    else for (const f of fwds) {
      const unr = r10((f.lockedPrice - spot) * f.quantity);
      rw(`Day${f.settlementDay-1}→${f.settlementDay}  ${f.quantity}wg @ ${formatCredits(f.lockedPrice)}cr  PnL: ${pStr(unr)}cr`, pnlFg(unr));
    }
    rw('', BRIGHT_WHITE);

    rw('FUTURES (' + futs.length + ' contracts)', '#ffd633');
    rDiv();
    if (futs.length === 0) { rw('  -- none --', DC); }
    else {
      for (const type of ['long', 'short']) {
        const grp = futs.filter(f => f.type === type);
        if (!grp.length) continue;
        const avgE = r10(grp.reduce((s,f)=>s+f.entryPrice,0)/grp.length);
        const unr  = r10(grp.reduce((s,f)=>s+(spot-f.entryPrice)*f.quantity*(type==='long'?1:-1),0));
        rw(`  ${grp.length}× ${type.toUpperCase()}  entry ${formatCredits(avgE)}  now ${formatCredits(spot)}  PnL: ${pStr(unr)}cr`, pnlFg(unr));
      }
    }
    rw('', BRIGHT_WHITE);

    // Group options: spreads together, singles separate
    const spreadIds = [...new Set(opts.filter(o => o.spreadId != null).map(o => o.spreadId))];
    const singleOpts = opts.filter(o => o.spreadId == null);
    rw('OPTIONS (' + opts.length + ' open)', '#ffd633');
    rDiv();
    if (opts.length === 0) { rw('  -- none --', DC); }
    else {
      for (const sid of spreadIds) {
        const legs = opts.filter(o => o.spreadId === sid);
        const netPnL = r10(legs.reduce((s, o) => {
          const val = o.type === 'call' ? Math.max(spot - o.strike, 0) : Math.max(o.strike - spot, 0);
          return s + (o.side === 'buy' ? val - o.premium : o.premium - val);
        }, 0));
        const sType = legs[0].spreadType || 'SPREAD';
        rw(`  ${sType}  legs:${legs.length}  net PnL: ${pStr(netPnL)}cr`, pnlFg(netPnL));
      }
      for (const o of singleOpts) {
        const val = r10(o.type === 'call' ? Math.max(spot - o.strike, 0) : Math.max(o.strike - spot, 0));
        const pnl = r10(o.side === 'buy' ? val - o.premium : o.premium - val);
        rw(`  ${o.type.toUpperCase()}  K:${formatCredits(o.strike)}  exp:${o.expiry}  prem:${formatCredits(o.premium)}  [${o.side}]`, pnlFg(pnl));
      }
    }
    rw('', BRIGHT_WHITE);

    // Totals
    const totalUnr = r10(
      fwds.reduce((s,f) => s+(f.lockedPrice-spot)*f.quantity, 0) +
      futs.reduce((s,f) => s+(spot-f.entryPrice)*f.quantity*(f.type==='long'?1:-1), 0) +
      opts.reduce((s,o) => { const val = o.type==='call'?Math.max(spot-o.strike,0):Math.max(o.strike-spot,0); return s+(o.side==='buy'?val-o.premium:o.premium-val); }, 0)
    );
    rw(`Unrealized PnL:  ${pStr(totalUnr)}cr`, pnlFg(totalUnr));
    rw(`Realized today:  ${pStr(state.derivatives.pnlToday)}cr`, pnlFg(state.derivatives.pnlToday));
    rw(`Total all-time:  ${pStr(state.derivatives.totalPnL)}cr`, pnlFg(state.derivatives.totalPnL));

    // Remaining art rows if right pane is shorter
    for (let r = 10; r < 21; r++) {
      const ay = CY + r;
      if (ay >= BOX_Y+BOX_H-2) break;
      if (row <= ay) { border(ay); for (let x=1;x<BOX_W-1;x++) display.draw(BOX_X+x,ay,' ',BRIGHT_WHITE,BG); }
    }
  }

  // ── TRADE tab ─────────────────────────────────────────────────────────────
  function redrawTrade() {
    const CY = BOX_Y + 5;
    for (let r = 0; r < 10; r++) crow(CY+r, r);

    const spot = state.marketPrice;
    const dl = state.phase >= 3 ? demandLabel(state.demand) : { text: 'N/A', fg: WC };
    drp(CY,   `Spot: ${formatCredits(spot)}cr    Demand: ${state.demand} (${dl.text})`, BRIGHT_WHITE);
    drp(CY+1, `Vol:  ${Math.round(state.volatility*100)}%    Day: ${state.day}    Phase: ${state.phase}`, WC);
    rSep(CY+2);

    if (!tradeInst) {
      // Instrument list
      const hasFut  = !!state.skills.futures;
      const hasBuy  = !!state.skills.optionsBuy;
      const hasWrt  = !!state.skills.optionsWrite;
      drp(CY+3, '1. Forward Contract', TC);
      drp(CY+4, `2. Futures`, hasFut ? TC : DC);
      drp(CY+5, `3. Call Option — Buy`, hasBuy ? TC : DC);
      drp(CY+6, `4. Put Option — Buy`,  hasBuy ? TC : DC);
      drp(CY+7, `5. Write Call`, hasWrt ? TC : DC);
      drp(CY+8, `6. Write Put`,  hasWrt ? TC : DC);
    } else {
      // Form view
      const EXDAYS = EXPIRIES[tradeForm.expiryIdx];
      if (tradeInst === 'forward') {
        const maxQty = state.storage.widgets + state.player.inventory.widgets;
        drp(CY+3, 'FORWARD CONTRACT', BRIGHT_WHITE);
        rSep(CY+4);
        drp(CY+5, `Lock price:  ${formatCredits(spot)}cr  (today's spot)`, WC);
        drp(CY+6, `Settle:      Day ${state.day + 1}  (tomorrow)`, WC);
        rSep(CY+7);
        drp(CY+8, tradeForm.focus===0 ? `> Quantity: [ ${tradeForm.qty} ]   +/- to adjust` : `  Quantity: [ ${tradeForm.qty} ]`, tradeForm.focus===0 ? BRIGHT_WHITE : WC);
        rSep(CY+9);
        const rise = r10((spot * 1.1 - spot) * tradeForm.qty);
        const fall = r10((spot * 0.9 - spot) * tradeForm.qty);
        drp(CY+10, `Est PnL +10%: ${pStr(rise)}cr`, pnlFg(rise));
        drp(CY+11, `Est PnL -10%: ${pStr(fall)}cr`, pnlFg(fall));
        rSep(CY+12);
        drp(CY+13, 'Enter: confirm   ESC: cancel', WC);
      } else if (tradeInst === 'futures') {
        const margin = r10(spot * 10 * 0.20);
        const canOpen = state.player.credits >= margin;
        drp(CY+3, 'FUTURES CONTRACT', BRIGHT_WHITE);
        rSep(CY+4);
        drp(CY+5, `Entry: ${formatCredits(spot)}cr    Margin: ${formatCredits(margin)}cr  (20%)`, WC);
        rSep(CY+6);
        drp(CY+7, tradeForm.focus===0 ? `> Direction: [ ${tradeForm.dir.toUpperCase()} ]   1=Long 2=Short` : `  Direction: [ ${tradeForm.dir.toUpperCase()} ]`, tradeForm.focus===0 ? BRIGHT_WHITE : WC);
        drp(CY+8, tradeForm.focus===1 ? `> Contracts: [ ${tradeForm.contracts} ]   +/- to adjust` : `  Contracts: [ ${tradeForm.contracts} ]`, tradeForm.focus===1 ? BRIGHT_WHITE : WC);
        rSep(CY+9);
        const notional = r10(spot * 10 * tradeForm.contracts);
        const reqMargin = r10(margin * tradeForm.contracts);
        drp(CY+10, `Notional: ${formatCredits(notional)}cr   Required: ${formatCredits(reqMargin)}cr`, WC);
        drp(CY+11, canOpen ? 'Enter: confirm   ESC: cancel' : `Need ${formatCredits(reqMargin)}cr margin`, canOpen ? WC : '#ff5555');
      } else {
        const parts = tradeInst.split('_');
        const oType = parts[0]; // 'call' or 'put'
        const oSide = parts[1]; // 'buy' or 'write'
        const prem  = calcOptionPremium(oType, tradeForm.strike, EXDAYS);
        const intrinsic = oType==='call' ? Math.max(spot-tradeForm.strike,0) : Math.max(tradeForm.strike-spot,0);
        const timeVal = r10(prem - intrinsic);
        const netCost = oSide==='buy' ? prem : r10(prem*3 - prem);
        const canAfford = state.player.credits >= netCost;
        drp(CY+3, `${oSide.toUpperCase()} ${oType.toUpperCase()} OPTION`, BRIGHT_WHITE);
        rSep(CY+4);
        drp(CY+5, `Spot: ${formatCredits(spot)}cr    Vol: ${Math.round(state.volatility*100)}%`, WC);
        rSep(CY+6);
        drp(CY+7, tradeForm.focus===0 ? `> Strike:  [ ${formatCredits(tradeForm.strike)}cr ]   +/- 0.1cr` : `  Strike:  [ ${formatCredits(tradeForm.strike)}cr ]`, tradeForm.focus===0 ? BRIGHT_WHITE : WC);
        drp(CY+8, tradeForm.focus===1 ? `> Expiry:  [ ${EXDAYS} days ]   Tab to cycle` : `  Expiry:  [ ${EXDAYS} days ]`, tradeForm.focus===1 ? BRIGHT_WHITE : WC);
        rSep(CY+9);
        drp(CY+10, `Premium: ${formatCredits(prem)}cr  (intrinsic: ${formatCredits(r10(intrinsic))}  time: ${formatCredits(timeVal)})`, BRIGHT_WHITE);
        drp(CY+11, oSide==='buy' ? `Cost: ${formatCredits(prem)}cr` : `Rcv: ${formatCredits(prem)}cr  Margin: ${formatCredits(r10(prem*3))}cr`, WC);
        rSep(CY+12);
        drp(CY+13, canAfford ? 'Enter: confirm   ESC: cancel' : `Need ${formatCredits(netCost)}cr`, canAfford ? WC : '#ff5555');
      }
    }

    // Fill remaining pane rows
    for (let r = 10; r < 26; r++) {
      const ay = CY + r; if (ay >= BOX_Y+BOX_H-2) break;
      if (!tradeInst || r >= 14) { border(ay); for (let x=1;x<BOX_W-1;x++) display.draw(BOX_X+x,ay,' ',BRIGHT_WHITE,BG); }
    }
  }

  // ── SPREADS tab ───────────────────────────────────────────────────────────
  function spreadPremNet(type, s) {
    if (type === 'bullCall') return r10(calcOptionPremium('call',s.buyStrike,EXPIRIES[s.expiryIdx]) - calcOptionPremium('call',s.writeStrike,EXPIRIES[s.expiryIdx]));
    if (type === 'bearPut')  return r10(calcOptionPremium('put',s.buyStrike,EXPIRIES[s.expiryIdx]) - calcOptionPremium('put',s.writeStrike,EXPIRIES[s.expiryIdx]));
    if (type === 'straddle') return r10(calcOptionPremium('call',s.strike,EXPIRIES[s.expiryIdx]) + calcOptionPremium('put',s.strike,EXPIRIES[s.expiryIdx]));
    if (type === 'strangle') return r10(calcOptionPremium('call',s.callStrike,EXPIRIES[s.expiryIdx]) + calcOptionPremium('put',s.putStrike,EXPIRIES[s.expiryIdx]));
    return 0;
  }

  function redrawSpreads() {
    const CY = BOX_Y + 5;
    const spot = state.marketPrice;
    const hasBuy = !!state.skills.optionsBuy;
    const hasWrt = !!state.skills.optionsWrite;

    if (spreadConfirm) {
      // Confirmation sub-view
      const sc = spreadConfirm;
      irow(CY,   'CONFIRM SPREAD', TC);
      sep(CY+1);
      irow(CY+2, `Spread type: ${sc.label}`, BRIGHT_WHITE);
      irow(CY+3, sc.leg1, '#66cc66');
      irow(CY+4, sc.leg2, '#ff5555');
      sep(CY+5);
      irow(CY+6, `Net cost: ${formatCredits(sc.netCost)}cr`, sc.netCost >= 0 ? '#ff9933' : '#66cc66');
      irow(CY+7, `Max profit: ${formatCredits(sc.maxProfit)}cr   Max loss: ${formatCredits(sc.maxLoss)}cr`, BRIGHT_WHITE);
      sep(CY+8);
      irow(CY+9,  '1. Confirm — open both legs simultaneously', '#66cc66');
      irow(CY+10, '2. Cancel', WC);
      for (let r = 11; CY+r < BOX_Y+BOX_H-2; r++) irow(CY+r, '', BRIGHT_WHITE);
      return;
    }

    const spot2 = state.marketPrice;
    const dl = state.phase >= 3 ? demandLabel(state.demand) : { text: 'N/A', fg: WC };
    const ctxLine = `Spot: ${formatCredits(spot2)}cr   Vol: ${Math.round(state.volatility*100)}%   Demand: ${dl.text}   Day ${state.day}`;
    irow(CY, ctxLine, BRIGHT_WHITE);
    irow(CY+1, '', BRIGHT_WHITE);

    // Cards
    const CARDS = [
      { key: 'bullCall', num: '1', label: 'BULL CALL SPREAD', req: hasBuy, reqLabel: '[requires Options Buy]',
        getLines(s) {
          const net = spreadPremNet('bullCall', s); const mp = r10(Math.abs(s.writeStrike-s.buyStrike)-net);
          return [`Buy call: ${formatCredits(s.buyStrike)}cr   Write call: ${formatCredits(s.writeStrike)}cr   Exp: ${EXPIRIES[s.expiryIdx]}d`,
                  `Net prem: ${formatCredits(net)}cr   Max profit: ${formatCredits(mp)}cr   Max loss: ${formatCredits(net)}cr`,
                  `Profit if price > ${formatCredits(r10(s.buyStrike+net))}cr at expiry.`];
        },
      },
      { key: 'bearPut', num: '2', label: 'BEAR PUT SPREAD',  req: hasBuy, reqLabel: '[requires Options Buy]',
        getLines(s) {
          const net = spreadPremNet('bearPut', s); const mp = r10(Math.abs(s.buyStrike-s.writeStrike)-net);
          return [`Buy put: ${formatCredits(s.buyStrike)}cr   Write put: ${formatCredits(s.writeStrike)}cr   Exp: ${EXPIRIES[s.expiryIdx]}d`,
                  `Net prem: ${formatCredits(net)}cr   Max profit: ${formatCredits(mp)}cr   Max loss: ${formatCredits(net)}cr`,
                  `Profit if price < ${formatCredits(r10(s.buyStrike-net))}cr at expiry.`];
        },
      },
      { key: 'straddle', num: '3', label: 'LONG STRADDLE', req: hasBuy, reqLabel: '[requires Options Buy]',
        getLines(s) {
          const net = spreadPremNet('straddle', s);
          return [`Strike: ${formatCredits(s.strike)}cr   Expiry: ${EXPIRIES[s.expiryIdx]} days`,
                  `Net prem: ${formatCredits(net)}cr   Up BE: ${formatCredits(r10(s.strike+net))}cr   Dn BE: ${formatCredits(r10(s.strike-net))}cr`,
                  `Profit if price moves more than ${formatCredits(net)}cr in either direction.`];
        },
      },
      { key: 'strangle', num: '4', label: 'SHORT STRANGLE', req: hasWrt, reqLabel: '[requires Options Write]',
        getLines(s) {
          const net = spreadPremNet('strangle', s);
          return [`Write call: ${formatCredits(s.callStrike)}cr   Write put: ${formatCredits(s.putStrike)}cr   Exp: ${EXPIRIES[s.expiryIdx]}d`,
                  `Premium rcvd: ${formatCredits(net)}cr   Max loss: unlimited outside range`,
                  `Profit if price stays between ${formatCredits(s.putStrike)}cr and ${formatCredits(s.callStrike)}cr.`];
        },
      },
    ];

    let r = 2;
    for (const card of CARDS) {
      if (CY+r >= BOX_Y+BOX_H-2) break;
      sep(CY+r); r++;
      const isFocused = spreadFocus === card.key;
      const reqFg = card.req ? (isFocused ? TC : '#aaaaaa') : DC;
      const hdr = menuPad(card.label, IW - card.reqLabel.length) + card.reqLabel;
      irow(CY+r, hdr, reqFg); r++;
      const cfg = ss[card.key];
      if (!card.req) {
        irow(CY+r, '', BRIGHT_WHITE); r++;
        irow(CY+r, '  ' + card.reqLabel, DC); r++;
        irow(CY+r, '', BRIGHT_WHITE); r++;
      } else {
        const lines = card.getLines(cfg);
        for (const l of lines) { irow(CY+r, l, isFocused ? BRIGHT_WHITE : '#555555'); r++; }
      }
      irow(CY+r, `${card.num}. Enter spread`, card.req ? (isFocused ? '#66cc66' : WC) : DC); r++;
    }
    for (; CY+r < BOX_Y+BOX_H-2; r++) irow(CY+r, '', BRIGHT_WHITE);
  }

  // ── Main redraw ───────────────────────────────────────────────────────────
  function redraw() {
    drawFrame();
    if (tab === 'chart') redrawChart();
    else if (tab === 'positions') redrawPositions();
    else if (tab === 'trade') redrawTrade();
    else redrawSpreads();
  }

  // ── Close ─────────────────────────────────────────────────────────────────
  function closeDV() {
    dvMenuRedrawFn = null;
    window.removeEventListener('keydown', dvKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  // ── Close all positions helper ────────────────────────────────────────────
  function closeAllPositions() {
    let pnl = 0;
    const sp = state.marketPrice;
    for (const f of state.derivatives.forwards) pnl += (f.lockedPrice - sp) * f.quantity;
    for (const f of state.derivatives.futures)  { pnl += (sp - f.entryPrice)*f.quantity*(f.type==='long'?1:-1); state.player.credits = r10(state.player.credits + f.marginHeld); }
    for (const o of state.derivatives.options)  { const ev = o.type==='call'?Math.max(sp-o.strike,0):Math.max(o.strike-sp,0); if (o.side==='buy') { pnl += ev - o.premium; } else { pnl += o.premium - ev; state.player.credits = r10(state.player.credits + o.marginHeld); } }
    pnl = r10(pnl);
    state.player.credits = r10(state.player.credits + pnl);
    state.derivatives.pnlToday = r10(state.derivatives.pnlToday + pnl);
    state.derivatives.totalPnL = r10(state.derivatives.totalPnL + pnl);
    state.derivatives.forwards = []; state.derivatives.futures = []; state.derivatives.options = [];
    state.derivatives.marginCallActive = false;
    addLog(`All positions closed. PnL: ${pStr(pnl)}cr.`, pnl >= 0 ? '#66cc66' : '#ff5555');
    drawStatusBar();
  }

  // ── Key handler ───────────────────────────────────────────────────────────
  function dvKeyHandler(e) {
    if (e.key === 'Escape') {
      if (spreadConfirm) { spreadConfirm = null; redraw(); return; }
      if (tradeInst)     { tradeInst = null; redraw(); return; }
      closeDV(); return;
    }

    // Tab cycling (only when not in a form)
    if (!tradeInst && !spreadConfirm) {
      if (e.key === 'ArrowLeft')  { tab = TABS[(TABS.indexOf(tab)-1+TABS.length)%TABS.length]; redraw(); return; }
      if (e.key === 'ArrowRight') { tab = TABS[(TABS.indexOf(tab)+1)%TABS.length]; redraw(); return; }
    }

    // CHART: close-all shortcut
    if (tab === 'chart') {
      if (e.key === 'c') { closeAllPositions(); redraw(); }
      return;
    }

    // POSITIONS: close-all shortcut
    if (tab === 'positions') {
      if (e.key === 'c') { closeAllPositions(); redraw(); }
      return;
    }

    // TRADE tab
    if (tab === 'trade') {
      if (!tradeInst) {
        // Instrument selection
        const hasFut = !!state.skills.futures;
        const hasBuy = !!state.skills.optionsBuy;
        const hasWrt = !!state.skills.optionsWrite;
        if (e.key === '1') { tradeInst = 'forward'; tradeForm = { qty:10, focus:0, dir:'long', contracts:1, strike:r10(state.marketPrice), expiryIdx:2 }; redraw(); return; }
        if (e.key === '2' && hasFut) { tradeInst = 'futures'; tradeForm = { qty:10, focus:0, dir:'long', contracts:1, strike:r10(state.marketPrice), expiryIdx:2 }; redraw(); return; }
        if (e.key === '3' && hasBuy) { tradeInst = 'call_buy'; tradeForm = { qty:1, focus:0, dir:'long', contracts:1, strike:r10(state.marketPrice), expiryIdx:2 }; redraw(); return; }
        if (e.key === '4' && hasBuy) { tradeInst = 'put_buy';  tradeForm = { qty:1, focus:0, dir:'long', contracts:1, strike:r10(state.marketPrice), expiryIdx:2 }; redraw(); return; }
        if (e.key === '5' && hasWrt) { tradeInst = 'call_write'; tradeForm = { qty:1, focus:0, dir:'long', contracts:1, strike:r10(state.marketPrice), expiryIdx:2 }; redraw(); return; }
        if (e.key === '6' && hasWrt) { tradeInst = 'put_write';  tradeForm = { qty:1, focus:0, dir:'long', contracts:1, strike:r10(state.marketPrice), expiryIdx:2 }; redraw(); return; }
        return;
      }

      // In form
      const step = (tradeInst.includes('call')||tradeInst.includes('put')) && tradeForm.focus===0 ? 0.1 : 1;

      if (e.key === 'Tab') { e.preventDefault(); tradeForm.focus = 1 - tradeForm.focus; redraw(); return; }
      if (e.key === 'ArrowUp'   || e.key === '+') {
        if (tradeInst === 'forward')                      { tradeForm.qty = Math.max(1, tradeForm.qty+1); }
        else if (tradeInst === 'futures' && tradeForm.focus===1) { tradeForm.contracts = Math.max(1, tradeForm.contracts+1); }
        else if (tradeInst === 'futures' && tradeForm.focus===0) {}
        else if (tradeForm.focus===0)  { tradeForm.strike = r10(tradeForm.strike + 0.1); }
        else { tradeForm.expiryIdx = (tradeForm.expiryIdx+1)%EXPIRIES.length; }
        redraw(); return;
      }
      if (e.key === 'ArrowDown' || e.key === '-') {
        if (tradeInst === 'forward')                      { tradeForm.qty = Math.max(1, tradeForm.qty-1); }
        else if (tradeInst === 'futures' && tradeForm.focus===1) { tradeForm.contracts = Math.max(1, tradeForm.contracts-1); }
        else if (tradeInst === 'futures' && tradeForm.focus===0) {}
        else if (tradeForm.focus===0)  { tradeForm.strike = r10(Math.max(0.1, tradeForm.strike - 0.1)); }
        else { tradeForm.expiryIdx = (tradeForm.expiryIdx-1+EXPIRIES.length)%EXPIRIES.length; }
        redraw(); return;
      }
      if (tradeInst === 'futures') {
        if (e.key === '1') { tradeForm.dir = 'long';  redraw(); return; }
        if (e.key === '2') { tradeForm.dir = 'short'; redraw(); return; }
      }
      if (e.key === 'Enter') {
        const sp = state.marketPrice;
        if (tradeInst === 'forward') {
          state.derivatives.forwards.push({ quantity: tradeForm.qty, lockedPrice: sp, settlementDay: state.day+1 });
          addLog(`Forward: ${tradeForm.qty} widgets @ ${formatCredits(sp)}cr, day ${state.day+1}.`, TC);
        } else if (tradeInst === 'futures') {
          const margin = r10(sp * 10 * 0.20 * tradeForm.contracts);
          if (state.player.credits < margin) { addLog('Insufficient credits for margin.', '#ff5555'); return; }
          state.player.credits = r10(state.player.credits - margin);
          for (let i = 0; i < tradeForm.contracts; i++)
            state.derivatives.futures.push({ type: tradeForm.dir, quantity:10, entryPrice:sp, lastSettlementPrice:sp, openDay:state.day, marginHeld:r10(sp*10*0.20) });
          addLog(`Opened ${tradeForm.contracts}× ${tradeForm.dir} future @ ${formatCredits(sp)}cr.`, TC);
        } else {
          const parts = tradeInst.split('_');
          const oType = parts[0], oSide = parts[1];
          const prem = calcOptionPremium(oType, tradeForm.strike, EXPIRIES[tradeForm.expiryIdx]);
          if (oSide === 'buy') {
            if (state.player.credits < prem) { addLog(`Need ${formatCredits(prem)}cr for premium.`, '#ff5555'); return; }
            state.player.credits = r10(state.player.credits - prem);
            state.derivatives.options.push({ type:oType, strike:tradeForm.strike, expiry:state.day+EXPIRIES[tradeForm.expiryIdx], premium:prem, quantity:1, side:'buy', marginHeld:0 });
            addLog(`Bought ${oType} K:${formatCredits(tradeForm.strike)} exp:${state.day+EXPIRIES[tradeForm.expiryIdx]}. Prem: ${formatCredits(prem)}cr.`, TC);
          } else {
            const margin = r10(prem*3), netCost = r10(margin-prem);
            if (state.player.credits < netCost) { addLog(`Need ${formatCredits(netCost)}cr net margin.`, '#ff5555'); return; }
            state.player.credits = r10(state.player.credits + prem - margin);
            state.derivatives.options.push({ type:oType, strike:tradeForm.strike, expiry:state.day+EXPIRIES[tradeForm.expiryIdx], premium:prem, quantity:1, side:'write', marginHeld:margin });
            addLog(`Written ${oType} K:${formatCredits(tradeForm.strike)} exp:${state.day+EXPIRIES[tradeForm.expiryIdx]}. Prem rcvd: ${formatCredits(prem)}cr.`, TC);
          }
        }
        drawStatusBar();
        tradeInst = null;
        redraw();
      }
      return;
    }

    // SPREADS tab
    if (tab === 'spreads') {
      if (spreadConfirm) {
        if (e.key === '1') {
          // Execute spread
          const sc = spreadConfirm;
          const sid = state.derivatives.nextSpreadId++;
          state.player.credits = r10(state.player.credits - sc.netCost);
          for (const leg of sc.legs)
            state.derivatives.options.push({ ...leg, expiry: state.day + EXPIRIES[ss[sc.key].expiryIdx], spreadId: sid, spreadType: sc.label });
          addLog(`Spread entered: ${sc.label}. Net cost: ${formatCredits(sc.netCost)}cr.`, TC);
          drawStatusBar();
          spreadConfirm = null;
          redraw();
          return;
        }
        if (e.key === '2') { spreadConfirm = null; redraw(); return; }
        return;
      }

      // Cycle focused card
      const SKEYS = ['bullCall', 'bearPut', 'straddle', 'strangle'];
      if (e.key === 'Tab') { e.preventDefault(); spreadFocus = SKEYS[(SKEYS.indexOf(spreadFocus)+1)%SKEYS.length]; redraw(); return; }

      // Adjust fields
      if (e.key === 'ArrowUp' || e.key === '+') {
        const s = ss[spreadFocus];
        if (spreadFocus === 'bullCall') s.buyStrike = r10(s.buyStrike + 0.1);
        else if (spreadFocus === 'bearPut') s.writeStrike = r10(s.writeStrike + 0.1);
        else if (spreadFocus === 'straddle') s.strike = r10(s.strike + 0.1);
        else s.callStrike = r10(s.callStrike + 0.1);
        redraw(); return;
      }
      if (e.key === 'ArrowDown' || e.key === '-') {
        const s = ss[spreadFocus];
        if (spreadFocus === 'bullCall') s.buyStrike = r10(Math.max(0.1, s.buyStrike - 0.1));
        else if (spreadFocus === 'bearPut') s.writeStrike = r10(Math.max(0.1, s.writeStrike - 0.1));
        else if (spreadFocus === 'straddle') s.strike = r10(Math.max(0.1, s.strike - 0.1));
        else s.callStrike = r10(Math.max(0.1, s.callStrike - 0.1));
        redraw(); return;
      }

      // Select spread → confirmation
      const CARD_MAP = { '1':'bullCall','2':'bearPut','3':'straddle','4':'strangle' };
      const CARD_NEED = { bullCall: !!state.skills.optionsBuy, bearPut: !!state.skills.optionsBuy, straddle: !!state.skills.optionsBuy, strangle: !!state.skills.optionsWrite };
      const cKey = CARD_MAP[e.key];
      if (cKey && CARD_NEED[cKey]) {
        const s = ss[cKey];
        const sp = state.marketPrice;
        const exD = EXPIRIES[s.expiryIdx];
        let label, leg1Obj, leg2Obj, leg1Str, leg2Str, maxProfit, maxLoss;
        if (cKey === 'bullCall') {
          const p1 = calcOptionPremium('call',s.buyStrike,exD);
          const p2 = calcOptionPremium('call',s.writeStrike,exD);
          const net = r10(p1 - p2);
          label = 'BULL CALL SPREAD';
          leg1Obj = { type:'call', strike:s.buyStrike,  premium:p1, quantity:1, side:'buy',   marginHeld:0 };
          leg2Obj = { type:'call', strike:s.writeStrike, premium:p2, quantity:1, side:'write', marginHeld:r10(p2*3) };
          leg1Str = `Leg 1: BUY  CALL  K:${formatCredits(s.buyStrike)}  exp:${exD}d  prem:-${formatCredits(p1)}cr`;
          leg2Str = `Leg 2: WRITE CALL K:${formatCredits(s.writeStrike)} exp:${exD}d  prem:+${formatCredits(p2)}cr`;
          maxProfit = r10(Math.abs(s.writeStrike-s.buyStrike) - net);
          maxLoss = net;
          spreadConfirm = { key:cKey, label, legs:[leg1Obj,leg2Obj], leg1:leg1Str, leg2:leg2Str, netCost:net, maxProfit, maxLoss };
        } else if (cKey === 'bearPut') {
          const p1 = calcOptionPremium('put',s.buyStrike,exD);
          const p2 = calcOptionPremium('put',s.writeStrike,exD);
          const net = r10(p1 - p2);
          label = 'BEAR PUT SPREAD';
          leg1Str = `Leg 1: BUY  PUT  K:${formatCredits(s.buyStrike)}  exp:${exD}d  prem:-${formatCredits(p1)}cr`;
          leg2Str = `Leg 2: WRITE PUT K:${formatCredits(s.writeStrike)} exp:${exD}d  prem:+${formatCredits(p2)}cr`;
          maxProfit = r10(Math.abs(s.buyStrike-s.writeStrike) - net);
          maxLoss = net;
          const l1o = { type:'put', strike:s.buyStrike,   premium:p1, quantity:1, side:'buy',   marginHeld:0 };
          const l2o = { type:'put', strike:s.writeStrike, premium:p2, quantity:1, side:'write', marginHeld:r10(p2*3) };
          spreadConfirm = { key:cKey, label, legs:[l1o,l2o], leg1:leg1Str, leg2:leg2Str, netCost:net, maxProfit, maxLoss };
        } else if (cKey === 'straddle') {
          const pc = calcOptionPremium('call',s.strike,exD);
          const pp = calcOptionPremium('put',s.strike,exD);
          const net = r10(pc + pp);
          label = 'LONG STRADDLE';
          leg1Str = `Leg 1: BUY CALL K:${formatCredits(s.strike)} exp:${exD}d  prem:-${formatCredits(pc)}cr`;
          leg2Str = `Leg 2: BUY PUT  K:${formatCredits(s.strike)} exp:${exD}d  prem:-${formatCredits(pp)}cr`;
          const l1o = { type:'call', strike:s.strike, premium:pc, quantity:1, side:'buy', marginHeld:0 };
          const l2o = { type:'put',  strike:s.strike, premium:pp, quantity:1, side:'buy', marginHeld:0 };
          spreadConfirm = { key:cKey, label, legs:[l1o,l2o], leg1:leg1Str, leg2:leg2Str, netCost:net, maxProfit:999, maxLoss:net };
        } else { // strangle
          const pc = calcOptionPremium('call',s.callStrike,exD);
          const pp = calcOptionPremium('put',s.putStrike,exD);
          const net = r10(pc + pp); // receive both premiums
          label = 'SHORT STRANGLE';
          leg1Str = `Leg 1: WRITE CALL K:${formatCredits(s.callStrike)} exp:${exD}d  prem:+${formatCredits(pc)}cr`;
          leg2Str = `Leg 2: WRITE PUT  K:${formatCredits(s.putStrike)} exp:${exD}d  prem:+${formatCredits(pp)}cr`;
          const l1o = { type:'call', strike:s.callStrike, premium:pc, quantity:1, side:'write', marginHeld:r10(pc*3) };
          const l2o = { type:'put',  strike:s.putStrike,  premium:pp, quantity:1, side:'write', marginHeld:r10(pp*3) };
          // Writing = receive net premium, netCost is negative (you receive)
          spreadConfirm = { key:cKey, label, legs:[l1o,l2o], leg1:leg1Str, leg2:leg2Str, netCost:r10(-net), maxProfit:net, maxLoss:999 };
        }
        redraw();
      }
      return;
    }
  }

  dvMenuRedrawFn = redraw;
  redraw();
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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }
  function posKeyHandler(e) { if (e.key === 'Escape') close(); }
  window.addEventListener('keydown', posKeyHandler);
}

// ── Large digit renderer (§9) ─────────────────────────────────────────────────

const LARGE_DIGITS = {
  '0': ['┌───┐','│   │','│   │','│   │','└───┘'],
  '1': ['  ╷  ','  │  ','  │  ','  │  ','  ╵  '],
  '2': ['╶───┐','    │','┌───┘','│    ','└───╴'],
  '3': ['╶───┐','    │',' ───┤','    │','╶───┘'],
  '4': ['┐   ┐','│   │','└───┤','    │','    ╵'],
  '5': ['┌───╴','│    ','└───┐','    │','╶───┘'],
  '6': ['┌───╴','│    ','├───┐','│   │','└───┘'],
  '7': ['╶───┐','    │','    │','    │','    ╵'],
  '8': ['┌───┐','│   │','├───┤','│   │','└───┘'],
  '9': ['┌───┐','│   │','└───┤','    │','╶───┘'],
  ',': ['     ','     ','     ','  ,  ',' /   '],
  '/': ['    ╱','   ╱ ','  ╱  ',' ╱   ','╱    '],
  ' ': ['     ','     ','     ','     ','     '],
};

// Shared menu utility — pads to exact width, hard-truncates with … if over
function menuPad(str, width) {
  if (str.length > width) return str.slice(0, width - 1) + '…';
  return str.padEnd(width);
}

function renderLargeNumber(display, x, y, numberString, color, availableWidth) {
  // If a width is given and the digits would overflow, fall back to exponential plain text
  if (availableWidth !== undefined && numberString.length * 6 > availableWidth) {
    const n = parseFloat(numberString.replace(/,/g, ''));
    let expStr;
    if (!isFinite(n) || isNaN(n)) {
      expStr = numberString.slice(0, availableWidth);
    } else if (n === 0) {
      expStr = '0';
    } else {
      const exp = Math.floor(Math.log10(Math.abs(n)));
      expStr = `${(n / Math.pow(10, exp)).toFixed(2)}e+${exp}`;
    }
    const pad = Math.max(0, Math.floor((availableWidth - expStr.length) / 2));
    for (let i = 0; i < availableWidth; i++)
      display.draw(x + i, y + 2, i >= pad && i < pad + expStr.length ? expStr[i - pad] : ' ', color, BG);
    return;
  }
  for (let ci = 0; ci < numberString.length; ci++) {
    const ch    = numberString[ci];
    const pat   = LARGE_DIGITS[ch] || LARGE_DIGITS[' '];
    const ox    = x + ci * 6;
    for (let row = 0; row < 5; row++) {
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
  const RC     = COLOR_LF_FRAME; // rocket red (border color)
  const WC     = '#555555';
  const DC     = '#333333';

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

    rpt(4,  'WIDGETS LOADED', WC);

    // Large digit display (rows 5-9, 5 rows tall)
    const rw     = Math.min(state.rocketWidgets, 50000);
    const numStr = rw.toLocaleString('en-US');
    const numFg  = rw >= 45000 ? '#ff5555' : rw >= 25000 ? '#ff9933' : '#ffd633';
    renderLargeNumber(display, RP, BOX_Y + 5, numStr, numFg, RW);

    rpt(10, '/ 50,000', WC);

    // Progress bar (row 12)
    const pct      = rw / 50000;
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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function lfKeyHandler(e) {
    if (e.key === 'Escape') { closeLF(); return; }
    if (e.key === ' ') {
      e.preventDefault();
      if (state.rocketWidgets < 50000) {
        state.courierDestination = state.courierDestination === 'market' ? 'rocket' : 'market';
        redraw();
      }
    }
  }
  window.addEventListener('keydown', lfKeyHandler);
}

// ── Cottage interior (§4.2) ───────────────────────────────────────────────────

function logHistory(text) {
  if (!Array.isArray(state.bookshelfLog)) state.bookshelfLog = [];
  state.bookshelfLog.push({ day: state.day, text });
  if (state.bookshelfLog.length > 50) state.bookshelfLog.shift();
}

function buildInteriorTileMap() {
  const W = 20, H = 12;
  const FC = '#1a1208', WC = '#886633';
  for (let x = 0; x < W; x++) {
    interiorTileMap[x] = [];
    for (let y = 0; y < H; y++) {
      const isBorder = x === 0 || x === W-1 || y === 0 || y === H-1 || y === 10;
      const isDoor   = y === 10 && x === 10;
      interiorTileMap[x][y] = {
        walkable:    !isBorder,
        glyph:       isBorder ? (y===0||y===H-1 ? '═' : '║') : '.',
        fg:          isBorder ? WC : FC,
        description: isBorder ? (isDoor ? 'The way out. The world is still there.' : 'The cottage wall. It keeps the weather out.') : 'Wooden floorboards. They creak in the same spot every time.',
        furniture:   null,
      };
    }
  }
  // Fix border corners
  interiorTileMap[0][0].glyph    = '╔'; interiorTileMap[W-1][0].glyph    = '╗';
  interiorTileMap[0][H-1].glyph  = '╚'; interiorTileMap[W-1][H-1].glyph  = '╝';

  function stamp(x1, x2, y1, y2, key, glyph, fg, desc, walkable) {
    for (let x = x1; x <= Math.min(x2, 18); x++) {
      for (let y = y1; y <= Math.min(y2, 9); y++) {
        if (x < 1 || x > 18 || y < 1 || y > 9) continue;
        interiorTileMap[x][y] = { walkable, glyph: glyph[0]||'.', fg, description: desc, furniture: key };
      }
    }
  }
  const fur = state.cottage.furniture;
  if (fur.kitchen)      stamp(1,8, 1,3, 'kitchen',      '#', '#aaaaaa', 'A modest kitchen. Functional.', false);
  if (fur.fireplace)    stamp(8,14,1,3, 'fireplace',    '{', '#ff9933', 'A small fireplace. The warmth is real.', false);
  if (fur.bed)          stamp(12,18,1,3,'bed',          '[', '#6688cc', 'A small bed. Adequate.', false);
  if (fur.clock)        stamp(1,5, 2,3, 'clock',        'o', '#aaaaaa', 'A wall clock. It keeps better time than you do.', false);
  if (fur.bookshelf)    stamp(14,18,2,4,'bookshelf',    '[', '#886633', 'Shelves of records. Your history, such as it is.', false);
  if (fur.table)        stamp(7,13,3,4, 'table',        '=', '#aa7744', 'A sturdy wooden table. Older than it looks.', false);
  if (fur.rockingchair) stamp(3,7, 5,6, 'rockingchair', '~', '#aa7744', 'A rocking chair. It faces the fire.', false);
  if (fur.rug)          stamp(8,12,5,5, 'rug',          '≈', '#886633', 'A braided rug. It anchors the room.', true);
  if (fur.candles)      stamp(7,11,6,6, 'candles',      'i', '#ffd633', "Two candles. They've been burning a while.", true);
  if (fur.mat)          stamp(9,14,9,9, 'mat',          '-', '#aa7744', 'A welcome mat. It says nothing but means it.', true);
  // Cat desc
  if (fur.cat) {
    const cx = state.cottage.catX, cy = state.cottage.catY;
    if (cx >= 1 && cx <= 18 && cy >= 1 && cy <= 9)
      interiorTileMap[cx][cy].description = 'Your cat. It has opinions but shares few of them.';
  }
}

function getCottageGlyphAt(ix, iy) {
  // Returns {ch, fg} for the look cursor to display
  const W = 20, H = 12;
  const fur = state.cottage.furniture;
  if (ix === state.cottage.playerX && iy === state.cottage.playerY) return { ch: '@', fg: state.player.color || BRIGHT_WHITE };
  if (fur.cat && ix === state.cottage.catX && iy === state.cottage.catY) return { ch: 'f', fg: '#cc9933' };
  if (interiorTileMap[ix] && interiorTileMap[ix][iy]) {
    const t = interiorTileMap[ix][iy];
    return { ch: t.glyph, fg: t.fg };
  }
  return { ch: ' ', fg: '#555555' };
}

function drawInteriorFurniture() {
  const OX = 30, OY = 15;
  const fur = state.cottage.furniture;
  function dp(ix, iy, ch, fg) { if (ix>=0&&ix<=19&&iy>=0&&iy<=11) display.draw(OX+ix, OY+iy, ch, fg, BG); }

  if (fur.kitchen) {
    ['[##][##]','|  ||  |','|__|  |_'].forEach((row, r) => {
      const fg = r===0?'#aaaaaa':'#886633';
      for (let i=0;i<row.length;i++) dp(1+i,1+r,row[i],fg);
    });
  }
  if (fur.fireplace) {
    const frames = [['{ ^ ^ }','#ff9933'],['{ * * }','#ffd633']];
    dp(8,1,'{',  '#886633'); dp(14,1,'}','#886633');
    for(let i=1;i<=5;i++) dp(8+i,1,' ','#886633');
    const [fRow, fFg] = frames[fireplaceFrame];
    for(let i=0;i<7;i++) dp(8+i,2,fRow[i],fFg);
    for(let i=0;i<7;i++) dp(8+i,3,('{_____}')[i],'#aaaaaa');
  }
  if (fur.bed) {
    ['[______]','|  zz  |','[______]'].forEach((row, r) => {
      for(let i=0;i<row.length&&12+i<=18;i++) {
        let ch=row[i], fg=r===1?'#aaaaaa':'#6688cc';
        if(r===1&&(i===3||i===4)){ch='z';fg='#ccccff';}
        dp(12+i,1+r,ch,fg);
      }
    });
  }
  if (fur.bookshelf) {
    for(let r=0;r<3;r++) for(let i=0;i<5;i++) dp(14+i,2+r,'[|||]'[i],'#886633');
  }
  if (fur.clock) {
    const faceColor = state.marketOpen?'#ffd633':'#cc66cc';
    [' (o) ',' |_| '].forEach((row, r) => {
      for(let i=0;i<5;i++) dp(1+i,2+r,row[i],(r===0&&i===2)?faceColor:'#aaaaaa');
    });
  }
  if (fur.table) {
    for(let i=0;i<7;i++) dp(7+i,3,'[=====]'[i],'#aa7744');
    for(let i=0;i<7;i++) dp(7+i,4,'  | |  '[i],'#886633');
  }
  if (fur.rockingchair) {
    [' (~) ','/___\\'].forEach((row,r) => {
      for(let i=0;i<5;i++) dp(3+i,5+r,row[i],r===0?'#aa7744':'#886633');
    });
  }
  if (fur.rug) {
    for(let i=0;i<5;i++) dp(8+i,5,'≈','#886633');
  }
  if (fur.candles) {
    const dot = candlePhase ? '·' : ' ';
    dp(7,6,'i','#ffd633'); dp(8,6,' ','#ffd633'); dp(9,6,dot,'#ffd633'); dp(10,6,' ','#ffd633'); dp(11,6,'i','#ffd633');
  }
  if (fur.mat) {
    for(let i=0;i<6;i++) dp(9+i,9,'[----]'[i],'#aa7744');
  }
}

function handleCottageInteract() {
  const px = state.cottage.playerX, py = state.cottage.playerY;
  const fur = state.cottage.furniture;
  // Cat adjacent
  if (fur.cat) {
    if (Math.abs(px-state.cottage.catX)<=1 && Math.abs(py-state.cottage.catY)<=1) {
      addLog('You pet the cat. It tolerates this.', '#cc9933'); renderLog(); return true;
    }
  }
  // Bookshelf adjacent (x=14..18, y=2..4)
  if (fur.bookshelf) {
    let adj=false;
    for(let bx=14;bx<=18&&!adj;bx++) for(let by=2;by<=4&&!adj;by++) if(Math.abs(px-bx)<=1&&Math.abs(py-by)<=1) adj=true;
    if(adj){ openBookshelfHistory(); return true; }
  }
  // Bed adjacent (x=12..18, y=1..3)
  if (fur.bed) {
    let adj=false;
    for(let bx=12;bx<=18&&!adj;bx++) for(let by=1;by<=3&&!adj;by++) if(Math.abs(px-bx)<=1&&Math.abs(py-by)<=1) adj=true;
    if(adj){ addLog('You lie down for a moment. The ceiling is very white.','#ccccff'); renderLog(); return true; }
  }
  // Rocking chair adjacent (x=3..7, y=5..6)
  if (fur.rockingchair) {
    let adj=false;
    for(let bx=3;bx<=7&&!adj;bx++) for(let by=5;by<=6&&!adj;by++) if(Math.abs(px-bx)<=1&&Math.abs(py-by)<=1) adj=true;
    if(adj){ addLog('You sit for a moment. The chair rocks slowly.','#aa7744'); renderLog(); return true; }
  }
  return false;
}

function openBookshelfHistory() {
  bookshelfOverlayActive = true;
  // Draw overlay on top of cottage interior
  const OX=30, OY=14, OW=20, OH=14;
  const TC='#aa66ff', DC='#333333';
  display.draw(OX,OY,'╔',TC,BG); display.draw(OX+OW-1,OY,'╗',TC,BG);
  for(let i=1;i<OW-1;i++) display.draw(OX+i,OY,'═',TC,BG);
  // Title
  { const ay=OY+1; display.draw(OX,'║',TC,BG); display.draw(OX+OW-1,OY+1,'║',TC,BG);
    const t='-- YOUR HISTORY --';
    for(let i=0;i<OW-2;i++) {
      const ci=i-(Math.floor((OW-2-t.length)/2));
      display.draw(OX+1+i,ay,(ci>=0&&ci<t.length)?t[ci]:' ',(ci>=0&&ci<t.length)?TC:DC,BG);
    }
  }
  // Separator
  { const ay=OY+2; display.draw(OX,'║',TC,BG); display.draw(OX+OW-1,ay,'║',TC,BG);
    for(let i=1;i<OW-1;i++) display.draw(OX+i,ay,'─',DC,BG); }
  // Entries (newest first)
  const entries = (state.bookshelfLog||[]).slice().reverse();
  const maxRows = OH-4;
  for(let r=0;r<maxRows;r++) {
    const ay=OY+3+r;
    display.draw(OX,'║',TC,BG); display.draw(OX+OW-1,ay,'║',TC,BG);
    if(r<entries.length) {
      const e=entries[r];
      const dayStr=`Day ${e.day}: `;
      const text=(dayStr+e.text).slice(0,OW-2);
      for(let i=0;i<OW-2;i++) {
        const ch=i<text.length?text[i]:' ';
        const fg=i<dayStr.length?TC:'#aaaaaa';
        display.draw(OX+1+i,ay,ch,fg,BG);
      }
    } else if(entries.length===0&&r===0) {
      const t='Nothing recorded yet.';
      for(let i=0;i<OW-2;i++) display.draw(OX+1+i,ay,i<t.length?t[i]:' ','#555555',BG);
    } else {
      for(let i=0;i<OW-2;i++) display.draw(OX+1+i,ay,' ',BRIGHT_WHITE,BG);
    }
  }
  // Footer + bottom
  { const ay=OY+OH-2; display.draw(OX,'║',TC,BG); display.draw(OX+OW-1,ay,'║',TC,BG);
    const f='ESC: close'; for(let i=0;i<OW-2;i++) display.draw(OX+1+i,ay,i<f.length?f[i]:' ',DC,BG); }
  display.draw(OX,OY+OH-1,'╚',TC,BG); display.draw(OX+OW-1,OY+OH-1,'╝',TC,BG);
  for(let i=1;i<OW-1;i++) display.draw(OX+i,OY+OH-1,'═',TC,BG);
}

function drawCottageInterior() {
  const OX = 30, OY = 15;
  const W = 20, H = 12;
  const TC = '#886633';
  const FC = '#1a1208';
  const WARMC = '#2a1a0a';
  const fur = state.cottage.furniture;

  // Top border
  display.draw(OX, OY, '╔', TC, BG);
  for (let i = 1; i < W-1; i++) display.draw(OX+i, OY, '═', TC, BG);
  display.draw(OX+W-1, OY, '╗', TC, BG);

  // Walkable rows y=1..9
  for (let iy = 1; iy <= 9; iy++) {
    const sy = OY + iy;
    display.draw(OX, sy, '║', TC, BG);
    for (let ix = 1; ix <= 18; ix++) {
      const warm = fur.fireplace && iy === 4 && ix >= 7 && ix <= 14;
      display.draw(OX+ix, sy, '.', warm ? WARMC : FC, BG);
    }
    display.draw(OX+W-1, sy, '║', TC, BG);
  }

  // Row 10: bottom wall with door indicator
  { const sy = OY + 10;
    display.draw(OX, sy, '║', TC, BG);
    for (let ix = 1; ix <= 18; ix++)
      display.draw(OX+ix, sy, ix===10?'.':' ', ix===10?'#cc9933':'#333333', BG);
    display.draw(OX+W-1, sy, '║', TC, BG);
  }

  // Bottom border
  display.draw(OX, OY+H-1, '╚', TC, BG);
  for (let i = 1; i < W-1; i++) display.draw(OX+i, OY+H-1, '═', TC, BG);
  display.draw(OX+W-1, OY+H-1, '╝', TC, BG);

  // Furniture
  drawInteriorFurniture();

  // Cat
  if (fur.cat) display.draw(OX+state.cottage.catX, OY+state.cottage.catY, 'f', '#cc9933', BG);

  // Player
  display.draw(OX+state.cottage.playerX, OY+state.cottage.playerY, '@', state.player.color||BRIGHT_WHITE, BG);

  // Hint row
  if (cottageLookActive) {
    // Look mode: show description
    const ix = cottageLookX, iy = cottageLookY;
    let desc = '';
    if (iy===0||iy===H-1||ix===0||ix===W-1||iy===10) {
      desc = (ix===10&&iy===10) ? 'The way out. The world is still there.' : 'The cottage wall. It keeps the weather out.';
    } else if (ix===state.cottage.playerX && iy===state.cottage.playerY) {
      desc = "That's you. You're home.";
    } else if (fur.cat && ix===state.cottage.catX && iy===state.cottage.catY) {
      desc = 'Your cat. It has opinions but shares few of them.';
    } else if (interiorTileMap[ix] && interiorTileMap[ix][iy]) {
      desc = interiorTileMap[ix][iy].description;
    } else {
      desc = 'Wooden floorboards. They creak in the same spot every time.';
    }
    const dStr = desc.slice(0, DISPLAY_WIDTH);
    for (let i = 0; i < DISPLAY_WIDTH; i++) display.draw(i, OY+H, i<dStr.length?dStr[i]:' ', '#aa66ff', BG);
    // Look cursor
    const { ch, fg } = getCottageGlyphAt(ix, iy);
    display.draw(OX+ix, OY+iy, ch, BG, fg);
  } else {
    const hint = '[ move: arrows | interact: space | look: o | exit: esc ]';
    for (let i = 0; i < DISPLAY_WIDTH; i++) display.draw(i, OY+H, i<hint.length?hint[i]:' ', '#444444', BG);
  }

  if (bookshelfOverlayActive) openBookshelfHistory();
}

function enterCottage() {
  state.cottage.playerX = 10;
  state.cottage.playerY = 5;
  state.cottage.matLoggedThisVisit = false;
  cottageLookActive = false;
  bookshelfOverlayActive = false;
  buildInteriorTileMap();
  state.gameState = 'cottage';
  clearScreen();
  drawCottageInterior();
  drawStatusBar();
  if (!state.cottage.visited) {
    state.cottage.visited = true;
    addLog('You step inside. It smells of pine and old dust.', '#886633');
    renderLog();
  }
}

function exitCottage() {
  cottageLookActive = false;
  bookshelfOverlayActive = false;
  state.gameState = 'playing';
  state.player.x = state.cottage.mapX + 3;
  state.player.y = state.cottage.mapY + 4;
  drawWorld();
  drawStatusBar();
  renderLog();
  // Immediately re-render worker glyphs at their current positions
  for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
  for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
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
    showOfficeMenu();
    return;
  }
  const gsStation = STATION_DEFS.find(s => s.label === 'GS');
  if (gsStation && isAdjacentToStation(gsStation) && state.stations.general_store?.unlocked) { openGeneralStoreMenu(); return; }
  const stStation = STATION_DEFS.find(s => s.label === 'ST');
  if (stStation && isAdjacentToStation(stStation)) { openStorageMenu(); return; }
  const bkStation = STATION_DEFS.find(s => s.label === 'BK');
  if (bkStation && isAdjacentToStation(bkStation)) { openBankMenu(); return; }
  const trStation = STATION_DEFS.find(s => s.label === 'TR');
  if (trStation && isAdjacentToStation(trStation)) { openDerivativesMenu(); return; }
  const lfStation = STATION_DEFS.find(s => s.label === 'LF');
  if (lfStation && isAdjacentToStation(lfStation) && state.stations.launch_facility?.unlocked) { openLFMenu(); return; }
  const npStation = STATION_DEFS.find(s => s.label === 'NP');
  if (npStation && isAdjacentToStation(npStation) && state.stations.newspaper?.unlocked) { openNewspaperMenu(); return; }
  // Cottage door entry
  if (state.cottage.owned) {
    const doorX = state.cottage.mapX + 3, doorY = state.cottage.mapY + 3;
    const px = state.player.x, py = state.player.y;
    if (Math.abs(px - doorX) <= 1 && Math.abs(py - doorY) <= 1) { enterCottage(); return; }
  }
  // Remote crafting via INTERFACING skill (not adjacent to workbench)
  if ((state.skills.interfacing?.pips || 0) >= 1 && state.player.inventory.rm > 0) {
    openWorkbenchMenu(true); return;
  }
}

// ── Inventory screen (§3.9) ──────────────────────────────────────────────────

function showInventory() {
  state.gameState = 'inventory';
  let tab           = 'stocks'; // 'stocks' | 'ops' | 'skills'
  let workerScroll  = 0;
  let selectedSkill = null; // null | 'endurance' | 'aquatics' | 'interfacing'
  let skillErrMsg   = null;
  let skillErrTimer = null;

  const TABS    = ['stocks', 'ops', 'skills'];
  const BOX_W   = 54;
  const BOX_H   = 25; // rows 0–24
  const BOX_X   = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y   = Math.max(2, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const IW      = 52; // inner width
  const BC      = '#66ccff'; // border color
  const DC      = '#333333';
  const WC      = '#555555';
  const LP_W    = 24; // left pane (skills/ops)
  const RP_W    = 27; // right pane (skills/ops)
  const CONT_X  = BOX_X + 1; // left edge of inner content

  // Tab bar string exactly 52 chars
  const TAB_BAR = '    [ STOCKS ]  │  [ OPERATIONS ]  │  [ SKILLS ]    ';
  const TAB_RANGES = { stocks: [4,13], ops: [19,32], skills: [38,47] };
  const TAB_NAMES  = { stocks: 'STOCKS', ops: 'OPERATIONS', skills: 'SKILLS' };

  const SKILL_DEFS = [
    { key: 'endurance',   name: 'ENDURANCE',   maxPips: 3, costs: [500, 5000, 50000],
      descs: ['You can carry more than before.', 'Your carrying capacity has grown significantly.', 'You can carry a remarkable amount.'] },
    { key: 'aquatics',    name: 'AQUATICS',    maxPips: 1, costs: [5000],
      descs: ['The water no longer stops you.'] },
    { key: 'interfacing', name: 'INTERFACING', maxPips: 3, costs: [500, 5000, 50000],
      descs: ['You no longer need the bench to work.', 'Your technique is improving.', "You've refined this to near-instinct."] },
  ];

  // ── Drawing helpers ───────────────────────────────────────────────────────
  function border(ay) {
    display.draw(BOX_X, ay, '║', BC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', BC, BG);
  }
  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, p[i] || ' ', fg, BG);
  }
  function lrow(ay, text, fg) { // left pane (LP_W chars)
    const p = menuPad(text, LP_W);
    for (let i = 0; i < LP_W; i++) display.draw(CONT_X + i, ay, p[i] || ' ', fg, BG);
  }
  function rrow(ay, text, fg) { // right pane (RP_W chars)
    const p = menuPad(text, RP_W);
    for (let i = 0; i < RP_W; i++) display.draw(CONT_X + LP_W + 1 + i, ay, p[i] || ' ', fg, BG);
  }
  function divider(ay) { display.draw(CONT_X + LP_W, ay, '│', DC, BG); }
  function splitRow(ay, ltxt, rtxt, lfg, rfg) { border(ay); lrow(ay,ltxt,lfg); divider(ay); rrow(ay,rtxt,rfg); }

  function drawBar(ay, label, current, max, barFg, labelFg) {
    border(ay);
    const BAR_W = 12;
    const filled = max > 0 ? Math.min(Math.round(current/max*BAR_W), BAR_W) : 0;
    let c = CONT_X;
    const lbl = menuPad(label, 18);
    for (let i = 0; i < 18; i++) display.draw(c++, ay, lbl[i], labelFg, BG);
    display.draw(c++, ay, '[', WC, BG);
    for (let i = 0; i < BAR_W; i++) display.draw(c++, ay, i<filled?'=':' ', i<filled?barFg:WC, BG);
    display.draw(c++, ay, ']', WC, BG);
    const val = menuPad(`${current}/${max}`, IW - 18 - 1 - BAR_W - 1);
    for (let i = 0; i < val.length; i++) display.draw(c++, ay, val[i]||' ', labelFg, BG);
  }

  function drawFrame() {
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);
    // Row 0: ╔═52═╗
    display.draw(BOX_X, BOX_Y, '╔', BC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', BC, BG);
    for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y, '═', BC, BG);
    // Row 1: header
    { const ay = BOX_Y+1; border(ay);
      const title = `INVENTORY [${TAB_NAMES[tab]}]`, hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW-hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? BRIGHT_WHITE : (i >= IW-hint.length ? DC : BRIGHT_WHITE);
        display.draw(CONT_X+i, ay, ch, fg, BG);
      }
    }
    // Row 2: ═
    { const ay = BOX_Y+2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X+i, ay, '═', DC, BG); }
    // Row 3: tab bar
    { const ay = BOX_Y+3; border(ay);
      const [s,e] = TAB_RANGES[tab];
      for (let i = 0; i < IW; i++) {
        const ch = TAB_BAR[i] || ' ';
        display.draw(CONT_X+i, ay, ch, (i>=s && i<=e) ? BC : DC, BG);
      }
    }
    // Row 22: ═
    { const ay = BOX_Y+22; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X+i, ay, '═', DC, BG); }
    // Row 24: ╚═52═╝
    display.draw(BOX_X, BOX_Y+24, '╚', BC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+24, '╝', BC, BG);
    for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y+24, '═', BC, BG);
  }

  // ── STOCKS tab ────────────────────────────────────────────────────────────
  function redrawStocks() {
    const inv = state.player.inventory;
    const cap = state.player.inventoryCaps;
    drawBar(BOX_Y+4, 'Raw Materials', inv.rm,      cap.rm,      '#66cc66', '#ff9933');
    drawBar(BOX_Y+5, 'Widgets',       inv.widgets, cap.widgets, '#66cc66', BRIGHT_WHITE);
    irow(BOX_Y+6, '─'.repeat(IW), DC);
    { // Credits sym row
      border(BOX_Y+7);
      const SYM_W = 16, syms = Math.min(Math.floor(state.player.credits/10), SYM_W);
      let c = CONT_X;
      const lbl = menuPad('Credits', 16);
      for (let i = 0; i < 16; i++) display.draw(c++, BOX_Y+7, lbl[i], WC, BG);
      for (let i = 0; i < SYM_W; i++) display.draw(c++, BOX_Y+7, i<syms?'$':' ', i<syms?'#ffd633':WC, BG);
      const val = menuPad(`${formatCredits(state.player.credits)}cr`, IW-16-SYM_W);
      for (let i = 0; i < val.length; i++) display.draw(c++, BOX_Y+7, val[i]||' ', '#ffd633', BG);
    }
    { // Stamps row
      border(BOX_Y+8);
      const SDOT_W = 20;
      const stamps  = state.player.stamps;
      const dots    = Math.min(stamps, SDOT_W);
      const overflow = stamps > SDOT_W;
      let c = CONT_X;
      const lbl = menuPad('Stamps', 16);
      for (let i = 0; i < 16; i++) display.draw(c++, BOX_Y+8, lbl[i], '#555555', BG);
      for (let i = 0; i < SDOT_W; i++) display.draw(c++, BOX_Y+8, i < dots ? '·' : ' ', COLOR_STAMPS, BG);
      display.draw(c++, BOX_Y+8, overflow ? '+' : ' ', COLOR_STAMPS, BG);
      const val = menuPad(String(stamps), IW-16-SDOT_W-1);
      for (let i = 0; i < val.length; i++) display.draw(c++, BOX_Y+8, val[i]||' ', COLOR_STAMPS, BG);
    }
    { // Lifetime sym row
      border(BOX_Y+9);
      const SYM_W = 16, syms = Math.min(Math.floor(state.lifetimeCreditsEarned/10), SYM_W);
      let c = CONT_X;
      const lbl = menuPad('Lifetime', 16);
      for (let i = 0; i < 16; i++) display.draw(c++, BOX_Y+9, lbl[i], WC, BG);
      for (let i = 0; i < SYM_W; i++) display.draw(c++, BOX_Y+9, i<syms?'~':' ', i<syms?WC:WC, BG);
      const val = menuPad(`${formatCredits(state.lifetimeCreditsEarned)}cr`, IW-16-SYM_W);
      for (let i = 0; i < val.length; i++) display.draw(c++, BOX_Y+9, val[i]||' ', WC, BG);
    }
    irow(BOX_Y+10, '─'.repeat(IW), DC);
    if (state.phase >= 3) {
      irow(BOX_Y+11, 'MARKET REPORT', BC);
      const dl = demandLabel(state.demand);
      irow(BOX_Y+12, `Demand today:   ${String(state.demand).padStart(3)} widgets  (${dl.text})`, dl.fg);
      irow(BOX_Y+13, `Price today:    ${state.marketPrice}cr`, BRIGHT_WHITE);
      irow(BOX_Y+14, `Sold today:     ${state.widgetsSoldToday} / ${state.demand}`, BRIGHT_WHITE);
      irow(BOX_Y+15, `Remaining:      ${Math.max(0, state.demand-state.widgetsSoldToday)} widgets`, BRIGHT_WHITE);
    } else {
      irow(BOX_Y+11, 'MARKET REPORT — available in Phase 3', WC);
    }
    const ms  = state.marketOpen ? 'OPEN' : 'CLOSED';
    const mFg = state.marketOpen ? BRIGHT_YELLOW : WC;
    const mRem = state.marketOpen ? (180-state.dayTick) : (240-state.dayTick);
    const statusLine = `Day ${state.day}  •  Market: ${ms}  •  ${mRem}s left`;
    irow(BOX_Y+23, statusLine, BRIGHT_WHITE);
  }

  // ── OPERATIONS tab ────────────────────────────────────────────────────────
  function redrawOps() {
    const sep = LP_W; // divider at column sep within inner
    for (let r = 4; r <= 21; r++) { border(BOX_Y+r); divider(BOX_Y+r); }
    lrow(BOX_Y+4, 'PRODUCTION STATS', '#ffd633');
    const avg  = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;
    const rRM  = avg(state.stats.rmLastTen);
    const rWg  = avg(state.stats.widgetsLastTen);
    const rCr  = avg(state.stats.creditsLastTen);
    const cFg  = rCr >= 0 ? '#66cc66' : '#ff5555';
    lrow(BOX_Y+5,  `RM/sec    ${Math.abs(rRM).toFixed(1)}`, BRIGHT_WHITE);
    lrow(BOX_Y+6,  `Wdgt/sec  ${rWg.toFixed(1)}`, BRIGHT_WHITE);
    lrow(BOX_Y+7,  `Cr/sec  ${(rCr>=0?'+':'')}${rCr.toFixed(1)}cr`, cFg);
    for (let i = 0; i < LP_W; i++) display.draw(CONT_X+i, BOX_Y+8, '─', DC, BG);
    lrow(BOX_Y+9,  'Today', BRIGHT_WHITE);
    lrow(BOX_Y+10, `RM in inv.${String(state.player.inventory.rm).padStart(LP_W-10)}`, BRIGHT_WHITE);
    lrow(BOX_Y+11, `Wdgts made${String(state.stats.widgetsMadeToday).padStart(LP_W-10)}`, BRIGHT_WHITE);
    lrow(BOX_Y+12, `Wdgts sold${String(state.widgetsSoldToday).padStart(LP_W-10)}`, BRIGHT_WHITE);
    lrow(BOX_Y+13, `Revenue${(formatCredits(state.stats.revenueToday)+'cr').padStart(LP_W-7)}`, '#66cc66');
    lrow(BOX_Y+14, `Costs  ${(formatCredits(state.stats.costsToday)+'cr').padStart(LP_W-7)}`, '#ff5555');
    const net  = Math.round((state.stats.revenueToday - state.stats.costsToday)*10)/10;
    const netS = (net>=0?'+':'')+formatCredits(net)+'cr';
    lrow(BOX_Y+15, `Net${netS.padStart(LP_W-3)}`, net>=0?'#66cc66':'#ff5555');

    // Right pane — workers
    const allW = [
      ...state.workers.apprentices.map((w,i)=>({type:'appr',idx:i,w})),
      ...state.workers.couriers.map((c,i)=>({type:'cour',idx:i,w:c})),
    ];
    const LINES_PER = 5, maxVis = Math.floor(14/LINES_PER);
    if (allW.length === 0) {
      rrow(BOX_Y+10, 'No workers', WC);
      rrow(BOX_Y+11, 'hired yet.', WC);
    } else {
      workerScroll = Math.min(workerScroll, Math.max(0, allW.length - maxVis));
      if (workerScroll > 0)                    rrow(BOX_Y+4, '▲'.padStart(RP_W), WC);
      if (workerScroll+maxVis < allW.length)   rrow(BOX_Y+18,'▼'.padStart(RP_W), WC);
      let row = BOX_Y+5;
      for (let wi = workerScroll; wi < Math.min(workerScroll+maxVis, allW.length); wi++) {
        const {type,idx,w} = allW[wi];
        if (type === 'appr') {
          const st = w.paused ? 'idle' : w.workerState;
          let fFg, fig2, stLbl, taskLbl;
          if (st==='crafting') { fFg='#ff9933'; fig2='[=]'; stLbl='CRAFTING'; taskLbl='making widget'; }
          else if (st==='fetching'||st==='returning') { fFg='#66ccff'; fig2='\\|/'; stLbl='WORKING'; taskLbl=st==='fetching'?'RM→WB':'WB→RM'; }
          else { fFg=WC; fig2='...'; stLbl=w.paused?'PAUSED':'IDLE'; taskLbl='waiting'; }
          rrow(row,   `[o] ${workerLabel(w, idx, 'appr')}`, fFg);
          rrow(row+1, `${fig2} ${stLbl}`, fFg);
          rrow(row+2, `    ${taskLbl}`, WC);
        } else {
          const st = w.courierState;
          let fFg, fig2, stLbl, taskLbl;
          if (st==='loading') { fFg='#cc66cc'; fig2='/=\\'; stLbl='LOADING'; taskLbl='at STG'; }
          else if (st==='delivering') { fFg='#ffd633'; fig2='>>>'; stLbl='DLVRING'; taskLbl='STG→MKT'; }
          else if (st==='returning')  { fFg=WC; fig2='<<<'; stLbl='RETURN'; taskLbl='MKT→STG'; }
          else { fFg=WC; fig2='/=\\'; stLbl='IDLE'; taskLbl='waiting'; }
          rrow(row,   `[>] ${workerLabel(w, idx, 'courier')}`, fFg);
          rrow(row+1, `${fig2} ${stLbl}`, fFg);
          rrow(row+2, `    ${taskLbl}`, WC);
        }
        row += LINES_PER;
      }
    }
    const opsStatus = `${state.workers.apprentices.length} apprentice${state.workers.apprentices.length!==1?'s':''}, ${state.workers.couriers.length} courier${state.workers.couriers.length!==1?'s':''}.`;
    irow(BOX_Y+23, opsStatus, WC);
  }

  // ── SKILLS tab ────────────────────────────────────────────────────────────
  function getSkillPips(def) {
    if (def.key === 'aquatics') return state.skills.aquatics?.purchased ? 1 : 0;
    return state.skills[def.key]?.pips || 0;
  }

  function redrawSkills() {
    for (let r = 4; r <= 21; r++) { border(BOX_Y+r); divider(BOX_Y+r); }

    // Left pane — skill list
    SKILL_DEFS.forEach((def, si) => {
      const pips  = getSkillPips(def);
      const baseR = BOX_Y + 4 + si * 4;
      const isActive = selectedSkill === def.key;
      const nameFg   = isActive ? BRIGHT_WHITE : WC;
      lrow(baseR, `${si+1}. ${def.name}`, nameFg);
      // pip + cost row
      const nextCost = pips < def.maxPips ? def.costs[pips] : null;
      let col = 0;
      let c = CONT_X;
      for (let pi = 0; pi < def.maxPips; pi++) {
        const bought = pi < pips;
        const fg = bought ? '#66cc66' : DC;
        display.draw(c++, baseR+1, '[', fg, BG);
        display.draw(c++, baseR+1, bought ? '●' : '○', fg, BG);
        display.draw(c++, baseR+1, ']', fg, BG);
        col += 3;
      }
      display.draw(c++, baseR+1, ' ', BRIGHT_WHITE, BG); col++;
      if (nextCost !== null) {
        const costStr = nextCost.toLocaleString('en-US') + 'cr';
        for (const ch of costStr) { display.draw(c++, baseR+1, ch, WC, BG); col++; }
      } else {
        const done = '✓ DONE';
        for (const ch of done) { display.draw(c++, baseR+1, ch, '#66cc66', BG); col++; }
      }
      // Fill rest of left pane
      while (col < LP_W) { display.draw(c++, baseR+1, ' ', BRIGHT_WHITE, BG); col++; }
    });

    // Right pane — selected skill detail
    if (!selectedSkill) {
      rrow(BOX_Y+8, 'Select a skill', WC);
      rrow(BOX_Y+9, 'with 1 / 2 / 3', WC);
    } else {
      const def  = SKILL_DEFS.find(d => d.key === selectedSkill);
      const pips = getSkillPips(def);
      rrow(BOX_Y+4, def.name, BC);
      if (pips > 0) {
        const descLines = wordWrap(def.descs[pips-1], RP_W);
        for (let li = 0; li < Math.min(descLines.length, 4); li++)
          rrow(BOX_Y+6+li, descLines[li], BRIGHT_WHITE);
      } else {
        rrow(BOX_Y+6, '???', WC);
      }
      if (pips >= def.maxPips) {
        rrow(BOX_Y+11, 'MASTERED', '#66cc66');
      } else {
        const nextCost = def.costs[pips];
        const canAfford = state.player.credits >= nextCost;
        rrow(BOX_Y+11, (pips === 0 ? 'Cost: ' : 'Next pip: ') + nextCost.toLocaleString('en-US') + 'cr', canAfford ? BRIGHT_WHITE : WC);
        const ski = SKILL_DEFS.indexOf(def) + 1;
        rrow(BOX_Y+13, `${ski}. Purchase`, canAfford ? '#66cc66' : WC);
        rrow(BOX_Y+14, 'ESC: Back', WC);
        if (skillErrMsg) rrow(BOX_Y+16, skillErrMsg, '#ff5555');
      }
    }
    const allDone = SKILL_DEFS.every(d => getSkillPips(d) >= d.maxPips);
    irow(BOX_Y+23, allDone ? 'All skills mastered.' : 'Purchase upgrades with credits.', allDone ? '#66cc66' : WC);
  }

  function attemptPurchase() {
    if (!selectedSkill) return;
    const def  = SKILL_DEFS.find(d => d.key === selectedSkill);
    const pips = getSkillPips(def);
    if (pips >= def.maxPips) return;
    const cost = def.costs[pips];
    if (state.player.credits < cost) {
      skillErrMsg = 'Insufficient credits.';
      if (skillErrTimer) clearTimeout(skillErrTimer);
      skillErrTimer = setTimeout(() => { skillErrMsg = null; redraw(); }, 2000);
      redraw(); return;
    }
    state.player.credits -= cost;
    if (selectedSkill === 'endurance') {
      const np = (state.skills.endurance.pips || 0) + 1;
      state.skills.endurance.pips = np;
      if (np === 1) { state.player.inventoryCaps.rm = 10; state.player.inventoryCaps.widgets = 10; }
      else if (np === 2) { state.player.inventoryCaps.rm = 50; state.player.inventoryCaps.widgets = 50; }
      else if (np === 3) { state.player.inventoryCaps.rm = 100; state.player.inventoryCaps.widgets = 100; }
    } else if (selectedSkill === 'aquatics') {
      state.skills.aquatics.purchased = true;
      for (const t of shimmerTiles) tileMap[t.x][t.y].playerWalkable = true;
    } else if (selectedSkill === 'interfacing') {
      const np = (state.skills.interfacing.pips || 0) + 1;
      state.skills.interfacing.pips = np;
      if (np === 1) state.craftingTimeRemote = 10;
      else if (np === 2) state.craftingTimeRemote = 7;
      else if (np === 3) state.craftingTimeRemote = 5;
    }
    addLog(`${def.name} upgraded.`, '#66ccff');
    drawStatusBar();
    redraw();
  }

  // ── Main redraw ───────────────────────────────────────────────────────────
  function redraw() {
    drawFrame();
    if (tab === 'stocks') redrawStocks();
    else if (tab === 'ops') redrawOps();
    else redrawSkills();
  }

  inventoryRedrawFn = redraw;
  redraw();

  function closeInventory() {
    inventoryRedrawFn = null;
    if (skillErrTimer) clearTimeout(skillErrTimer);
    window.removeEventListener('keydown', invKeyHandler);
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  function invKeyHandler(e) {
    if (e.key === 'Escape' || e.key === 'i') { closeInventory(); return; }
    if (e.key === 'ArrowLeft')  {
      const i = TABS.indexOf(tab); tab = TABS[(i - 1 + TABS.length) % TABS.length];
      selectedSkill = null; workerScroll = 0; redraw(); return;
    }
    if (e.key === 'ArrowRight') {
      const i = TABS.indexOf(tab); tab = TABS[(i + 1) % TABS.length];
      selectedSkill = null; workerScroll = 0; redraw(); return;
    }
    if (tab === 'ops') {
      if (e.key === 'ArrowUp')   { workerScroll = Math.max(0, workerScroll - 1); redraw(); }
      if (e.key === 'ArrowDown') { workerScroll++; redraw(); }
    }
    if (tab === 'skills') {
      const keyToSkill = { '1': 'endurance', '2': 'aquatics', '3': 'interfacing' };
      const sk = keyToSkill[e.key];
      if (sk) {
        if (selectedSkill === sk) { attemptPurchase(); }
        else { selectedSkill = sk; skillErrMsg = null; redraw(); }
        return;
      }
    }
  }
  window.addEventListener('keydown', invKeyHandler);
}

// ── Worker helpers (§5.3) ────────────────────────────────────────────────────

function workerLabel(w, idx, type) {
  if (w.nickname) return w.nickname;
  return type === 'courier' ? `Courier ${idx + 1}` : `Apprentice ${idx + 1}`;
}

// ── Newspaper menu (§13) ──────────────────────────────────────────────────────

function openNewspaperMenu() {
  if (!state.stations.newspaper?.unlocked) return;
  state.gameState = 'newspaper';

  const NC    = '#ccaa44'; // newsprint gold
  const LC    = '#f0f0f0';
  const DC    = '#333333';
  const HL    = '#ffdd66'; // headline gold
  const BOX_W = 60;
  const IW    = 58;        // inner width
  const LP_W  = 16;        // left pane (art)
  const RP_W  = 41;        // right pane
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);

  const NP_ART = [
    ' _____________ ',
    '|  THE DAILY  |',
    '|    WIDGET   |',
    '|=============|',
    '| ## ## ## ## |',
    '| ## ## ## ## |',
    '| ## ## ## ## |',
    '|-------------|',
    '| [  PRESS  ] |',
    '|_____________|',
    '  |||     ||| ',
    '  ___     ___ ',
  ];

  const BULLISH_STORIES = [
    { label: 'Endorse by industry figure',  headline: 'INDUSTRY FIGURE ENDORSES WIDGETS — demand expected to surge',     nudge: +15 },
    { label: 'Gov. subsidy incoming',        headline: 'GOVERNMENT WIDGET SUBSIDY INCOMING — analysts bullish',              nudge: +15 },
    { label: 'Widgets cure mild ailments',   headline: 'WIDGETS LINKED TO HEALTH BENEFITS — sales forecast strong',        nudge: +15 },
    { label: 'Supply running critically low',headline: 'SUPPLY RUNNING CRITICALLY LOW — buyers urged to act now',           nudge: +15 },
    { label: 'Rival producer has gone under',headline: 'RIVAL WIDGET PRODUCER CONFIRMS CLOSURE — market share up',         nudge: +15 },
  ];
  const BEARISH_STORIES = [
    { label: 'Link to food-borne illness',   headline: 'WIDGETS LINKED TO FOOD-BORNE ILLNESS OUTBREAK — demand at risk',   nudge: -15 },
    { label: 'Factory environmental breach', headline: 'FACTORY ENVIRONMENTAL VIOLATIONS REPORTED — confidence shaken',    nudge: -15 },
    { label: 'Competing product superior',   headline: 'COMPETING PRODUCT OUTPERFORMS WIDGETS IN INDEPENDENT TESTS',       nudge: -15 },
    { label: 'Widgets contain banned material',headline: 'WIDGETS CONTAIN BANNED MATERIALS — investigation underway',     nudge: -15 },
    { label: 'Demand survey shows sharp drop',headline: 'DEMAND SURVEY SHOWS SHARP DROP — analysts downgrade outlook',    nudge: -15 },
  ];

  let npSel     = 0;   // 0-9 (bullish 0-4, bearish 5-9), or 0-14 with smear
  let npConfirm = false;

  const hasSkill  = !!state.skills.plantStory;
  const hasSmear  = !!state.skills.smearCampaign;
  const onCooldown = () => (state.day - (state.stations.newspaper.lastManipulationDay ?? -99)) < 3;

  function allStories() {
    const list = [];
    BULLISH_STORIES.forEach((s, i) => list.push({ ...s, tier: 'plant',  cost: 500,  letter: String.fromCharCode(97+i) }));
    BEARISH_STORIES.forEach((s, i) => list.push({ ...s, tier: 'plant',  cost: 500,  letter: String.fromCharCode(102+i) }));
    if (hasSmear) {
      BULLISH_STORIES.forEach((s, i) => list.push({ ...s, nudge: +30, tier: 'smear', cost: 2000, letter: String(i+1) }));
      BEARISH_STORIES.forEach((s, i) => list.push({ ...s, nudge: -30, tier: 'smear', cost: 2000, letter: String(i+6) }));
    }
    return list;
  }

  // Compute BOX_H based on what's shown
  function calcBOX_H() {
    if (!hasSkill)            return 28;
    if (onCooldown())         return 24;
    if (!hasSmear)            return 36;
    return 46;
  }

  function redraw() {
    const BOX_H = calcBOX_H();
    const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
    const LP_X  = BOX_X + 1;
    const RP_X  = BOX_X + 1 + LP_W + 1;
    const animFrame = (state.newspaper.animTick >> 2) & 1; // flip every 4 ticks

    function border(ay) { display.draw(BOX_X, ay, '║', NC, BG); display.draw(BOX_X + BOX_W - 1, ay, '║', NC, BG); }
    function lp(ay, text, fg) {
      const p = menuPad(text, LP_W);
      for (let i = 0; i < LP_W; i++) display.draw(LP_X + i, ay, p[i]||' ', fg, BG);
    }
    function rp(ay, text, fg) {
      const p = menuPad(text, RP_W);
      for (let i = 0; i < RP_W; i++) display.draw(RP_X + i, ay, p[i]||' ', fg, BG);
    }
    function fullRow(ay, text, fg) {
      border(ay);
      const p = menuPad(text, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i]||' ', fg, BG);
    }
    function sep(ay) { fullRow(ay, '─'.repeat(IW), DC); }

    // Clear
    for (let r = 1; r < BOX_H - 1; r++) for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', LC, BG);

    // Top border
    display.draw(BOX_X, BOX_Y, '╔', NC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', NC, BG);
    for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y, '═', NC, BG);

    // Row 1: title
    { const ay = BOX_Y + 1; border(ay);
      const title = 'THE DAILY WIDGET', hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? LC : (i >= IW - hint.length ? DC : LC);
        display.draw(BOX_X + 1 + i, BOX_Y + 1, ch, fg, BG);
      }
    }

    // Row 2: ═ separator
    { const ay = BOX_Y + 2; border(ay); for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, '═', DC, BG); }

    // Rows 3-14: art pane + right pane
    for (let r = 0; r < 12; r++) {
      const ay = BOX_Y + 3 + r;
      border(ay);
      // Art pane
      const artLine = NP_ART[r] || '                ';
      for (let i = 0; i < LP_W; i++) {
        let fg = NC;
        if (r === 1 || r === 2) fg = HL; // "THE DAILY" / "WIDGET" text
        if (r >= 4 && r <= 6)   fg = animFrame === 0 ? '#555555' : '#444444'; // animated ## columns
        if (r === 8)             fg = NC; // [  PRESS  ]
        if (r === 10 || r === 11) fg = '#aaaaaa'; // press legs
        display.draw(LP_X + i, ay, artLine[i]||' ', fg, BG);
      }
      // Divider
      display.draw(BOX_X + 1 + LP_W, ay, '│', DC, BG);
      // Right pane (cleared already)
    }

    // Right pane content
    const hdl = state.newspaper.todayHeadline || '(no report yet today)';
    const hdlWrapped = wordWrap(hdl, 38);
    rp(BOX_Y+4,  'TODAY\'S REPORT', NC);
    hdlWrapped.slice(0, 2).forEach((line, i) => rp(BOX_Y + 6 + i, line, LC));
    const fLabel = state.newspaper.tomorrowForecastLabel || '—';
    const FORECAST_FG = { Strong:'#66cc66', Positive:'#66cc66', Mixed:'#ffd633', Weak:'#ff9933', Poor:'#ff5555' };
    rp(BOX_Y+9,  `Tomorrow's outlook: ${fLabel}`, FORECAST_FG[fLabel] || '#aaaaaa');
    const eD = Math.round(50 + 30 * Math.sin((state.day+1) / 7 * 2 * Math.PI));
    rp(BOX_Y+10, `Expected demand: ~${eD} widgets`, '#555555');
    for (let i = 0; i < 39; i++) display.draw(RP_X + i, BOX_Y+12, '═', DC, BG);
    rp(BOX_Y+13, hasSkill ? 'INFLUENCE THE NARRATIVE' : 'STANDARD EDITION', hasSkill ? NC : DC);

    // Row 15: separator
    sep(BOX_Y + 15);

    // Story section rows start at BOX_Y+16
    let cr = BOX_Y + 16;
    if (!hasSkill) {
      fullRow(cr++, 'This is a standard subscription.', '#555555');
      cr++; // blank
      fullRow(cr++, 'Influence options available via', '#555555');
      fullRow(cr++, 'the Office (MARKETING section).', '#555555');
      cr++;
      fullRow(cr++, '  Plant a Story:     1,500cr', '#555555');
      fullRow(cr++, '  Run a Smear:       4,000cr', '#555555');
    } else if (onCooldown()) {
      const nextDay = (state.stations.newspaper.lastManipulationDay ?? 0) + 3;
      fullRow(cr++, 'Cooldown active.', '#555555');
      fullRow(cr++, `Next story available: day ${nextDay}`, '#555555');
    } else {
      const stories = allStories();
      const sections = [
        { title: `BULLISH STORIES  (+demand)   ${hasSmear ? '500cr' : '500cr'}`, stories: BULLISH_STORIES, offset: 0, tier: 'plant', cost: 500 },
        { title: `BEARISH STORIES  (-demand)   ${hasSmear ? '500cr' : '500cr'}`, stories: BEARISH_STORIES, offset: 5, tier: 'plant', cost: 500 },
      ];
      if (hasSmear) {
        sections.push({ title: 'SMEAR CAMPAIGN (+/- demand)  2,000cr', stories: [...BULLISH_STORIES, ...BEARISH_STORIES], offset: 10, tier: 'smear', cost: 2000, isSmear: true });
      }

      for (const sec of sections) {
        fullRow(cr++, sec.title, sec.isSmear ? '#ff5555' : NC);
        for (let i = 0; i < sec.stories.length; i++) {
          const globalIdx = sec.offset + i;
          const isSel = npSel === globalIdx;
          const prefix = isSel ? '>> ' : '   ';
          const ltr = sec.isSmear ? (i < 5 ? String(i+1) : String(i-4)) : String.fromCharCode((sec.offset < 5 ? 97 : 102) + i);
          fullRow(cr++, `${prefix}${ltr}) ${sec.stories[i].label}`, isSel ? HL : '#aaaaaa');
        }
        cr++; // blank
      }

      if (npConfirm) {
        const chosen = allStories()[npSel];
        fullRow(cr++, `File this story for ${chosen.cost}cr? (1. Yes / 2. No)`, LC);
      }
    }

    // Bottom separator and footer
    { const ay = BOX_Y + BOX_H - 3; sep(ay); }
    { const ay = BOX_Y + BOX_H - 2; border(ay);
      const footTxt = hasSkill && !onCooldown() ? (npConfirm ? '1: confirm  2: cancel' : '↑↓: select  Enter: choose  ESC: exit') : 'ESC: exit';
      const fp = menuPad(footTxt.length < IW ? ' '.repeat(Math.floor((IW-footTxt.length)/2)) + footTxt : footTxt, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, fp[i]||' ', DC, BG); }

    // Bottom border
    { const ay = BOX_Y + BOX_H - 1;
      display.draw(BOX_X, ay, '╚', NC, BG); display.draw(BOX_X+BOX_W-1, ay, '╝', NC, BG);
      for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, ay, '═', NC, BG); }
  }

  npMenuRedrawFn = redraw;
  redraw();

  // Animation ticker (4-tick cycle, ~100ms)
  const npAnimInterval = setInterval(() => {
    if (state.gameState !== 'newspaper') { clearInterval(npAnimInterval); return; }
    state.newspaper.animTick++;
    redraw();
  }, 250);

  function closeNP() {
    npMenuRedrawFn = null;
    clearInterval(npAnimInterval);
    window.removeEventListener('keydown', npKeyHandler);
    const BOX_H = calcBOX_H();
    const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function npKeyHandler(e) {
    if (e.key === 'Escape') { if (npConfirm) { npConfirm = false; redraw(); } else { closeNP(); } return; }
    if (!hasSkill || onCooldown()) return;

    const stories = allStories();
    const maxSel  = stories.length - 1;

    if (npConfirm) {
      if (e.key === '1') {
        const chosen = stories[npSel];
        if (state.player.credits < chosen.cost) { addLog(`Not enough credits. Need ${chosen.cost}cr.`, '#ff5555'); npConfirm = false; redraw(); return; }
        state.player.credits -= chosen.cost;
        state.stations.newspaper.pendingManipulation = { tier: chosen.tier, nudge: chosen.nudge, headline: chosen.headline };
        state.stations.newspaper.lastManipulationDay = state.day;
        addLog('> Story filed. It will run at dawn.', NC);
        drawStatusBar();
        npConfirm = false; closeNP();
      } else if (e.key === '2') {
        npConfirm = false; redraw();
      }
      return;
    }

    if (e.key === 'ArrowDown') { e.preventDefault(); npSel = Math.min(npSel + 1, maxSel); redraw(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); npSel = Math.max(npSel - 1, 0);       redraw(); return; }
    if (e.key === 'Enter') { npConfirm = true; redraw(); return; }
  }
  window.addEventListener('keydown', npKeyHandler);
}

// ── Apprentice worker logic (§5.3) ───────────────────────────────────────────

function tickApprentices() {
  const rmDef  = STATION_DEFS.find(s => s.label === 'RM');
  const wbDef  = STATION_DEFS.find(s => s.label === 'WB');
  const rmDoor = { x: rmDef.x + 1, y: rmDef.y + 2 };  // (10, 4)
  const wbDoor = { x: wbDef.x + 1, y: wbDef.y + 2 };  // (35, 10)
  const speed    = Math.max(1, Math.round(WORKER_SPEEDS[state.skills.workerSpeedLevel || 0]));
  const carryMax = WORKER_CARRY_CAPS[state.skills.workerCarryLevel || 0];

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
        const space = carryMax - w.carryRM;
        let bought = 0;
        while (bought < space && state.player.credits >= 3) {
          state.player.credits -= 3;
          w.carryRM++;
          bought++;
          if (bought === 1) { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(w.x, w.y, rmD.x + 1, rmD.y + 2, 3); }
        }
        if (bought > 0) drawStatusBar();
        w.target = { ...wbDoor };
        w.workerState = 'returning';
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
  const lfDoor = lfDef ? { x: lfDef.x + 1, y: lfDef.y + 2 } : null;
  const speed    = Math.max(1, Math.round(COURIER_SPEEDS[state.skills.courierSpeedLevel || 0]));
  const carryMax = COURIER_CARRY_CAPS[state.skills.courierCarryLevel || 0];
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
          if (c.carryWidgets > 0 && state.rocketWidgets < 50000) {
            const toLoad = Math.min(c.carryWidgets, 50000 - state.rocketWidgets);
            state.rocketWidgets += toLoad;
            c.carryWidgets -= toLoad;
            addLog(`Courier loaded ${toLoad} widget${toLoad !== 1 ? 's' : ''}. Total: ${state.rocketWidgets.toLocaleString()} / 50,000.`, '#ff5555');
            drawStatusBar();
            if (!state.rocketFull && state.rocketWidgets >= 50000) {
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
    state.stations.storage.unlocked       = true;
    state.stations.general_store.unlocked = true;
    state.skills.apprenticeCount = 1;
    state.skills.courierCount    = 0;
    state.storage.widgets        = 30;
    const ofDef = STATION_DEFS.find(s => s.label === 'OF');
    if (ofDef) state.workers.apprentices.push({ x: ofDef.x+1, y: ofDef.y+2, workerState: 'idle', carryRM: 0, carryWidgets: 0, target: {x:0,y:0}, craftTimer: 0, paused: false });
    const stD = STATION_DEFS.find(s => s.label === 'ST');
    if (stD) { stD.wc = '#66ccff'; stD.lc = '#aaddff'; }
    const gsD2 = STATION_DEFS.find(s => s.label === 'GS');
    if (gsD2) { gsD2.wc = '#aa66ff'; gsD2.lc = '#cc99ff'; }
  }
  if (n >= 3) {
    state.stations.bank = { unlocked: true };
    const bkD = STATION_DEFS.find(s => s.label === 'BK');
    if (bkD) { bkD.wc = '#66cc66'; bkD.lc = '#aaffaa'; }
    calculateDailyDemand();
    state.widgetsSoldToday = 0;
  }
  if (n >= 4) {
    state.stations.terminal = { unlocked: true };
    state.terminalUnlocked  = true;
    const dvD = STATION_DEFS.find(s => s.label === 'TR');
    if (dvD) { dvD.wc = '#cc66cc'; dvD.lc = '#cc66cc'; }
  }
  if (n >= 5) {
    state.stations.launch_facility = { unlocked: true };
    state.rocketWidgets     = 0;
    state.courierDestination = 'market';
    const lfD = STATION_DEFS.find(s => s.label === 'LF');
    if (lfD) { lfD.wc = COLOR_LF_FRAME; lfD.lc = COLOR_LF_LABEL; lfD.dc = '#cc3333'; }
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
  const BOX_H  = 14;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(5, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4; // 50
  const WC     = '#555555';

  function drawBorder() {
    display.draw(BOX_X, BOX_Y, '+', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '-', WC, BG);
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, bY, '+', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '+', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '-', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '|', WC, BG);
      display.draw(BOX_X+BOX_W-1, BOX_Y+y, '|', WC, BG);
    }
  }

  drawBorder();

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
      { const fsOn = state.settings.fullscreen;
        line(4, `2. Fullscreen            [${fsOn ? 'ON ' : 'OFF'}]`, BRIGHT_WHITE);
        // Color the bracket value
        const valStr = fsOn ? 'ON ' : 'OFF', valFg = fsOn ? '#66cc66' : '#555555';
        const valCol = CONT_X + '2. Fullscreen            ['.length;
        for (let i=0;i<valStr.length;i++) display.draw(valCol+i, BOX_Y+4, valStr[i], valFg, BG); }
      line(5, '3. Developer Mode',  BRIGHT_WHITE);
      line(6, '4. Back',            BRIGHT_WHITE);
      if (fsError) line(8, fsError, '#ff5555');
      centered(10, 'ESC to go back', WC);
    } else {
      centered(1, '– DEV MODE –', '#ff5555');
      line(2, 'For testing only.', WC);
      line(4, '1. Jump to Phase 1  (fresh start, 50cr)',           BRIGHT_WHITE);
      line(5, '2. Jump to Phase 2  (500cr, workers unlocked)',     BRIGHT_WHITE);
      line(6, '3. Jump to Phase 3  (2000cr, bank unlocked)',       BRIGHT_WHITE);
      line(7, '4. Jump to Phase 4  (5000cr, derivatives unlocked)',BRIGHT_WHITE);
      line(8, '5. Jump to Phase 5  (10000cr, LF unlocked)',        BRIGHT_WHITE);
      line(9,  '6. Give credits',   BRIGHT_WHITE);
      line(10, '7. Give widgets',   BRIGHT_WHITE);
      line(11, '8. Back',           BRIGHT_WHITE);
      centered(12, 'ESC to go back', WC);
    }
  }

  render();

  pauseMenuRedrawFn = () => { drawBorder(); render(); };

  function close() {
    pauseMenuRedrawFn = null;
    window.removeEventListener('keydown', pauseKeyHandler);
    for (let y = BOX_Y; y < BOX_Y+BOX_H; y++)
      for (let x = BOX_X; x < BOX_X+BOX_W; x++)
        if (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < WORLD_ROWS) markDirty(x, y);
    renderDirty();
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = prevState;
  }

  function pauseKeyHandler(e) {
    if (screen === 'pause') {
      if (e.key === '1' || e.key === 'Escape') { close(); }
      else if (e.key === '2') { screen = 'settings'; render(); }
      else if (e.key === '3') {
        pauseMenuRedrawFn = null;
        window.removeEventListener('keydown', pauseKeyHandler);
        saveGame();
        showContinueMenu();
      }
    } else if (screen === 'settings') {
      if (e.key === '1') { state.audio.muted = !state.audio.muted; saveGame(); render(); }
      else if (e.key === '2') {
        // Fullscreen toggle
        const newFS = !state.settings.fullscreen;
        setFullscreen(newFS);
        drawBorder(); render(); // redraw menu on newly-sized display
      }
      else if (e.key === '3') { screen = 'dev'; render(); }
      else if (e.key === '4' || e.key === 'Escape') { screen = 'pause'; render(); }
    } else {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 5) {
        window.removeEventListener('keydown', pauseKeyHandler);
        devJumpToPhase(num);
      } else if (e.key === '6') {
        window.removeEventListener('keydown', pauseKeyHandler);
        showNumericPrompt('Give credits (any amount)', 9999999,
          (v) => {
            state.player.credits += v;
            state.lifetimeCreditsEarned += v;
            drawStatusBar();
            addLog(`> DEV: +${v}cr added.`, '#ff5555');
            state.gameState = prevState;
            showPauseMenu();
          },
          () => { state.gameState = prevState; showPauseMenu(); }
        );
      } else if (e.key === '7') {
        window.removeEventListener('keydown', pauseKeyHandler);
        showNumericPrompt('Give widgets (any amount)', 9999999,
          (v) => {
            const space = state.storage.widgetCap - state.storage.widgets;
            const add   = Math.min(v, space);
            state.storage.widgets += add;
            if (add < v) addLog(`> DEV: Storage full. Added ${add} widgets to storage.`, '#ff5555');
            else         addLog(`> DEV: +${add} widgets added to storage.`, '#ff5555');
            drawStatusBar();
            state.gameState = prevState;
            showPauseMenu();
          },
          () => { state.gameState = prevState; showPauseMenu(); }
        );
      } else if (e.key === '8' || e.key === 'Escape') { screen = 'settings'; render(); }
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
  if (state.gameState !== 'playing') return; // pause wave behind any open menu
  if (!dayNightFlash) return;

  if (dayNightFlash.frame >= 120) {
    // Wave complete — mark all tiles dirty so map fully restores
    for (let y = 0; y < WORLD_ROWS; y++)
      for (let x = 0; x < DISPLAY_WIDTH; x++)
        markDirty(x, y);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
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
  // Flash animation counters tick regardless of menu state (§5.3)
  if (state.officeAnim.apprenticeFlash > 0) {
    state.officeAnim.apprenticeFlash--;
    if (officeMenuRedrawFn && state.officeTab === 'upgrades' && state.officeUpgradesPage === 1) officeMenuRedrawFn();
  }
  if (state.officeAnim.courierFlash > 0) {
    state.officeAnim.courierFlash--;
    if (officeMenuRedrawFn && state.officeTab === 'upgrades' && state.officeUpgradesPage === 1) officeMenuRedrawFn();
  }

  if (state.gameState !== 'playing' && state.gameState !== 'crafting' && state.gameState !== 'dashboard' && state.gameState !== 'inventory' && state.gameState !== 'lf_menu' && state.gameState !== 'rm_menu' && state.gameState !== 'wb_menu' && state.gameState !== 'mt_menu' && state.gameState !== 'dv_menu' && state.gameState !== 'cottage') return;

  // Stats: snapshot before tick for delta computation
  const _sCr = state.player.credits;
  const _sRM = state.player.inventory.rm + state.storage.rm;
  const _sWg = state.player.inventory.widgets + state.storage.widgets;

  state.tick++;
  state.dayTick++;
  if (state.dayTick >= 240) { state.dayTick = 0; state.day++; state.bellFiredToday = false; state.widgetsSoldToday = 0; state.demandMetLogged = false; state.stats.widgetsMadeToday = 0; state.stats.revenueToday = 0; state.stats.costsToday = 0; }
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
    // Newspaper headline at dawn (§13)
    if (state.phase >= 3 && state.stations.newspaper?.unlocked) {
      const np = state.stations.newspaper;
      const expectedD = Math.round(50 + 30 * Math.sin(state.day / 7 * 2 * Math.PI));
      let useManipulated = false, manipHeadline = '';
      if (np.pendingManipulation) {
        const roll = Math.random();
        const successRate = np.pendingManipulation.tier === 'smear' ? 0.85 : 0.80;
        if (roll < successRate) {
          state.demand = Math.max(5, state.demand + np.pendingManipulation.nudge);
          state.marketPrice = Math.round(8 * Math.pow(state.demand / 50, 0.5) * 10) / 10;
          useManipulated = true;
          manipHeadline = np.pendingManipulation.headline;
        }
        np.pendingManipulation = null;
      }
      const HEADLINES_REAL = [
        [71, 'WIDGET DEMAND PROJECTED STRONG — analysts optimistic'],
        [55, 'STEADY GROWTH EXPECTED — market watchers confident'],
        [40, 'MIXED SIGNALS IN WIDGET SECTOR — cautious outlook'],
        [25, 'SUPPLY CONCERNS LOOM — demand forecast weak'],
        [ 0, 'WIDGET MARKET FACES HEADWINDS — analysts concerned'],
      ];
      const headline = useManipulated ? manipHeadline
        : HEADLINES_REAL.find(([thr]) => state.demand > thr)[1];
      state.newspaper.todayHeadline = headline;
      // Forecast for tomorrow's menu display
      const nxtD = Math.round(50 + 30 * Math.sin((state.day + 1) / 7 * 2 * Math.PI));
      const FORECAST_LABELS = [[71,'Strong'],[55,'Positive'],[40,'Mixed'],[25,'Weak'],[0,'Poor']];
      state.newspaper.tomorrowForecastLabel = FORECAST_LABELS.find(([t]) => nxtD > t)[1];
      state.newspaper.animTick = 0;
      addLog(`> [DAILY WIDGET] ${headline}`, '#ccaa44');
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
          if (pnl > 0) changeRating(+0.25, 'Profitable forward contract');
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

    // Credit rating: consecutive profitable days
    if (state.player.credits > 0 && !state.bank.loan && state.debt === 0) {
      state.bank.consecutivePositiveDays++;
      if (state.bank.consecutivePositiveDays >= 5 && state.bank.consecutivePositiveDays % 5 === 0) {
        changeRating(+0.5, `${state.bank.consecutivePositiveDays} profitable days`);
      }
    } else {
      state.bank.consecutivePositiveDays = 0;
    }
    state.bank.creditNegativeLogged = false; // reset per-day flag at dawn

    // Card billing cycle
    if (state.bank.card.owned) {
      const card = state.bank.card;
      if (state.day === card.paymentDueDay && card.minimumPaymentDue > 0) {
        card.missedPayments++;
        changeRating(-2.0, 'Missed card payment');
        addLog('Card: missed minimum payment. Credit score hit.', '#ff5555');
        card.minimumPaymentDue = 0;
      }
      if (card.balance > 0 && state.day >= card.lastStatementDay + card.cycleLength) {
        const interest = Math.round(card.balance * card.interestRate * 10) / 10;
        card.balance   = Math.round((card.balance + interest) * 10) / 10;
        card.minimumPaymentDue = Math.round(Math.max(5, card.balance * 0.1) * 10) / 10;
        card.paymentDueDay   = state.day + 5;
        card.lastStatementDay = state.day;
        addLog(`Card statement: ${card.balance.toFixed(1)}cr balance, min payment ${card.minimumPaymentDue.toFixed(1)}cr due day ${card.paymentDueDay}.`, '#66ccff');
      }
    }

    // Loan overdue check
    if (state.bank.loan && state.day > state.bank.loan.deadline) {
      state.bank.loan.overdueDays = (state.bank.loan.overdueDays || 0) + 1;
      addLog('LOAN OVERDUE. Repay or refinance immediately.', '#ff5555');
      if (!state.bank.loan.ratingFiredAt1 && state.bank.loan.overdueDays >= 1) {
        state.bank.loan.ratingFiredAt1 = true;
        changeRating(-1.5, 'Loan overdue 1+ days');
      }
      if (!state.bank.loan.ratingFiredAt3 && state.bank.loan.overdueDays >= 3) {
        state.bank.loan.ratingFiredAt3 = true;
        changeRating(-2.0, 'Loan overdue 3+ days');
      }
      if (state.bank.loan.overdueDays >= 3 && state.player.credits <= 0 && state.bank.deposit <= 0) {
        setTimeout(showBankruptcyScreen, 1000);
      }
    }
  }
  drawTimeIndicator();

  // Stamp event timer — only when actively playing (§13)
  if (state.gameState === 'playing') {
    state.player.stampEventTimer = (state.player.stampEventTimer ?? 40) - 1;
    if (state.player.stampEventTimer <= 0) {
      state.player.stampEventTimer = Math.floor(Math.random() * 21) + 40;
      awardStamp(1, true);
    }
  }

  if (state.gameState === 'crafting') {
    // Advance hammer animation frame
    const HAMMER_SCHEDULE = [5, 2, 1, 3]; // ticks held per frame
    state.workbenchHammerTick++;
    if (state.workbenchHammerTick >= HAMMER_SCHEDULE[state.workbenchHammerFrame]) {
      const prevFrame = state.workbenchHammerFrame;
      state.workbenchHammerTick = 0;
      state.workbenchHammerFrame = (state.workbenchHammerFrame + 1) % 4;
      // Door tile spark: draw on entry to impact frame, restore on exit
      const wbDef = STATION_DEFS.find(s => s.label === 'WB');
      if (wbDef) {
        const doorX = wbDef.x + 1, doorY = wbDef.y + 2;
        if (state.workbenchHammerFrame === 2) {
          display.draw(doorX, doorY, '*', '#ffd633', BG);
        } else if (prevFrame === 2) {
          markDirty(doorX, doorY);
          renderDirty();
        }
      }
    }

    const secsLeft = activeCraftTicks - craftProgress;
    drawRow(LOG_END_ROW, `> Crafting — ${secsLeft}s remaining`, '#ff9933');
    craftProgress++;
    if (!craftingRemote) pulseWB();
    if (craftProgress >= activeCraftTicks) {
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
        craftingRemote = false;
        state.workbenchHammerFrame = 0; state.workbenchHammerTick = 0;
        state.gameState = 'playing';
        if (wbMenuCloseFn) { wbMenuCloseFn(); wbMenuRedrawFn = null; wbMenuCloseFn = null; }
      }
    }
  }

  // Workers — §5.3
  if (state.workers.apprentices.length > 0) tickApprentices();
  if (state.workers.couriers.length > 0)    tickCouriers();
  if (state.workers.apprentices.length > 0 || state.workers.couriers.length > 0) {
    if (state.gameState !== 'cottage') { // don't draw workers over cottage interior
      renderDirty();
      for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
      for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
      display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    }
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

  // Live-refresh station menus
  if (rmMenuRedrawFn) rmMenuRedrawFn();
  if (wbMenuRedrawFn) wbMenuRedrawFn();
  if (mtMenuRedrawFn) { mtMenuBlinkOn = !mtMenuBlinkOn; mtMenuRedrawFn(); }
  if (dvMenuRedrawFn) dvMenuRedrawFn();
  if (storageMenuRedrawFn) storageMenuRedrawFn();
  if (bankMenuRedrawFn) bankMenuRedrawFn();
  if (gsMenuRedrawFn) gsMenuRedrawFn();

  // Cottage animations + cat AI (§4.2)
  if (state.cottage.owned) {
    if (state.cottage.furniture.fireplace && state.tick % 6 === 0) fireplaceFrame = 1 - fireplaceFrame;
    if (state.cottage.furniture.candles   && state.tick % 12 === 0) candlePhase = !candlePhase;
    if (state.cottage.furniture.cat && state.tick % 8 === 0 && state.gameState === 'cottage') {
      const cx = state.cottage.catX, cy = state.cottage.catY;
      const nearFire = state.cottage.furniture.fireplace && cx >= 6 && cx <= 14 && cy <= 5;
      if (!(nearFire && Math.random() < 0.7)) {
        const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
        const valid = DIRS.filter(([dx,dy]) => {
          const nx=cx+dx, ny=cy+dy;
          if(nx<1||nx>18||ny<1||ny>9) return false;
          if(!interiorTileMap[nx]||!interiorTileMap[nx][ny]) return false;
          return interiorTileMap[nx][ny].walkable && !(nx===state.cottage.playerX&&ny===state.cottage.playerY);
        });
        if(valid.length>0){const[dx,dy]=valid[Math.floor(Math.random()*valid.length)];state.cottage.catX=cx+dx;state.cottage.catY=cy+dy;}
      }
    }
  }
  if (state.gameState === 'cottage') drawCottageInterior();

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
        'The shop owner waves from the doorway. You wave back.',
        'A worker laughs at something across the yard.',
        'You hear the sound of tools from the workbench.',
        'One of your workers waves. You nod back.',
        'The courier returns empty-handed, then sets off again.',
        'One of your workers pauses and looks at the sky.',
        'The factory hums at a frequency you feel more than hear.',
        'A courier passes without acknowledging you.',
        'You realize you haven\'t made a widget by hand in a while.',
      );
      if (state.cottage.furniture && state.cottage.furniture.cat) {
        AMBIENT.push(
          'Your cat is asleep near the fireplace.',
          'Your cat watches you from the bookshelf.',
          'Your cat sits in the doorway, indifferent.',
          'Your cat bats at something you can\'t see.',
        );
      }
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
  if (state.tick % 8 === 0 && shimmerTiles.length >= 2 &&
      (state.gameState === 'playing' || state.gameState === 'look')) {
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
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
  }

  if (state.tick % 10 === 0) saveGame();
  effectsManager.update();
}, 1000);

// ── Effects render loop — runs at ~60fps independent of game tick ─────────────
;(function effectsLoop(ts) {
  if (state.gameState !== 'cottage') effectsManager.render(display);

  // Scroll-in: advance pendingLine only when world is active (not paused, not look mode)
  const logActive = state.gameState === 'playing' || state.gameState === 'crafting' ||
                    state.gameState === 'dashboard' || state.gameState === 'menu' ||
                    state.gameState === 'inventory' || state.gameState === 'lf_menu' ||
                    state.gameState === 'rm_menu' || state.gameState === 'wb_menu' ||
                    state.gameState === 'mt_menu' || state.gameState === 'dv_menu';
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
