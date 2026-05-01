import {
  DISPLAY_WIDTH, DISPLAY_HEIGHT, WORLD_ROWS,
  STATUS_ROW, LOG_START_ROW, LOG_END_ROW, HINT_ROW,
  BG, BRIGHT_WHITE, BRIGHT_YELLOW, BRIGHT_CYAN, BRIGHT_MAGENTA, DIM_GRAY,
  LOG_SCROLL_SPEED,
  COLOR_LF_FRAME, COLOR_LF_LABEL,
  COLOR_HINT_LINE,
  COLOR_STAMPS,
  DEV_PASSWORD,
  COLOR_NP_FRAME,
  COLOR_NP_LABEL,
  RATING_COLORS,
} from './constants.js';
import { EffectsManager } from './src/effects.js';
import { HAMMER_FRAMES, HAMMER_COLORS } from './hammer.js';

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
let pauseMenuRedrawFn  = null; // set by showPauseMenu, cleared on close
let pauseMenuCloseFn   = null; // set by showPauseMenu so fullscreenchange can close it
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
  // Resize by updating the existing display — never destroy/recreate it
  display.setOptions({ fontSize });
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
    fullRedraw();
    if (pauseMenuRedrawFn) pauseMenuRedrawFn();
  }
}

function fullRedraw() {
  const gs = state ? state.gameState : 'title';
  if (gs === 'title' || gs === 'title_menu' || gs === 'changelog') {
    clearScreen(); drawTitleBorder(); drawArt(); drawPrompt(true); drawTitleBottomText();
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
    const onOverworld = state.gameState === 'playing' || state.gameState === 'title' || state.gameState === 'title_menu';
    if (onOverworld) {
      state.settings.fullscreen = isFS;
      localStorage.setItem('widgeter.settings.fullscreen', JSON.stringify(isFS));
      recalculateDisplaySize(isFS ? window.screen.width : window.innerWidth, isFS ? window.screen.height : window.innerHeight);
    } else {
      // Player was closing a menu with Escape — re-enter fullscreen silently
      if (!isFS && state.settings.fullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
    fullRedraw();
    if (pauseMenuRedrawFn) pauseMenuRedrawFn();
  }
});

// Prevent browser from exiting fullscreen when Escape closes a game menu
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state?.gameState &&
      state.gameState !== 'playing' && state.gameState !== 'title' && state.gameState !== 'title_menu') {
    e.preventDefault();
  }
}, { capture: true });

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
    gold: 10,
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
    stampHintFired:    false,
    stampHintTick:     180 + Math.floor(Math.random() * 59),
  },
  day: 1,
  tick: 0,
  dayTick: 0,       // 0–239; resets each day
  marketOpen: true, // true for dayTick 0–179, false for 180–239
  phase: 1,
  lifetimeGoldEarned: 0,
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
    casino:          { id: 'CS', x: 71, y: 11, unlocked: false, visible: true, spunToday: 0, dailyBetTotal: 0, lossesTonight: 0, jackpotLogged: false },
  },
  shinyRocks: {
    red:    { collected: false, blinkTicks: [-1, -1, -1], blinkFramesRemaining: 0, x: 5,  y: 12 },
    yellow: { collected: false, blinkTicks: [-1, -1, -1], blinkFramesRemaining: 0, x: 42, y: 8  },
    blue:   { collected: false, blinkTicks: [-1, -1, -1], blinkFramesRemaining: 0, x: 74, y: 36 },
  },
  newspaper: { todayHeadline: '', tomorrowForecastLabel: '', animTick: 0 },
  rocketWidgets:       0,
  rocketFull:          false,
  courierDestination:  'market',  // 'market' | 'rocket'
  rocketAnimFrame:     0,
  loadingPort:         { unlocked: false, widgets: 0, capacity: 100 },
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
  garden: {},
  gardenRegrow: {},
  cooking: { activeBuff: null },
  bookshelfLog: [],
  officeUnlocked:      false,
  officeTab:           'workers',  // 'workers' | 'upgrades' | 'info'
  storage: { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 },
  workbenchWidgets:  0,
  workbenchHammerFrame: 0,
  workbenchHammerTick:  0,
  productionHalted:  false,
  wbFullLogged:      false,
  couriersOwned:        0,
  demand:               50,
  marketPrice:          8,
  marketBuyOffers:      [],
  widgetsSoldToday:     0,
  demandMetLogged:      false,
  debt:                 0,
  debtDaysUnpaid:       0,
  demandCrashOccurred:  false,
  demandHistory:        [],
  terminalUnlocked:     false,
  derivatives:          { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0, nextSpreadId: 0 },
  terminal:             { positions: [], totalPnL: 0, pnlToday: 0, _nextId: 0 },
  volatility:           0.2,
  endingTriggered:      false,
  endingCompleted:      false,
  devUnlocked:          false,
  widgetsMade:          0,
  peakCredits:          0,
  bank: {
    deposit: 0,
    tab:                     'account',
    cardPage:                'bronze',
    upgradeLogQueue:         [],
    upgradeLogLastFired:     0,
    creditRating:            'CC',
    creditRatingScore:       3.0,
    ratingHistory:           [],
    consecutivePositiveDays: 0,
    creditNegativeLogged:    false,
    casinoStartCredits:      null, // transient — not saved
    card: {
      tier: null, limit: 0, balance: 0, interestRate: 0,
      statementCycle: 10, lastStatementDay: 0,
      minimumPaymentDue: 0, paymentDueDay: 0, missedPayments: 0,
      consecutiveGoldPayments: 0, demotionWarningDay: null,
      upgradeNotified: { bronze: false, silver: false, gold: false, black: false },
      overdraftUsedThisCycle: false, graceUsedThisCycle: false,
      silverMarketExtraUsedToday: false, demandImmunityUsedThisWeek: false,
      insuranceBalance: 0, autoRMThreshold: 0,
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
    pickaxeLevel: 0,
    lantern:      false,
    endurance:    { pips: 0 },
    aquatics:     { purchased: false },
    interfacing:  { pips: 0 },
  },
  craftingTimeRemote: 10,
  lakeEasterEgg: { discovered: false },
  mine: {
    discovered: false,
    discoveredDay: -1,
    tiles: [],
    lastGenDay: -1,
    playerX: 12,
    playerY: 13,
    playerDir: { x: 0, y: -1 },
    totalMined: 0,
    crystals: 0,
    bareHandHits: 0,
    handsBloodied: false,
    kickedOut: false,
    kickedOutUntilPeriod: -1,
    enemyX: -1,
    enemyY: -1,
  },
  weather: {
    current:        'clear',
    forecast:       'clear',
    actualTomorrow: 'clear',
  },
  fishing: {
    totalCatches:  0,
    catchesToday:  0,
    dailyLimit:    5,
    // transient fields — reset on menu open
    currentPhase:  'menu',
    fishTimer:     0,
    biteTimer:     0,
    fishX:         0,
    animTick:      0,
  },
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
    lifetimeGoldEarned:  state.lifetimeGoldEarned,
    lifetimeWidgetsMade: state.lifetimeWidgetsMade,
    logLines:            state.logLines,
    bellFiredToday:       state.bellFiredToday,
    lastAmbientTick:      state.lastAmbientTick,
    lastNarrativeTick:    state.lastNarrativeTick,
    nextAmbientDelay:     state.nextAmbientDelay,
    stepsWalked:          state.stepsWalked,
    stations:             state.stations,
    officeUnlocked:       state.officeUnlocked,
    officeTab:            state.officeTab,
    storage:              state.storage,
    workbenchWidgets:     state.workbenchWidgets,
    productionHalted:     state.productionHalted,
    wbFullLogged:         state.wbFullLogged,
    couriersOwned:        state.couriersOwned,
    demand:               state.demand,
    marketPrice:          state.marketPrice,
    marketBuyOffers:      state.marketBuyOffers,
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
    endingCompleted:      state.endingCompleted,
    devUnlocked:          state.devUnlocked,
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
    loadingPort:          state.loadingPort,
    skills:               state.skills,
    craftingTimeRemote:   state.craftingTimeRemote,
    cottage:              state.cottage,
    garden:               state.garden,
    gardenRegrow:         state.gardenRegrow,
    cooking:              state.cooking,
    bookshelfLog:         state.bookshelfLog,
    mine:                 state.mine,
    weather:              state.weather,
    stamps:               state.player.stamps,
    stampWalkCounter:     state.player.stampWalkCounter,
    stampLookTiles:       Array.from(state.player.stampLookTiles),
    stampLookMilestone:   state.player.stampLookMilestone,
    stampEventTimer:      state.player.stampEventTimer,
    stampHintFired:       state.player.stampHintFired,
    stampHintTick:        state.player.stampHintTick,
    newspaper:            state.newspaper,
    fishingTotalCatches:   state.fishing.totalCatches,
    fishingCatchesToday:   state.fishing.catchesToday,
    fishingDailyLimit:     state.fishing.dailyLimit,
    lakeEasterEggDiscovered: state.lakeEasterEgg.discovered,
    shinyRocks: state.shinyRocks,
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
    // Migration: rename credits → gold
    state.player.gold          = state.player.gold ?? state.player.credits ?? 10;
    delete state.player.credits;
    state.player.color         = state.player.color         ?? '#f0f0f0';
    state.player.colorName     = state.player.colorName     ?? 'DEFAULT';
    state.player.ownedOutfits  = state.player.ownedOutfits  ?? [];
    state.day                  = data.day;
    state.tick                 = data.tick;
    state.dayTick              = data.dayTick   ?? 0;
    state.marketOpen           = data.marketOpen ?? true;
    state.phase                = data.phase;
    state.lifetimeGoldEarned   = data.lifetimeGoldEarned ?? data.lifetimeCreditsEarned ?? 0;
    state.lifetimeWidgetsMade  = data.lifetimeWidgetsMade ?? 0;
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
    state.officeTab            = data.officeTab            ?? 'workers';
    state.storage              = data.storage           ?? { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 };
    state.workbenchWidgets     = data.workbenchWidgets  ?? 0;
    state.productionHalted     = data.productionHalted  ?? false;
    state.wbFullLogged         = data.wbFullLogged       ?? false;
    state.couriersOwned        = data.couriersOwned        ?? 0;
    state.demand               = data.demand               ?? 50;
    state.marketPrice          = data.marketPrice          ?? 8;
    state.marketBuyOffers      = data.marketBuyOffers      ?? [];
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
    // New terminal state
    state.terminal = data.terminal ?? { positions: [], totalPnL: 0, pnlToday: 0, _nextId: 0 };
    state.terminal.positions = state.terminal.positions ?? [];
    state.terminal.totalPnL  = state.terminal.totalPnL  ?? 0;
    state.terminal.pnlToday  = state.terminal.pnlToday  ?? 0;
    state.terminal._nextId   = state.terminal._nextId   ?? 0;
    // Migrate old derivatives.forwards to terminal.positions
    if ((data.derivatives?.forwards ?? []).length > 0 && state.terminal.positions.length === 0) {
      for (const f of state.derivatives.forwards) {
        state.terminal.positions.push({ id: state.terminal._nextId++, type: 'fwd_buy', qty: f.quantity, lockPrice: f.lockedPrice, deliveryDay: f.settlementDay, openDay: f.openDay });
      }
    }
    state.volatility                     = data.volatility                     ?? 0.2;
    state.endingTriggered                = data.endingTriggered                ?? false;
    state.endingCompleted                = data.endingCompleted                ?? false;
    state.devUnlocked                    = data.devUnlocked                    ?? false;
    state.widgetsMade          = data.widgetsMade          ?? 0;
    state.peakCredits          = data.peakCredits          ?? 0;
    state.bank                 = data.bank                 ?? { deposit: 0 };
    state.bank.deposit         = state.bank.deposit        ?? 0;
    // Migrate old 'B' start rating to 'CC'
    if (state.bank.creditRating === 'B' && (state.bank.creditRatingScore ?? 3.0) === 3.0) state.bank.creditRating = 'CC';
    state.bank.creditRating           = state.bank.creditRating           ?? 'CC';
    state.bank.creditRatingScore      = state.bank.creditRatingScore      ?? 3.0;
    state.bank.ratingHistory          = state.bank.ratingHistory          ?? [];
    state.bank.consecutivePositiveDays = state.bank.consecutivePositiveDays ?? 0;
    state.bank.creditNegativeLogged   = false; // transient
    state.bank.casinoStartCredits     = null;  // transient
    state.bank.tab               = state.bank.tab               ?? 'account';
    state.bank.cardPage          = state.bank.cardPage          ?? 'bronze';
    state.bank.upgradeLogQueue   = []; // transient
    state.bank.upgradeLogLastFired = 0;
    { const _c = state.bank.card = state.bank.card ?? {};
      // Migrate old card.owned to card.tier
      if (_c.owned === true && !_c.tier) _c.tier = 'bronze';
      if (_c.owned === false && _c.tier === undefined) _c.tier = null;
      delete _c.owned;
      _c.tier                       = _c.tier                       ?? null;
      _c.limit                      = _c.limit                      ?? 0;
      _c.balance                    = _c.balance                    ?? 0;
      _c.interestRate               = _c.interestRate               ?? 0;
      _c.statementCycle             = _c.statementCycle             ?? (_c.cycleLength ?? 10);
      _c.lastStatementDay           = _c.lastStatementDay           ?? 0;
      _c.minimumPaymentDue          = _c.minimumPaymentDue          ?? 0;
      _c.paymentDueDay              = _c.paymentDueDay              ?? 0;
      _c.missedPayments             = _c.missedPayments             ?? 0;
      _c.consecutiveGoldPayments    = _c.consecutiveGoldPayments    ?? 0;
      _c.demotionWarningDay         = _c.demotionWarningDay         ?? null;
      _c.upgradeNotified            = _c.upgradeNotified            ?? { bronze: false, silver: false, gold: false, black: false };
      _c.overdraftUsedThisCycle     = _c.overdraftUsedThisCycle     ?? false;
      _c.graceUsedThisCycle         = _c.graceUsedThisCycle         ?? false;
      _c.silverMarketExtraUsedToday = _c.silverMarketExtraUsedToday ?? false;
      _c.demandImmunityUsedThisWeek = _c.demandImmunityUsedThisWeek ?? false;
      _c.insuranceBalance           = _c.insuranceBalance           ?? 0;
      _c.autoRMThreshold            = _c.autoRMThreshold            ?? 0;
    }
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
    for (const w of state.workers.apprentices) { w.nickname = w.nickname ?? ''; w.buyOnCredit = w.buyOnCredit ?? false; }
    for (const c of state.workers.couriers)    { c.nickname = c.nickname ?? ''; c.paused = c.paused ?? false; }
    state.stats                = data.stats ?? { rmLastTen: [], widgetsLastTen: [], creditsLastTen: [], widgetsMadeToday: 0, revenueToday: 0, costsToday: 0 };
    state.rocketWidgets        = data.rocketWidgets       ?? 0;
    state.rocketFull           = data.rocketFull          ?? false;
    state.courierDestination   = data.courierDestination  ?? 'market';
    state.loadingPort          = data.loadingPort ?? { unlocked: false, widgets: 0, capacity: 100 };
    state.loadingPort.capacity = state.loadingPort.capacity ?? 100;
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
        workerSpeedLevel:  s.workerSpeedLevel  ?? Math.min(s.workerSpeed  || 0, 5),
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
    state.garden = data.garden ?? {};
    state.gardenRegrow = data.gardenRegrow ?? {};
    state.cooking = data.cooking ?? { activeBuff: null };
    state.cooking.activeBuff = state.cooking.activeBuff ?? null;
    state.bookshelfLog = data.bookshelfLog ?? [];
    // Stamps (§13)
    state.player.stamps            = data.stamps            ?? 0;
    state.player.stampWalkCounter  = data.stampWalkCounter  ?? 0;
    state.player.stampLookTiles    = new Set(data.stampLookTiles ?? []);
    state.player.stampLookMilestone = data.stampLookMilestone ?? 0;
    state.player.stampEventTimer   = data.stampEventTimer   ?? (Math.floor(Math.random() * 21) + 40);
    state.player.stampHintFired    = data.stampHintFired    ?? false;
    state.player.stampHintTick     = data.stampHintTick     ?? (180 + Math.floor(Math.random() * 59));
    // Newspaper (§13)
    state.newspaper = data.newspaper ?? { todayHeadline: '', tomorrowForecastLabel: '', animTick: 0 };
    state.newspaper.todayHeadline       = state.newspaper.todayHeadline       ?? '';
    state.newspaper.tomorrowForecastLabel = state.newspaper.tomorrowForecastLabel ?? '';
    state.newspaper.animTick            = 0; // transient
    state.stations.newspaper = state.stations.newspaper ?? { unlocked: false, lastManipulationDay: -99, manipulationCooldownDays: 3, pendingManipulation: null };
    state.stations.newspaper.lastManipulationDay    = state.stations.newspaper.lastManipulationDay    ?? -99;
    state.stations.newspaper.manipulationCooldownDays = state.stations.newspaper.manipulationCooldownDays ?? 3;
    state.stations.newspaper.pendingManipulation    = state.stations.newspaper.pendingManipulation    ?? null;
    // Lake easter egg discovery state
    state.lakeEasterEgg = { discovered: data.lakeEasterEggDiscovered ?? false };
    // Fishing (§4.2) — only totalCatches, catchesToday, dailyLimit are persistent
    state.fishing = state.fishing ?? {};
    state.fishing.totalCatches  = data.fishingTotalCatches  ?? 0;
    state.fishing.catchesToday  = data.fishingCatchesToday  ?? 0;
    state.fishing.dailyLimit    = data.fishingDailyLimit    ?? 5;
    state.fishing.currentPhase  = 'menu';
    state.fishing.fishTimer     = 0;
    state.fishing.biteTimer     = 0;
    state.fishing.fishX         = 0;
    state.fishing.animTick      = 0;
    // Casino (§4.2)
    { const _cs = state.stations.casino = state.stations.casino ?? {};
      _cs.id              = 'CS';
      _cs.x               = 71;
      _cs.y               = 11;
      _cs.unlocked        = _cs.unlocked        ?? false;
      _cs.visible         = true; // always visible from game start
      _cs.spunToday       = _cs.spunToday       ?? 0;
      _cs.dailyBetTotal   = _cs.dailyBetTotal   ?? 0;
      _cs.lossesTonight   = _cs.lossesTonight   ?? 0;
      _cs.jackpotLogged   = _cs.jackpotLogged   ?? false;
    }
    // Shiny rocks (§4.2)
    { const _sr = state.shinyRocks = data.shinyRocks ?? {};
      _sr.red    = _sr.red    ?? { collected: false, x: 5,  y: 12 };
      _sr.yellow = _sr.yellow ?? { collected: false, x: 42, y: 8  };
      _sr.blue   = _sr.blue   ?? { collected: false, x: 74, y: 36 };
      for (const color of ['red', 'yellow', 'blue']) {
        const rock = _sr[color];
        if (!rock.blinkTicks) {
          rock.blinkTicks = rock.blinkTick !== undefined ? [rock.blinkTick, -1, -1] : [-1, -1, -1];
          delete rock.blinkTick;
        }
        rock.blinkFramesRemaining = 0; // transient — always reset on load
      }
      // If any uncollected rock still has no valid ticks (saved before dawn ever ran), assign now
      for (const color of ['red', 'yellow', 'blue']) {
        const rock = _sr[color];
        if (!rock.collected && rock.blinkTicks.every(t => t === -1)) {
          rock.blinkTicks = pickThreeBlinkTicks();
        }
      }
    }
    // Mine (§Mine)
    { const _m = state.mine = data.mine ?? {};
      _m.discovered            = _m.discovered            ?? false;
      _m.discoveredDay         = _m.discoveredDay         ?? -1;
      _m.tiles                 = _m.tiles                 ?? [];
      _m.lastGenDay            = _m.lastGenDay            ?? -1;
      _m.playerX               = _m.playerX               ?? 12;
      _m.playerY               = _m.playerY               ?? 13;
      _m.playerDir             = _m.playerDir             ?? { x: 0, y: -1 };
      _m.totalMined            = _m.totalMined            ?? 0;
      _m.crystals              = _m.crystals              ?? 0;
      _m.bareHandHits          = _m.bareHandHits          ?? 0;
      _m.handsBloodied         = _m.handsBloodied         ?? false;
      _m.kickedOut             = _m.kickedOut             ?? false;
      _m.kickedOutUntilPeriod  = _m.kickedOutUntilPeriod  ?? -1;
      _m.enemyX                = _m.enemyX                ?? -1;
      _m.enemyY                = _m.enemyY                ?? -1;
    }
    // Mine skills
    state.skills.pickaxeLevel = state.skills.pickaxeLevel ?? 0;
    state.skills.lantern      = state.skills.lantern      ?? false;
    // Weather
    { const _w = state.weather = data.weather ?? {};
      _w.current        = _w.current        ?? 'clear';
      _w.forecast       = _w.forecast       ?? 'clear';
      _w.actualTomorrow = _w.actualTomorrow ?? 'clear';
    }
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

const ART_MAX_W     = Math.max(...TITLE_ART.map(l => l.length));
const ART_X         = Math.floor((DISPLAY_WIDTH - ART_MAX_W) / 2);
const CUBE_W        = 16;
const CUBE_H        = 10;
const CUBE_CX       = Math.floor(DISPLAY_WIDTH / 2);
const TOTAL_TITLE_H = CUBE_H + 1 + TITLE_ART.length + 2 + 1;
const ART_Y         = Math.floor((DISPLAY_HEIGHT - TOTAL_TITLE_H) / 2) + CUBE_H + 1 - 4;
const CUBE_CY       = ART_Y - CUBE_H + Math.floor(CUBE_H / 2) - 1;
const PROMPT_X      = Math.floor((DISPLAY_WIDTH - PROMPT.length) / 2);
const PROMPT_Y      = ART_Y + TITLE_ART.length + 2;

function drawArt(frame = 0) {
  for (let row = 0; row < TITLE_ART.length; row++) {
    const line = TITLE_ART[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] === ' ') continue;
      const wave = Math.sin((col * 0.12) - (frame * 0.03)) * 0.5 + 0.5;
      const r = Math.round(200 + wave * 55);
      const g = Math.round(170 + wave * 44);
      const b = Math.round(wave * 51);
      const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
      display.draw(ART_X + col, ART_Y + row, line[col], hex, BG);
    }
  }
}

function drawPrompt(visible) {
  const fg = visible ? BRIGHT_CYAN : BG;
  for (let col = 0; col < PROMPT.length; col++) {
    display.draw(PROMPT_X + col, PROMPT_Y, PROMPT[col], fg, BG);
  }
}

// ── 3D wireframe cube (§3.3) ──────────────────────────────────────────────────
const CUBE_VERTS = [
  [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
  [-1,-1, 1],[1,-1, 1],[1,1, 1],[-1,1, 1],
];
const CUBE_EDGES = [
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7],
];
let cubeAngleA = 0, cubeAngleB = 0;

function rotateCube(verts, angleA, angleB) {
  const cosA = Math.cos(angleA), sinA = Math.sin(angleA);
  const cosB = Math.cos(angleB), sinB = Math.sin(angleB);
  return verts.map(([x, y, z]) => {
    const x1 = x * cosA - z * sinA, z1 = x * sinA + z * cosA;
    const y1 = y * cosB - z1 * sinB, z2 = y * sinB + z1 * cosB;
    return [x1, y1, z2];
  });
}

function projectPoint(x, y, z, cx, cy, scale) {
  const d = z + 3.5;
  return [Math.round(cx + (x / d) * scale * 2), Math.round(cy + (y / d) * scale), d];
}

function edgeChar(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > ay * 2) return '─';
  if (ay > ax * 2) return '│';
  return (dx > 0 && dy > 0) || (dx < 0 && dy < 0) ? '╲' : '╱';
}

function drawCubeLine(buf, x0, y0, z0, x1, y1, z1) {
  const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  const steps = Math.max(dx, dy);
  for (let i = 0; i <= steps; i++) {
    const t = steps > 0 ? i / steps : 0;
    const z = z0 + (z1 - z0) * t;
    const key = `${x},${y}`;
    if (!buf[key] || z < buf[key].z) buf[key] = { ch: edgeChar(x1-x0, y1-y0), z, x, y };
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
}

function renderTitleCube() {
  cubeAngleA += 0.015; cubeAngleB += 0.008;
  const rotated   = rotateCube(CUBE_VERTS, cubeAngleA, cubeAngleB);
  const projected = rotated.map(([x, y, z]) => projectPoint(x, y, z, CUBE_CX, CUBE_CY, 3.5));
  const buf = {};
  for (const [i, j] of CUBE_EDGES)
    drawCubeLine(buf, projected[i][0], projected[i][1], projected[i][2],
                      projected[j][0], projected[j][1], projected[j][2]);
  for (const p of Object.values(buf)) {
    if (p.x < 0 || p.x >= DISPLAY_WIDTH || p.y < 0 || p.y >= DISPLAY_HEIGHT) continue;
    const fg = p.z < 3.0 ? '#ffd633' : p.z < 3.8 ? '#aa8822' : '#555555';
    display.draw(p.x, p.y, p.ch, fg, BG);
  }
  for (const [px, py, pz] of projected)
    if (px >= 0 && px < DISPLAY_WIDTH && py >= 0 && py < DISPLAY_HEIGHT)
      display.draw(px, py, '+', pz < 3.5 ? '#ffd633' : '#777755', BG);
}

// ── Title particles (§3.3) ────────────────────────────────────────────────────
const titleParticles  = [];
const PARTICLE_CHARS  = ['·', '✦', '*'];
const PARTICLE_COLORS = ['#5a4a20', '#6a5a28', '#4a3a18', '#8a7a30'];

function spawnTitleParticle() {
  titleParticles.push({
    x: CUBE_CX - 6 + Math.random() * 12,
    y: CUBE_CY - 3 + Math.random() * 6,  // within cube area only, max CUBE_CY+3
    vy: -0.04 - Math.random() * 0.03,
    vx: (Math.random() - 0.5) * 0.02,
    char: PARTICLE_CHARS[Math.floor(Math.random() * PARTICLE_CHARS.length)],
    color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    life: 120 + Math.floor(Math.random() * 80),
  });
}

let titleFrame = 0;

function titleAnimLoop() {
  if (state.gameState !== 'title' && state.gameState !== 'title_menu' && state.gameState !== 'changelog') return;
  // Don't render cube/particles when changelog overlay is open
  if (state.gameState === 'changelog') { requestAnimationFrame(titleAnimLoop); return; }
  titleFrame++;

  // Step 1: Clear the entire cube/particle zone (rows 2..ART_Y-1, inside border)
  for (let y = 2; y < ART_Y; y++)
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++)
      display.draw(x, y, ' ', BRIGHT_WHITE, BG);

  // Step 2: Update and cull particles
  for (let i = titleParticles.length - 1; i >= 0; i--) {
    const p = titleParticles[i];
    p.x += p.vx; p.y += p.vy; p.life--;
    if (p.life <= 0 || p.y <= 1 || p.y >= ART_Y - 1) { titleParticles.splice(i, 1); }
  }

  // Step 3: Draw cube
  renderTitleCube();

  // Step 4: Draw particles on top of cube
  for (const p of titleParticles) {
    const px = Math.floor(p.x), py = Math.floor(p.y);
    if (px >= 1 && px < DISPLAY_WIDTH - 1 && py >= 1 && py < DISPLAY_HEIGHT - 1)
      display.draw(px, py, p.char, p.color, BG);
  }

  // Step 5: Draw WIDGETER text with pulse
  drawArt(titleFrame);

  if (titleParticles.length < 4 && Math.random() < 0.015) spawnTitleParticle();
  requestAnimationFrame(titleAnimLoop);
}

function drawTitleBorder() {
  const W = DISPLAY_WIDTH, H = DISPLAY_HEIGHT, BC = '#ffd633';
  display.draw(0,   0,   '╔', BC, BG); display.draw(W-1, 0,   '╗', BC, BG);
  display.draw(0,   H-1, '╚', BC, BG); display.draw(W-1, H-1, '╝', BC, BG);
  for (let x = 1; x < W - 1; x++) { display.draw(x, 0, '═', BC, BG); display.draw(x, H-1, '═', BC, BG); }
  for (let y = 1; y < H - 1; y++) { display.draw(0, y, '║', BC, BG); display.draw(W-1, y, '║', BC, BG); }
}

clearScreen();
drawTitleBorder();
drawArt(0);
drawPrompt(true);

const CREDIT  = "Created by Adam A.";
const VERSION = "alpha 1.07.10";

// ── Sound system ──────────────────────────────────────────────────────────────
const SOUNDS = {};
function loadSound(name, path) {
  const audio = new Audio(path);
  audio.volume = 0.3;
  SOUNDS[name] = audio;
}
function playSound(name) {
  if (state.audio?.muted) return;
  const s = SOUNDS[name];
  if (!s) return;
  const clone = s.cloneNode();
  clone.volume = s.volume;
  clone.play().catch(() => {});
}
loadSound('bought',  'sounds/bought.wav');
loadSound('click',   'sounds/click.wav');
loadSound('crafted', 'sounds/crafted.wav');
loadSound('newgame', 'sounds/neworcontinue.wav');
loadSound('sold',    'sounds/sold.wav');
loadSound('start',   'sounds/startgame.wav');
function drawTitleBottomText() {
  const CHLABEL = 'press c for changelog';
  for (let i = 0; i < CREDIT.length;   i++) display.draw(77 - CREDIT.length   + i, 45, CREDIT[i],   '#555555', BG);
  for (let i = 0; i < VERSION.length;  i++) display.draw(77 - VERSION.length  + i, 46, VERSION[i],  '#555555', BG);
  for (let i = 0; i < CHLABEL.length;  i++) display.draw(77 - CHLABEL.length  + i, 47, CHLABEL[i],  '#333333', BG);
}
drawTitleBottomText();
requestAnimationFrame(titleAnimLoop);

let promptVisible = true;
let blinkInterval = setInterval(() => {
  promptVisible = !promptVisible;
  drawPrompt(promptVisible);
}, 500);

// ── Event log (§3.8) ──────────────────────────────────────────────────────────

let logQueue   = []; // lines waiting to scroll in: [{text, color}]
let pendingLine = null; // line currently scrolling in: {text, color, charsRevealed}

function addLog(message, color) {
  const MAX_LOG = 76;
  if (message.length > MAX_LOG) {
    const cut   = message.lastIndexOf(' ', MAX_LOG);
    const split = cut > 0 ? cut : MAX_LOG;
    addLog(message.slice(0, split), color);
    addLog(message.slice(split + (cut > 0 ? 1 : 0)), color);
    return;
  }
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
      if (entry && entry.rich) {
        drawRow(row, '', DIM_GRAY); // clear the row first
        const prefix = '> ';
        const full   = prefix + entry.text;
        for (let ci = 0; ci < full.length && ci < DISPLAY_WIDTH; ci++) {
          const cIdx = ci - prefix.length; // character index into entry.text
          const col  = entry.colors[Math.max(0, cIdx) % entry.colors.length];
          const fg   = ci < prefix.length ? DIM_GRAY : col;
          display.draw(ci, row, full[ci], fg, BG);
        }
      } else if (entry) {
        drawRow(row, '> ' + entry.text, entry.color);
      } else {
        drawRow(row, '>', DIM_GRAY);
      }
    }
  }
  drawPhaseGoal();
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

let phaseGoalFlashUntil = 0;
let phaseGoalLastValue  = -1;

function drawPhaseGoal() {
  if (state.gameState !== 'playing' && state.gameState !== 'crafting') return;

  let goalText = '';
  let currentRemaining = 0;

  if (state.phase === 1) {
    currentRemaining = Math.max(0, Math.ceil(100 - state.lifetimeGoldEarned));
    goalText = `PHASE 2 IN ${currentRemaining}CR`;
  } else if (state.phase === 2) {
    currentRemaining = Math.max(0, Math.ceil(1000 - state.lifetimeGoldEarned));
    goalText = `PHASE 3 IN ${currentRemaining}CR`;
  } else if (state.phase === 3) {
    currentRemaining = Math.max(0, Math.ceil(2000 - state.lifetimeGoldEarned));
    goalText = `PHASE 4 IN ${currentRemaining}CR`;
  } else if (state.phase === 4) {
    currentRemaining = Math.max(0, Math.ceil(10000 - state.lifetimeGoldEarned));
    goalText = `PHASE 5 IN ${currentRemaining}CR`;
  } else if (state.phase === 5) {
    currentRemaining = Math.max(0, 5000 - state.rocketWidgets);
    if (currentRemaining > 0) {
      goalText = `ROCKET: ${state.rocketWidgets.toLocaleString()}/${(5000).toLocaleString()}`;
    } else {
      goalText = 'LAUNCH READY';
    }
  }

  if (!goalText) return;

  if (phaseGoalLastValue >= 0 && currentRemaining < phaseGoalLastValue) {
    phaseGoalFlashUntil = Date.now() + 1000;
  }
  phaseGoalLastValue = currentRemaining;

  const isFlashing = Date.now() < phaseGoalFlashUntil;
  let textFg;
  if (isFlashing) {
    textFg = '#ffffff';
  } else if (state.phase === 5) {
    textFg = '#ff5555';
  } else {
    textFg = '#66cc66';
  }

  const borderFg = '#555555';
  const padded = ' ' + goalText + ' ';
  const boxW = padded.length + 2;
  const boxX = DISPLAY_WIDTH - boxW;
  const topY = LOG_END_ROW;

  display.draw(boxX, topY - 1, '╔', borderFg, BG);
  for (let i = 1; i < boxW - 1; i++) display.draw(boxX + i, topY - 1, '═', borderFg, BG);
  display.draw(boxX + boxW - 1, topY - 1, '╗', borderFg, BG);

  display.draw(boxX, topY, '║', borderFg, BG);
  for (let i = 0; i < padded.length; i++) display.draw(boxX + 1 + i, topY, padded[i], textFg, BG);
  display.draw(boxX + boxW - 1, topY, '║', borderFg, BG);

  display.draw(boxX, topY + 1, '╚', borderFg, BG);
  for (let i = 1; i < boxW - 1; i++) display.draw(boxX + i, topY + 1, '═', borderFg, BG);
  display.draw(boxX + boxW - 1, topY + 1, '╝', borderFg, BG);
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
  sx = seg(sx, `Gold: ${formatCredits(state.player.gold)}`, state.player.gold < 0 ? '#ff5555' : BRIGHT_YELLOW) + 2;
  sx = seg(sx, `Raw: ${inv.rm}`, '#ff9933') + 2;
  sx = seg(sx, `Widgets: ${inv.widgets}/${cap.widgets}`, widgetFg) + 2;
       seg(sx, `Price: ${state.marketPrice}g`, '#66cc66');
  drawTimeIndicator();
  drawPhaseGoal();
  if (state.phase >= 2) {
    const WEATHER_ICONS = { clear: ['*', '#ffd633'], rain: ['~', '#4a8aaa'], fog: ['%', '#666666'], heatwave: ['^', '#ff6633'], storm: ['!', '#ffaa00'] };
    const [icon, color] = WEATHER_ICONS[state.weather.current] || ['*', '#ffd633'];
    display.draw(DISPLAY_WIDTH - 2, STATUS_ROW, icon, color, BG);
  }
  if (state.cooking?.activeBuff) {
    display.draw(DISPLAY_WIDTH - 4, STATUS_ROW, '♨', state.cooking.activeBuff.color, BG);
  }
}

// ── Tile map (§4.2) ───────────────────────────────────────────────────────────

// Station definitions — single source of truth for layout and colors
const STATION_DEFS = [
  { x: 66, y: 34, label: 'LF', wc: DIM_GRAY, lc: DIM_GRAY },
  { x: 23, y: 32, label: 'ST', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x: 61, y:  4, label: 'BK', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x: 56, y: 16, label: 'TR', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x:  8, y: 35, label: 'GS', wc: DIM_GRAY,  lc: DIM_GRAY  },
  { x:  9, y:  2, label: 'RM', wc: '#ff9933', lc: '#ffaa55', dc: '#cc7722' },
  { x: 34, y:  8, label: 'WB', wc: '#cc3300', lc: '#ff5533', dc: '#aa2200' },
  { x: 61, y: 23, label: 'MT', wc: '#ffd633', lc: '#ffea66', dc: '#ccaa22' },
  { x: 23, y: 17, label: 'OF', wc: '#f0f0f0', lc: '#ffffff', dc: '#aaaaaa' },
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

function clearMenuRegion(x, y, width, height) {
  for (let dx = 0; dx < width; dx++)
    for (let dy = 0; dy < height; dy++)
      if (x + dx >= 0 && x + dx < DISPLAY_WIDTH && y + dy >= 0 && y + dy < WORLD_ROWS)
        markDirty(x + dx, y + dy);
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
                    || (x >= 64 && x <= 71 && y >= 32 && y <= 38) // LF clearance
                    || (x >= 70 && x <= 75 && y >= 10 && y <= 14); // CS clearance
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

  // Dense jungle west of pond — x=1-14, y=16-35 (§4.2)
  for (let y = 16; y <= 35; y++) {
    for (let x = 1; x <= 14; x++) {
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const t = tileMap[x][y];
      if (t.glyph === ':' || t.glyph === '~') continue;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (t.glyph !== 'Y' && noise < 20) {
        const tile = mk('Y', '#1a4a1a', true);
        tile.description = 'A jungle tree. The bark is slick with moisture.';
        tileMap[x][y] = tile;
        continue;
      }
      if (t.glyph === 'Y') {
        const shade = noise % 4;
        if (shade === 0)      t.fg = '#1a5a1a';
        else if (shade === 1) t.fg = '#2a6a2a';
        else if (shade === 2) t.fg = '#1a4a2a';
        // shade 3: keep original color for variety
        t.description = 'A jungle tree. The bark is slick with moisture.';
        continue;
      }
      if (noise < 55) {
        const ug = noise % 4;
        let tile;
        if (ug === 0) {
          tile = mk('"', '#1a4a1a', true);
          tile.description = 'Ferns crowd the forest floor.';
        } else if (ug === 1) {
          tile = mk('{', '#1a3a1a', true);
          tile.description = 'Thick vines hang from the canopy.';
        } else if (ug === 2) {
          tile = mk('%', '#2a4a1a', true);
          tile.description = 'A dense bush. Something could be hiding in there.';
        } else {
          tile = mk("'", '#1a3a1a', true);
          tile.description = 'Low growth. The jungle presses in from all sides.';
        }
        tileMap[x][y] = tile;
      }
    }
  }

  // Sandy desert biome — bottom-right corner around LF, gradient blend into grass (§4.2)
  for (let y = 24; y <= WORLD_ROWS - 2; y++) {
    for (let x = 53; x <= DISPLAY_WIDTH - 2; x++) {
      const t = tileMap[x][y];
      if (!t.walkable) continue;
      if (t.glyph === ':' || t.glyph === 'Y') continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;

      const sandX = (x - 53) / (DISPLAY_WIDTH - 2 - 53);
      const sandY = (y - 24) / (WORLD_ROWS - 2 - 24);
      const sandStrength = sandX * sandY;

      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (noise >= sandStrength * 100) continue;

      const duneRow = ((y + x * 0.3) % 5 < 1.2);
      let glyph, fg;
      if (duneRow) {
        glyph = '_'; fg = '#7a6538';
      } else if (noise % 3 === 0) {
        glyph = ','; fg = '#4a3a1e';
      } else {
        glyph = '.'; fg = '#5a4828';
      }
      tileMap[x][y] = mk(glyph, fg, true);
    }
  }
  // Sand ripple accents in deep desert zone
  for (let y = 32; y <= WORLD_ROWS - 2; y++) {
    for (let x = 64; x <= DISPLAY_WIDTH - 2; x++) {
      const t = tileMap[x][y];
      if (!t.walkable) continue;
      if (t.glyph === ':' || t.glyph === 'Y') continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      const sandX = (x - 53) / (DISPLAY_WIDTH - 2 - 53);
      const sandY = (y - 24) / (WORLD_ROWS - 2 - 24);
      if (sandX * sandY > 0.7 && noise % 12 === 0) {
        const tile = mk('~', '#6a5830', true);
        tile.description = 'A ripple in the sand. You wonder what made it.';
        tileMap[x][y] = tile;
      }
    }
  }

  // Snow/Frost Zone — top-right corner x=50-78, y=1-6 (§4.2)
  for (let y = 1; y <= 6; y++) {
    for (let x = 50; x <= 78; x++) {
      const t = tileMap[x][y];
      if (!t.walkable || t.glyph === ':' || t.glyph === 'Y') continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const frostStrength = 1.0 - (y - 1) / 6;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (noise >= frostStrength * 85) continue;
      let glyph, fg, desc;
      if (noise % 5 === 0)      { glyph = '*'; fg = '#aabbcc'; desc = "A snowflake. It won't last."; }
      else if (noise % 3 === 0) { glyph = '_'; fg = '#667788'; desc = 'A thin sheet of ice. Watch your step.'; }
      else                      { glyph = '·'; fg = '#8899aa'; desc = 'Frost. The ground crunches underfoot.'; }
      const tile = mk(glyph, fg, true);
      tile.description = desc;
      tileMap[x][y] = tile;
    }
  }
  // Frozen trees in frost zone
  for (let y = 1; y <= 5; y++) {
    for (let x = 50; x <= 78; x++) {
      if (tileMap[x][y].glyph === 'Y') {
        tileMap[x][y] = { ...tileMap[x][y], fg: '#88aacc', description: 'A frozen tree. The bark is slick with ice.' };
      }
    }
  }
  // Snowman at (63, 2) — solid object in frost zone
  const snowX = 63, snowY = 2;
  if (!isPathTile(snowX, snowY) && !isStationTile(snowX, snowY)) {
    const smHead = mk('o', '#ccddee', false);
    smHead.description = "A snowman's head. Two pebble eyes stare back.";
    tileMap[snowX][snowY] = smHead;
    const smBody = mk('8', '#aabbcc', false);
    smBody.description = "The snowman's body. Someone gave it a button.";
    tileMap[snowX][snowY + 1] = smBody;
    const smBase = mk('O', '#8899aa', false);
    smBase.description = 'The base of a snowman. Wider than expected.';
    tileMap[snowX][snowY + 2] = smBase;
  }

  // Rocky Outcrop — center-south x=32-46, y=35-41 (§4.2)
  for (let y = 35; y <= 41; y++) {
    for (let x = 32; x <= 46; x++) {
      const t = tileMap[x][y];
      if (!t.walkable || t.glyph === ':' || t.glyph === 'Y') continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (noise >= 70) continue;
      let glyph, fg, desc;
      if (noise % 7 === 0)      { glyph = '^'; fg = '#5a5a5a'; desc = 'Jagged stone. This was here before you.'; }
      else if (noise % 4 === 0) { glyph = '▪'; fg = '#4a4a4a'; desc = "A stubborn boulder. It isn't moving."; }
      else if (noise % 3 === 0) { glyph = ';'; fg = '#3a3a3a'; desc = 'Loose pebbles. They scatter when you walk.'; }
      else                      { glyph = '.'; fg = '#4a4a4a'; desc = 'Gravel. This area is rocky.'; }
      const tile = mk(glyph, fg, true);
      tile.description = desc;
      tileMap[x][y] = tile;
    }
  }

  // Pond sand fringe — thin ring outside dirt bank, before marsh so marsh overwrites (§4.2)
  for (let y = POND_CY - POND_RY - 2; y <= POND_CY + POND_RY + 2; y++) {
    for (let x = POND_CX - POND_RX - 2; x <= POND_CX + POND_RX + 2; x++) {
      if (x <= 0 || x >= DISPLAY_WIDTH - 1 || y <= 0 || y >= WORLD_ROWS - 1) continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const t = tileMap[x][y];
      if (t.glyph === '~' || t.glyph === ',' || t.glyph === ':' || t.glyph === 'Y') continue;
      const dx = (x - POND_CX) / (POND_RX + 1.5);
      const dy = (y - POND_CY) / (POND_RY + 1.5);
      const dist = dx * dx + dy * dy;
      if (dist >= 1 || dist < 0.6) continue;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (noise >= 50) continue;
      const tile = mk('.', '#5a4828', true);
      tile.description = 'Sandy bank. The pond is close.';
      tileMap[x][y] = tile;
    }
  }

  // Marsh/Reeds — fringe ring 2-3 tiles beyond pond bank (§4.2)
  for (let y = POND_CY - POND_RY - 4; y <= POND_CY + POND_RY + 4; y++) {
    for (let x = POND_CX - POND_RX - 4; x <= POND_CX + POND_RX + 4; x++) {
      if (x <= 0 || x >= DISPLAY_WIDTH - 1 || y <= 0 || y >= WORLD_ROWS - 1) continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const t = tileMap[x][y];
      if (t.glyph === '~' || t.glyph === ',' || t.glyph === ':' || t.glyph === 'Y') continue;
      const dx = (x - POND_CX) / (POND_RX + 3);
      const dy = (y - POND_CY) / (POND_RY + 3);
      if (dx * dx + dy * dy >= 1) continue;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (noise >= 65) continue;
      let glyph, fg, desc;
      if (noise % 5 === 0)      { glyph = '|'; fg = '#2a4a2a'; desc = 'Tall reeds. Something rustles inside.'; }
      else if (noise % 4 === 0) { glyph = ';'; fg = '#3a3a1a'; desc = 'Cattails. They sway without wind.'; }
      else                      { glyph = ','; fg = '#1a3a2a'; desc = 'Wet mud. Your boots sink a little.'; }
      const tile = mk(glyph, fg, true);
      tile.description = desc;
      tileMap[x][y] = tile;
    }
  }

  // Second wildflower patch — left forest edge x=3-14, y=10-18 (§4.2)
  const FLOWER2_COLORS = ['#6688cc', '#aaaacc', '#88aa88'];
  const FLOWER2_DESCS  = [
    'A pale blue flower. It looks cold but alive.',
    'White petals, almost translucent.',
    'A green-tinged bloom. Stubborn little thing.',
  ];
  for (let y = 10; y <= 18; y++) {
    for (let x = 3; x <= 14; x++) {
      if (x <= 0 || x >= DISPLAY_WIDTH - 1 || y <= 0 || y >= WORLD_ROWS - 1) continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      if (tileMap[x][y].glyph === 'Y' || tileMap[x][y].glyph === ':') continue;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 100;
      if (noise < 12) {
        const fi = (x * 31 + y * 17) % 3;
        const tile = mk('*', FLOWER2_COLORS[fi], true);
        tile.description = FLOWER2_DESCS[fi];
        tileMap[x][y] = tile;
      }
    }
  }

  // Scattered mushrooms — ~0.8% density, placed last so they appear on top (§4.2)
  const MUSHROOM_GLYPHS = [
    { glyph: '♠', fg: '#6a4a3a' },
    { glyph: '♠', fg: '#4a6a4a' },
    { glyph: '♠', fg: '#8a6a5a' },
    { glyph: '♠', fg: '#5a3a5a' },
    { glyph: 'τ',  fg: '#aa6644' },
  ];
  const MUSHROOM_DESCS = [
    "A small mushroom. Don't eat it.",
    "A small mushroom. Don't eat it.",
    "A small mushroom. Don't eat it.",
    "A small mushroom. Don't eat it.",
    "A tall mushroom. Definitely don't eat it.",
  ];
  for (let y = 1; y < WORLD_ROWS - 1; y++) {
    for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
      const t = tileMap[x][y];
      if (!t.walkable) continue;
      if (t.glyph === ':' || t.glyph === 'Y' || t.glyph === '*' || t.glyph === '~') continue;
      if (isPathTile(x, y) || isStationTile(x, y)) continue;
      const noise = ((x * 1664525 + y * 1013904223) >>> 16) % 1000;
      if (noise >= 8) continue;
      const mi = noise % MUSHROOM_GLYPHS.length;
      const tile = mk(MUSHROOM_GLYPHS[mi].glyph, MUSHROOM_GLYPHS[mi].fg, true);
      tile.description = MUSHROOM_DESCS[mi];
      tileMap[x][y] = tile;
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
  if (state.cottage.owned) placeGardenTiles();

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
    if (st2) { st2.wc = '#66ccff'; st2.lc = '#aaddff'; st2.dc = '#4488aa'; }
    if (state.stations.general_store?.unlocked) {
      const gs2 = STATION_DEFS.find(s => s.label === 'GS');
      if (gs2) { gs2.wc = '#aa66ff'; gs2.lc = '#cc99ff'; gs2.dc = '#884499'; }
    }
  }
  if (state.phase >= 3) {
    const bk3 = STATION_DEFS.find(s => s.label === 'BK');
    if (bk3) { bk3.wc = '#66cc66'; bk3.lc = '#aaffaa'; bk3.dc = '#449944'; }
    if (state.stations.newspaper?.unlocked) {
      const np3 = STATION_DEFS.find(s => s.label === 'NP');
      if (np3) { np3.wc = COLOR_NP_FRAME; np3.lc = COLOR_NP_LABEL; np3.dc = '#2a6a3a'; }
    }
  }
  if (state.phase >= 4) {
    const dv4 = STATION_DEFS.find(s => s.label === 'TR');
    if (dv4) { dv4.wc = '#cc66cc'; dv4.lc = '#dd99dd'; dv4.dc = '#884488'; }
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
      wall: 'The market. Open at dawn, closed at dusk. Widgets become gold here.',
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
    tileMap[s.x  ][s.y]   = mk('╔',        s.wc, false);
    tileMap[s.x+1][s.y]   = mk('═',        s.wc, false);
    tileMap[s.x+2][s.y]   = mk('═',        s.wc, false);
    tileMap[s.x+3][s.y]   = mk('╗',        s.wc, false);
    tileMap[s.x  ][s.y+1] = mk('║',        s.wc, false);
    tileMap[s.x+1][s.y+1] = mk(s.label[0], s.lc, false);
    tileMap[s.x+2][s.y+1] = mk(s.label[1], s.lc, false);
    tileMap[s.x+3][s.y+1] = mk('║',        s.wc, false);
    tileMap[s.x  ][s.y+2] = mk('╚',        s.wc, false);
    tileMap[s.x+1][s.y+2] = mk('-',        s.dc || s.wc, true);  // door — ASCII hyphen, walkable
    tileMap[s.x+2][s.y+2] = mk('═',        s.wc, false);
    tileMap[s.x+3][s.y+2] = mk('╝',        s.wc, false);
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
  // Pond center Look Mode description (§4.2)
  if (tileMap[22] && tileMap[22][25]) {
    if (!state.skills.aquatics?.purchased) {
      tileMap[22][25].description = 'The deepest part of the pond. Something glints below the surface. You cannot reach it.';
    } else if (!state.lakeEasterEgg?.discovered) {
      tileMap[22][25].description = 'The center of the lake. The water is calm but something catches the light below. Press space to investigate.';
    } else {
      tileMap[22][25].description = 'The center of the lake. The water is calm. Press space to fish.';
    }
  }
  // Surrounding pond tile descriptions are in descriptions.json tiles["21,25"] etc.

  // Casino (§4.2) — always stamp; locked state shows ?? in dim grey
  stampCasino(!state.stations.casino.unlocked);
  // Loading Port — only stamp when unlocked
  stampLoadingPort();

  // Rock proximity tile descriptions (override descriptions.json entries)
  if (tileMap[4]?.[12])  tileMap[4][12].description  = 'Something glints between the trees. You catch it for a moment, then it\'s gone. It comes back.';
  if (tileMap[41]?.[8])  tileMap[41][8].description  = 'A flash of yellow in the grass. Gone before you could focus. It will be again.';
  if (tileMap[73]?.[36]) tileMap[73][36].description = 'Something blue blinks here. Sometimes once an hour, sometimes more often.';

  // Mine entrance — stamp when discovered (§Mine)
  if (state.mine.discovered) placeMineEntrance();
}

function placeMineEntrance() {
  const mk = (g, fg, w) => ({ glyph: g, fg, bg: BG, walkable: w });
  const mx = 38, my = 38;
  const wc = '#aa6633', lc = '#ffaa55', dc = '#885522';
  tileMap[mx  ][my  ] = mk('╔', wc, false);
  tileMap[mx+1][my  ] = mk('═', wc, false);
  tileMap[mx+2][my  ] = mk('═', wc, false);
  tileMap[mx+3][my  ] = mk('╗', wc, false);
  tileMap[mx  ][my+1] = mk('║', wc, false);
  tileMap[mx+1][my+1] = mk('M', lc, false);
  tileMap[mx+2][my+1] = mk('N', lc, false);
  tileMap[mx+3][my+1] = mk('║', wc, false);
  tileMap[mx  ][my+2] = mk('╚', wc, false);
  tileMap[mx+1][my+2] = mk('Ω', dc, true);
  tileMap[mx+2][my+2] = mk('═', wc, false);
  tileMap[mx+3][my+2] = mk('╝', wc, false);
  tileMap[mx+1][my+2].station = 'mine';
  tileMap[mx+1][my+2].description = 'The mine entrance. A dark opening in the earth.';
  for (let dx = 0; dx < 4; dx++)
    for (let dy = 0; dy < 3; dy++)
      markDirty(mx + dx, my + dy);
}

// Inject cottage tiles into the live tileMap and mark them dirty.
// Called from buildTileMap() and immediately after purchase so the cottage
// appears without waiting for the next full drawWorld() call.
const GARDEN_DEFS = [
  // Vegetables — edible (eaten → regrow in 2 days)
  { key: 'tomato',   name: 'Tomato',   price:  6, glyph: 'o', fg: '#ff4444', type: 'veggie' },
  { key: 'carrot',   name: 'Carrot',   price:  4, glyph: '!', fg: '#ff8833', type: 'veggie' },
  { key: 'pumpkin',  name: 'Pumpkin',  price: 10, glyph: 'O', fg: '#ff8800', type: 'veggie' },
  { key: 'corn',     name: 'Corn',     price:  5, glyph: '|', fg: '#ccaa33', type: 'veggie' },
  { key: 'potato',   name: 'Potato',   price:  3, glyph: '·', fg: '#aa8855', type: 'veggie' },
  { key: 'cabbage',  name: 'Cabbage',  price:  4, glyph: '@', fg: '#44aa44', type: 'veggie' },
  { key: 'onion',    name: 'Onion',    price:  4, glyph: 'o', fg: '#ccaa55', type: 'veggie' },
  { key: 'pepper',   name: 'Pepper',   price:  5, glyph: '!', fg: '#ff3333', type: 'veggie' },
  { key: 'lettuce',  name: 'Lettuce',  price:  3, glyph: '@', fg: '#55cc55', type: 'veggie' },
  { key: 'beet',     name: 'Beet',     price:  5, glyph: '●', fg: '#882255', type: 'veggie' },
  { key: 'celery',   name: 'Celery',   price:  3, glyph: '|', fg: '#66aa44', type: 'veggie' },
  { key: 'mushroom', name: 'Mushroom', price:  6, glyph: '♠', fg: '#886655', type: 'veggie' },
];

function placeCottageTiles() {
  const cx = state.cottage.mapX, cy = state.cottage.mapY;
  const RC = '#cc3333', WC_COT = '#886633', DC_COT = '#aa6633';
  const mk = (g, fg, w) => ({ glyph: g, fg, bg: BG, walkable: w });
  // Row 0: roof — walkable (╱╲ glyphs)
  const ROOF = [' ', '╱', '╲', '╱', '╲', ' '];
  for (let i = 0; i < 6; i++) tileMap[cx+i][cy] = mk(ROOF[i], RC, true);
  // Row 1: top wall
  tileMap[cx  ][cy+1] = mk('╔', WC_COT, false);
  tileMap[cx+1][cy+1] = mk('═', WC_COT, false);
  tileMap[cx+2][cy+1] = mk('═', WC_COT, false);
  tileMap[cx+3][cy+1] = mk('═', WC_COT, false);
  tileMap[cx+4][cy+1] = mk('═', WC_COT, false);
  tileMap[cx+5][cy+1] = mk('╗', WC_COT, false);
  // Row 2: middle wall
  tileMap[cx  ][cy+2] = mk('║', WC_COT, false);
  for (let i = 1; i <= 4; i++) tileMap[cx+i][cy+2] = mk(' ', WC_COT, false);
  tileMap[cx+5][cy+2] = mk('║', WC_COT, false);
  // Row 3: bottom wall with door
  tileMap[cx  ][cy+3] = mk('╚', WC_COT, false);
  tileMap[cx+1][cy+3] = mk('═', WC_COT, false);
  tileMap[cx+2][cy+3] = mk('═', WC_COT, false);
  tileMap[cx+3][cy+3] = mk('-', DC_COT, true); // door — walkable, enters interior
  tileMap[cx+4][cy+3] = mk('═', WC_COT, false);
  tileMap[cx+5][cy+3] = mk('╝', WC_COT, false);
  // Mark all 24 cottage tiles dirty
  for (let dx = 0; dx < 6; dx++)
    for (let dy = 0; dy < 4; dy++)
      markDirty(cx + dx, cy + dy);
}

function placeGardenTiles() {
  if (!state.cottage.owned) return;
  const mk = (g, fg, w) => ({ glyph: g, fg, bg: BG, walkable: w });
  const FENCE = '#886633';
  const SOIL  = '#2a2a1a';
  // Garden: 6 wide × 5 tall fence. Origin = (mapX-7, mapY-1) = (33, 20)
  const gx = state.cottage.mapX - 7; // 33
  const gy = state.cottage.mapY - 1; // 20
  const GW = 6, GH = 5;
  const GARDEN_INNER_X = gx + 1; // 34
  const GARDEN_INNER_Y = gy + 1; // 21

  // Fence border
  for (let x = gx; x < gx + GW; x++) {
    const topTile = mk('═', FENCE, false); topTile.description = 'A low wooden fence around the garden.';
    const botTile = mk('═', FENCE, false); botTile.description = 'A low wooden fence around the garden.';
    tileMap[x][gy]        = topTile;
    tileMap[x][gy + GH-1] = botTile;
  }
  for (let y = gy; y < gy + GH; y++) {
    const leftTile = mk('║', FENCE, false); leftTile.description = 'A low wooden fence around the garden.';
    const rightTile = mk('║', FENCE, false); rightTile.description = 'A low wooden fence around the garden.';
    tileMap[gx][y]        = leftTile;
    tileMap[gx + GW-1][y] = rightTile;
  }
  const mkCorner = (g) => { const t = mk(g, FENCE, false); t.description = 'A low wooden fence around the garden.'; return t; };
  tileMap[gx][gy]             = mkCorner('╔');
  tileMap[gx + GW-1][gy]     = mkCorner('╗');
  tileMap[gx][gy + GH-1]     = mkCorner('╚');
  tileMap[gx + GW-1][gy + GH-1] = mkCorner('╝');
  // Gate in bottom fence (centre column) — walkable opening
  const gateTile = mk('_', FENCE, true); gateTile.description = 'A gap in the garden fence. You can step through.';
  tileMap[gx + 2][gy + GH - 1] = gateTile;

  // Interior: 4 wide × 3 tall = 12 plot tiles
  for (let i = 0; i < GARDEN_DEFS.length; i++) {
    const item = GARDEN_DEFS[i];
    const px = GARDEN_INNER_X + (i % 4);
    const py = GARDEN_INNER_Y + Math.floor(i / 4);
    if (state.garden[item.key] === true) {
      const t = mk(item.glyph, item.fg, true);
      t.description = `A ${item.name}. Looks ripe. Press Space to eat.`;
      tileMap[px][py] = t;
    } else if (state.garden[item.key] === 'eaten') {
      const regrowDay = state.gardenRegrow[item.key] ?? '?';
      const t = mk('·', '#445533', true);
      t.description = `The ${item.name} was eaten. Regrows day ${regrowDay}.`;
      tileMap[px][py] = t;
    } else {
      const t = mk('·', SOIL, true);
      t.description = 'Tilled soil. Ready for planting.';
      tileMap[px][py] = t;
    }
  }

  // Mark all garden tiles dirty
  for (let dx = 0; dx < GW; dx++)
    for (let dy = 0; dy < GH; dy++)
      markDirty(gx + dx, gy + dy);
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
    "[arrows: move] [space: use] [i: inv] [o: look] [p: ponder]",
    COLOR_HINT_LINE);
  drawPhaseGoal();
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
  "On the morning of the deep orange sun, the dew is heavy on the leaves surrounding your workshop. The air smells of something metallic.",
  "You have inherited this place. A workbench, a plot of land, a small wallet of gold. The buyers come at dawn and leave at dusk. Between these hours, you will have nothing but time to manufacture.",
  "You make small, useful objects using sufficient patience and raw materials.",
  "Begin at the shed [RM] to the north-west. Purchase materials and craft them into widgets at the workbench [WB] in the north. Sell what you make at the market [MT] in the south-east during operational hours.",
];
const INTRO_HINT_SENTENCE = "Press 'o' to look around you for hints, and if you're stuck, press 'p' to ponder.";
const INTRO_NAV_TOKENS    = { '[RM]': '#ff6600', '[WB]': '#cc3300', '[MT]': '#ffd633' };
const INTRO_BORDER_COLOR  = '#886633';
const INTRO_FLOURISH_COLOR = '#aa8855';
const INTRO_TITLE_COLOR   = '#ffd633';
const INTRO_HINT_COLOR    = '#66cc66';
const INTRO_KEY_COLOR     = '#ffffff';
const INTRO_WRAP_W = 54;
const INTRO_INDENT = '  ';

function showIntroScreen() {
  state.gameState = 'intro';

  const BOX_W        = 60;
  const INNER_W      = BOX_W - 2; // 58
  const BOX_X        = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const FLOURISH_STR = '·~'.repeat(27); // 54 chars
  const TITLE_TEXT   = '-- WIDGETER --';
  const PROMPT_TEXT  = '[ press any key to begin ]';

  // Build animated paragraph data
  const allAnimParas = [
    { lines: wordWrap(INTRO_PARAS[0], INTRO_WRAP_W), type: 'text' },
    { lines: wordWrap(INTRO_PARAS[1], INTRO_WRAP_W), type: 'text' },
    { lines: wordWrap(INTRO_PARAS[2], INTRO_WRAP_W), type: 'text' },
    { lines: wordWrap(INTRO_PARAS[3], INTRO_WRAP_W), type: 'nav' },
    { lines: wordWrap(INTRO_HINT_SENTENCE, INTRO_WRAP_W), type: 'hint' },
    { lines: ['Good luck.'], type: 'text' },
  ];

  // Build rows array
  const rows = [];
  rows.push({ flourish: true }); // [0] top flourish — shown immediately
  rows.push(null);                // [1] blank
  rows.push({ text: TITLE_TEXT, fg: INTRO_TITLE_COLOR, center: true }); // [2]
  rows.push(null);                // [3] blank

  const PARA_START_IDX = rows.length; // = 4

  for (let i = 0; i < allAnimParas.length; i++) {
    if (i > 0) rows.push(null); // blank gap between paragraphs
    for (const line of allAnimParas[i].lines) {
      const r = { text: INTRO_INDENT + line, fg: BRIGHT_WHITE };
      if (allAnimParas[i].type === 'nav')  r.coloredNav  = true;
      if (allAnimParas[i].type === 'hint') r.coloredHint = true;
      rows.push(r);
    }
  }

  // Footer rows (revealed by showPrompt)
  rows.push(null);                // blank after Good luck.   → PROMPT_IDX - 3
  rows.push({ flourish: true }); // bottom flourish           → PROMPT_IDX - 2
  rows.push(null);                // blank before prompt       → PROMPT_IDX - 1
  const PROMPT_IDX = rows.length;
  rows.push({ text: PROMPT_TEXT, fg: BRIGHT_CYAN, center: true }); // prompt
  rows.push(null);                // blank after prompt

  const BOX_H = rows.length + 2; // +2 for top/bottom borders
  const BOX_Y = Math.floor((DISPLAY_HEIGHT - BOX_H) / 2);

  function drawContentRow(i, fg_override) {
    const y   = BOX_Y + 1 + i;
    const row = rows[i];
    display.draw(BOX_X,             y, '║', INTRO_BORDER_COLOR, BG);
    display.draw(BOX_X + BOX_W - 1, y, '║', INTRO_BORDER_COLOR, BG);
    if (row === null || fg_override === BG) {
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, y, ' ', BRIGHT_WHITE, BG);
      return;
    }
    if (row.flourish) {
      const fg  = fg_override !== undefined ? fg_override : INTRO_FLOURISH_COLOR;
      const pad = Math.floor((INNER_W - FLOURISH_STR.length) / 2);
      for (let x = 0; x < INNER_W; x++) {
        const si = x - pad;
        display.draw(BOX_X + 1 + x, y, (si >= 0 && si < FLOURISH_STR.length) ? FLOURISH_STR[si] : ' ', fg, BG);
      }
      return;
    }
    let text = row.text;
    if (row.center) {
      const pad = Math.floor((INNER_W - text.length) / 2);
      text = ' '.repeat(pad) + text;
    }
    if ((row.coloredNav || row.coloredHint) && fg_override === undefined) {
      const tokens    = row.coloredNav ? INTRO_NAV_TOKENS : { "'o'": INTRO_KEY_COLOR, "'p'": INTRO_KEY_COLOR };
      const defaultFg = row.coloredHint ? INTRO_HINT_COLOR : BRIGHT_WHITE;
      let cx = 0, si = 0;
      while (cx < INNER_W) {
        if (si >= text.length) { display.draw(BOX_X + 1 + cx, y, ' ', BRIGHT_WHITE, BG); cx++; continue; }
        let matched = false;
        for (const [tok, clr] of Object.entries(tokens)) {
          if (text.startsWith(tok, si)) {
            for (let j = 0; j < tok.length && cx < INNER_W; j++, cx++)
              display.draw(BOX_X + 1 + cx, y, tok[j], clr, BG);
            si += tok.length; matched = true; break;
          }
        }
        if (!matched) { display.draw(BOX_X + 1 + cx, y, text[si], defaultFg, BG); cx++; si++; }
      }
    } else {
      const fg = fg_override !== undefined ? fg_override : row.fg;
      for (let x = 0; x < INNER_W; x++) {
        display.draw(BOX_X + 1 + x, y, x < text.length ? text[x] : ' ', fg, BG);
      }
    }
  }

  // Draw ornate border
  display.draw(BOX_X,             BOX_Y, '╔', INTRO_BORDER_COLOR, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', INTRO_BORDER_COLOR, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '═', INTRO_BORDER_COLOR, BG);
  const botY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X,             botY, '╚', INTRO_BORDER_COLOR, BG);
  display.draw(BOX_X + BOX_W - 1, botY, '╝', INTRO_BORDER_COLOR, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, botY, '═', INTRO_BORDER_COLOR, BG);

  // Mask all content, then reveal static header
  for (let i = 0; i < rows.length; i++) drawContentRow(i, BG);
  drawContentRow(0); // top flourish
  drawContentRow(1); // blank
  drawContentRow(2); // title
  drawContentRow(3); // blank

  // Build paraRanges for animation
  const paraRanges = [];
  let ri = PARA_START_IDX;
  for (let i = 0; i < allAnimParas.length; i++) {
    const blankIdx = i > 0 ? ri++ : null;
    paraRanges.push({ blankIdx, start: ri, end: ri + allAnimParas[i].lines.length });
    ri += allAnimParas[i].lines.length;
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
    if (i < allAnimParas.length - 1) {
      timers.push(setTimeout(() => revealPara(i + 1), 400));
    } else {
      timers.push(setTimeout(showPrompt, 400));
    }
  }

  function showPrompt() {
    if (state.gameState !== 'intro') return;
    drawContentRow(PROMPT_IDX - 3); // blank after Good luck.
    drawContentRow(PROMPT_IDX - 2); // bottom flourish
    drawContentRow(PROMPT_IDX - 1); // blank before prompt
    drawContentRow(PROMPT_IDX);     // prompt
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
  state.player = { x: 15, y: 14, gold: 10, inventory: { rm: 0, widgets: 0 }, inventoryCaps: { rm: 5, widgets: 5 }, color: '#f0f0f0', colorName: 'DEFAULT', ownedOutfits: [] };
  state.day = 1; state.tick = 0; state.dayTick = 0;
  state.marketOpen = true; state.phase = 1;
  state.lifetimeGoldEarned = 0; state.lifetimeWidgetsMade = 0; state.logLines = []; state.bellFiredToday = false;
  state.lastAmbientTick = 0; state.lastNarrativeTick = 0; state.nextAmbientDelay = 45; state.stepsWalked = 0;
  state.stations = {
    launch_facility: { unlocked: false }, storage: { unlocked: false }, general_store: { unlocked: false },
    newspaper: { unlocked: false, lastManipulationDay: -99, manipulationCooldownDays: 3, pendingManipulation: null },
    casino:    { id: 'CS', x: 71, y: 11, unlocked: false, visible: true, spunToday: 0, dailyBetTotal: 0, lossesTonight: 0, jackpotLogged: false },
  };
  state.shinyRocks = {
    red:    { collected: false, blinkTicks: [-1, -1, -1], blinkFramesRemaining: 0, x: 5,  y: 12 },
    yellow: { collected: false, blinkTicks: [-1, -1, -1], blinkFramesRemaining: 0, x: 42, y: 8  },
    blue:   { collected: false, blinkTicks: [-1, -1, -1], blinkFramesRemaining: 0, x: 74, y: 36 },
  };
  for (const rock of Object.values(state.shinyRocks)) {
    if (!rock.collected) rock.blinkTicks = pickThreeBlinkTicks();
  }
  state.newspaper = { todayHeadline: '', tomorrowForecastLabel: '', animTick: 0 };
  const gsDef = STATION_DEFS.find(s => s.label === 'GS');
  if (gsDef) { gsDef.wc = DIM_GRAY; gsDef.lc = DIM_GRAY; }
  const npDef = STATION_DEFS.find(s => s.label === 'NP');
  if (npDef) { npDef.wc = DIM_GRAY; npDef.lc = DIM_GRAY; delete npDef.dc; }
  state.rocketWidgets      = 0;
  state.rocketFull         = false;
  state.courierDestination = 'market';
  state.rocketAnimFrame    = 0;
  state.loadingPort        = { unlocked: false, widgets: 0, capacity: 100 };
  state.officeUnlocked     = false;
  state.officeTab          = 'workers';
  state.storage = { widgets: 0, rm: 0, widgetCap: 50, rmCap: 50 };
  state.workbenchWidgets    = 0;
  state.workbenchHammerFrame = 0;
  state.workbenchHammerTick  = 0;
  state.productionHalted = false;
  state.wbFullLogged     = false;
  state.couriersOwned    = 0;
  state.demand           = 50;
  state.marketPrice      = 8;
  state.marketBuyOffers  = [];
  generateBuyOffers();
  state.widgetsSoldToday = 0;
  state.demandMetLogged      = false;
  state.debt                 = 0;
  state.debtDaysUnpaid       = 0;
  state.demandCrashOccurred  = false;
  state.demandHistory        = [];
  state.terminalUnlocked     = false;
  state.derivatives          = { forwards: [], futures: [], options: [], pnlToday: 0, totalPnL: 0, marginCallActive: false, marginCallDay: 0 };
  state.terminal             = { positions: [], totalPnL: 0, pnlToday: 0, _nextId: 0 };
  state.volatility           = 0.2;
  state.endingTriggered      = false;
  state.endingCompleted      = false;
  state.devUnlocked          = false;
  state.widgetsMade          = 0;
  state.peakCredits          = 0;
  state.bank                 = {
    deposit: 0,
    creditRating: 'CC', creditRatingScore: 3.0,
    ratingHistory: [], consecutivePositiveDays: 0,
    creditNegativeLogged: false,
    casinoStartCredits: null,
    upgradeLogQueue: [],
    upgradeLogLastFired: 0,
    card: {
      tier: null, limit: 0, balance: 0, interestRate: 0,
      statementCycle: 10, lastStatementDay: 0,
      minimumPaymentDue: 0, paymentDueDay: 0, missedPayments: 0,
      consecutiveGoldPayments: 0, demotionWarningDay: null,
      upgradeNotified: { bronze: false, silver: false, gold: false, black: false },
      overdraftUsedThisCycle: false, graceUsedThisCycle: false,
      silverMarketExtraUsedToday: false, demandImmunityUsedThisWeek: false,
      insuranceBalance: 0, autoRMThreshold: 0,
    },
  };
  state.audio            = { muted: false };
  { const savedFS = localStorage.getItem('widgeter.settings.fullscreen');
    state.settings = { fullscreen: savedFS ? JSON.parse(savedFS) : false, currentFontSize: state.settings?.currentFontSize ?? 16 }; }
  state.workers = { apprentices: [], couriers: [] };
  state.stats = { rmLastTen: [], widgetsLastTen: [], creditsLastTen: [], widgetsMadeToday: 0, revenueToday: 0, costsToday: 0 };
  state.skills = { apprenticeCount: 0, courierCount: 0, workerCarryLevel: 0, workerSpeedLevel: 0, courierCarryLevel: 0, courierSpeedLevel: 0, storageExp1: 0, storageExp2: 0, reducedCarry: 0, discountDump: 0, demandHistory: 0, forecast: 0, futures: 0, optionsBuy: 0, optionsWrite: 0, volatilitySurface: 0, plantStory: 0, smearCampaign: 0, pickaxeLevel: 0, lantern: false, endurance: { pips: 0 }, aquatics: { purchased: false }, interfacing: { pips: 0 } };
  state.mine = { discovered: false, discoveredDay: -1, tiles: [], lastGenDay: -1, playerX: 12, playerY: 13, playerDir: { x: 0, y: -1 }, totalMined: 0, crystals: 0, bareHandHits: 0, handsBloodied: false, kickedOut: false, kickedOutUntilPeriod: -1, enemyX: -1, enemyY: -1 };
  state.weather = { current: 'clear', forecast: 'clear', actualTomorrow: 'clear' };
  state.craftingTimeRemote = 10;
  state.stats.pondStepsWalked = 0;
  state.fishing = { totalCatches: 0, catchesToday: 0, dailyLimit: 5, currentPhase: 'menu', fishTimer: 0, biteTimer: 0, fishX: 0, animTick: 0 };
  state.lakeEasterEgg = { discovered: false };
  state.cottage = { owned: false, mapX: 40, mapY: 21, playerX: 10, playerY: 5, furniture: {}, visited: false, catX: 9, catY: 7, matLoggedThisVisit: false };
  state.garden = {};
  state.gardenRegrow = {};
  state.cooking = { activeBuff: null };
  state.bookshelfLog = [];
  state.officeAnim = { apprenticeFlash: 0, courierFlash: 0 };
  state.player.stamps            = 0;
  state.player.stampWalkCounter  = 0;
  state.player.stampLookTiles    = new Set();
  state.player.stampLookMilestone = 0;
  state.player.stampEventTimer   = Math.floor(Math.random() * 21) + 40;
  state.player.stampHintFired    = false;
  state.player.stampHintTick     = 180 + Math.floor(Math.random() * 59);
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
  clearScreen(); drawTitleBorder(); drawArt(); drawTitleBottomText();
  state.gameState = 'title_menu';
  const BC = BRIGHT_CYAN;
  const INNER_W = 25;
  const BOX_W = INNER_W + 4;
  const BOX_H = 8;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = PROMPT_Y + 3;
  const CX = BOX_X + 2;
  display.draw(BOX_X, BOX_Y, '╔', BC, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', BC, BG);
  display.draw(BOX_X, BOX_Y + BOX_H - 1, '╚', BC, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y + BOX_H - 1, '╝', BC, BG);
  for (let x = 1; x < BOX_W - 1; x++) {
    display.draw(BOX_X + x, BOX_Y, '═', BC, BG);
    display.draw(BOX_X + x, BOX_Y + BOX_H - 1, '═', BC, BG);
  }
  for (let y = 1; y < BOX_H - 1; y++) {
    display.draw(BOX_X, BOX_Y + y, '║', BC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '║', BC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + y, ' ', BRIGHT_WHITE, BG);
  }
  const t1 = 'Are you sure?';
  const t2 = 'Your save will be lost.';
  const o1 = '1. Yes, start over';
  const o2 = '2. Cancel';
  for (let i = 0; i < t1.length; i++) display.draw(CX + i, BOX_Y + 1, t1[i], '#ffd633', BG);
  for (let i = 0; i < t2.length; i++) display.draw(CX + i, BOX_Y + 2, t2[i], '#f0f0f0', BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + 3, '─', '#333333', BG);
  for (let i = 0; i < o1.length; i++) display.draw(CX + i, BOX_Y + 4, o1[i], '#f0f0f0', BG);
  for (let i = 0; i < o2.length; i++) display.draw(CX + i, BOX_Y + 5, o2[i], '#f0f0f0', BG);
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

function showTitleOptions() {
  state.gameState = 'title_menu';
  const WC = '#555555';
  const INNER_W = 18;
  const BOX_W = INNER_W + 4;
  const BOX_H = 9;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = PROMPT_Y + 3;
  const CX = BOX_X + 2;

  let devPwMode = false, devPwBuf = '', devPwErr = false;

  function renderOpts() {
    // Clear and redraw box interior
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, BOX_Y, '╔', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '═', WC, BG);
    display.draw(BOX_X, bY, '╚', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '╝', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '═', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '║', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '║', WC, BG);
      for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
    }
    if (devPwMode) {
      const prompt = devPwErr ? 'Wrong password.' : `Password: ${'*'.repeat(devPwBuf.length)}_`;
      const ttl = '-- DEV MODE --';
      for (let i = 0; i < ttl.length; i++) display.draw(CX+i, BOX_Y+1, ttl[i], BRIGHT_CYAN, BG);
      for (let i = 0; i < prompt.length; i++) display.draw(CX+i, BOX_Y+3, prompt[i], devPwErr ? '#ff5555' : BRIGHT_WHITE, BG);
      const hint = 'ESC: cancel';
      for (let i = 0; i < hint.length; i++) display.draw(CX+i, BOX_Y+5, hint[i], WC, BG);
    } else {
      const ttl = '-- SETTINGS --';
      for (let i = 0; i < ttl.length; i++) display.draw(CX+i, BOX_Y+1, ttl[i], BRIGHT_CYAN, BG);
      const sndLabel = state.audio.muted ? '[OFF]' : '[ON ]';
      const sndFg    = state.audio.muted ? '#555555' : '#66cc66';
      const fsLabel  = state.settings.fullscreen ? '[ON ]' : '[OFF]';
      const fsFg     = state.settings.fullscreen ? '#66cc66' : '#555555';
      const line1 = `1. Sound   ${sndLabel}`;
      const line2 = `2. Fullscr ${fsLabel}`;
      const line3 = '3. Dev Mode';
      const line4 = '4. Back';
      for (let i = 0; i < line1.length; i++) display.draw(CX+i, BOX_Y+3, line1[i], i >= 11 ? sndFg : BRIGHT_WHITE, BG);
      for (let i = 0; i < line2.length; i++) display.draw(CX+i, BOX_Y+4, line2[i], i >= 11 ? fsFg  : BRIGHT_WHITE, BG);
      for (let i = 0; i < line3.length; i++) display.draw(CX+i, BOX_Y+5, line3[i], BRIGHT_WHITE, BG);
      for (let i = 0; i < line4.length; i++) display.draw(CX+i, BOX_Y+6, line4[i], WC, BG);
    }
  }

  function optsKeyHandler(e) {
    if (devPwMode) {
      if (e.key === 'Escape') { devPwMode = false; devPwBuf = ''; devPwErr = false; renderOpts(); return; }
      if (e.key === 'Backspace') { devPwBuf = devPwBuf.slice(0, -1); renderOpts(); return; }
      if (e.key === 'Enter') {
        if (devPwBuf.toLowerCase() === DEV_PASSWORD) {
          state.devUnlocked = true;
          devPwMode = false; devPwBuf = '';
          window.removeEventListener('keydown', optsKeyHandler);
          showContinueMenu();
        } else {
          devPwErr = true; renderOpts();
          setTimeout(() => { devPwErr = false; devPwBuf = ''; renderOpts(); }, 2000);
        }
        return;
      }
      if (e.key.length === 1 && devPwBuf.length < 10) { devPwBuf += e.key; renderOpts(); }
      return;
    }
    if (e.key === '1') {
      state.audio.muted = !state.audio.muted;
      renderOpts(); return;
    }
    if (e.key === '2') {
      setFullscreen(!state.settings.fullscreen);
      renderOpts(); return;
    }
    if (e.key === '3') {
      if (state.devUnlocked) {
        window.removeEventListener('keydown', optsKeyHandler);
        showContinueMenu();
      } else {
        devPwMode = true; devPwBuf = ''; devPwErr = false;
        renderOpts();
      }
      return;
    }
    if (e.key === '4' || e.key === 'Escape') {
      window.removeEventListener('keydown', optsKeyHandler);
      showContinueMenu();
    }
  }

  renderOpts();
  window.addEventListener('keydown', optsKeyHandler);
}

function showChangelog() {
  state.gameState = 'changelog';
  const BOX_W = 60, IW_CL = 58, BOX_H = 30;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((DISPLAY_HEIGHT - BOX_H) / 2));
  const BC = '#66ccff';
  let scrollOffset = 0;
  const VISIBLE_ROWS = 18;
  const maxLineW = IW_CL - 6; // 4-char indent + 2-char margin

  // Build flat row array — each element is one display line
  const contentRows = [];
  for (const entry of CHANGELOG) {
    contentRows.push({ type: 'version', text: 'alpha ' + entry.version });
    const words = entry.summary.split(' ');
    let line = '';
    for (const word of words) {
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxLineW) {
        line += ' ' + word;
      } else {
        contentRows.push({ type: 'summary', text: '    ' + line });
        line = word;
      }
    }
    if (line) contentRows.push({ type: 'summary', text: '    ' + line });
    contentRows.push({ type: 'blank' });
  }

  function drawChangelog() {
    // Clear entire box area first (prevents bleed-through from title/cube)
    for (let y = BOX_Y; y < BOX_Y + BOX_H; y++)
      for (let x = BOX_X; x < BOX_X + BOX_W; x++)
        display.draw(x, y, ' ', BRIGHT_WHITE, BG);
    // Frame
    display.draw(BOX_X, BOX_Y, '╔', BC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', BC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '╚', BC, BG); display.draw(BOX_X+BOX_W-1, botY, '╝', BC, BG);
    for (let x = 1; x < BOX_W-1; x++) { display.draw(BOX_X+x, BOX_Y, '═', BC, BG); display.draw(BOX_X+x, botY, '═', BC, BG); }
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '║', BC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '║', BC, BG);
    }
    // Row 1: title + hint
    const titleStr = 'CHANGELOG', hintStr = 'press esc to close';
    for (let i = 0; i < titleStr.length; i++) display.draw(BOX_X+1+i, BOX_Y+1, titleStr[i], '#ffffff', BG);
    for (let i = 0; i < hintStr.length; i++) display.draw(BOX_X+BOX_W-2-hintStr.length+i, BOX_Y+1, hintStr[i], '#333333', BG);
    // Row 2: ═ separator
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+2, '═', '#444444', BG);
    // Rows 4-5: warning block
    const warn1 = 'WARNING: Changes are pushed consistently and saves';
    const warn2 = 'do not carry over. Refresh the page at your own risk.';
    for (let i = 0; i < warn1.length; i++) display.draw(BOX_X+2+i, BOX_Y+4, warn1[i], '#ff5555', BG);
    for (let i = 0; i < warn2.length; i++) display.draw(BOX_X+2+i, BOX_Y+5, warn2[i], '#ff5555', BG);
    // Row 8: ═ separator
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+8, '═', '#444444', BG);
    // Rows 9 to 9+VISIBLE_ROWS-1: scrollable content rows
    for (let r = 0; r < VISIBLE_ROWS; r++) {
      const row = contentRows[scrollOffset + r];
      if (!row) continue;
      const ay = BOX_Y + 9 + r;
      if (row.type === 'version') {
        for (let i = 0; i < row.text.length; i++) display.draw(BOX_X+2+i, ay, row.text[i], '#66ccff', BG);
      } else if (row.type === 'summary') {
        for (let i = 0; i < row.text.length; i++) display.draw(BOX_X+2+i, ay, row.text[i], '#aaaaaa', BG);
      }
    }
    // Footer separator + hint
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+BOX_H-3, '═', '#444444', BG);
    const footer = '[ ↑↓ scroll  |  ESC close ]';
    const fx = BOX_X + 1 + Math.floor((IW_CL - footer.length) / 2);
    for (let i = 0; i < footer.length; i++) display.draw(fx+i, BOX_Y+BOX_H-2, footer[i], '#555555', BG);
  }

  drawChangelog();

  function clKeyHandler(e) {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', clKeyHandler);
      showContinueMenu();
      return;
    }
    const maxScroll = Math.max(0, contentRows.length - VISIBLE_ROWS);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollOffset = Math.max(0, scrollOffset - 1);
      drawChangelog();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      scrollOffset = Math.min(maxScroll, scrollOffset + 1);
      drawChangelog();
    }
  }
  window.addEventListener('keydown', clKeyHandler);
}

function showContinueMenu() {
  clearScreen(); drawTitleBorder(); drawArt(); drawTitleBottomText();
  state.gameState = 'title_menu';
  const BC = BRIGHT_CYAN;
  const INNER_W = 16;
  const BOX_W = INNER_W + 4;
  const BOX_H = 7;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = PROMPT_Y + 3;
  const CX = BOX_X + 2;
  display.draw(BOX_X, BOX_Y, '╔', BC, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', BC, BG);
  display.draw(BOX_X, BOX_Y + BOX_H - 1, '╚', BC, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y + BOX_H - 1, '╝', BC, BG);
  for (let x = 1; x < BOX_W - 1; x++) {
    display.draw(BOX_X + x, BOX_Y, '═', BC, BG);
    display.draw(BOX_X + x, BOX_Y + BOX_H - 1, '═', BC, BG);
  }
  for (let y = 1; y < BOX_H - 1; y++) {
    display.draw(BOX_X, BOX_Y + y, '║', BC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '║', BC, BG);
    for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + y, ' ', BRIGHT_WHITE, BG);
  }
  const saveExists = !!localStorage.getItem(SAVE_KEY);
  const o1 = saveExists && state.endingCompleted ? '1. Continue ★' : '1. Continue';
  const o2 = '2. New Game';
  const o3 = '3. Options';
  const c1fg = saveExists ? '#f0f0f0' : '#333333';
  for (let i = 0; i < o1.length; i++) display.draw(CX + i, BOX_Y + 2, o1[i], c1fg, BG);
  for (let i = 0; i < o2.length; i++) display.draw(CX + i, BOX_Y + 3, o2[i], '#f0f0f0', BG);
  for (let i = 0; i < o3.length; i++) display.draw(CX + i, BOX_Y + 4, o3[i], '#f0f0f0', BG);
  if (saveExists && state.endingCompleted) {
    const starIdx = o1.indexOf('★');
    if (starIdx >= 0) display.draw(CX + starIdx, BOX_Y + 2, '★', '#ffd633', BG);
  }
  function cmKeyHandler(e) {
    if (e.key === '1') {
      if (!saveExists) return;
      playSound('newgame');
      window.removeEventListener('keydown', cmKeyHandler);
      state.gameState = 'playing';
      clearScreen();
      drawWorld();
    } else if (e.key === '2') {
      playSound('newgame');
      window.removeEventListener('keydown', cmKeyHandler);
      if (!saveExists) {
        resetState();
        localStorage.removeItem(SAVE_KEY);
        state.gameState = 'transitioning';
        startPhaseIn();
      } else {
        showNewGameConfirm();
      }
    } else if (e.key === '3') {
      window.removeEventListener('keydown', cmKeyHandler);
      showTitleOptions();
    } else if (e.key === 'c') {
      window.removeEventListener('keydown', cmKeyHandler);
      showChangelog();
    }
  }
  window.addEventListener('keydown', cmKeyHandler);
}

function onAnyKey() {
  playSound('start');
  clearInterval(blinkInterval);
  window.removeEventListener('keydown', onAnyKey);
  // Apply fullscreen preference — browsers require a user gesture before requestFullscreen
  if (state.settings.fullscreen) setFullscreen(true);
  showContinueMenu();
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
      } else if (d[1]===1 && state.cottage.playerY===9 && state.cottage.playerX===8) {
        // Only exit through the door at x=8
        exitCottage();
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      if (bookshelfOverlayActive) { bookshelfOverlayActive = false; drawCottageInterior(); return; }
      if (cottageLookActive) { cottageLookActive = false; drawCottageInterior(); return; }
      // Space exits only from door tile at (8, 9)
      if (state.cottage.playerX === 8 && state.cottage.playerY === 9) { exitCottage(); return; }
      handleCottageInteract();
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
  playSound('click');
  const newLX = Math.max(0, Math.min(DISPLAY_WIDTH - 1, lookX + d[0]));
  const newLY = Math.max(0, Math.min(WORLD_ROWS - 1,    lookY + d[1]));
  if (state.weather.current === 'fog' || state.weather.current === 'storm') {
    const dist = Math.sqrt((newLX - state.player.x) ** 2 + (newLY - state.player.y) ** 2);
    if (dist > 5) return;
  }
  restoreLookTile();
  lookX = newLX;
  lookY = newLY;
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
  display.draw(BOX_X, BOX_Y, '╔', WC, BG);
  display.draw(BOX_X + BOX_W - 1, BOX_Y, '╔', WC, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y, '═', WC, BG);
  const botY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, botY, '╚', WC, BG);
  display.draw(BOX_X + BOX_W - 1, botY, '╚', WC, BG);
  for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, botY, '═', WC, BG);
  for (let y = 1; y < BOX_H - 1; y++) {
    display.draw(BOX_X, BOX_Y + y, '║', WC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '║', WC, BG);
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
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
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
  const BOX_H = 24; // +1 row for Gold bulk RM option, +1 for recycle
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
    const rm       = state.player.inventory.rm;
    const rmCap    = state.player.inventoryCaps.rm;
    const rmSpace  = rmCap - rm;
    const storageRM = state.stations.storage?.unlocked ? state.storage.rm : 0;
    const maxBuy   = Math.min(rmSpace, storageRM + Math.floor(state.player.gold / COST));
    const canBuy1  = (state.player.gold >= COST || storageRM > 0) && rmSpace > 0;

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

    const cardTier = state.bank.card.tier;
    const isBronzePlus = cardTierAtLeast('bronze');
    const isGoldPlus   = cardTierAtLeast('gold');
    const discountedCost = isBronzePlus ? Math.max(1, Math.floor(COST * 0.95)) : COST;
    const discStr = isBronzePlus ? `${formatCredits(discountedCost)}g (-5%)` : `${formatCredits(COST)}g`;
    drp(BOX_Y + 11, `Cost per unit:  ${discStr}`, isBronzePlus ? '#cc7733' : '#f0f0f0');
    if (state.stations.storage?.unlocked) {
      const srm = state.storage.rm, scap = state.storage.rmCap;
      const usedFirst = srm > 0 ? ' — used first' : '';
      drp(BOX_Y + 12, `Storage RM: ${srm}/${scap}${usedFirst}`, srm > 0 ? '#ff6600' : '#555555');
    } else {
      drp(BOX_Y + 12, 'No storage unlocked.', '#444444');
    }

    // Row 13: ─ action separator
    { const ay = BOX_Y + 13; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Action rows 14-19
    const c1 = storageRM > 0 ? 'free (storage)' : `-${formatCredits(discountedCost)}g`;
    const fromStMax = Math.min(maxBuy, storageRM);
    const fromCrMax = maxBuy - fromStMax;
    const cm = maxBuy > 0 ? (fromCrMax > 0 ? `-${formatCredits(fromCrMax * discountedCost)}g` : 'free') : '';
    const cardAvail = cardTier ? Math.max(0, state.bank.card.limit - state.bank.card.balance) : 0;
    const canBuyCard = (!!cardTier && cardAvail >= discountedCost && rmSpace > 0) || (storageRM > 0 && rmSpace > 0);
    const fromSt50 = Math.min(50, storageRM);
    const bulkCostDisplay = (50 - fromSt50) * Math.floor(COST * 0.85);
    const canBulk50  = isGoldPlus && rmSpace >= 50 && (fromSt50 === 50 || cardAvail >= bulkCostDisplay || state.player.gold >= bulkCostDisplay);
    const c5hint = storageRM > 0 ? 'free (storage)' : (cardTier && cardAvail >= discountedCost ? `-${discountedCost}g (card)` : '');
    arow(BOX_Y + 14, `1. Get 1 RM`, c1, canBuy1 ? '#66cc66' : '#ff5555');
    arow(BOX_Y + 15, `2. Get max (${maxBuy})`, cm, canBuy1 && maxBuy > 0 ? '#66cc66' : '#ff5555');
    arow(BOX_Y + 16, '3. Custom amount', '', canBuy1 ? '#66cc66' : '#ff5555');
    arow(BOX_Y + 17, '4. Cancel', '', '#555555');
    arow(BOX_Y + 18, `5. Get 1 RM`, c5hint, canBuyCard ? getCardTierColor(cardTier) : '#444444');
    arow(BOX_Y + 19, `6. Bulk buy 50 RM (-15%)`, isGoldPlus ? `-${Math.floor(50*COST*0.85)}g` : '[Gold+ only]', canBulk50 ? CARD_TIERS.gold.color : '#444444');
    const canRecycle = state.stations.storage?.unlocked && state.storage.widgets >= 10 && rmSpace > 0;
    const recycleColor = canRecycle ? '#66cc66' : '#444444';
    arow(BOX_Y + 20, `7. Recycle 10 widgets → 1 RM`, canRecycle ? '+1 RM' : '[need 10 WG in storage]', recycleColor);

    // Row 21: ═ bottom rule
    { const ay = BOX_Y + 21; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 22: status / card hint
    let statusText, statusFg;
    if (rmSpace <= 0)                              { statusText = 'Inventory full.'; statusFg = '#ff5555'; }
    else if (!canBuy1)                             { statusText = 'Insufficient gold.'; statusFg = '#ff5555'; }
    else if (storageRM > 0)                        { statusText = `${storageRM} RM in storage — used first.`; statusFg = '#ff6600'; }
    else if (state.bank?.card?.tier)               { statusText = 'Hold SHIFT to pay on credit card.'; statusFg = '#555555'; }
    else                                           { statusText = 'Press a key to purchase.'; statusFg = '#555555'; }
    { const ay = BOX_Y + 22; border(ay);
      const centered = menuPad(statusText.length < IW ? ' '.repeat(Math.floor((IW-statusText.length)/2)) + statusText : statusText, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, centered[i] || ' ', statusFg, BG); }

    // Row 23: ╚═…═╝
    display.draw(BOX_X, BOX_Y + 23, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 23, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 23, '═', TC, BG);
  }

  function closeRM() {
    rmMenuRedrawFn = null;
    window.removeEventListener('keydown', rmKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
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
    const maxBuy  = Math.min(rmSpace, Math.floor(state.player.gold / COST));
    const canBuy1 = state.player.gold >= COST && rmSpace > 0;

    const isBronzePlus2  = cardTierAtLeast('bronze');
    const isGoldPlus2    = cardTierAtLeast('gold');
    const effectiveCost  = isBronzePlus2 ? Math.max(1, Math.floor(COST * 0.95)) : COST;
    const storageRM2     = state.stations.storage?.unlocked ? state.storage.rm : 0;
    const maxGet2        = Math.min(rmSpace, storageRM2 + Math.floor(state.player.gold / effectiveCost));
    const canGet1        = (state.player.gold >= effectiveCost || storageRM2 > 0) && rmSpace > 0;

    const useCard = e.shiftKey && !!state.bank?.card?.tier;
    if (e.key === '1' && (canGet1 || (useCard && rmSpace > 0))) {
      if (storageRM2 > 0) {
        state.storage.rm--;
        state.player.inventory.rm++;
        addLog('Took 1 RM from storage.', '#ff6600');
      } else {
        if (!payForItem(effectiveCost, useCard)) { redraw(); return; }
        state.player.inventory.rm++;
        if (!useCard && isBronzePlus2 && effectiveCost < COST) addLog(`> Card discount applied: -${COST - effectiveCost}g.`, '#cc7733');
        if (!useCard) addLog('You buy 1 raw material.', '#ff9933');
        { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(state.player.x, state.player.y, rmD.x+1, rmD.y+2, effectiveCost); }
      }
      playSound('bought'); drawStatusBar(); redraw();
      return;
    }
    if (e.key === '2' && maxGet2 > 0 && (canGet1 || useCard)) {
      const fromSt = Math.min(maxGet2, storageRM2);
      const fromCr = maxGet2 - fromSt;
      state.storage.rm -= fromSt;
      if (fromCr > 0) {
        if (!payForItem(fromCr * effectiveCost, useCard)) { state.storage.rm += fromSt; redraw(); return; }
        if (!useCard) addLog(`Bought ${fromCr} RM for ${formatCredits(fromCr * effectiveCost)}g.`, '#ff9933');
      }
      if (fromSt > 0) addLog(`Took ${fromSt} RM from storage.`, '#ff6600');
      state.player.inventory.rm += maxGet2;
      playSound('bought'); drawStatusBar(); redraw();
      return;
    }
    if (e.key === '3' && (canGet1 || useCard)) {
      const maxCard = useCard ? Math.min(rmSpace, storageRM2 + Math.floor(Math.max(0,(state.bank.card.limit||0)-(state.bank.card.balance||0)) / effectiveCost)) : maxGet2;
      window.removeEventListener('keydown', rmKeyHandler);
      showNumericPrompt(`Get RM (max ${maxCard})`, maxCard,
        (n) => {
          const fromSt3 = Math.min(n, storageRM2);
          const fromCr3 = n - fromSt3;
          state.storage.rm -= fromSt3;
          if (fromCr3 > 0) {
            if (!payForItem(fromCr3 * effectiveCost, useCard)) { state.storage.rm += fromSt3; openRMShedMenu(); return; }
            if (!useCard) addLog(`Bought ${fromCr3} RM for ${formatCredits(fromCr3 * effectiveCost)}g.`, '#ff9933');
          }
          if (fromSt3 > 0) addLog(`Took ${fromSt3} RM from storage.`, '#ff6600');
          state.player.inventory.rm += n;
          playSound('bought'); drawStatusBar();
          openRMShedMenu();
        },
        () => openRMShedMenu()
      );
    }
    if (e.key === '5') {
      if (storageRM2 > 0 && rmSpace > 0) {
        state.storage.rm--;
        state.player.inventory.rm++;
        addLog('Took 1 RM from storage.', '#ff6600');
        playSound('bought'); drawStatusBar(); redraw();
        return;
      }
      const card = state.bank.card;
      if (!card?.tier) return;
      const avail = Math.max(0, card.limit - card.balance);
      if (avail < effectiveCost || rmSpace <= 0) return;
      card.balance = Math.round((card.balance + effectiveCost) * 10) / 10;
      state.player.inventory.rm++;
      addLog(`You buy 1 RM on ${card.tier} card.`, getCardTierColor(card.tier)); playSound('bought'); drawStatusBar();
      { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(state.player.x, state.player.y, rmD.x+1, rmD.y+2, effectiveCost); }
      redraw();
    }
    if (e.key === '6' && isGoldPlus2) {
      if (rmSpace < 50) { addLog('Not enough inventory space for 50 RM.', '#ff5555'); return; }
      const fromSt6     = Math.min(50, storageRM2);
      const fromBuy6    = 50 - fromSt6;
      const bulkCost6   = fromBuy6 * Math.floor(COST * 0.85);
      if (fromSt6 === 50 || state.player.gold >= bulkCost6) {
        state.storage.rm -= fromSt6;
        state.player.gold -= bulkCost6;
        state.player.inventory.rm += 50;
        if (fromSt6 > 0) addLog(`Took ${fromSt6} RM from storage.`, '#ff6600');
        if (fromBuy6 > 0) addLog(`Bulk purchase: ${fromBuy6} RM for ${bulkCost6}g (-15%).`, CARD_TIERS.gold.color);
        playSound('bought');
      } else {
        const card3 = state.bank.card;
        const avail3 = Math.max(0, card3.limit - card3.balance);
        if (avail3 >= bulkCost6) {
          state.storage.rm -= fromSt6;
          card3.balance = Math.round((card3.balance + bulkCost6) * 10) / 10;
          state.player.inventory.rm += 50;
          if (fromSt6 > 0) addLog(`Took ${fromSt6} RM from storage.`, '#ff6600');
          if (fromBuy6 > 0) addLog(`Bulk purchase: ${fromBuy6} RM for ${bulkCost6}g on card (-15%).`, CARD_TIERS.gold.color);
          playSound('bought');
        } else { addLog('Insufficient gold or card limit for bulk purchase.', '#ff5555'); return; }
      }
      drawStatusBar(); redraw();
    }
    if (e.key === '7') {
      if (!state.stations.storage?.unlocked) { addLog('Need storage to recycle.', '#555555'); return; }
      if (state.storage.widgets < 10) { addLog(`Need 10 widgets in storage. Have ${state.storage.widgets}.`, '#ff5555'); return; }
      if (rmSpace <= 0) { addLog('Inventory full. Drop some RM first.', '#ff5555'); return; }
      state.storage.widgets -= 10;
      state.player.inventory.rm += 1;
      addLog('Recycled 10 widgets into 1 RM brick.', '#66cc66');
      playSound('crafted');
      drawStatusBar();
      redraw();
      return;
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
  const weatherCraftPenalty = state.weather.current === 'heatwave' ? 1 : 0;
  activeCraftTicks = ticks + weatherCraftPenalty;
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

  function drawHammerRow(r, ay) {
    const frame = state.workbenchHammerFrame;
    const rowIdx = r - 2;
    if (rowIdx < 0 || rowIdx > 4 || frame < 0 || frame > 9) return;
    const s = HAMMER_FRAMES[frame][rowIdx];
    const base = HAMMER_COLORS[frame][rowIdx];
    for (let i = 0; i < AW; i++) {
      const ch = s[i] || ' ';
      let fg;
      if (base === null) {
        if (ch === '*') fg = '#ffd633';
        else if (ch === '.') fg = '#ff9933';
        else if (ch === '\\' || ch === '/') fg = '#ff9933';
        else if (ch === '=' || ch === '-') fg = '#886633';
        else fg = '#aaaaaa';
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
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
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

// Instantly applies all state flags and tile colors for every phase up to `phase`.
// Safe to call multiple times (idempotent for already-unlocked stations).
// Used by devJumpToPhase and as a safety net in the tick loop.
function applyPhaseUnlocks(phase) {
  if (phase >= 2) {
    state.officeUnlocked = true;
    if (!state.stations.storage.unlocked) {
      state.stations.storage.unlocked = true;
      colorInStation('ST', '#66ccff', '#aaddff', '#4488aa');
    }
    if (!state.stations.general_store.unlocked) {
      state.stations.general_store.unlocked = true;
      colorInStation('GS', '#aa66ff', '#cc99ff', '#884499');
    }
  }
  if (phase >= 3) {
    if (!state.stations.bank) state.stations.bank = { unlocked: false };
    if (!state.stations.bank.unlocked) {
      state.stations.bank.unlocked = true;
      colorInStation('BK', '#66cc66', '#aaffaa', '#449944');
    }
    if (!state.stations.newspaper.unlocked) {
      state.stations.newspaper.unlocked = true;
      colorInStation('NP', COLOR_NP_FRAME, COLOR_NP_LABEL, '#2a6a3a');
    }
    // Terminal unlocks at Phase 3 (was Phase 4)
    state.terminalUnlocked = true;
    if (!state.stations.terminal) state.stations.terminal = { unlocked: false };
    if (!state.stations.terminal.unlocked) {
      state.stations.terminal.unlocked = true;
      colorInStation('TR', '#cc66cc', '#dd99dd', '#884488');
    }
  }
  if (phase >= 4) {
    // Phase 4: terminal already unlocked; futures/options unlocked via skill purchases
  }
  if (phase >= 5) {
    if (!state.stations.launch_facility.unlocked) {
      state.stations.launch_facility.unlocked = true;
      colorInStation('LF', COLOR_LF_FRAME, COLOR_LF_LABEL, '#cc3333');
      state.rocketWidgets = state.rocketWidgets ?? 0;
      state.courierDestination = state.courierDestination ?? 'market';
    }
  }
  if (state.mine.discovered) placeMineEntrance();
}

function colorInStation(label, wc, lc, dc) {
  const s = STATION_DEFS.find(sd => sd.label === label);
  if (!s) return;
  const doorColor = dc || wc;
  s.wc = wc; s.lc = lc; s.dc = dc;
  const tiles = [
    [s.x,   s.y,   '╔', wc,        false], [s.x+1, s.y,   '═', wc,        false],
    [s.x+2, s.y,   '═', wc,        false], [s.x+3, s.y,   '╗', wc,        false],
    [s.x,   s.y+1, '║', wc,        false], [s.x+1, s.y+1, s.label[0], lc, false],
    [s.x+2, s.y+1, s.label[1], lc, false], [s.x+3, s.y+1, '║', wc,        false],
    [s.x,   s.y+2, '╚', wc,        false], [s.x+1, s.y+2, '-', doorColor,  true],
    [s.x+2, s.y+2, '═', wc,        false], [s.x+3, s.y+2, '╝', wc,        false],
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

// Stamp the Loading Port footprint next to the Market. Called from buildTileMap when unlocked.
function stampLoadingPort() {
  if (!state.loadingPort?.unlocked) return;
  const mtDef = STATION_DEFS.find(s => s.label === 'MT');
  if (!mtDef) return;
  const x = mtDef.x + 4, y = mtDef.y + 1;
  const wc = '#558855', lc = '#88cc88', dc = '#336633';
  const mk = (g, fg, walk, desc) => ({ glyph: g, fg, bg: BG, walkable: walk, description: desc });
  const desc = 'The Loading Port. Couriers deposit widgets here; they auto-sell at market open.';
  tileMap[x  ][y  ] = mk('╔', wc, false, desc);
  tileMap[x+1][y  ] = mk('═', wc, false, desc);
  tileMap[x+2][y  ] = mk('═', wc, false, desc);
  tileMap[x+3][y  ] = mk('╗', wc, false, desc);
  tileMap[x  ][y+1] = mk('║', wc, false, desc);
  tileMap[x+1][y+1] = mk('L', lc, false, desc);
  tileMap[x+2][y+1] = mk('P', lc, false, desc);
  tileMap[x+3][y+1] = mk('║', wc, false, desc);
  tileMap[x  ][y+2] = mk('╚', wc, false, desc);
  tileMap[x+1][y+2] = mk('-', dc, true,  'Loading Port entrance. Couriers deliver here.');
  tileMap[x+2][y+2] = mk('═', wc, false, desc);
  tileMap[x+3][y+2] = mk('╝', wc, false, desc);
}

// Stamp or re-stamp the Casino footprint. Called from buildTileMap and on unlock/visibility trigger.
function stampCasino(locked) {
  const cs = state.stations.casino;
  const wc  = locked ? '#555555' : '#2244aa';
  const lc  = locked ? '#555555' : '#5577cc';
  const dc  = locked ? '#555555' : '#112266';
  const l0  = locked ? '?' : 'C', l1 = locked ? '?' : 'S';
  const wallDesc = locked
    ? 'A run-down building. Cracked windows. Something inside is waiting.'
    : 'The Casino. Velvet inside. Velvet smell outside.';
  const doorDesc = locked
    ? 'A boarded door. The lock has three coloured slots — red, yellow, blue.'
    : 'The casino door. Open after dark. The Black card opens it any time.';
  const labelDesc = locked
    ? "Whatever this was, it isn't anymore. Or maybe it never was."
    : 'The Casino. Open after dark.';
  const mk = (g, fg, walk, desc) => ({ glyph: g, fg, bg: BG, walkable: walk, description: desc });
  const x = cs.x, y = cs.y;
  tileMap[x  ][y  ] = mk('╔', wc, false, wallDesc);
  tileMap[x+1][y  ] = mk('═', wc, false, wallDesc);
  tileMap[x+2][y  ] = mk('═', wc, false, wallDesc);
  tileMap[x+3][y  ] = mk('╗', wc, false, wallDesc);
  tileMap[x  ][y+1] = mk('║', wc, false, wallDesc);
  tileMap[x+1][y+1] = mk(l0,  lc, false, labelDesc);
  tileMap[x+2][y+1] = mk(l1,  lc, false, labelDesc);
  tileMap[x+3][y+1] = mk('║', wc, false, wallDesc);
  tileMap[x  ][y+2] = mk('╚', wc, false, wallDesc);
  tileMap[x+1][y+2] = mk('-', dc, true,  doorDesc);
  tileMap[x+2][y+2] = mk('═', wc, false, wallDesc);
  tileMap[x+3][y+2] = mk('╝', wc, false, wallDesc);
  for (let dx = 0; dx <= 3; dx++) for (let dy = 0; dy <= 2; dy++) markDirty(x + dx, y + dy);
}

function checkPhase2Trigger() {
  if (state.lifetimeGoldEarned >= 100 && state.phase === 1) {
    state.phase = 2;
    phaseGoalLastValue = -1;
    state.officeUnlocked = true;
    logHistory('Hired first worker.');
    state.stations.storage.unlocked       = true;
    state.stations.general_store.unlocked = true;
    queuePopup('NEW STATIONS UNLOCKED', ['Office, Storage, and', 'General Store are now open.'], '#66ccff');
    addLog('Something stirs. The Office door swings open.', '#cc66cc');
    setTimeout(() => addLog('You can afford to hire help.', '#cc66cc'), 2000);
    setTimeout(() => {
      addLog('The Storage Warehouse is now available.', '#cc66cc');
      colorInStation('ST', '#66ccff', '#aaddff', '#4488aa');
    }, 4000);
    setTimeout(() => {
      addLog('A light is on in the shop at the south-west corner. Someone is open for business.', '#aa66ff');
      colorInStation('GS', '#aa66ff', '#cc99ff', '#884499');
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
  if (state.weather.current === 'rain')     state.demand = Math.max(5, Math.round(state.demand * 0.90));
  if (state.weather.current === 'storm')    state.demand = Math.max(5, Math.round(state.demand * 0.80));
  if (state.weather.current === 'heatwave') state.demand = Math.round(state.demand * 1.20);
  // Cooking buff: demand
  if (state.cooking?.activeBuff?.buff === 'demand') state.demand = Math.round(state.demand * state.cooking.activeBuff.value);
  state.marketPrice = Math.round(8 * Math.pow(state.demand / 50, 0.5) * 10) / 10;
  // Cooking buff: price
  if (state.cooking?.activeBuff?.buff === 'price') state.marketPrice = Math.round(state.marketPrice * state.cooking.activeBuff.value * 10) / 10;
  if (state.demand < 20 && !state.demandCrashOccurred) logHistory('The market collapsed.');
  if (state.demand < 20) state.demandCrashOccurred = true;
  state.demandHistory.push({ day: state.day, demand: state.demand, price: state.marketPrice });
  if (state.demandHistory.length > 30) state.demandHistory.shift();
}

function checkBankruptcyStipend() {
  if (state.player.gold <= -20) {
    state.player.gold = -20; // clamp to floor
    addLog('You feel absolutely screwed.', '#ff5555');
    setTimeout(() => {
      state.player.gold = Math.round((state.player.gold + 30) * 10) / 10;
      addLog('The bank extends an emergency stipend. +30g.', '#66cc66');
      drawStatusBar();
    }, 1500);
    drawStatusBar();
    return true;
  }
  return false;
}

function checkPhase3Trigger() {
  if (state.phase === 2 && (state.lifetimeGoldEarned >= 1000 || (state.couriersOwned >= 1 && state.day >= 2))) {
    state.phase = 3;
    phaseGoalLastValue = -1;
    state.stations.bank = { unlocked: true };
    state.stations.newspaper.unlocked = true;
    state.terminalUnlocked = true;
    state.stations.terminal = state.stations.terminal ?? { unlocked: true };
    state.stations.terminal.unlocked = true;
    colorInStation('TR', '#cc66cc', '#dd99dd', '#884488');
    logHistory('The market began fluctuating.');
    calculateDailyDemand();
    queuePopup('NEW STATIONS UNLOCKED', ['Bank, Newspaper, Terminal', 'are now open.', 'Terminal: Forwards available now.'], '#66ccff');
    addLog('The bank lights come on for the first time.', '#66cc66');
    setTimeout(() => addLog('New possibilities are available.', '#66cc66'), 2000);
    setTimeout(() => colorInStation('BK', '#66cc66', '#aaffaa', '#449944'), 4000);
    setTimeout(() => {
      addLog('> The Newspaper office has a light on. Someone is printing something.', COLOR_NP_FRAME);
      colorInStation('NP', COLOR_NP_FRAME, COLOR_NP_LABEL, '#2a6a3a');
    }, 5000);
  }
}

function checkPhase4Trigger() {
  if (state.phase === 3 && state.lifetimeGoldEarned >= 2000) {
    state.phase = 4;
    phaseGoalLastValue = -1;
    logHistory('A man in a clean suit appeared.');
    queuePopup('TERMINAL EXPANDED', ['Futures and Options', 'now available at the Terminal.'], '#cc66cc');
    addLog('A man in a clean suit appears at the market.', '#cc66cc');
    setTimeout(() => addLog('The terminal upgrades: futures and options are now unlockable.', '#cc66cc'), 2000);
  }
}

function checkPhase5Trigger() {
  if (state.phase === 4 && state.lifetimeGoldEarned >= 10000) {
    state.phase = 5;
    phaseGoalLastValue = -1;
    logHistory('The launch facility opened.');
    queuePopup('LAUNCH FACILITY OPEN', ['Load 5,000 widgets', 'into the rocket to launch.'], '#ff5555');
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
    const card = state.bank.card;
    const immuneActive = card.tier === 'black' && card.demandImmunityUsedThisWeek && state._demandImmunityActiveToday;
    const remaining = state.demand - state.widgetsSoldToday;
    if (remaining <= 0 && !immuneActive) {
      // Silver+ can sell up to 10 extra widgets at 70% price
      const isSilverPlus = cardTierAtLeast('silver');
      if (isSilverPlus && !card.silverMarketExtraUsedToday) {
        const extraSold = state.widgetsSoldToday - state.demand;
        const extraLeft = 10 - extraSold;
        if (extraLeft > 0 && state.player.inventory.widgets > 0) {
          const extraN = Math.min(n, extraLeft, state.player.inventory.widgets);
          if (extraN > 0) {
            const discPrice = Math.round(state.marketPrice * 0.70 * 10) / 10;
            const earned = Math.round(extraN * discPrice * 10) / 10;
            state.player.gold += earned;
            state.player.inventory.widgets -= extraN;
            state.lifetimeGoldEarned   += earned;
            state.widgetsSoldToday        += extraN;
            state.stats.revenueToday       = Math.round((state.stats.revenueToday + earned) * 10) / 10;
            addLog(`Silver perk: sold ${extraN} extra widget${extraN!==1?'s':''} at 70% for ${formatCredits(earned)}g.`, '#aaaaaa');
            if (extraSold + extraN >= 10) card.silverMarketExtraUsedToday = true;
            drawStatusBar();
          }
          return;
        }
      }
      if (!state.demandMetLogged) {
        addLog("The market has taken all it will take today.", '#ff9933');
        state.demandMetLogged = true;
      }
      return;
    }
    if (!immuneActive) n = Math.min(n, remaining);
  }
  const isFirstSale = state.lifetimeGoldEarned === 0;
  const price  = state.marketPrice;
  const earned = n * price;
  state.player.gold           += earned;
  state.player.inventory.widgets -= n;
  state.lifetimeGoldEarned    += earned;
  state.stats.revenueToday        = Math.round((state.stats.revenueToday + earned) * 10) / 10;
  if (state.phase >= 3) state.widgetsSoldToday += n;
  addLog(`Sold ${n} widget${n !== 1 ? 's' : ''} for ${formatCredits(earned)}g.`, BRIGHT_CYAN);
  if (isFirstSale) { addLog('Congrats on your first sale.', '#cc66cc'); logHistory('Sold the first widget.'); }
  playSound('sold');
  drawStatusBar();
  { const mtD = STATION_DEFS.find(s => s.label === 'MT'); if (mtD) effectsManager.creditRain(mtD.x + 1, mtD.y + 2, n, isFirstSale, earned); }
  checkPhase2Trigger();
  drawPhaseGoal();
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

  display.draw(BOX_X, BOX_Y, '╔', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '═', WC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '╚', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '╝', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '═', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '║', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '║', WC, BG);
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
    const info = `D:${String(demand).padStart(3)}  P:${String(price).padStart(5)}g  ${dl.text}`;
    for (let j = 0; j < info.length; j++) display.draw(cx+j, row, info[j], dl.fg, BG);
  }

  const esc = '[ ESC to close ]';
  const eX = CONT_X + Math.floor((CONT_W - esc.length) / 2);
  for (let i = 0; i < esc.length; i++) display.draw(eX+i, BOX_Y+BOX_H-2, esc[i], WC, BG);

  function close() {
    window.removeEventListener('keydown', chartKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
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

const SELLER_PORTRAITS = [
  ['  .---.  ', ' ( o o ) ', '  ( > )  ', '  /| |\\  ', '   d b   '],
  ['  .---.  ', ' ( -_- ) ', '  ( = )  ', '  /| |\\  ', '   d b   '],
  ['  _/\\_   ', ' ( * * ) ', '  ( o )  ', '  /| |\\  ', '   d b   '],
  ['  [===]  ', ' ( o_o ) ', '  ( - )  ', '  /| |\\  ', '   d b   '],
  ['  .---.  ', ' ( >_< ) ', '  (   )  ', '  /| |\\  ', '   d b   '],
  ['  ~~~~~  ', ' ( o o ) ', '  ( ^ )  ', '  /| |\\  ', '   d b   '],
  ['  .===.  ', ' ( $ $ ) ', '  ( = )  ', '  /| |\\  ', '   d b   '],
  ['  .---.  ', ' ( ; ; ) ', '  ( ~ )  ', '  /| |\\  ', '   d b   '],
  ['  .vvv.  ', ' ( o O ) ', '  ( < )  ', '  /| |\\  ', '   d b   '],
  ['  .....  ', ' ( ? ? ) ', '  ( _ )  ', '  /| |\\  ', '   d b   '],
];

const SELLER_ADJ = ['Rusty','Thin','Old','Crooked','Dusty','Slick','Tall','Quiet','Lucky','Bitter','Slow','Sharp','Pale','Half','Wiry'];
const SELLER_NOUN = ['Pete','Margaret','Bones','Sullivan','Sawdust','Wheels','Copper','Finch','Tobacco','Gravel','Needles','Pudding','Decker','Spool','Morrow'];

function generateBuyOffers() {
  const basePrice = state.marketPrice;
  const usedAdj = new Set(), usedNoun = new Set(), usedPortrait = new Set();
  state.marketBuyOffers = [0, 1].map(() => {
    let adj, noun;
    do { adj  = Math.floor(Math.random() * SELLER_ADJ.length); }  while (usedAdj.has(adj));
    do { noun = Math.floor(Math.random() * SELLER_NOUN.length); } while (usedNoun.has(noun));
    usedAdj.add(adj); usedNoun.add(noun);
    let portIdx;
    do { portIdx = Math.floor(Math.random() * SELLER_PORTRAITS.length); } while (usedPortrait.has(portIdx));
    usedPortrait.add(portIdx);
    const name = SELLER_ADJ[adj] + ' ' + SELLER_NOUN[noun];
    const size = (Math.floor(Math.random() * 16) + 5) * 10;
    const markup = 1.10 + Math.random() * 0.15;
    const askPrice = Math.round(basePrice * markup * 10) / 10;
    return { portIdx, name, size, askPrice, rejected: false, accepted: false };
  });
}

function openMarketMenu(initialTab = 'sell') {
  state.gameState = 'mt_menu';

  const TC    = '#ffd633';
  const DC    = '#333333';
  const BOX_W = 60;
  const IW    = 58;
  const AW    = 14;
  const IPW   = 43;
  const BOX_H = 34;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;
  let marketTab = initialTab;

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

    // Row 1: header — shows active tab label
    { const ay = BOX_Y + 1;
      border(ay);
      const tabLbl = marketTab === 'sell' ? '[SELL]' : '[BUY]';
      const title = `Widget Market ${tabLbl}`.trim(), hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? '#f0f0f0' : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    // Row 2: ═ separator
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 3: tab bar (always visible)
    { const ay = BOX_Y + 3; border(ay);
      const HALF = Math.floor(IW / 2);
      const center = (s, w) => { const p = Math.max(0, w - s.length); const l = Math.floor(p/2); return ' '.repeat(l) + s + ' '.repeat(p-l); };
      const sellLbl = center(marketTab === 'sell' ? '>> [ SELL ] <<' : '[ SELL ]', HALF);
      const buyLbl  = center(marketTab === 'buy'  ? '>> [ BUY ] <<'  : '[ BUY ]',  IW - HALF);
      for (let i = 0; i < IW; i++) {
        const inLeft = i < HALF;
        const ch = (inLeft ? sellLbl : buyLbl)[inLeft ? i : i - HALF] || ' ';
        display.draw(BOX_X + 1 + i, ay, ch, (inLeft && marketTab === 'sell') || (!inLeft && marketTab === 'buy') ? '#ffffff' : '#555555', BG);
      }
    }
    // Row 4: ─ separator
    { const ay = BOX_Y + 4; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    const artBase = BOX_Y + 5; // art pane start row

    if (marketTab === 'sell') {
      // ── SELL tab ──────────────────────────────────────────────────────────────
      // Art + info pane (10 rows)
      for (let r = 0; r < 10; r++) crow(artBase + r, r);
      drp(artBase + 1, 'WIDGET MARKET', TC);
      if (mtMenuBlinkOn) drp(artBase + 2, state.marketOpen ? 'OPEN' : 'CLOSED', state.marketOpen ? '#66cc66' : '#ff5555');
      drp(artBase + 3, 'Widgets in hand:', '#555555');
      renderLargeNumber(display, RPX, artBase + 4, String(widgets), '#f0f0f0', IPW);
      drp(artBase + 8, state.loadingPort?.unlocked
        ? `LP: ${state.loadingPort.widgets}/${state.loadingPort.capacity} wgt  (auto-sells dawn)`
        : '', state.loadingPort?.unlocked ? '#88cc88' : BRIGHT_WHITE);
      drp(artBase + 9, `Price today:  ${formatCredits(price)}g`, TC);

      const sep1 = artBase + 10;
      { border(sep1); for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, sep1, '─', DC, BG); }

      // Demand rows
      if (state.phase >= 3) {
        irow(sep1 + 1, `Demand today:  ${state.demand} widgets`, dl ? dl.fg : '#f0f0f0');
        irow(sep1 + 2, `Sold today:   ${state.widgetsSoldToday} / ${state.demand}`, '#555555');
      }

      const sep2 = sep1 + 3;
      { border(sep2); for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, sep2, '─', DC, BG); }

      // Action rows
      const a0 = sep2 + 1;
      if (!state.marketOpen) {
        irow(a0,     'The market is shuttered.', '#555555');
        irow(a0 + 1, 'Opens at dawn.', '#555555');
        irow(a0 + 2, `Dawn in:  ${secsLeft}s`, '#cc66cc');
        arow(a0 + 3, '1. Cancel', '', '#555555');
      } else if (cantSell) {
        const isBlack = state.bank.card.tier === 'black';
        const immuneAvail = isBlack && !state.bank.card.demandImmunityUsedThisWeek;
        irow(a0,     demandMet ? 'Daily demand satisfied. No more sales.' : 'Nothing to sell.', '#555555');
        irow(a0 + 1, '', BRIGHT_WHITE);
        if (isBlack && !state._demandImmunityActiveToday) {
          arow(a0 + 2, '2. Use Black Card: unlimited sales today', '-500g', immuneAvail ? '#f0f0f0' : '#333333');
        } else if (state._demandImmunityActiveToday) {
          irow(a0 + 2, '  Demand immunity active — sell freely.', CARD_TIERS.black.labelColor);
        } else { irow(a0 + 2, '', BRIGHT_WHITE); }
        arow(a0 + 3, '1. Cancel', '', '#555555');
      } else {
        arow(a0,     '1. Sell 1',            `+${formatCredits(price)}g`,         '#66cc66');
        arow(a0 + 1, `2. Sell max  (${avail})`, `+${formatCredits(avail * price)}g`, '#66cc66');
        arow(a0 + 2, '3. Sell custom amount', '',                                   '#66cc66');
        arow(a0 + 3, '4. Cancel',            '',                                   '#555555');
      }

      // Status footer
      const statusRow = a0 + 5;
      { border(statusRow - 1); for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, statusRow - 1, '═', DC, BG); }
      let statusText, statusFg;
      if (!state.marketOpen) { statusText = 'Come back at dawn.'; statusFg = '#555555'; }
      else if (demandMet)    { statusText = 'Daily demand satisfied. No more sales today.'; statusFg = TC; }
      else                   { statusText = 'Sell widgets here during market hours.'; statusFg = '#555555'; }
      { border(statusRow);
        const centered = menuPad(statusText.length < IW ? ' '.repeat(Math.floor((IW - statusText.length) / 2)) + statusText : statusText, IW);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, statusRow, centered[i] || ' ', statusFg, BG); }

      // Market upgrades section — below status row
      { const ay = statusRow + 1; border(ay);
        for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, '─', DC, BG); }
      { const ay = statusRow + 2; border(ay);
        const tag = '[ MARKET UPGRADES ]';
        const d = IW - tag.length - 2, ld = Math.floor(d/2), rd = d - ld;
        const hdr = ('─'.repeat(ld) + ' ' + tag + ' ' + '─'.repeat(rd)).slice(0, IW);
        for (let i = 0; i < IW; i++) {
          const inTag = i >= ld+1 && i < ld+1+tag.length;
          display.draw(BOX_X+1+i, ay, hdr[i]||'─', inTag ? TC : '#333333', BG);
        }
      }
      function mtUpgradeRow(row, nk, key) {
        const node = OFFICE_NODES.find(n => n.key === nk);
        const ay = statusRow + row; border(ay);
        const owned = (state.skills[nk] || 0) >= 1;
        const locked = state.phase < (node?.minPhase || 3);
        const canAfford = !owned && !locked && state.player.gold >= node?.cost;
        const cost  = owned ? '✓' : (locked ? '[locked]' : `${node?.cost}g`);
        const nFg   = owned ? '#888888' : (locked ? '#333333' : '#aaaaaa');
        const cFg   = owned ? '#66cc66' : (locked ? '#333333' : (canAfford ? '#66cc66' : '#ff5555'));
        const label = `[${key}] ${node?.name || nk}`;
        const gap   = Math.max(1, IW - label.length - cost.length - 1);
        const rp = menuPad(label + ' '.repeat(gap) + cost, IW);
        for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, rp[i]||' ', i < label.length ? nFg : cFg, BG);
      }
      mtUpgradeRow(3, 'reducedCarry', 'u');
      mtUpgradeRow(4, 'discountDump', 'v');
      if (state.bank?.card?.tier) {
        const ay = statusRow + 7; border(ay);
        const ht = menuPad('Hold SHIFT to pay upgrades on credit card.', IW);
        for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, ht[i]||' ', '#555555', BG);
      }
      // Loading Port upgrades
      { const lp = state.loadingPort;
        const lpOwned = lp?.unlocked;
        const expOwned = lp?.capacity >= 200;
        function mtLPRow(row, label, key, owned, cost, req) {
          const ay = statusRow + row; border(ay);
          const nFg = owned ? '#888888' : (req ? '#333333' : '#aaaaaa');
          const cFg = owned ? '#66cc66' : (req ? '#333333' : (state.player.gold >= cost ? '#66cc66' : '#ff5555'));
          const stat = owned ? '✓' : (req ? '[need LP first]' : `${cost}g`);
          const lbl = `[${key}] ${label}`;
          const gap = Math.max(1, IW - lbl.length - stat.length - 1);
          const rp = menuPad(lbl + ' '.repeat(gap) + stat, IW);
          for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, rp[i]||' ', i < lbl.length ? nFg : cFg, BG);
        }
        mtLPRow(5, 'Loading Port',       'w', lpOwned,  500, false);
        mtLPRow(6, 'Expand Port (x2)',   'x', expOwned, 800, !lpOwned);
      }

    } else {
      // ── BUY tab ───────────────────────────────────────────────────────────────
      const offers = state.marketBuyOffers;
      if (!offers || offers.length === 0) {
        irow(artBase + 5, 'No offers available today.', '#555555');
      } else {
        const OFFER_ROWS = [artBase, artBase + 10]; // start row for each offer panel
        const OFFER_KEYS = ['1', '2'];
        for (let oi = 0; oi < 2; oi++) {
          const offer = offers[oi];
          if (!offer) continue;
          const base = OFFER_ROWS[oi];

          // Offer header
          { border(base);
            const tag = ` OFFER ${oi + 1} `;
            const dashes = IW - tag.length - 2;
            const lD = Math.floor(dashes / 2), rD = dashes - lD;
            const full = ('═'.repeat(lD) + ' ' + tag + ' ' + '═'.repeat(rD)).slice(0, IW);
            for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, base, full[i] || '═', '#555555', BG);
          }
          // Blank row
          border(base + 1);

          const portrait = offer.rejected ? null : SELLER_PORTRAITS[offer.portIdx] || SELLER_PORTRAITS[0];
          const grayed   = offer.rejected;
          const portFgs  = ['#555555', '#ffd633', '#ffd633', '#aaaaaa', '#aaaaaa'];

          for (let pr = 0; pr < 5; pr++) {
            const ay = base + 2 + pr;
            border(ay);
            // Portrait (9 chars at BOX_X+3)
            const pRow = (portrait && !grayed) ? portrait[pr] : '         ';
            for (let ci = 0; ci < 9; ci++) display.draw(BOX_X + 3 + ci, ay, pRow[ci] || ' ', grayed ? '#222222' : portFgs[pr], BG);
          }

          // Info text (starting BOX_X+14)
          const IX = BOX_X + 14;
          if (offer.rejected) {
            // Show retraction message
            const retractLine = `"${offer.name}" has retracted their offer.`;
            const rp = menuPad(retractLine, IW - 13);
            for (let i = 0; i < rp.length; i++) display.draw(IX + i, base + 3, rp[i] || ' ', '#ff5555', BG);
          } else if (offer.accepted) {
            const lns = [
              [`Seller:  "${offer.name}"`,                    TC],
              [`Lot:     ${offer.size} widgets`,              '#f0f0f0'],
              [`Ask:     ${offer.askPrice}g / widget`,       '#f0f0f0'],
              [`Total:   ${formatCredits(offer.size * offer.askPrice)}g`, '#f0f0f0'],
            ];
            for (let li = 0; li < lns.length; li++) {
              const rp = menuPad(lns[li][0], IW - 13);
              for (let ci = 0; ci < rp.length; ci++) display.draw(IX + ci, base + 2 + li, rp[ci] || ' ', lns[li][1], BG);
            }
          } else {
            const total = Math.round(offer.askPrice * offer.size * 10) / 10;
            const lns = [
              [`Seller:  "${offer.name}"`,                TC,        '#555555'],
              [`Lot:     ${offer.size} widgets`,          '#f0f0f0', '#555555'],
              [`Ask:     ${offer.askPrice}g / widget`,   '#f0f0f0', '#555555'],
              [`Total:   ${formatCredits(total)}g`,      '#ff5555', '#555555'],
            ];
            for (let li = 0; li < lns.length; li++) {
              const [val, vfg, lfg] = lns[li];
              const colonIdx = val.indexOf(':');
              const rp = menuPad(val, IW - 13);
              for (let ci = 0; ci < rp.length; ci++) {
                const fg = ci <= colonIdx ? lfg : vfg;
                display.draw(IX + ci, base + 2 + li, rp[ci] || ' ', fg, BG);
              }
            }
          }

          // Blank row after portrait
          border(base + 7);

          // Bid / status line
          const bidAy = base + 8;
          border(bidAy);
          if (offer.rejected) {
            const rp = menuPad('  OFFER WITHDRAWN', IW);
            for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, bidAy, rp[i] || ' ', '#555555', BG);
          } else if (offer.accepted) {
            const rp = menuPad('  ACCEPTED — widgets delivered to storage.', IW);
            for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, bidAy, rp[i] || ' ', '#66cc66', BG);
          } else {
            const noStorage = state.storage.widgets + offer.size > state.storage.widgetCap;
            const bidKey = OFFER_KEYS[oi];
            const bidStr = noStorage
              ? `  ${bidKey}) Place a bid on this lot   [not enough storage]`
              : `  ${bidKey}) Place a bid on this lot`;
            const bidFg = noStorage ? '#ff5555' : '#66cc66';
            const rp = menuPad(bidStr, IW);
            for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, bidAy, rp[i] || ' ', bidFg, BG);
          }
          // Blank spacer after offer
          border(base + 9);
        }
      }
    }

    // Row BOX_H-1: ╚═╝
    display.draw(BOX_X, BOX_Y + BOX_H - 1, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + BOX_H - 1, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + BOX_H - 1, '═', TC, BG);
  }

  function closeMT() {
    mtMenuRedrawFn = null;
    window.removeEventListener('keydown', mtKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  function processBid(offerIdx, bidPrice) {
    const offer = state.marketBuyOffers[offerIdx];
    if (!offer || offer.accepted || offer.rejected) return;
    if (state.storage.widgets + offer.size > state.storage.widgetCap) {
      addLog('> Your warehouse can\'t hold that many.', '#ff5555'); return;
    }
    const ratio = bidPrice / offer.askPrice;
    let chance;
    if (ratio >= 1.0)      chance = 1.0;
    else if (ratio >= 0.9) chance = 0.75;
    else if (ratio >= 0.8) chance = 0.50;
    else if (ratio >= 0.7) chance = 0.25;
    else                   chance = 0;
    if (Math.random() < chance) {
      const totalCost = Math.round(bidPrice * offer.size * 10) / 10;
      if (state.player.gold < totalCost) {
        addLog(`> You can't afford ${formatCredits(totalCost)}g.`, '#ff5555'); return;
      }
      state.player.gold = Math.round((state.player.gold - totalCost) * 10) / 10;
      state.storage.widgets += offer.size;
      offer.accepted = true;
      addLog(`> ${offer.name} accepts. ${offer.size} widgets delivered to storage.`, '#66cc66');
      playSound('bought');
      drawStatusBar();
    } else {
      offer.rejected = true;
      addLog(`> ${offer.name} scoffs at your offer and walks away.`, '#ff5555');
    }
    redraw();
  }

  function mtKeyHandler(e) {
    if (e.key === 'Escape') { closeMT(); return; }

    // Tab switching
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      marketTab = marketTab === 'sell' ? 'buy' : 'sell';
      playSound('click'); redraw(); return;
    }

    // Market upgrades — available in any tab
    { const _uc = e.shiftKey && !!state.bank?.card?.tier;
      if (e.key === 'u') {
        const node = OFFICE_NODES.find(n => n.key === 'reducedCarry');
        if (!node || state.phase < node.minPhase) { addLog('Reduced Carry Cost not yet available.', '#555555'); return; }
        if ((state.skills.reducedCarry || 0) >= 1) { addLog('Already purchased.', '#555555'); return; }
        if (!payForItem(node.cost, _uc)) { redraw(); return; }
        state.skills.reducedCarry = 1;
        addLog('Reduced Carry Cost purchased. Storage cost halved.', TC); playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === 'v') {
        const node = OFFICE_NODES.find(n => n.key === 'discountDump');
        if (!node || state.phase < node.minPhase) { addLog('Market Discount Dump not yet available.', '#555555'); return; }
        if ((state.skills.discountDump || 0) >= 1) { addLog('Already purchased.', '#555555'); return; }
        if (!payForItem(node.cost, _uc)) { redraw(); return; }
        state.skills.discountDump = 1;
        addLog('Market Discount Dump purchased.', TC); playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === 'w') {
        if (state.loadingPort?.unlocked) { addLog('Loading Port already unlocked.', '#555555'); return; }
        if (!payForItem(500, _uc)) { redraw(); return; }
        state.loadingPort.unlocked = true;
        stampLoadingPort();
        addLog('Loading Port unlocked. Couriers now deposit here; auto-sells at dawn.', '#88cc88');
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === 'x') {
        if (!state.loadingPort?.unlocked) { addLog('Unlock Loading Port first.', '#555555'); return; }
        if ((state.loadingPort?.capacity || 100) >= 200) { addLog('Loading Port already at max capacity.', '#555555'); return; }
        if (!payForItem(800, _uc)) { redraw(); return; }
        state.loadingPort.capacity = 200;
        addLog('Loading Port expanded to 200 widget capacity.', '#88cc88');
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
    }

    if (marketTab === 'sell') {
      // ── SELL tab ───────────────────────────────────────────────────────────
      if (e.key === '4') {
        const avail = state.phase >= 3
          ? Math.max(0, Math.min(state.player.inventory.widgets, state.demand - state.widgetsSoldToday))
          : state.player.inventory.widgets;
        if (state.marketOpen && avail > 0) { closeMT(); return; }
      }
      if (!state.marketOpen) { if (e.key === '1') closeMT(); return; }

      const widgets = state.player.inventory.widgets;
      const price   = state.phase >= 3 ? state.marketPrice : 8.0;
      const demandMet = state.phase >= 3 && state.widgetsSoldToday >= state.demand;
      const avail   = state.phase >= 3
        ? Math.max(0, Math.min(widgets, state.demand - state.widgetsSoldToday))
        : widgets;
      const cantSell = avail === 0 || demandMet;

      if (cantSell) {
        if (e.key === '1') { closeMT(); return; }
        if (e.key === '2' && state.bank.card.tier === 'black' && !state.bank.card.demandImmunityUsedThisWeek && !state._demandImmunityActiveToday) {
          const immuneCost = 500;
          const avail2 = Math.max(0, state.bank.card.limit - state.bank.card.balance);
          if (avail2 >= immuneCost) {
            state.bank.card.balance = Math.round((state.bank.card.balance + immuneCost) * 10) / 10;
            state.bank.card.demandImmunityUsedThisWeek = true;
            state._demandImmunityActiveToday = true;
            addLog('> Black card: demand immunity activated. Sell freely today.', CARD_TIERS.black.labelColor);
            drawStatusBar(); redraw();
          } else { addLog('Insufficient card credit for demand immunity.', '#ff5555'); }
        }
        return;
      }

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

    } else if (marketTab === 'buy') {
      // ── BUY tab ────────────────────────────────────────────────────────────
      if (e.key === '1' || e.key === '2') {
        const offerIdx = e.key === '1' ? 0 : 1;
        const offer = state.marketBuyOffers[offerIdx];
        if (!offer || offer.accepted || offer.rejected) return;
        if (state.storage.widgets + offer.size > state.storage.widgetCap) {
          addLog('> Your warehouse can\'t hold that many.', '#ff5555');
          return;
        }
        window.removeEventListener('keydown', mtKeyHandler);
        showNumericPrompt(
          `Bid per widget (ask: ${offer.askPrice}g)`,
          Math.ceil(offer.askPrice * 2),
          (bidPrice) => { processBid(offerIdx, bidPrice); openMarketMenu('buy'); },
          () => openMarketMenu('buy'),
          { decimal: true }
        );
        return;
      }
    }
  }

  mtMenuRedrawFn = redraw;
  mtMenuBlinkOn  = true;
  redraw();
  window.addEventListener('keydown', mtKeyHandler);
}

// ── Office skill tree (§5.3) ──────────────────────────────────────────────────

// Carry cap and speed lookup tables indexed by skill level (§5.3)
const WORKER_CARRY_CAPS  = [3, 5, 8, 12, 16, 20];        // workerCarryLevel 0–5
const WORKER_SPEEDS      = [1.2, 1.5, 1.8, 2.1, 2.5, 3.0];  // workerSpeedLevel 0–5
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
  { key: 'workerSpeed', name: 'Train Apprentice Speed',        levelKey: 'workerSpeedLevel', costs: [30, 60, 100, 160, 250], max: 5, minPhase: 2 },
  // Storage (unchanged)
  { key: 'storageExp1',  name: 'Storage Expansion I',  cost: 200, max: 1, minPhase: 3 },
  { key: 'storageExp2',  name: 'Storage Expansion II', cost: 300, max: 1, minPhase: 3, requires: 'storageExp1', requiresLabel: 'Expansion I' },
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
  { key: 'plantStory',    name: 'Plant a Story',    cost:  750, max: 1, minPhase: 3 },
  { key: 'smearCampaign', name: 'Run a Smear',      cost: 2000, max: 1, minPhase: 3, requires: 'plantStory', requiresLabel: 'Plant a Story first' },
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
  if (!state.officeTab) state.officeTab = 'workers';

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

  // Upgrades moved to their home station menus; SECTIONS now empty.
  const SECTIONS = [];

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
      return { fg: DC, status: '[locked]' };

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
      if (state.player.gold < node.cost)
        return { fg: '#ff5555', status: `[${Math.ceil(node.cost - state.player.gold)}g more]` };
      return { fg: '#66cc66', status: '[available]' };
    }

    // Scaling repeatable nodes (workerCarry, workerSpeed, courierCarry, courierSpeed)
    if (node.levelKey) {
      const level = state.skills[node.levelKey] || 0;
      if (level >= node.max) return { fg: '#888888', status: '[max]' };
      const cost = node.costs[level];
      if (state.player.gold < cost)
        return { fg: '#ff5555', status: `[${Math.ceil(cost - state.player.gold)}g more]` };
      return { fg: '#66cc66', status: '[available]' };
    }

    // Standard flat-cost nodes
    const level = state.skills[nk] || 0;
    if (node.requires && !state.skills[node.requires])
      return { fg: DC, status: `[needs ${node.requiresLabel}]` };
    if (level >= (node.max || 1))
      return { fg: '#888888', status: node.max === 1 ? '[owned]' : '[max]' };
    if (state.player.gold < node.cost)
      return { fg: '#ff5555', status: `[${Math.ceil(node.cost - state.player.gold)}g more]` };
    return { fg: '#66cc66', status: '[available]' };
  }

  // ── Tab 1 "WORKERS" dual-panel render (§5.3) ─────────────────────────────────
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
      const ok = state.player.gold >= node.cost;
      return { n: lbl, nfg: ok ? '#66cc66' : '#ff5555', c: `    Cost: ${node.cost}g`, cfg: '#555555' };
    }
    function appCarryInfo() {
      const node = OFFICE_NODES.find(nd => nd.key === 'workerCarry');
      const lv = state.skills.workerCarryLevel || 0;
      if (state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '          ', cfg: '#222222' };
      if (lv >= node.max) return { n: '[^] Appr. Inventory', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const cost = node.costs[lv];
      const ok = state.player.gold >= cost;
      return { n: '[^] Appr. Inventory', nfg: ok ? '#66cc66' : '#ff5555', c: `    Cost: ${cost}g (${lv}/${node.max})`, cfg: '#555555' };
    }
    function appSpeedInfo() {
      const node = OFFICE_NODES.find(nd => nd.key === 'workerSpeed');
      const lv = state.skills.workerSpeedLevel || 0;
      if (state.phase < node.minPhase) return { n: '[ locked ]', nfg: '#222222', c: '          ', cfg: '#222222' };
      if (lv >= node.max) return { n: '[>] Train Speed', nfg: '#555555', c: '[MAX]', cfg: '#555555' };
      const cost = node.costs[lv];
      const ok = state.player.gold >= cost;
      return { n: '[>] Train Speed', nfg: ok ? '#66cc66' : '#ff5555', c: `    Cost: ${cost}g (${lv}/${node.max})`, cfg: '#555555' };
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
      const tabLabel = state.officeTab === 'workers'  ? '[WORKERS]'
                     : state.officeTab === 'upgrades' ? '[INFO]'
                     : '[WORKER LIST]';
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
      // Three-tab bar: WORKERS(17) │ UPGRADES(17) │ INFORMATION(16) = 17+1+17+1+16 = 52
      const TLBLS = ['[ WORKERS ]', '[ INFO ]', '[ WORKER LIST ]'];
      const TABS  = ['workers', 'upgrades', 'info'];
      const SEGS  = [17, 17, 16];
      const DIV1  = 17, DIV2 = 35;
      const center = (str, w) => { const pad = Math.max(0, w - str.length); const l = Math.floor(pad/2); return ' '.repeat(l) + str + ' '.repeat(pad-l); };
      const seg0 = center(TLBLS[0], SEGS[0]);
      const seg1 = center(TLBLS[1], SEGS[1]);
      const seg2 = center(TLBLS[2], SEGS[2]);
      for (let i = 0; i < IW; i++) {
        if (i === DIV1 || i === DIV2) { display.draw(BOX_X + 1 + i, ay, '│', DC, BG); continue; }
        let ch, active;
        if (i < DIV1)      { ch = seg0[i]          || ' '; active = state.officeTab === 'workers'; }
        else if (i < DIV2) { ch = seg1[i-DIV1-1]   || ' '; active = state.officeTab === 'upgrades'; }
        else               { ch = seg2[i-DIV2-1]   || ' '; active = state.officeTab === 'info'; }
        display.draw(BOX_X + 1 + i, ay, ch, active ? LC : '#555555', BG);
      }
    }

    // Row 4: ─ separator
    { const ay = BOX_Y + 4; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Rows 5-14: building art + info pane
    for (let r = 0; r < 10; r++) crow(BOX_Y + 5 + r, r);
    drp(BOX_Y + 6, 'THE OFFICE', LC);
    drp(BOX_Y + 7, 'Credits available:', '#555555');
    const crStr = String(Math.floor(state.player.gold));
    renderLargeNumber(display, RPX, BOX_Y + 8, crStr, '#ffd633', IPW);
    drp(BOX_Y + 13, `Phase:  ${state.phase}`, '#555555');
    drp(BOX_Y + 14, `Lifetime:  ${formatCredits(state.lifetimeGoldEarned)}g`, '#555555');

    // Row 15: ─ separator
    { const ay = BOX_Y + 15; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    if (state.officeTab === 'workers') {
      // Tab 1 — WORKERS: dual-panel apprentice/courier management
      renderOfficePage1(BOX_Y + 16);
      for (let i = 18; i < PAGE_ROWS; i++) {
        const ay = BOX_Y + 16 + i;
        border(ay);
        for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, ay, ' ', BRIGHT_WHITE, BG);
      }
      // Courier wages info row
      const cc = state.workers.couriers.length;
      if (cc > 0) {
        const wageRow = BOX_Y + 16 + 19;
        border(wageRow);
        const wageStr = `Daily courier wages: ${cc * 5}g  (5g × ${cc} courier${cc > 1 ? 's' : ''})`;
        const wp = menuPad(wageStr, IW);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, wageRow, wp[i] || ' ', '#555555', BG);
      }

    } else if (state.officeTab === 'upgrades') {
      // Tab 2 — INFO: read-only production stats
      for (let r = 0; r < PAGE_ROWS; r++) {
        const ay = BOX_Y + 16 + r; border(ay);
        for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, ay, ' ', BRIGHT_WHITE, BG);
      }
      const FG_LABEL = '#555555', FG_VAL = '#f0f0f0', FG_GOLD = '#ffd633';
      function infoRow(row, label, value, vfg) {
        const ay = BOX_Y + 16 + row; border(ay);
        const gap = Math.max(1, IW - label.length - value.length);
        const rp = menuPad(label + ' '.repeat(gap) + value, IW);
        for (let i = 0; i < IW; i++) {
          const fg = i < label.length ? FG_LABEL : vfg;
          display.draw(BOX_X + 1 + i, ay, rp[i] || ' ', fg, BG);
        }
      }
      { const ay = BOX_Y + 16; border(ay);
        const hdr = menuPad('PRODUCTION INFO', IW);
        for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, hdr[i]||' ', LC, BG); }
      { const ay = BOX_Y + 17; border(ay);
        for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, ay, '─', DC, BG); }
      infoRow(2, 'Widgets made today:',    String(state.stats.widgetsMadeToday),            FG_VAL);
      infoRow(3, 'Widgets made lifetime:', String(state.lifetimeWidgetsMade || 0),          FG_VAL);
      infoRow(4, 'Revenue today:',         `${formatCredits(state.stats.revenueToday)}g`,   FG_GOLD);
      infoRow(5, 'Revenue lifetime:',      `${formatCredits(state.lifetimeGoldEarned)}g`,  FG_GOLD);
      infoRow(6, 'Days played:',           String(state.day),                               FG_VAL);
      infoRow(7, 'Current phase:',         String(state.phase),                             FG_VAL);

    } else { // Tab 3 — INFO: live worker list
      const allW = [
        ...state.workers.apprentices.map((w, i) => ({ type: 'appr', idx: i, w })),
        ...state.workers.couriers.map((c, i)    => ({ type: 'cour', idx: i, w: c })),
      ];
      const nW = allW.length;
      const PER_PAGE = Math.floor(PAGE_ROWS / 4);
      workerSel        = Math.max(0, Math.min(workerSel, nW - 1));
      if (nW > 0 && workerSel < workerPageStart) workerPageStart = workerSel;
      if (nW > 0 && workerSel >= workerPageStart + PER_PAGE) workerPageStart = workerSel - PER_PAGE + 1;
      workerPageStart  = Math.max(0, Math.min(workerPageStart, Math.max(0, nW - PER_PAGE)));
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
        if (workerPageStart > 0) {
          irow(BOX_Y + 16 + contentRow, menuPad('  ▲ more above', IW), DC);
          contentRow++;
        }
        for (let wi = workerPageStart; wi < Math.min(workerPageStart + PER_PAGE, nW); wi++) {
          const { type, idx, w } = allW[wi];
          const isSel = wi === workerSel;
          const base  = BOX_Y + 16 + contentRow;
          const ruleFg = isSel ? '#666666' : DC;
          { border(base); const rule = menuPad('─'.repeat(IW), IW); for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, base, rule[i], ruleFg, BG); }
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
          let statsLine;
          if (type === 'appr') {
            const task = w.workerState === 'fetching' ? 'RM→WB' : w.workerState === 'crafting' ? 'making widget' : w.workerState === 'returning' ? 'WB→STG' : 'waiting';
            statsLine = `    Carry: ${w.carryRM}/${carryMax}   Speed: ${WORKER_SPEEDS[state.skills.workerSpeedLevel||0].toFixed(1)}   ${task}`;
          } else {
            const task = w.courierState === 'loading' ? 'at STG' : w.courierState === 'delivering' ? 'STG→MKT' : w.courierState === 'returning' ? 'MKT→STG' : 'waiting';
            statsLine = `    Carry: ${w.carryWidgets}/${courCarryMax}   Speed: ${COURIER_SPEEDS[state.skills.courierSpeedLevel||0].toFixed(1)}   ${task}`;
          }
          irow(base + 2, statsLine, '#555555');
          const creditMark = (type === 'appr' && w.buyOnCredit && state.bank?.card?.tier) ? '[$]' : '';
          if (creditMark) {
            const ay2 = base + 1; border(ay2);
            display.draw(BOX_X + 1 + IW - 4, ay2, creditMark[0], '#aaaaaa', BG);
            display.draw(BOX_X + 1 + IW - 3, ay2, creditMark[1], '#aaaaaa', BG);
            display.draw(BOX_X + 1 + IW - 2, ay2, creditMark[2], '#aaaaaa', BG);
          }
          const hintLine = isSel
            ? (type === 'appr'
                ? `    [1:pause/resume]  [2:rename]  [c:${w.buyOnCredit ? 'cash' : 'credit'}]  [↑↓:navigate]`
                : '    [2:rename]  [↑↓:navigate]')
            : '    ↑↓ to select';
          irow(base + 3, hintLine, DC);
          contentRow += 4;
        }
        if (workerPageStart + PER_PAGE < nW) {
          const lastRow = BOX_Y + 16 + Math.min(contentRow, PAGE_ROWS - 1);
          irow(lastRow, menuPad('  ▼ more below', IW), DC);
        }
      }
    }

    // Row 37: ─ separator (all tabs)
    { const ay = BOX_Y + 37; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Row 38: footer (tab-specific)
    { const ay = BOX_Y + 38; border(ay);
      let footerLine, footerFg = '#555555';
      if (state.officeTab === 'workers') {
        const cardHint = state.bank?.card?.tier ? '  SHIFT=card' : '';
        footerLine = menuPad(`[ ← → switch tabs ]   Keys: [number] buy  [space] pause  [n] rename${cardHint}`, IW);
      } else if (state.officeTab === 'upgrades') {
        footerLine = menuPad('[ ← → switch tabs ]  Production stats (read-only)', IW);
      } else {
        const anyWorkers = state.workers.apprentices.length + state.workers.couriers.length > 0;
        if (renameMode) {
          const displayBuf = renameBuf.slice(0, 14).padEnd(14, '_');
          footerLine = menuPad(`Rename: [${displayBuf}]  Enter/Esc`, IW);
          footerFg = '#ffd633';
        } else {
          footerLine = menuPad(anyWorkers ? '[ ← → switch tabs | ↑↓ select | 1 pause | 2 rename ]' : '[ ← → switch tabs ]', IW);
        }
      }
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, footerLine[i] || ' ', footerFg, BG);
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
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  function officeKeyHandler(e) {
    if (e.key === 'Escape') { closeOffice(); return; }

    // ← → cycle through the three tabs (wrapping)
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const tabs = ['workers', 'upgrades', 'info'];
      state.officeTab = tabs[(tabs.indexOf(state.officeTab) + 1) % 3];
      playSound('click'); redraw(); return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const tabs = ['workers', 'upgrades', 'info'];
      state.officeTab = tabs[(tabs.indexOf(state.officeTab) + 2) % 3];
      playSound('click'); redraw(); return;
    }

    // ── INFO tab: worker navigation, pause, rename ────────────────────────────
    if (state.officeTab === 'info') {
      const allW = [
        ...state.workers.apprentices.map((w, i) => ({ type: 'appr', idx: i, w })),
        ...state.workers.couriers.map((c, i)    => ({ type: 'cour', idx: i, w: c })),
      ];
      if (renameMode) {
        if (e.key === 'Enter') {
          if (renameTarget >= 0 && renameTarget < allW.length)
            allW[renameTarget].w.nickname = renameBuf.trim();
          renameMode = false; renameBuf = ''; renameTarget = -1; redraw();
        } else if (e.key === 'Escape') {
          renameMode = false; renameBuf = ''; renameTarget = -1; redraw();
        } else if (e.key === 'Backspace') {
          renameBuf = renameBuf.slice(0, -1); redraw();
        } else if (e.key.length === 1 && renameBuf.length < 14) {
          renameBuf += e.key; redraw();
        }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); workerSel = Math.min(workerSel + 1, Math.max(0, allW.length - 1)); redraw(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); workerSel = Math.max(0, workerSel - 1); redraw(); return; }
      if (e.key === '1' && allW[workerSel] && allW[workerSel].type === 'appr') {
        const { idx, w } = allW[workerSel];
        w.paused = !w.paused;
        addLog(`${workerLabel(w, idx, 'appr')} ${w.paused ? 'paused' : 'resumed'}.`, '#66ccff');
        redraw(); return;
      }
      if (e.key === 'c' && allW[workerSel] && allW[workerSel].type === 'appr') {
        if (!state.bank?.card?.tier) { addLog('Need a credit card first.', '#555555'); return; }
        const { idx, w } = allW[workerSel];
        w.buyOnCredit = !w.buyOnCredit;
        addLog(`${workerLabel(w, idx, 'appr')} now buys RM with ${w.buyOnCredit ? 'credit card' : 'gold'}.`, '#aaaaaa');
        redraw(); return;
      }
      if (e.key === '2' && allW[workerSel]) {
        renameMode = true; renameBuf = allW[workerSel].w.nickname || ''; renameTarget = workerSel;
        redraw(); return;
      }
      return;
    }

    // ── WORKERS tab: keys 1-6 for apprentice/courier upgrades ────────────────
    if (state.officeTab === 'workers') {
      const useCard = e.shiftKey && !!state.bank?.card?.tier;
      if (e.key === '1') {
        const count = state.skills.apprenticeCount;
        if (count >= 5) return;
        const node = OFFICE_NODES.find(n => n.countKey === 'apprenticeCount' && n.tier === count + 1);
        if (!node || !state.officeUnlocked || state.phase < node.minPhase) return;
        if (!payForItem(node.cost, useCard)) { redraw(); return; }
        state.skills.apprenticeCount = count + 1;
        const ofDef = STATION_DEFS.find(s => s.label === 'OF');
        state.workers.apprentices.push({ x: ofDef.x+1, y: ofDef.y+2, workerState: 'idle', carryRM: 0, carryWidgets: 0, target: {x:0,y:0}, craftTimer: 0, paused: false, nickname: '', buyOnCredit: false });
        addLog('Apprentice hired.', '#cc66cc');
        state.officeAnim.apprenticeFlash = 3;
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === '2') {
        const node = OFFICE_NODES.find(n => n.key === 'workerCarry');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.workerCarryLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (!payForItem(cost, useCard)) { redraw(); return; }
        state.skills.workerCarryLevel = lv + 1;
        addLog(`> Increase Apprentice Inventory level ${lv + 1}.`, '#cc66cc');
        state.officeAnim.apprenticeFlash = 3;
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === '3') {
        const node = OFFICE_NODES.find(n => n.key === 'workerSpeed');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.workerSpeedLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (!payForItem(cost, useCard)) { redraw(); return; }
        state.skills.workerSpeedLevel = lv + 1;
        addLog(`> Train Apprentice Speed level ${lv + 1}.`, '#cc66cc');
        state.officeAnim.apprenticeFlash = 3;
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === '4') {
        const count = state.skills.courierCount;
        if (count >= 4) return;
        const node = OFFICE_NODES.find(n => n.countKey === 'courierCount' && n.tier === count + 1);
        if (!node || !state.officeUnlocked || state.phase < node.minPhase) return;
        if (state.storage.widgets < node.widgetCost) { addLog(`Not enough widgets. Need ${node.widgetCost} WG.`, '#ff5555'); redraw(); return; }
        state.storage.widgets -= node.widgetCost;
        state.skills.courierCount = count + 1;
        const ofDef = STATION_DEFS.find(s => s.label === 'OF');
        state.workers.couriers.push({ x: ofDef.x+1, y: ofDef.y+2, courierState: 'idle', carryWidgets: 0, target: {x:0,y:0}, nickname: '', paused: false });
        state.couriersOwned++;
        addLog(`> ${node.widgetCost} widgets consumed. Courier built.`, '#cc66cc');
        state.officeAnim.courierFlash = 3;
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === '5') {
        const node = OFFICE_NODES.find(n => n.key === 'courierCarry');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.courierCarryLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (state.storage.widgets < cost) { addLog(`Not enough widgets. Need ${cost} WG.`, '#ff5555'); redraw(); return; }
        state.storage.widgets -= cost;
        state.skills.courierCarryLevel = lv + 1;
        addLog(`> ${cost} widgets consumed. Increase Courier Inventory purchased.`, '#cc66cc');
        state.officeAnim.courierFlash = 3;
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === '6') {
        const node = OFFICE_NODES.find(n => n.key === 'courierSpeed');
        if (!state.officeUnlocked || state.phase < node.minPhase) return;
        const lv = state.skills.courierSpeedLevel || 0;
        if (lv >= node.max) return;
        const cost = node.costs[lv];
        if (state.storage.widgets < cost) { addLog(`Not enough widgets. Need ${cost} WG.`, '#ff5555'); redraw(); return; }
        state.storage.widgets -= cost;
        state.skills.courierSpeedLevel = lv + 1;
        addLog(`> ${cost} widgets consumed. Overclock Courier Speed purchased.`, '#cc66cc');
        state.officeAnim.courierFlash = 3;
        playSound('bought'); drawStatusBar(); redraw(); return;
      }
      return;
    }

    // INFO tab: no purchasable items, just stats
  }
  window.addEventListener('keydown', officeKeyHandler);
}

// ── Stamps currency helpers (§13) ─────────────────────────────────────────────

let stampMsgRecent  = [];
let recentAmbient   = []; // 6-deep no-repeat buffer for ambient flavor lines

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
  const actual = state.bank.card.tier === 'black' ? amount * 2 : amount;
  const wasLow = state.player.stamps < 5;
  state.player.stamps += actual;
  if (announce) {
    addLog(pickStampMsg(), COLOR_STAMPS);
    if (wasLow) setTimeout(() => addLog('Spend stamps at the General Store for cosmetics and upgrades.', COLOR_STAMPS), 1500);
  }
  if (state.gameState === 'inventory' && inventoryRedrawFn) inventoryRedrawFn();
}

function getPonderHint() {
  const inv = state.player.inventory;
  const px = state.player.x, py = state.player.y;

  function near(label, dist) {
    const s = STATION_DEFS.find(sd => sd.label === label);
    if (!s) return false;
    return Math.abs(px - (s.x + 2)) + Math.abs(py - (s.y + 1)) <= dist;
  }
  function nearPond(dist) {
    return Math.abs(px - 22) + Math.abs(py - 25) <= dist;
  }

  const checks = [
    // Category 1: Position-based (within 5 Manhattan distance of station)
    { cond: () => near('RM', 5) && inv.rm === 0 && state.player.gold >= 3,
      text: '> You\'re near the shed. Buy materials and start crafting.', color: '#ff9933' },
    { cond: () => near('RM', 5) && inv.rm >= state.player.inventoryCaps.rm,
      text: '> Your pockets are full. Head to the workbench.', color: '#ff9933' },
    { cond: () => near('WB', 5) && inv.rm > 0 && inv.widgets < state.player.inventoryCaps.widgets,
      text: '> The workbench is right here. Press space to craft.', color: '#cc3300' },
    { cond: () => near('WB', 5) && inv.rm === 0,
      text: '> You need raw materials first. Visit the shed.', color: '#cc3300' },
    { cond: () => near('MT', 5) && inv.widgets > 0 && state.marketOpen,
      text: '> The market is open. Sell what you\'ve made.', color: '#ffd633' },
    { cond: () => near('MT', 5) && inv.widgets > 0 && !state.marketOpen,
      text: '> Market\'s closed. Wait for the bell.', color: '#ffd633' },
    { cond: () => near('MT', 5) && inv.widgets === 0,
      text: '> Nothing to sell. Craft some widgets first.', color: '#ffd633' },
    { cond: () => near('OF', 5) && state.phase >= 2,
      text: '> Check the office for upgrades. Arrows swap tabs.', color: '#ffffff' },
    { cond: () => near('BK', 5) && state.phase >= 3 && state.bank.deposit > 0,
      text: '> Your deposit is earning 10% daily. Let it grow.', color: '#66cc66' },
    { cond: () => near('BK', 5) && state.phase >= 3 && !state.bank.card.tier,
      text: '> You might qualify for a credit card.', color: '#66cc66' },
    { cond: () => near('TR', 5) && state.phase >= 4,
      text: '> Try a forward contract to start. No cost to enter.', color: '#cc66cc' },
    { cond: () => near('LF', 5) && state.phase >= 5,
      text: '> The rocket needs widgets. Toggle couriers inside.', color: '#ff5555' },
    { cond: () => near('GS', 5) && state.phase >= 2,
      text: '> The shop sells cosmetics for stamps.', color: '#aa66ff' },
    { cond: () => near('NP', 5) && state.phase >= 3,
      text: '> Read today\'s headline. Or write tomorrow\'s.', color: COLOR_NP_FRAME },
    { cond: () => nearPond(5) && !state.skills.aquatics?.purchased,
      text: '> The pond is deep. The aquatics skill would help.', color: '#1a6a8a' },
    { cond: () => nearPond(5) && state.skills.aquatics?.purchased && state.lakeEasterEgg?.discovered,
      text: '> Fish here. Stand in the center, press space.', color: '#1a6a8a' },
    // Category 2: Urgency
    { cond: () => !!state.bank.card?.tier && (state.bank.card.missedPayments ?? 0) > 0,
      text: '> Card payment overdue. Visit the bank now.', color: '#ff5555' },
    { cond: () => !!state.bank.card?.tier && state.bank.card.balance > state.bank.card.limit * 0.8,
      text: '> Card nearly maxed. Consider paying it down.', color: '#ff9933' },
    { cond: () => state.phase >= 2 && state.storage.widgets >= state.storage.widgetCap,
      text: '> Storage full. Production halted. Sell or expand.', color: '#ff5555' },
    { cond: () => state.player.gold < 0,
      text: '> You\'re in the red. Sell widgets or visit the bank.', color: '#ff5555' },
    { cond: () => !state.marketOpen && inv.widgets > 0,
      text: '> Market\'s closed. Craft, deposit, or wait for dawn.', color: '#555555' },
    { cond: () => state.phase >= 3 && state.demand < 20,
      text: '> Demand collapsed. Hold production or short it.', color: '#ff9933' },
    { cond: () => !!state.bank.card?.tier && getBankRatingIdx() <= 2,
      text: '> Credit rating at risk. Your card could be revoked.', color: '#ff5555' },
    { cond: () => state.phase >= 5 && state.courierDestination === 'market' && state.rocketWidgets < 5000,
      text: '> Couriers selling at market. Toggle to the rocket?', color: '#ff5555' },
    { cond: () => state.stations.casino?.unlocked && !state.marketOpen,
      text: '> The casino is open.', color: '#aa3333' },
    { cond: () => state.stations.casino?.unlocked && state.bank.card?.tier === 'black',
      text: '> The casino is open. Always, for you.', color: '#2244aa' },
    // Category 3: Phase guidance
    { cond: () => state.phase === 1 && state.lifetimeGoldEarned < 20,
      text: '> Buy materials. Craft widgets. Sell at the market.', color: '#66ccff' },
    { cond: () => state.phase === 1 && state.lifetimeGoldEarned >= 20 && state.lifetimeGoldEarned < 60,
      text: '> Keep the loop going. Credits add up.', color: '#66ccff' },
    { cond: () => state.phase === 1 && state.lifetimeGoldEarned >= 60 && state.lifetimeGoldEarned < 100,
      text: '> Almost there. The office looks less dusty.', color: '#66ccff' },
    { cond: () => state.phase === 2 && state.skills.apprenticeCount === 0,
      text: '> You can hire workers now. Visit the office.', color: '#66ccff' },
    { cond: () => state.phase === 2 && state.skills.apprenticeCount > 0 && state.skills.courierCount === 0,
      text: '> Workers make, but can\'t sell. Build a courier.', color: '#66ccff' },
    { cond: () => state.phase === 2 && state.skills.apprenticeCount > 0 && state.skills.courierCount > 0,
      text: '> Automation running. Watch, tune, save for Phase 3.', color: '#66ccff' },
    { cond: () => state.phase === 3 && !state.bank.card?.tier && getBankRatingIdx() >= 3,
      text: '> The bank is open. Consider a credit card.', color: '#66ccff' },
    { cond: () => state.phase === 3 && !state.skills.plantStory,
      text: '> The newspaper publishes forecasts. The office sells influence.', color: '#66ccff' },
    { cond: () => state.phase === 3 && state.demand > 60,
      text: '> Demand is high. Sell everything you can.', color: '#66ccff' },
    { cond: () => state.phase >= 3 && state.terminal.positions.filter(p=>p.type==='forward').length === 0,
      text: '> The terminal is open. Try a forward contract.', color: '#66ccff' },
    { cond: () => state.phase >= 3 && state.terminal.totalPnL > 0,
      text: '> Trades profitable. Consider scaling up.', color: '#66ccff' },
    { cond: () => state.phase >= 3 && state.terminal.totalPnL < 0,
      text: '> Positions underwater. Cut losses or wait.', color: '#66ccff' },
    { cond: () => state.phase === 5 && state.rocketWidgets === 0,
      text: '> Toggle couriers to start loading the rocket.', color: '#66ccff' },
    { cond: () => state.phase === 5 && state.rocketWidgets > 0 && state.rocketWidgets < 25000,
      text: '> Keep loading. Not even halfway.', color: '#66ccff' },
    { cond: () => state.phase === 5 && state.rocketWidgets >= 25000 && state.rocketWidgets < 45000,
      text: '> Over halfway. The market barely matters.', color: '#66ccff' },
    { cond: () => state.phase === 5 && state.rocketWidgets >= 45000,
      text: '> Almost. Everything you built was for this.', color: '#66ccff' },
    // Rock and casino discovery hints
    { cond: () => !state.stations.casino?.unlocked && Object.values(state.shinyRocks).every(r => !r.collected),
      text: '> Three coloured stones, hidden by day. They blink, briefly. Three times each, somewhere out there.', color: '#888888' },
    { cond: () => { const n = Object.values(state.shinyRocks).filter(r => r.collected).length; return n >= 1 && n <= 2 && !state.stations.casino?.unlocked; },
      text: '> Find the rest. Each appears three times a day, briefly.', color: '#888888' },
    { cond: () => Object.values(state.shinyRocks).every(r => r.collected) && !state.stations.casino?.unlocked,
      text: '> The stones are warm. The casino has a lock with three slots.', color: '#aa3333' },
  ];

  for (const c of checks) {
    if (c.cond()) return { text: c.text, color: c.color };
  }
  return { text: '> Keep working. Something will happen.', color: '#555555' };
}

function handlePonder() {
  const result = getPonderHint();
  wrapLog(result.text, result.color);
}

// ── Interior state (§4.2) ────────────────────────────────────────────────────
let interiorTileMap  = [];     // [x][y] = {walkable, glyph, fg, description, furniture}
let fireplaceFrame   = 0;      // 0 or 1
let candlePhase      = false;  // toggles glow dot
let cottageLookActive = false;
let cottageLookX     = 1;
let cottageLookY     = 1;
let bookshelfOverlayActive = false;

// Outfit definitions — purchasable colors for the player @ glyph. Prices in stamps.
const OUTFITS = [
  { key: 'crimson', name: 'CRIMSON',        color: '#cc2233', price: 15 },
  { key: 'cobalt',  name: 'COBALT',         color: '#2255cc', price: 15 },
  { key: 'amber',   name: 'AMBER',          color: '#cc7700', price: 15 },
  { key: 'forest',  name: 'FOREST',         color: '#226622', price: 15 },
  { key: 'rose',    name: 'ROSE',           color: '#cc5588', price: 15 },
  { key: 'slate',   name: 'SLATE',          color: '#667788', price: 15 },
  { key: 'gold',    name: 'GOLD',           color: '#ccaa00', price: 15 },
  { key: 'teal',    name: 'TEAL',           color: '#229988', price: 15 },
  { key: 'ivory',   name: 'IVORY',          color: '#ddddcc', price: 15 },
  { key: 'violet',  name: 'VIOLET',         color: '#8844cc', price: 15 },
  { key: 'cloak',   name: 'CRIMSON CLOAK',  color: '#cc2222', price: 25 },
  { key: 'midnight',name: 'MIDNIGHT ROBE',  color: '#1a1a4a', price: 30 },
  { key: 'golden',  name: 'GOLDEN THREADS', color: '#ccaa33', price: 50 },
];

// HOME GOODS catalog (§4.2) — 12 purchasable items in order A–L. Prices in stamps (§13).
const FURNITURE_DEFS = [
  { key: 'cottage',      name: 'COTTAGE',       price: 195, glyph: '⌂', color: '#886633' },
  { key: 'rug',          name: 'BRAIDED RUG',   price:  10, glyph: '≈', color: '#886633' },
  { key: 'table',        name: 'WOODEN TABLE',  price:  16, glyph: '=', color: '#aa7744' },
  { key: 'fireplace',    name: 'FIREPLACE',     price:  42, glyph: '{', color: '#ff9933' },
  { key: 'bookshelf',    name: 'BOOKSHELF',     price:  26, glyph: '[', color: '#886633' },
  { key: 'clock',        name: 'CLOCK',         price:  10, glyph: 'o', color: '#aaaaaa' },
  { key: 'cat',          name: 'PET (CAT)',     price:  31, glyph: 'f', color: '#cc9933' },
  { key: 'kitchen',      name: 'KITCHEN',       price:  47, glyph: '#', color: '#aaaaaa' },
  { key: 'bed',          name: 'BED',           price:  31, glyph: 'z', color: '#6688cc' },
  { key: 'candles',      name: 'CANDLES',       price:   5, glyph: 'i', color: '#ffd633' },
  { key: 'rockingchair', name: 'ROCKING CHAIR', price:  16, glyph: '~', color: '#aa7744' },
  { key: 'mat',          name: 'WELCOME MAT',   price:  10, glyph: '-', color: '#aa7744' },
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
  const BOX_H = 33;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const RPX   = BOX_X + 1 + AW + 1;

  let gsTab = 'clothing'; // 'clothing' | 'home_goods' | 'garden' | 'mining'

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
    const letter=('abcdefghijklm')[idx], owned=state.player.ownedOutfits.includes(outfit.key), equipped=state.player.colorName===outfit.name, canAfford=state.player.stamps>=(outfit.price||15);
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

  function drawGardenCell(cx, ay, item, letter) {
    const planted    = !!state.garden[item.key];
    const noCottage  = !state.cottage.owned;
    const canAfford  = state.player.stamps >= item.price;
    const letterFg   = planted ? '#888888' : (noCottage ? '#444444' : (canAfford ? TC : '#555555'));
    display.draw(cx,  ay, letter,      letterFg,    BG);
    display.draw(cx+1,ay, ')',         '#555555',   BG);
    display.draw(cx+2,ay, ' ',         BRIGHT_WHITE,BG);
    display.draw(cx+3,ay, item.glyph,  planted ? item.fg : (noCottage ? '#444444' : '#555555'), BG);
    display.draw(cx+4,ay, ' ',         BRIGHT_WHITE,BG);
    const name11 = item.name.padEnd(11).slice(0,11);
    const nameFg = planted ? '#888888' : (noCottage ? '#444444' : (canAfford ? '#aaaaaa' : '#666666'));
    for (let i=0;i<11;i++) display.draw(cx+5+i,ay,name11[i]||' ',nameFg,BG);
    if (planted) {
      display.draw(cx+16,ay,'✓','#66cc66',BG);
      for(let i=1;i<7;i++) display.draw(cx+16+i,ay,' ',BRIGHT_WHITE,BG);
    } else {
      const priceStr = (item.price+' ·').padStart(7);
      const priceFg  = noCottage ? '#444444' : (canAfford ? '#66cc66' : '#ff5555');
      for(let i=0;i<7;i++) display.draw(cx+16+i,ay,priceStr[i]||' ',priceFg,BG);
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
    // Row 3: tab bar — four tabs: CLOTHING(13) | HOME GOODS(12) | GARDEN(12) | MINING(12) = 52 (with 3 separators)
    { const ay=BOX_Y+3; border(ay);
      const tabs=[{k:'clothing',lbl:'[CLOTHING ]',w:13},{k:'home_goods',lbl:'[HOME GOODS]',w:12},{k:'garden',lbl:'[ GARDEN  ]',w:12},{k:'mining',lbl:'[ MINING  ]',w:12}];
      let cx=BOX_X+1;
      for(let ti=0;ti<tabs.length;ti++){
        const t=tabs[ti],active=gsTab===t.k;
        const lp=Math.floor((t.w-t.lbl.length)/2);
        for(let i=0;i<t.w;i++){const ci=i-lp;const ch=(ci>=0&&ci<t.lbl.length)?t.lbl[ci]:' ';display.draw(cx+i,ay,ch,(active&&ch!==' ')?TC:DC,BG);}
        cx+=t.w;
        if(ti<tabs.length-1){display.draw(cx,ay,'│',DC,BG);cx++;}
      }
    }
    // Row 4: ─
    { const ay=BOX_Y+4; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,'─',DC,BG); }
    // Rows 5-14: art
    for(let r=0;r<10;r++) crow(BOX_Y+5+r,r);
    // Stamp balance in art pane last row (r=9, BOX_Y+14)
    { const ay=BOX_Y+14; const stStr = `Stamps:${state.player.stamps} ·`.slice(0,AW);
      for(let i=0;i<AW;i++) display.draw(BOX_X+1+i, ay, stStr[i]||' ', COLOR_STAMPS, BG); }
    // Right pane (rows 6-12)
    if(gsTab==='clothing'){
      drp(BOX_Y+6,'CLOTHING SHOP',TC); drp(BOX_Y+7,'Change your look.','#555555');
      drp(BOX_Y+9,'Prices: 15–50 stamps','#555555'); drp(BOX_Y+11,'Current look:','#555555');
      { const ay=BOX_Y+12; const cn=(state.player.colorName==='DEFAULT')?'default white':state.player.colorName.toLowerCase();
        drp(ay,`@ ${cn}`,'#555555'); display.draw(RPX,ay,'@',state.player.color||BRIGHT_WHITE,BG); }
    } else if(gsTab==='home_goods'){
      drp(BOX_Y+6,'HOME GOODS',TC); drp(BOX_Y+7,'Items for a life well-built.','#555555');
      drp(BOX_Y+9,'Buy items A–L below.','#555555');
      drp(BOX_Y+10,'Cottage required for B–L.','#555555');
      if(state.cottage.owned) drp(BOX_Y+12,'Cottage: OWNED','#66cc66');
      else drp(BOX_Y+12,'Cottage: not yet','#555555');
    } else if(gsTab==='garden'){
      drp(BOX_Y+6,'GARDEN SHOP',TC); drp(BOX_Y+7,'Grow something beautiful.','#555555');
      drp(BOX_Y+9,'Flowers are forever.','#555555');
      drp(BOX_Y+10,'Vegetables can be eaten.','#555555');
      if(state.cottage.owned) drp(BOX_Y+12,'Cottage: OWNED','#66cc66');
      else drp(BOX_Y+12,'Need a cottage first.','#555555');
    } else {
      drp(BOX_Y+6,'MINING EQUIPMENT',TC); drp(BOX_Y+7,'Tools for the underground.','#555555');
      drp(BOX_Y+9,`a. Pickaxe           ${state.skills.pickaxeLevel>=1?'✓ owned':'15 stamps'}`,(state.skills.pickaxeLevel>=1)?'#66cc66':'#aaaaaa');
      drp(BOX_Y+10,`b. Brand Name Pickaxe ${state.skills.pickaxeLevel>=2?'✓ owned':'40 stamps'}`,(state.skills.pickaxeLevel>=2)?'#66cc66':'#aaaaaa');
      drp(BOX_Y+11,`c. Lantern           ${state.skills.lantern?'✓ owned':'20 stamps'}`,(state.skills.lantern)?'#66cc66':'#aaaaaa');
      drp(BOX_Y+12,'─'.repeat(IPW),DC);
      drp(BOX_Y+13,`Sell crystal: 25g each`,'#555555');
      drp(BOX_Y+14,`d. Sell 1 crystal${state.mine.crystals>0?'  +25g':'  [none]'}`,state.mine.crystals>0?'#66cc66':'#444444');
      drp(BOX_Y+15,`Crystals: ${state.mine.crystals}/5`,'#66ccff');
    }
    // Rows 15-20: shopkeeper note in left pane only (shared between both tabs)
    { const NOTE = [
        "  We don't    ",
        "  sell rods.  ",
        "  But someone ",
        "  left some-  ",
        "  thing in    ",
        "  the pond.   ",
      ];
      for(let r=0;r<6;r++){
        const ay=BOX_Y+15+r; border(ay);
        for(let i=0;i<AW;i++) display.draw(BOX_X+1+i,ay,NOTE[r][i]||' ','#aaaa66',BG);
        display.draw(BOX_X+1+AW,ay,'│',DC,BG);
        for(let i=0;i<IPW;i++) display.draw(RPX+i,ay,' ',BRIGHT_WHITE,BG);
      }
    }
    // Row 21: ─
    { const ay=BOX_Y+21; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,'─',DC,BG); }
    // Rows 22-27: grid (6 rows)
    const letters='abcdefghijkl';
    if(gsTab==='mining'){
      for(let row=0;row<6;row++){const ay=BOX_Y+22+row;border(ay);for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,' ',BRIGHT_WHITE,BG);}
    } else if(gsTab==='clothing'){
      const rows=Math.ceil(OUTFITS.length/2);
      for(let row=0;row<rows;row++){
        const ay=BOX_Y+22+row; border(ay);
        let cx=BOX_X+3;
        if(row*2 < OUTFITS.length)   cx=drawOutfitCell(cx,ay,OUTFITS[row*2],row*2);
        cx+=2;
        if(row*2+1 < OUTFITS.length) cx=drawOutfitCell(cx,ay,OUTFITS[row*2+1],row*2+1);
        while(cx<BOX_X+1+IW) display.draw(cx++,ay,' ',BRIGHT_WHITE,BG);
      }
      { const ay=BOX_Y+29; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,' ',BRIGHT_WHITE,BG); }
    } else if(gsTab==='home_goods'){
      for(let row=0;row<6;row++){
        const ay=BOX_Y+22+row; border(ay);
        const li=row*2, ri=row*2+1;
        for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,' ',BRIGHT_WHITE,BG);
        if(li<FURNITURE_DEFS.length) drawHGCell(BOX_X+3,ay,FURNITURE_DEFS[li],letters[li]);
        if(ri<FURNITURE_DEFS.length) drawHGCell(BOX_X+28,ay,FURNITURE_DEFS[ri],letters[ri]);
      }
    } else {
      for(let row=0;row<6;row++){
        const ay=BOX_Y+22+row; border(ay);
        const li=row*2, ri=row*2+1;
        for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,' ',BRIGHT_WHITE,BG);
        if(li<GARDEN_DEFS.length) drawGardenCell(BOX_X+3,ay,GARDEN_DEFS[li],letters[li]);
        if(ri<GARDEN_DEFS.length) drawGardenCell(BOX_X+28,ay,GARDEN_DEFS[ri],letters[ri]);
      }
    }
    // Row 30: ═
    { const ay=BOX_Y+30; border(ay); for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,'═',DC,BG); }
    // Row 31: footer
    { const ay=BOX_Y+31; border(ay);
      const txt=gsTab==='clothing'?'a–m: buy/equip  →: next tab  ESC: exit':gsTab==='home_goods'?'a–l: buy/visit  ←→: switch tab  ESC: exit':gsTab==='garden'?'a–l: plant  ←→: switch tab  ESC: exit':'a–d: buy/sell  ←: prev tab  ESC: exit';
      const pad=' '.repeat(Math.max(0,Math.floor((IW-txt.length)/2)));
      const padded=menuPad(pad+txt,IW);
      for(let i=0;i<IW;i++) display.draw(BOX_X+1+i,ay,padded[i]||' ','#555555',BG); }
    // Row 32: ╚═╝
    display.draw(BOX_X,BOX_Y+32,'╚',TC,BG); display.draw(BOX_X+BOX_W-1,BOX_Y+32,'╝',TC,BG);
    for(let i=1;i<BOX_W-1;i++) display.draw(BOX_X+i,BOX_Y+32,'═',TC,BG);
  }

  gsMenuRedrawFn = redraw;
  redraw();

  function closeGS() {
    gsMenuRedrawFn = null;
    window.removeEventListener('keydown', gsKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x,state.player.y,'@',state.player.color||BRIGHT_WHITE,BG);
    state.gameState='playing';
  }

  function gsKeyHandler(e) {
    if (e.key === 'Escape') { closeGS(); return; }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (gsTab === 'clothing') { gsTab = 'home_goods'; playSound('click'); redraw(); }
      else if (gsTab === 'home_goods') { gsTab = 'garden'; playSound('click'); redraw(); }
      else if (gsTab === 'garden') { gsTab = 'mining'; playSound('click'); redraw(); }
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (gsTab === 'home_goods') { gsTab = 'clothing'; playSound('click'); redraw(); }
      else if (gsTab === 'garden') { gsTab = 'home_goods'; playSound('click'); redraw(); }
      else if (gsTab === 'mining') { gsTab = 'garden'; playSound('click'); redraw(); }
      return;
    }

    if (gsTab === 'mining') {
      if (e.key === 'a') {
        if (!state.mine.discovered) { addLog('Find the mine first.', '#555555'); return; }
        if (state.skills.pickaxeLevel >= 1) { addLog('You already own a pickaxe.', '#555555'); return; }
        if (state.player.stamps < 15) { addLog(`Need ${15 - state.player.stamps} more stamps.`, '#ff5555'); return; }
        state.player.stamps -= 15; state.skills.pickaxeLevel = 1;
        addLog('You buy a pickaxe. Mining is now faster.', '#ff9933'); playSound('bought'); drawStatusBar(); redraw();
        return;
      }
      if (e.key === 'b') {
        if (!state.mine.discovered) { addLog('Find the mine first.', '#555555'); return; }
        if (state.skills.pickaxeLevel < 1) { addLog('You need a pickaxe first.', '#555555'); return; }
        if (state.skills.pickaxeLevel >= 2) { addLog('You already own the brand name pickaxe.', '#555555'); return; }
        if (state.player.stamps < 40) { addLog(`Need ${40 - state.player.stamps} more stamps.`, '#ff5555'); return; }
        state.player.stamps -= 40; state.skills.pickaxeLevel = 2;
        addLog('Brand Name Pickaxe purchased. One hit per rock.', '#ff9933'); playSound('bought'); drawStatusBar(); redraw();
        return;
      }
      if (e.key === 'c') {
        if (!state.mine.discovered) { addLog('Find the mine first.', '#555555'); return; }
        if (state.skills.lantern) { addLog('You already own a lantern.', '#555555'); return; }
        if (state.player.stamps < 20) { addLog(`Need ${20 - state.player.stamps} more stamps.`, '#ff5555'); return; }
        state.player.stamps -= 20; state.skills.lantern = true;
        addLog('Lantern purchased. Ore veins visible through rock.', '#ffd633'); playSound('bought'); drawStatusBar(); redraw();
        return;
      }
      if (e.key === 'd') {
        if (state.mine.crystals < 1) { addLog('No crystals to sell.', '#555555'); return; }
        state.mine.crystals--;
        state.player.gold = Math.round((state.player.gold + 25) * 10) / 10;
        state.lifetimeGoldEarned = Math.round((state.lifetimeGoldEarned + 25) * 10) / 10;
        addLog('Sold 1 crystal for 25g.', '#66ccff'); playSound('sold'); drawStatusBar(); redraw();
        return;
      }
      return;
    }

    if (gsTab === 'garden') {
      const idx = 'abcdefghijkl'.indexOf(e.key);
      if (idx < 0 || !GARDEN_DEFS[idx]) return;
      const item = GARDEN_DEFS[idx];
      if (!state.cottage.owned) { addLog('You need a cottage first.', '#555555'); return; }
      if (state.garden[item.key] === true) { addLog('Already growing.', '#555555'); return; }
      if (state.garden[item.key] === 'eaten') { addLog(`${item.name} is regrowing. Wait a couple days.`, '#555555'); return; }
      if (state.player.stamps < item.price) { addLog(`You need ${item.price - state.player.stamps} more stamps.`, '#ff5555'); return; }
      state.player.stamps -= item.price;
      state.garden[item.key] = true;
      placeGardenTiles();
      renderDirty();
      display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
      addLog(`${item.name} planted in your garden.`, item.fg);
      playSound('bought'); drawStatusBar(); redraw();
      return;
    }

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
        placeGardenTiles();
        renderDirty();
        logHistory('Bought a cottage.');
        playSound('bought');
        addLog('You purchase the cottage. The deed changes hands.', '#ddcc99');
      } else {
        state.cottage.furniture[item.key] = true;
        if (item.key === 'cat') { state.cottage.catX = 9; state.cottage.catY = 7; }
        logHistory(`Brought home a ${item.name.toLowerCase()}.`);
        playSound('bought');
        addLog(`${item.name} placed in your cottage.`, '#aa66ff');
        buildInteriorTileMap();
      }
      drawStatusBar(); redraw(); return;
    }

    // CLOTHING tab: a–m
    const letterIdx = 'abcdefghijklm'.indexOf(e.key);
    if (letterIdx < 0) return;
    const outfit = OUTFITS[letterIdx]; if (!outfit) return;
    const owned=state.player.ownedOutfits.includes(outfit.key), equipped=state.player.colorName===outfit.name;
    if (equipped) { addLog("You're already wearing that.",'#555555'); return; }
    if (owned) {
      state.player.color=outfit.color; state.player.colorName=outfit.name;
      markDirty(state.player.x,state.player.y); renderDirty(); display.draw(state.player.x,state.player.y,'@',state.player.color,BG);
      addLog(`You change into something ${outfit.name.toLowerCase()}.`,outfit.color); redraw(); return;
    }
    const price=outfit.price||15;
    if (state.player.stamps<price) { addLog(`You need ${price-state.player.stamps} more stamps.`,'#ff5555'); return; }
    state.player.stamps-=price; state.player.ownedOutfits.push(outfit.key); state.player.color=outfit.color; state.player.colorName=outfit.name;
    markDirty(state.player.x,state.player.y); renderDirty(); display.draw(state.player.x,state.player.y,'@',state.player.color,BG);
    addLog(`You purchase and put on the ${outfit.name.toLowerCase()} outfit.`,outfit.color); playSound('bought'); drawStatusBar(); redraw();
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
  const BOX_H = 30;
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

    // Row 21: ─ separator before upgrades
    { const ay = BOX_Y + 21; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '─', DC, BG); }

    // Row 22: upgrade section header
    { const ay = BOX_Y + 22; border(ay);
      const tag = '[ UPGRADES ]';
      const dashes = IW - tag.length - 2;
      const ld = Math.floor(dashes/2), rd = dashes - ld;
      const hdr = ('─'.repeat(ld) + ' ' + tag + ' ' + '─'.repeat(rd)).slice(0, IW);
      for (let i = 0; i < IW; i++) {
        const inTag = i >= ld+1 && i < ld+1+tag.length;
        display.draw(BOX_X+1+i, ay, hdr[i]||'─', inTag ? '#66ccff' : '#333333', BG);
      }
    }

    // Rows 23-24: Storage Expansion I and II
    function stUpgradeRow(row, nk, key) {
      const node = OFFICE_NODES.find(n => n.key === nk);
      const ay = BOX_Y + row; border(ay);
      const owned = (state.skills[nk] || 0) >= 1;
      const locked = state.phase < (node?.minPhase || 3);
      const req = node?.requires && !(state.skills[node.requires] || 0);
      const canAfford = !owned && !locked && !req && state.player.gold >= node.cost;
      const marker = owned ? '✓' : (locked || req ? '·' : (canAfford ? '●' : '●'));
      const mFg   = owned ? '#66cc66' : (locked || req ? '#333333' : (canAfford ? '#66cc66' : '#ff5555'));
      const nFg   = owned ? '#888888' : (locked || req ? '#333333' : '#aaaaaa');
      const cFg   = owned ? '#888888' : (locked || req ? '#333333' : (canAfford ? '#66cc66' : '#ff5555'));
      const label = `[${key}] ${node?.name || nk}`;
      const cost  = owned ? '✓ owned' : (locked ? '[locked]' : (req ? `[need ${node.requires}]` : `${node.cost}g`));
      const gap   = Math.max(1, IW - label.length - cost.length - 2);
      const row_str = label + ' '.repeat(gap) + cost;
      const rp = menuPad(row_str, IW);
      for (let i = 0; i < IW; i++) {
        const fg = i < label.length ? nFg : (i === IW-1 ? mFg : cFg);
        display.draw(BOX_X+1+i, ay, rp[i]||' ', fg, BG);
      }
      display.draw(BOX_X+1+IW-1, ay, marker, mFg, BG);
    }
    stUpgradeRow(23, 'storageExp1', 'u');
    stUpgradeRow(24, 'storageExp2', 'v');

    // Rows 25-26: blank
    for (let r = 25; r <= 26; r++) { border(BOX_Y+r); for (let x=1;x<BOX_W-1;x++) display.draw(BOX_X+x,BOX_Y+r,' ',BRIGHT_WHITE,BG); }

    // Row 27: ═ separator
    { const ay = BOX_Y + 27; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 28: footer
    { const ay = BOX_Y + 28; border(ay);
      const cardTip = state.bank?.card?.tier ? '  SHIFT=card' : '';
      const txt = `Auto-halt: storage full pauses production.  [u/v] upgrades${cardTip}`;
      const centered = menuPad(txt.length < IW ? ' '.repeat(Math.floor((IW - txt.length) / 2)) + txt : txt, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, centered[i] || ' ', '#555555', BG); }

    // Row 29: ╚═╝
    display.draw(BOX_X, BOX_Y + 29, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 29, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 29, '═', TC, BG);
  }

  storageMenuRedrawFn = redraw;
  redraw();

  function closeStorage() {
    storageMenuRedrawFn = null;
    window.removeEventListener('keydown', storageKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
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
    } else if (e.key === 'u') {
      const node = OFFICE_NODES.find(n => n.key === 'storageExp1');
      if (!node || state.phase < node.minPhase) { addLog('Storage Expansion I not yet available.', '#555555'); return; }
      if ((state.skills.storageExp1 || 0) >= 1) { addLog('Storage Expansion I already purchased.', '#555555'); return; }
      if (!payForItem(node.cost, e.shiftKey && !!state.bank?.card?.tier)) { redraw(); return; }
      state.skills.storageExp1 = 1;
      state.storage.widgetCap = 100; state.storage.rmCap = 100;
      addLog('Storage Expansion I purchased. Capacity: 100.', TC); playSound('bought'); drawStatusBar(); redraw();
    } else if (e.key === 'v') {
      const node = OFFICE_NODES.find(n => n.key === 'storageExp2');
      if (!node || state.phase < node.minPhase) { addLog('Storage Expansion II not yet available.', '#555555'); return; }
      if (!(state.skills.storageExp1 || 0)) { addLog('Storage Expansion I required first.', '#555555'); return; }
      if ((state.skills.storageExp2 || 0) >= 1) { addLog('Storage Expansion II already purchased.', '#555555'); return; }
      if (!payForItem(node.cost, e.shiftKey && !!state.bank?.card?.tier)) { redraw(); return; }
      state.skills.storageExp2 = 1;
      state.storage.widgetCap = 1000; state.storage.rmCap = 1000;
      addLog('Storage Expansion II purchased. Capacity: 1000.', TC); playSound('bought'); drawStatusBar(); redraw();
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
    display.draw(BOX_X, BOX_Y, '╔', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '═', WC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '╚', WC, BG); display.draw(BOX_X+BOX_W-1, botY, '╝', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, botY, '═', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '║', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '║', WC, BG);
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
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
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

  display.draw(BOX_X, BOX_Y, '╔', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '═', WC, BG);
  const bY = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, bY, '╚', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '╝', WC, BG);
  for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '═', WC, BG);
  for (let y = 1; y < BOX_H-1; y++) {
    display.draw(BOX_X, BOX_Y+y, '║', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '║', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y+y, ' ', BRIGHT_WHITE, BG);
  }
  const TITLE = '– THE OFFICE –';
  for (let i = 0; i < TITLE.length; i++) display.draw(CX+i, BOX_Y+1, TITLE[i], BRIGHT_CYAN, BG);
  for (let i = 0; i < lines.length; i++)
    for (let j = 0; j < lines[i].length; j++) display.draw(CX+j, BOX_Y+3+i, lines[i][j], BRIGHT_WHITE, BG);

  function close(goPlay) {
    window.removeEventListener('keydown', dispatchKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
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

function showNumericPrompt(title, maxVal, onConfirm, onCancel, opts = {}) {
  const allowDecimal = !!opts.decimal;
  const BOX_W = 40, BOX_H = 8;
  const BOX_X = Math.floor((DISPLAY_WIDTH  - BOX_W) / 2);
  const BOX_Y = Math.floor((DISPLAY_HEIGHT - BOX_H) / 2);
  const CONT_X = BOX_X + 2;
  const CONT_W = BOX_W - 4;
  const WC = '#555555';

  // Save and disable all menu redraws so they don't overwrite the prompt
  const savedRedraws = {
    rm: rmMenuRedrawFn, wb: wbMenuRedrawFn, mt: mtMenuRedrawFn,
    office: officeMenuRedrawFn, gs: gsMenuRedrawFn, storage: storageMenuRedrawFn,
    bank: bankMenuRedrawFn, lf: lfMenuRedrawFn, dv: dvMenuRedrawFn,
    np: typeof npMenuRedrawFn !== 'undefined' ? npMenuRedrawFn : undefined,
    dashboard: typeof dashboardRedrawFn !== 'undefined' ? dashboardRedrawFn : undefined,
    inventory: typeof inventoryRedrawFn !== 'undefined' ? inventoryRedrawFn : undefined,
  };
  rmMenuRedrawFn = null; wbMenuRedrawFn = null; mtMenuRedrawFn = null;
  officeMenuRedrawFn = null; gsMenuRedrawFn = null; storageMenuRedrawFn = null;
  bankMenuRedrawFn = null; lfMenuRedrawFn = null; dvMenuRedrawFn = null;
  if (typeof npMenuRedrawFn !== 'undefined')      npMenuRedrawFn = null;
  if (typeof dashboardRedrawFn !== 'undefined')   dashboardRedrawFn = null;
  if (typeof inventoryRedrawFn !== 'undefined')   inventoryRedrawFn = null;

  let inputStr = '';

  function redrawPrompt() {
    display.draw(BOX_X, BOX_Y, '╔', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, BOX_Y, '═', WC, BG);
    const bY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, bY, '╚', WC, BG); display.draw(BOX_X+BOX_W-1, bY, '╝', WC, BG);
    for (let x = 1; x < BOX_W-1; x++) display.draw(BOX_X+x, bY, '═', WC, BG);
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X, BOX_Y+y, '║', WC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+y, '║', WC, BG);
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
    // Restore all parent menu redraws
    rmMenuRedrawFn = savedRedraws.rm;
    wbMenuRedrawFn = savedRedraws.wb;
    mtMenuRedrawFn = savedRedraws.mt;
    officeMenuRedrawFn = savedRedraws.office;
    gsMenuRedrawFn = savedRedraws.gs;
    storageMenuRedrawFn = savedRedraws.storage;
    bankMenuRedrawFn = savedRedraws.bank;
    lfMenuRedrawFn = savedRedraws.lf;
    dvMenuRedrawFn = savedRedraws.dv;
    if (savedRedraws.np !== undefined)        npMenuRedrawFn = savedRedraws.np;
    if (savedRedraws.dashboard !== undefined) dashboardRedrawFn = savedRedraws.dashboard;
    if (savedRedraws.inventory !== undefined) inventoryRedrawFn = savedRedraws.inventory;
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
  }

  function promptHandler(e) {
    e.preventDefault();
    if (e.key === 'Escape')    { closePrompt(); onCancel?.(); return; }
    if (e.key === 'Enter')     { const v = Math.min(allowDecimal ? (parseFloat(inputStr) || 0) : (parseInt(inputStr) || 0), maxVal); closePrompt(); if (v > 0) onConfirm(v); else onCancel?.(); return; }
    if (e.key === 'Backspace') { inputStr = inputStr.slice(0, -1); redrawPrompt(); return; }
    if (/^[0-9]$/.test(e.key) && inputStr.length < 9) { inputStr += e.key; redrawPrompt(); return; }
    if (allowDecimal && e.key === '.' && !inputStr.includes('.') && inputStr.length < 8) { inputStr += '.'; redrawPrompt(); }
  }

  redrawPrompt();
  window.addEventListener('keydown', promptHandler);
}

// ── Bank credit rating system (§5.4) ─────────────────────────────────────────

// 11-tier rating scale. Score 0–10 maps to index 0–10.
const RATING_TIERS = ['F','D','C','CC','B','BB','BBB','A','AA','AAA','S'];
// index:              0    1   2   3    4   5    6     7   8    9    10

const CARD_TIERS = {
  bronze: {
    requiresScore: 3, limit: 500,   interestRate: 0.20, cycle: 10,
    color: '#cc7733', labelColor: '#ffaa55',
    tagline: 'Start your financial journey.',
    perks: ['5% discount on RM purchases', 'Free overdraft: 50g once per cycle', 'Spend at any station'],
  },
  silver: {
    requiresScore: 5, limit: 2000,  interestRate: 0.10, cycle: 10,
    color: '#aaaaaa', labelColor: '#dddddd',
    tagline: 'For the serious producer.',
    perks: ['Auto RM purchase at dawn if storage low', 'Sell 10 extra widgets/day above demand cap at 30% discount', 'Workers 10% faster when payroll on card'],
  },
  gold: {
    requiresScore: 8, limit: 8000,  interestRate: 0.04, cycle: 12,
    color: '#ffd633', labelColor: '#ffe980',
    tagline: 'Preferred. Premium. Proven.',
    perks: ['Headlines delivered to log at dawn', 'Balance rollover grace: 2 days once per cycle', 'Bulk RM: buy 50 at 15% discount', 'Derivatives margin requirements -20%'],
  },
  black: {
    requiresScore: 10, limit: 50000, interestRate: 0.01, cycle: 15,
    color: '#333333', labelColor: '#f0f0f0',
    tagline: null,
    perks: ['Demand immunity once per week', 'Derivatives insurance up to 10,000g', 'Double stamps on all activities', 'Exclusive Auction House access'],
  },
};

const CARD_TIER_ORDER = ['bronze', 'silver', 'gold', 'black'];

// Helper: charge cost to card (Shift held) or gold. Returns true on success.
function payForItem(cost, useCard) {
  if (useCard) {
    const avail = Math.max(0, (state.bank.card.limit || 0) - (state.bank.card.balance || 0));
    if (avail < cost) { addLog('Card limit reached.', '#ff5555'); return false; }
    state.bank.card.balance = Math.round((state.bank.card.balance + cost) * 10) / 10;
    addLog(`Charged ${formatCredits(cost)}g to card.`, '#aaaaaa');
    return true;
  } else {
    if (state.player.gold < cost) { addLog(`Need ${formatCredits(cost)}g.`, '#ff5555'); return false; }
    state.player.gold = Math.round((state.player.gold - cost) * 10) / 10;
    return true;
  }
}

function cardTierAtLeast(minTier) {
  const order = ['bronze', 'silver', 'gold', 'black'];
  const playerIndex = order.indexOf(state.bank.card.tier);
  const minIndex    = order.indexOf(minTier);
  if (playerIndex === -1 || minIndex === -1) return false;
  return playerIndex >= minIndex;
}

function getUpgradeLogLines(tierName) {
  if (tierName === 'silver') return [
    { line: '> [BANK] Silver card issued. Welcome to preferred status.', color: '#aaaaaa' },
    { line: '> Includes all Bronze benefits:',                           color: '#555555' },
    { line: '>   ✦ 5% discount on RM purchases',                   color: '#cc7733' },
    { line: '>   ✦ Free overdraft: 50g once per cycle',            color: '#cc7733' },
    { line: '> Plus new Silver benefits:',                               color: '#aaaaaa' },
    { line: '>   ✦ Auto RM purchase at dawn if storage low',        color: '#aaaaaa' },
    { line: '>   ✦ Sell 10 extra widgets/day above demand',         color: '#aaaaaa' },
    { line: '>   ✦ Workers 10% faster when payroll on card',        color: '#aaaaaa' },
  ];
  if (tierName === 'gold') return [
    { line: '> [BANK] Gold card issued. You are a preferred customer.',  color: '#ffd633' },
    { line: '> Includes all Bronze and Silver benefits.',                color: '#555555' },
    { line: '> Plus new Gold benefits:',                                 color: '#ffd633' },
    { line: '>   ✦ Newspaper headlines delivered to log at dawn',   color: '#ffd633' },
    { line: '>   ✦ Balance rollover grace: 2 days once per cycle',  color: '#ffd633' },
    { line: '>   ✦ Bulk RM: buy 50 at 15% discount in one action',  color: '#ffd633' },
    { line: '>   ✦ Derivatives margin requirements -20%',           color: '#ffd633' },
  ];
  if (tierName === 'black') return [
    { line: '> [BANK] Black card issued.',                               color: '#f0f0f0' },
    { line: '> All previous benefits included.',                         color: '#555555' },
    { line: '> Plus:',                                                   color: '#f0f0f0' },
    { line: '>   ▪ Demand immunity once per week',                  color: '#f0f0f0' },
    { line: '>   ▪ Derivatives insurance up to 10,000g',           color: '#f0f0f0' },
    { line: '>   ▪ Double stamps on all activities',                color: '#f0f0f0' },
    { line: '>   ▪ Exclusive Auction House access',                 color: '#333333' },
  ];
  return [];
}

function getBankRatingIdx() {
  return Math.round(Math.max(0, Math.min(10, state.bank.creditRatingScore)));
}
function getRatingColor(tier) {
  return RATING_COLORS[tier] ?? '#f0f0f0';
}
function getMaxEligibleCardTier(score) {
  // Returns the highest CARD_TIER the player qualifies for at given score, or null
  let best = null;
  for (const t of CARD_TIER_ORDER) {
    if (score >= CARD_TIERS[t].requiresScore) best = t;
  }
  return best;
}
function getCardTierColor(tier) {
  if (!tier) return '#555555';
  return CARD_TIERS[tier]?.color ?? '#555555';
}

function changeRating(delta, reason) {
  const prevIdx = getBankRatingIdx();
  state.bank.creditRatingScore = Math.max(0, Math.min(10, state.bank.creditRatingScore + delta));
  const newIdx  = getBankRatingIdx();
  const newTier = RATING_TIERS[newIdx];
  state.bank.creditRating = newTier;
  if (newIdx !== prevIdx) {
    const prevTier = RATING_TIERS[prevIdx];
    const up = newIdx > prevIdx;
    if (state.bank.ratingHistory.length >= 20) state.bank.ratingHistory.shift();
    state.bank.ratingHistory.push({ day: state.day, from: prevTier, to: newTier, reason });
    addLog(`Credit rating: ${prevTier} → ${newTier}. ${reason}.`, up ? '#66cc66' : '#ff5555');
    // Check card upgrade eligibility on upward tier change
    if (up) {
      const currentTIdx = state.bank.card.tier ? CARD_TIER_ORDER.indexOf(state.bank.card.tier) : -1;
      for (const t of CARD_TIER_ORDER) {
        const tIdx = CARD_TIER_ORDER.indexOf(t);
        // Only notify for tiers strictly above the player's current card tier
        if (tIdx > currentTIdx && state.bank.creditRatingScore >= CARD_TIERS[t].requiresScore
            && !state.bank.card.upgradeNotified[t]) {
          state.bank.card.upgradeNotified[t] = true;
          addLog(`> [BANK] You qualify for a ${t.toUpperCase()} card.`, CARD_TIERS[t].color);
          addLog(`> Visit the Bank to upgrade.`, CARD_TIERS[t].color);
        }
      }
    }
  }
  if (bankMenuRedrawFn) bankMenuRedrawFn();
}

// ── Bank menu (§5.4) ─────────────────────────────────────────────────────────

function openBankMenu() {
  if (!state.stations.bank || !state.stations.bank.unlocked) return;
  state.gameState = 'menu';

  let bkTab    = state.bank.tab ?? 'account';   // 'account' | 'cards'
  let cardPage = Math.max(0, CARD_TIER_ORDER.indexOf(state.bank.cardPage ?? 'bronze')); // 0-3

  const TC  = '#66cc66';
  const CC  = '#66ccff';
  const DC  = '#333333';
  const LC  = '#ffffff';
  const BOX_W = 60;
  const IW    = 58;
  const AW    = 16;
  const RPW   = 41;
  const IPI   = RPW - 2; // inner section width
  const BOX_H = 32;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const DIVX  = BOX_X + 1 + AW;
  const RPX   = BOX_X + 1 + AW + 1;

  const BK_ART = [
    '  +----------+  ',
    '  | T H E    |  ',
    '  |  B A N K |  ',
    '  |----------|  ',
    '  | $      $ |  ',
    '  |    $$    |  ',
    '  | $      $ |  ',
    '  |----------|  ',
    '  |  V A U L T  ',
    '  +----------+  ',
  ];

  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }
  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', fg, BG);
  }
  function rowLeft(ay, artRow) {
    if (artRow !== undefined && artRow < 10) {
      const s = BK_ART[artRow] || '                ';
      const card = state.bank.card;
      const animTick = Math.floor(state.dayTick / 6) % 2;
      const cardOwned = !!card.tier;
      const dollarColor = cardOwned ? (animTick === 0 ? '#ffd633' : (getCardTierColor(card.tier))) : '#ffd633';
      for (let i = 0; i < AW; i++) {
        const ch = s[i] || ' ';
        let fg = BRIGHT_WHITE;
        if (ch === '+' || ch === '-') fg = TC;
        else if (ch === '|') fg = TC;
        else if ((artRow === 1) && i >= 4 && i <= 8) fg = '#aaffaa';   // T H E
        else if ((artRow === 2) && i >= 5 && i <= 12) fg = '#aaffaa';  // B A N K
        else if ((artRow === 3 || artRow === 7) && ch === '-') fg = '#aaaaaa';
        else if (artRow >= 4 && artRow <= 6 && ch === '$') fg = dollarColor;
        else if (artRow === 8 && i >= 4 && i <= 12) fg = '#aaffaa';   // V A U L T
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    } else if (artRow === 10) {
      // blank row
      for (let i = 0; i < AW; i++) display.draw(BOX_X + 1 + i, ay, ' ', BRIGHT_WHITE, BG);
    } else if (artRow === 11) {
      // CREDIT SCORE label
      const lbl = ' CREDIT SCORE   ';
      for (let i = 0; i < AW; i++) display.draw(BOX_X + 1 + i, ay, lbl[i] || ' ', DC, BG);
    } else if (artRow === 12) {
      // Score bar
      const rIdx = getBankRatingIdx();
      const rCol = getRatingColor(RATING_TIERS[rIdx]);
      const fill = Math.round(rIdx / 10 * 12);
      let c = BOX_X + 1;
      display.draw(c++, ay, ' ', BRIGHT_WHITE, BG); display.draw(c++, ay, ' ', BRIGHT_WHITE, BG);
      for (let i = 0; i < 12; i++) display.draw(c++, ay, i < fill ? '█' : '░', i < fill ? rCol : '#222222', BG);
      display.draw(c++, ay, ' ', BRIGHT_WHITE, BG); display.draw(c++, ay, ' ', BRIGHT_WHITE, BG);
    } else if (artRow === 13) {
      // current tier → next tier
      const rIdx = getBankRatingIdx();
      const cur  = RATING_TIERS[rIdx];
      const nxt  = rIdx < 10 ? RATING_TIERS[rIdx + 1] : null;
      const curC = getRatingColor(cur);
      const nxtC = nxt ? getRatingColor(nxt) : '#ffd633';
      let c = BOX_X + 1;
      display.draw(c++, ay, ' ', BRIGHT_WHITE, BG); display.draw(c++, ay, ' ', BRIGHT_WHITE, BG);
      for (const ch of cur)  { display.draw(c++, ay, ch, curC, BG); }
      display.draw(c++, ay, ' ', BRIGHT_WHITE, BG); display.draw(c++, ay, '→', DC, BG); display.draw(c++, ay, ' ', BRIGHT_WHITE, BG);
      if (nxt) { for (const ch of nxt) { display.draw(c++, ay, ch, nxtC, BG); } }
      else { display.draw(c++, ay, '★', '#ffd633', BG); display.draw(c++, ay, 'M', '#ffd633', BG); display.draw(c++, ay, 'A', '#ffd633', BG); display.draw(c++, ay, 'X', '#ffd633', BG); }
      while (c < BOX_X + 1 + AW) display.draw(c++, ay, ' ', BRIGHT_WHITE, BG);
    } else {
      for (let i = 0; i < AW; i++) display.draw(BOX_X + 1 + i, ay, ' ', BRIGHT_WHITE, BG);
    }
    display.draw(DIVX, ay, '│', DC, BG);
  }
  function srow(ay, text, fg, artRow) {
    border(ay);
    rowLeft(ay, artRow);
    display.draw(RPX, ay, '│', DC, BG);
    const p = menuPad(text, IPI);
    for (let i = 0; i < IPI; i++) display.draw(RPX + 1 + i, ay, p[i] || ' ', fg, BG);
    display.draw(RPX + RPW - 1, ay, '│', DC, BG);
  }
  function sbox_top(ay, artRow) {
    border(ay); rowLeft(ay, artRow);
    display.draw(RPX, ay, '┌', DC, BG);
    for (let i = 1; i < RPW - 1; i++) display.draw(RPX + i, ay, '─', DC, BG);
    display.draw(RPX + RPW - 1, ay, '┐', DC, BG);
  }
  function sbox_bot(ay, artRow) {
    border(ay); rowLeft(ay, artRow);
    display.draw(RPX, ay, '└', DC, BG);
    for (let i = 1; i < RPW - 1; i++) display.draw(RPX + i, ay, '─', DC, BG);
    display.draw(RPX + RPW - 1, ay, '┘', DC, BG);
  }
  function gap(ay, artRow) {
    border(ay); rowLeft(ay, artRow);
    for (let i = 0; i < RPW; i++) display.draw(RPX + i, ay, ' ', BRIGHT_WHITE, BG);
  }

  function redraw() {
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);

    // Row 0: ╔═╗
    display.draw(BOX_X, BOX_Y, '╔', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);

    // Row 1: header
    { const ay = BOX_Y + 1; border(ay);
      const title = `THE BANK [${bkTab === 'account' ? 'ACCOUNT' : 'CARDS'}]`, hint = 'esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        const fg = i < title.length ? LC : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }
    // Row 2: ═
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Row 3: tab bar — IW=58, split: left 28 │ right 29
    { const ay = BOX_Y + 3; border(ay);
      // Left half (28 chars): [ ACCOUNT ] or >> [ ACCOUNT ] <<
      const acLbl = bkTab === 'account' ? '>> [ ACCOUNT ] <<' : '[ ACCOUNT ]';
      const acPad = Math.floor((28 - acLbl.length) / 2);
      const acHalf = acLbl.padStart(acPad + acLbl.length).padEnd(28);
      // Right half (29 chars): [ CARDS ] or >> [ CARDS ] <<
      const cdLbl = bkTab === 'cards' ? '>> [ CARDS ] <<' : '[ CARDS ]';
      const cdPad = Math.floor((29 - cdLbl.length) / 2);
      const cdHalf = cdLbl.padStart(cdPad + cdLbl.length).padEnd(29);
      const tabBar = acHalf + '│' + cdHalf; // 28+1+29 = 58 = IW
      for (let i = 0; i < IW; i++) {
        const ch = tabBar[i] || ' ';
        let fg = DC;
        if (i < 28 && bkTab === 'account') fg = TC;        // entire left active
        else if (i > 28 && bkTab === 'cards') fg = TC;     // entire right active
        else if (i === 28) fg = DC;                         // divider
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }

    if (bkTab === 'account') {
      // Row 4: ═
      { const ay = BOX_Y + 4; border(ay);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

      const dep  = state.bank.deposit;
      const card = state.bank.card;
      const rIdx = getBankRatingIdx();
      const rTier = RATING_TIERS[rIdx];
      const rCol  = getRatingColor(rTier);

      // RATING section (rows 5-12)
      sbox_top(BOX_Y + 5, 0);
      { const hist = state.bank.ratingHistory;
        const last2 = hist.slice(-2);
        srow(BOX_Y + 6,  ` Rating: ${rTier.padEnd(5)} Score: ${state.bank.creditRatingScore.toFixed(1)}/10`, rCol, 1);
        const statusWord = rIdx >= 9 ? 'EXCELLENT' : rIdx >= 7 ? 'GOOD' : rIdx >= 5 ? 'FAIR' : rIdx >= 3 ? 'BUILDING' : 'POOR';
        srow(BOX_Y + 7,  ` Status: ${statusWord}`, rCol, 2);
        srow(BOX_Y + 8,  ' Improves: on-time payments, low balance', '#555555', 3);
        srow(BOX_Y + 9,  ' Drops from: missed payments, high utilization', '#555555', 4);
        if (last2.length === 0) {
          srow(BOX_Y + 10, ' No history yet.', DC, 5);
          srow(BOX_Y + 11, '', BRIGHT_WHITE, 6);
        } else {
          last2.forEach((e, i) => {
            const up = RATING_TIERS.indexOf(e.to) > RATING_TIERS.indexOf(e.from);
            const delta = (up ? '+' : '') + (e.reason.match(/[+-]\d/) || [''])[0];
            srow(BOX_Y + 10 + i, `  D${e.day}: ${e.reason.substring(0,20).padEnd(20)} ${e.from}→${e.to}`, up ? TC : '#ff5555', 5 + i);
          });
          if (last2.length < 2) srow(BOX_Y + 11, '', BRIGHT_WHITE, 6);
        }
      }
      sbox_bot(BOX_Y + 12, 7);

      // DEPOSITS section (rows 13-20)
      sbox_top(BOX_Y + 13, 8);
      { const availDep = Math.max(0, state.player.gold - 10);
        const projected = Math.round(dep * 0.10 * 10) / 10;
        srow(BOX_Y + 14, ` Balance:  ${formatCredits(dep)}g`, dep > 0 ? '#ffd633' : DC, 9);
        srow(BOX_Y + 15, ' Rate:     10.0% / day', TC, 10);
        srow(BOX_Y + 16, ` Tomorrow: +${formatCredits(projected)}g projected`, dep > 0 ? TC : DC, 11);
        srow(BOX_Y + 17, '', BRIGHT_WHITE, 12);
        srow(BOX_Y + 18, ` 1. Deposit all  ${availDep > 0 ? `[+${formatCredits(availDep)}g]` : '[need >10g]'}`, availDep > 0 ? TC : DC, 13);
        srow(BOX_Y + 19, ` 2. Custom amount  3. Withdraw all`, dep > 0 ? TC : DC);
      }
      sbox_bot(BOX_Y + 20);

      // CARD STATUS section (rows 21-28)
      sbox_top(BOX_Y + 21);
      if (!card.tier) {
        srow(BOX_Y + 22, ' No card. See CARDS tab to apply.', DC);
        for (let r = 23; r <= 27; r++) srow(BOX_Y + r, '', BRIGHT_WHITE);
      } else {
        const tierDef = CARD_TIERS[card.tier];
        const tCol    = getCardTierColor(card.tier);
        const pct     = card.limit > 0 ? Math.round(card.balance / card.limit * 100) : 0;
        const balFg   = pct > 80 ? '#ff5555' : pct > 50 ? '#ff9933' : '#ffd633';
        srow(BOX_Y + 22, ` Card:    ${card.tier.toUpperCase()} ACTIVE`, tCol);
        srow(BOX_Y + 23, ` Balance: ${formatCredits(card.balance)}g / ${card.limit}g  (${pct}%)`, balFg);
        const minPay = card.minimumPaymentDue;
        if (minPay > 0) {
          srow(BOX_Y + 24, ` Due:     ${formatCredits(minPay)}g by day ${card.paymentDueDay}`, state.day >= card.paymentDueDay ? '#ff5555' : DC);
        } else {
          srow(BOX_Y + 24, ' No payment due.', DC);
        }
        const can4 = minPay > 0 && state.player.gold >= minPay;
        const can5 = card.balance > 0 && state.player.gold > 0;
        const can6 = card.balance > 0 && state.player.gold > 0;
        srow(BOX_Y + 25, '', BRIGHT_WHITE);
        srow(BOX_Y + 26, ` 4. Pay min (${formatCredits(minPay)}g)  5. Pay full  6. Pre-pay`, can4||can5||can6 ? tCol : DC);
        srow(BOX_Y + 27, ' → Press → for CARDS tab details', DC);
      }
      sbox_bot(BOX_Y + 28);

      // Row 29: ═
      { const ay = BOX_Y + 29; border(ay);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

      // Row 30: status
      { const ay = BOX_Y + 30; border(ay);
        const msgs = [
          [10, 'You have reached the pinnacle.',              '#ffffff'],
          [9,  'Your credit is impeccable.',                  '#ffd633'],
          [8,  'You are a preferred customer.',               '#aaffaa'],
          [7,  'Your account is in good standing.',           TC],
          [6,  'Your account is in good standing.',           TC],
          [5,  'Your account is in good standing.',           TC],
          [4,  'Build your history for better products.',     DC],
          [3,  'Build your history to access products.',      DC],
          [2,  'Your rating needs attention.',                '#ff9933'],
          [1,  'Your rating needs attention.',                '#ff9933'],
          [0,  'No services available at this time.',         '#ff5555'],
        ];
        const [, txt, fc] = msgs.find(([min]) => rIdx >= min) ?? msgs[msgs.length - 1];
        const pad = menuPad(' '.repeat(Math.floor((IW - txt.length) / 2)) + txt, IW);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, pad[i] || ' ', fc, BG);
      }

    } else {
      // CARDS tab

      // Row 4: card page navigator
      { const ay = BOX_Y + 4; border(ay);
        let cx = BOX_X + 1;
        const labels = ['BRONZE','SILVER','GOLD','BLACK'];
        const prefix = '[ < '; const suffix = ' > ]';
        for (const ch of prefix) { display.draw(cx++, ay, ch, DC, BG); }
        labels.forEach((lbl, i) => {
          const sep = i > 0 ? '   ' : '';
          for (const ch of sep) display.draw(cx++, ay, ch, DC, BG);
          const col = i === cardPage ? getCardTierColor(CARD_TIER_ORDER[i]) : DC;
          for (const ch of lbl) display.draw(cx++, ay, ch, col, BG);
        });
        for (const ch of suffix) { display.draw(cx++, ay, ch, DC, BG); }
        while (cx < BOX_X + 1 + IW) display.draw(cx++, ay, ' ', BRIGHT_WHITE, BG);
      }

      // Card page content (rows 5-28)
      const tierName = CARD_TIER_ORDER[cardPage];
      const tierDef  = CARD_TIERS[tierName];
      const tCol     = tierDef.color;
      const tLbl     = tierDef.labelColor;
      const rScore   = state.bank.creditRatingScore;
      const qualified = rScore >= tierDef.requiresScore;
      const dimc = (c) => qualified ? c : DC;

      // Card art (rows 5-11, centered, 32 wide)
      const ART_W   = 32;
      const ART_OFF = Math.floor((IW - ART_W) / 2);
      const artBorder = qualified ? tCol : '#222222';
      const artText   = qualified ? tLbl : '#333333';
      { const rows = [
          '.' + '─'.repeat(30) + '.',
          `│  ★  W I D G E T E R         │`,
          `│     ${tierName.toUpperCase().padEnd(6)} CARD             │`,
          '│                              │',
          '│  **** **** **** 4892         │',
          '│  VALID THRU  ∞  WIDGETR      │',
          "'" + '─'.repeat(30) + "'",
        ];
        rows.forEach((row, ri) => {
          const ay = BOX_Y + 5 + ri;
          border(ay);
          for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, ' ', BRIGHT_WHITE, BG);
          for (let i = 0; i < ART_W && i < row.length; i++) {
            const ch = row[i];
            let fg = artBorder;
            if (ri >= 1 && ri <= 5 && i > 0 && i < ART_W - 1) {
              if (ri === 1 && i >= 5 && i <= 20) fg = artText; // WIDGETER
              else if (ri === 2 && i >= 5 && i <= 20) fg = artText; // tier name
              else if (ri === 4 && i >= 3) fg = '#555555';          // card number
              else if (ri === 5) fg = '#555555';                     // valid thru
              else fg = artBorder;
            }
            if (ch === '│' || ch === '.' || ch === "'" || ch === '─') fg = artBorder;
            display.draw(BOX_X + 1 + ART_OFF + i, ay, ch, fg, BG);
          }
        });
      }

      // Special: Black card when not at S
      if (tierName === 'black' && rScore < 10) {
        for (let r = 12; r <= 28; r++) irow(BOX_Y + r, '', BRIGHT_WHITE);
        irow(BOX_Y + 18, 'By invitation only.', DC);
      } else {
        // Card details (rows 12-28)
        const sepLine = '─'.repeat(IW);
        irow(BOX_Y + 12, tierName.toUpperCase() + ' CARD', dimc(tLbl));
        irow(BOX_Y + 13, sepLine, DC);
        if (tierDef.tagline) irow(BOX_Y + 14, `"${tierDef.tagline}"`, dimc(DC));
        else irow(BOX_Y + 14, '', BRIGHT_WHITE);
        irow(BOX_Y + 15, '', BRIGHT_WHITE);
        irow(BOX_Y + 16, `Credit Limit:    ${tierDef.limit}g`, dimc(BRIGHT_WHITE));
        irow(BOX_Y + 17, `Interest Rate:   ${(tierDef.interestRate * 100).toFixed(0)}% per statement`, dimc(BRIGHT_WHITE));
        irow(BOX_Y + 18, `Statement Cycle: Every ${tierDef.cycle} days`, dimc(BRIGHT_WHITE));
        irow(BOX_Y + 19, `Min. Rating:     ${RATING_TIERS[tierDef.requiresScore]}`, dimc(BRIGHT_WHITE));
        irow(BOX_Y + 20, '', BRIGHT_WHITE);
        irow(BOX_Y + 21, 'PERKS:', dimc(tCol));
        const perkGlyph = tierName === 'black' ? '▪' : '✦';
        tierDef.perks.forEach((p, i) => {
          irow(BOX_Y + 22 + i, `${perkGlyph} ${p}`, dimc('#aaaaaa'));
        });
        for (let r = 22 + tierDef.perks.length; r <= 26; r++) irow(BOX_Y + r, '', BRIGHT_WHITE);

        // Action button (row 27)
        const curTIdx = state.bank.card.tier ? CARD_TIER_ORDER.indexOf(state.bank.card.tier) : -1;
        const thisTIdx = CARD_TIER_ORDER.indexOf(tierName);
        let actionText, actionColor;
        if (!qualified) {
          actionText = `[REQUIRES ${RATING_TIERS[tierDef.requiresScore]} RATING]`; actionColor = DC;
        } else if (curTIdx === thisTIdx) {
          actionText = '[ACTIVE ✓]'; actionColor = TC;
        } else if (curTIdx > thisTIdx) {
          actionText = '[DOWNGRADE — N/A]'; actionColor = DC;
        } else {
          actionText = curTIdx < 0 ? '[4. APPLY — FREE]' : '[4. UPGRADE — CONFIRM]';
          actionColor = tCol;
        }
        irow(BOX_Y + 27, actionText, actionColor);
        irow(BOX_Y + 28, '', BRIGHT_WHITE);
      }

      // Row 29: ═
      { const ay = BOX_Y + 29; border(ay);
        for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

      // Row 30: status
      const statusTxt = !qualified ? `Unlock at ${RATING_TIERS[tierDef.requiresScore]} rating.` : `TAB to browse  4 to apply/upgrade`;
      irow(BOX_Y + 30, ' '.repeat(Math.floor((IW - statusTxt.length) / 2)) + statusTxt, qualified ? DC : '#444444');
    }

    // Row 31: ╚═╝
    display.draw(BOX_X, BOX_Y + 31, '╚', TC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y + 31, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + 31, '═', TC, BG);
  }

  bankMenuRedrawFn = redraw;
  redraw();

  function closeBank() {
    bankMenuRedrawFn = null;
    window.removeEventListener('keydown', bankKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    // Arm upgrade log sequence if one was queued during this session
    if (state.bank.upgradeLogQueue && state.bank.upgradeLogQueue.length > 0) {
      state.bank.upgradeLogLastFired = Date.now();
    }
    state.gameState = 'playing';
  }

  function bankKeyHandler(e) {
    if (e.key === 'Escape') { closeBank(); return; }
    // Left/right arrows: switch between top-level ACCOUNT / CARDS tabs only
    if (e.key === 'ArrowLeft')  {
      if (bkTab === 'cards') { bkTab = 'account'; state.bank.tab = 'account'; redraw(); }
      return;
    }
    if (e.key === 'ArrowRight') {
      if (bkTab === 'account') { bkTab = 'cards'; state.bank.tab = 'cards'; redraw(); }
      return;
    }
    // TAB: cycle card pages only while on the CARDS tab
    if (e.key === 'Tab') {
      e.preventDefault();
      if (bkTab === 'cards') {
        cardPage = (cardPage + 1) % 4;
        state.bank.cardPage = CARD_TIER_ORDER[cardPage];
        redraw();
      }
      return;
    }

    const dep  = state.bank.deposit;
    const card = state.bank.card;

    if (bkTab === 'account') {
      if (e.key === '1') {
        const amt = Math.max(0, state.player.gold - 10);
        if (amt <= 0) return;
        state.bank.deposit   = Math.round((state.bank.deposit + amt) * 10) / 10;
        state.player.gold = 10;
        addLog(`Deposited ${formatCredits(amt)}g.`, TC);
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '2') {
        const maxDep = Math.max(0, state.player.gold - 10);
        if (maxDep <= 0) return;
        window.removeEventListener('keydown', bankKeyHandler);
        bankMenuRedrawFn = null;
        showNumericPrompt('Deposit Amount', maxDep,
          (val) => { state.bank.deposit = Math.round((state.bank.deposit + val) * 10) / 10; state.player.gold -= val; addLog(`Deposited ${formatCredits(val)}g.`, TC); drawStatusBar(); openBankMenu(); },
          () => openBankMenu());
        return;
      }
      if (e.key === '3') {
        if (dep <= 0) return;
        state.player.gold = Math.round((state.player.gold + dep) * 10) / 10;
        state.bank.deposit   = 0;
        addLog(`Withdrew ${formatCredits(dep)}g.`, TC);
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '4' && card.tier) {
        const minPay = card.minimumPaymentDue;
        if (minPay <= 0) return;
        const pay = Math.min(minPay, state.player.gold);
        if (pay <= 0) return;
        state.player.gold   = Math.round((state.player.gold - pay) * 10) / 10;
        card.balance           = Math.round((card.balance - pay) * 10) / 10;
        card.minimumPaymentDue = Math.max(0, Math.round((card.minimumPaymentDue - pay) * 10) / 10);
        if (card.minimumPaymentDue === 0) {
          if (cardTierAtLeast('gold')) {
            card.consecutiveGoldPayments = (card.consecutiveGoldPayments || 0) + 1;
            if (card.consecutiveGoldPayments >= 3) {
              changeRating(+1.0, 'Three consecutive Gold payments');
              card.consecutiveGoldPayments = 0;
            }
          }
          changeRating(+0.5, 'Card payment made on time');
        }
        addLog(`Card payment: ${formatCredits(pay)}g paid.`, getCardTierColor(card.tier));
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '5' && card.tier) {
        if (card.balance <= 0 || state.player.gold <= 0) return;
        const pay = Math.min(card.balance, state.player.gold);
        state.player.gold = Math.round((state.player.gold - pay) * 10) / 10;
        card.balance         = Math.round((card.balance - pay) * 10) / 10;
        if (card.minimumPaymentDue > 0 && card.balance <= 0) {
          card.minimumPaymentDue = 0;
          changeRating(+0.5, 'Card balance paid in full');
        }
        addLog(`Card payment: ${formatCredits(pay)}g. Remaining: ${formatCredits(card.balance)}g.`, getCardTierColor(card.tier));
        drawStatusBar(); redraw(); return;
      }
      if (e.key === '6' && card.tier) {
        if (card.balance <= 0) { addLog('Card balance is zero.', '#555555'); return; }
        if (state.player.gold <= 0) { addLog('No gold to pre-pay with.', '#ff5555'); return; }
        const maxPre = Math.min(card.balance, state.player.gold);
        window.removeEventListener('keydown', bankKeyHandler);
        bankMenuRedrawFn = null;
        showNumericPrompt(`Pre-pay card (max ${formatCredits(maxPre)}g)`, Math.floor(maxPre),
          (val) => {
            if (val <= 0) { openBankMenu(); return; }
            const actual = Math.min(val, maxPre);
            state.player.gold = Math.round((state.player.gold - actual) * 10) / 10;
            card.balance       = Math.round((card.balance - actual) * 10) / 10;
            changeRating(+0.1, 'Card pre-payment');
            addLog(`Pre-paid ${formatCredits(actual)}g on card. Score improved.`, getCardTierColor(card.tier));
            drawStatusBar(); openBankMenu();
          },
          () => openBankMenu());
        return;
      }
    } else {
      // CARDS tab
      const tierName = CARD_TIER_ORDER[cardPage];
      const tierDef  = CARD_TIERS[tierName];
      if (e.key === '4') {
        const rScore   = state.bank.creditRatingScore;
        if (rScore < tierDef.requiresScore) return;
        const curTIdx  = card.tier ? CARD_TIER_ORDER.indexOf(card.tier) : -1;
        const thisTIdx = CARD_TIER_ORDER.indexOf(tierName);
        if (curTIdx >= thisTIdx) return; // can't downgrade or re-apply
        // Apply or upgrade
        card.tier         = tierName;
        card.limit        = tierDef.limit;
        card.interestRate = tierDef.interestRate;
        card.statementCycle = tierDef.cycle;
        if (curTIdx < 0) card.lastStatementDay = state.day; // fresh card
        if (tierName === 'black') card.insuranceBalance = 10000;
        card.upgradeNotified[tierName] = false; // reset so future upgrades still notify
        if (tierName === 'bronze') {
          // Bronze has no inherited perk sequence — just confirm immediately
          addLog(`BRONZE card issued. Limit: ${tierDef.limit}g. Interest: ${(tierDef.interestRate*100).toFixed(0)}%/statement.`, tierDef.color);
        } else {
          // Queue the perk-inheritance announcement sequence (fires after bank closes)
          state.bank.upgradeLogQueue   = getUpgradeLogLines(tierName);
          state.bank.upgradeLogLastFired = 0; // armed when closeBank fires
        }
        if (curTIdx >= 0) changeRating(+0.5, `Upgraded to ${tierName.toUpperCase()} card`);
        drawStatusBar(); redraw();
      }
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
  line(6,  `Peak gold:    ${state.peakCredits}g`, '#ffd633');
  line(7,  `Total earned:    ${state.lifetimeGoldEarned}g`, '#ffd633');
  line(9,  `Outstanding debt: ${state.debt > 0 ? state.debt.toFixed(1) : 0}g`, RC);
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
let lfChyronFn         = null;
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
let casinoMenuCloseFn   = null;

function checkAbstractionCollapse() {
  if (state.endingTriggered || (state.terminal?.totalPnL ?? state.derivatives.totalPnL) < 50000) return;
  state.endingTriggered = true;
  state.gameState = 'ending';
  saveGame();
  addLog('The numbers have stopped meaning anything.', '#cc66cc');
  setTimeout(() => addLog('Your widgets. Your gold. Your contracts. All of it — weightless.', '#cc66cc'), 3000);
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
    "You started with a workbench and ten gold.",
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

// ── Derivatives Terminal (§5.5) — redesigned grid UI ────────────────────────

// INSTRUMENTS definition: 4×2 grid
const INSTRUMENTS = [
  { key: 'fwd_buy',  name: 'BUY FORWARD',  desc1: 'Lock in a SELL', desc2: 'price for future', settle: 'DELIVERABLE', phase: 3, row: 0, col: 0 },
  { key: 'fwd_sell', name: 'SELL FORWARD', desc1: 'Lock in a BUY',  desc2: 'price for future', settle: 'DELIVERABLE', phase: 3, row: 0, col: 1 },
  { key: 'fut_long', name: 'BUY FUTURE',   desc1: 'Bet price goes', desc2: 'UP (cash settled)', settle: 'CASH SETTLED', phase: 4, row: 0, col: 2 },
  { key: 'fut_short',name: 'SELL FUTURE',  desc1: 'Bet price goes', desc2: 'DOWN (cash sett.)',settle: 'CASH SETTLED', phase: 4, row: 0, col: 3 },
  { key: 'call_buy', name: 'BUY CALL',     desc1: 'Right to profit', desc2: 'if price goes UP', settle: 'CASH SETTLED', phase: 4, row: 1, col: 0 },
  { key: 'call_sell',name: 'SELL CALL',    desc1: 'Sell right, risk', desc2: 'if price UP',     settle: 'CASH SETTLED', phase: 4, row: 1, col: 1 },
  { key: 'put_buy',  name: 'BUY PUT',      desc1: 'Right to profit', desc2: 'if price DOWN',   settle: 'CASH SETTLED', phase: 4, row: 1, col: 2 },
  { key: 'put_sell', name: 'SELL PUT',     desc1: 'Sell right, risk', desc2: 'if price DOWN',  settle: 'CASH SETTLED', phase: 4, row: 1, col: 3 },
];

function openDerivativesMenu() {
  if (!state.stations.terminal?.unlocked) return;
  state.gameState = 'dv_menu';
  const TC = '#cc66cc', DC = '#333333', WC = '#555555', LC = '#ffffff';
  const BOX_W = 70, BOX_H = 38, IW = 68, AW = 0;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CONT_X = BOX_X + 1;
  const CELL_W = 17; // IW / 4 = 17 chars per cell
  const CELL_H = 7;  // rows per grid cell

  let dvTab = 'trade'; // 'trade' | 'positions'
  let selInst = -1;    // -1 = none; 0-7 = instrument index
  // Form values
  let fQty = 10, fLockPrice = 0, fDays = 2, fStrike = 0;
  let formFocus = 0; // 0=qty, 1=price/strike, 2=days

  function r10(n) { return Math.round(n * 10) / 10; }
  function pnlFg(v) { return v > 0 ? '#66cc66' : v < 0 ? '#ff5555' : WC; }
  function pStr(v) { return (v >= 0 ? '+' : '') + r10(v); }

  function volLabel() {
    const v = state.volatility;
    if (v > 0.25) return 'HIGH';
    if (v > 0.15) return 'MEDIUM';
    return 'LOW';
  }

  function border(ay) {
    display.draw(BOX_X, ay, '║', TC, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', TC, BG);
  }
  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, p[i] || ' ', fg, BG);
  }
  function sep(ay) { irow(ay, '─'.repeat(IW), DC); }

  function drawFrame() {
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', LC, BG);
    display.draw(BOX_X, BOX_Y, '╔', TC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', TC, BG);
    { const ay = BOX_Y + 1; border(ay);
      const title = 'DERIVATIVES TERMINAL', hint = 'esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i-(IW-hint.length)] : ' ');
        display.draw(CONT_X + i, ay, ch, i < title.length ? LC : DC, BG);
      }
    }
    { const ay = BOX_Y + 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, '═', DC, BG); }
    { const ay = BOX_Y + 3; border(ay);
      const HALF = Math.floor(IW / 2);
      const tL = dvTab === 'trade'     ? '>> [ NEW TRADE ] <<' : '[ NEW TRADE ]';
      const tR = dvTab === 'positions' ? '>> [ POSITIONS ] <<' : '[ POSITIONS ]';
      const lPad = Math.floor((HALF - tL.length) / 2);
      const rPad = Math.floor((IW - HALF - tR.length) / 2);
      const left  = ' '.repeat(lPad) + tL + ' '.repeat(Math.max(0, HALF - tL.length - lPad));
      const right = ' '.repeat(rPad) + tR + ' '.repeat(Math.max(0, IW - HALF - tR.length - rPad));
      for (let i = 0; i < IW; i++) {
        const inLeft = i < HALF;
        const ch = (inLeft ? left[i] : right[i - HALF]) || ' ';
        display.draw(CONT_X + i, ay, ch, (inLeft && dvTab === 'trade') || (!inLeft && dvTab === 'positions') ? TC : '#555555', BG);
      }
    }
    { const ay = BOX_Y + 4; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, '═', DC, BG); }
    display.draw(BOX_X, BOX_Y + BOX_H - 1, '╚', TC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y + BOX_H - 1, '╝', TC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y + BOX_H - 1, '═', TC, BG);
  }

  // Draw a 17-wide × 7-tall instrument cell
  function drawCell(inst, gridRow, gridCol, selected) {
    const cx = CONT_X + gridCol * CELL_W;
    const cy = BOX_Y + 5 + gridRow * CELL_H;
    const locked = inst.phase > state.phase;
    const cellTC = locked ? '#333333' : (selected ? '#ffffff' : TC);
    const cellBC = locked ? '#1a1a1a' : (selected ? '#2a1a2a' : BG);
    const labelFg = locked ? '#444444' : (selected ? '#ffffff' : '#ccaacc');
    const textFg  = locked ? '#333333' : (selected ? '#ccaacc' : WC);
    const W = CELL_W;
    // Top border
    display.draw(cx, cy, '┌', cellTC, cellBC);
    for (let i = 1; i < W-1; i++) display.draw(cx+i, cy, '─', cellTC, cellBC);
    display.draw(cx+W-1, cy, '┐', cellTC, cellBC);
    // Middle rows
    const name = inst.name.slice(0, W-4).padEnd(W-4);
    const nameStr = ' ' + name + ' ';
    for (let i = 0; i < W; i++) {
      const ch = i === 0 ? '│' : (i === W-1 ? '│' : (nameStr[i] || ' '));
      const fg = i === 0 || i === W-1 ? cellTC : labelFg;
      display.draw(cx+i, cy+1, ch, fg, cellBC);
    }
    const desc1 = inst.desc1.slice(0,W-4).padEnd(W-4);
    const desc2 = inst.desc2.slice(0,W-4).padEnd(W-4);
    for (let row = 2; row <= 3; row++) {
      const dStr = row === 2 ? desc1 : desc2;
      display.draw(cx, cy+row, '│', cellTC, cellBC);
      for (let i = 1; i < W-1; i++) display.draw(cx+i, cy+row, (i <= dStr.length ? dStr[i-1] : ' ') || ' ', textFg, cellBC);
      display.draw(cx+W-1, cy+row, '│', cellTC, cellBC);
    }
    // Phase locked indicator or blank row
    display.draw(cx, cy+4, '│', cellTC, cellBC);
    if (locked) {
      const lk = 'PHASE ' + inst.phase;
      for (let i = 1; i < W-1; i++) display.draw(cx+i, cy+4, lk[i-1] || ' ', '#444444', cellBC);
    } else {
      for (let i = 1; i < W-1; i++) display.draw(cx+i, cy+4, ' ', textFg, cellBC);
    }
    display.draw(cx+W-1, cy+4, '│', cellTC, cellBC);
    // Settlement row
    const settle = inst.settle.slice(0,W-4).padEnd(W-4);
    display.draw(cx, cy+5, '│', cellTC, cellBC);
    for (let i = 1; i < W-1; i++) display.draw(cx+i, cy+5, settle[i-1] || ' ', locked ? '#333333' : '#888888', cellBC);
    display.draw(cx+W-1, cy+5, '│', cellTC, cellBC);
    // Bottom border
    display.draw(cx, cy+6, '└', cellTC, cellBC);
    for (let i = 1; i < W-1; i++) display.draw(cx+i, cy+6, '─', cellTC, cellBC);
    display.draw(cx+W-1, cy+6, '┘', cellTC, cellBC);
    // Key label at top-left corner
    const keyNum = String(INSTRUMENTS.indexOf(inst) + 1);
    display.draw(cx+1, cy, keyNum, locked ? '#444444' : '#ffd633', cellBC);
  }

  function drawTradeGrid() {
    // Draw 4×2 grid of cells
    for (let i = 0; i < INSTRUMENTS.length; i++) {
      const inst = INSTRUMENTS[i];
      drawCell(inst, inst.row, inst.col, selInst === i);
    }
    // Info below grid (rows 19+)
    const infoBase = BOX_Y + 5 + 2 * CELL_H; // row 19
    for (let r = infoBase; r < BOX_Y + BOX_H - 2; r++) {
      border(r);
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, r, ' ', LC, BG);
    }
    const spot = state.marketPrice;

    if (selInst < 0) {
      // No selection — show market context
      irow(infoBase,     `  Today: ${state.day}   Market: ${spot}g   Vol: ${Math.round(state.volatility*100)}% (${volLabel()})   Phase: ${state.phase}`, WC);
      irow(infoBase + 1, `  1-4: Row 1 instruments   5-8: Row 2   ←→: switch tabs   ESC: exit`, DC);
      const pos = state.terminal.positions;
      if (pos.length > 0) {
        irow(infoBase + 3, `  Open positions: ${pos.length}   Use POSITIONS tab to manage.`, '#aaaaaa');
      }
    } else {
      drawInstrumentForm(infoBase);
    }
    // Footer
    { const ay = BOX_Y + BOX_H - 2; border(ay);
      for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, '═', DC, BG); }
    const footHint = selInst >= 0
      ? '  ↑↓: adjust quantity   ←→: adjust price   ENTER: confirm   ESC: cancel'
      : '  1-8: select instrument   ←→: switch tabs   ESC: exit';
    irow(BOX_Y + BOX_H - 2, footHint, DC);
  }

  function drawInstrumentForm(baseRow) {
    const inst = INSTRUMENTS[selInst];
    const spot = r10(state.marketPrice);
    if (!fLockPrice) fLockPrice = spot;
    if (!fStrike) fStrike = spot;

    irow(baseRow,     `  ${inst.name}  —  ${inst.desc1} ${inst.desc2}`, TC);
    irow(baseRow + 1, `  Today: ${spot}g  |  Vol: ${Math.round(state.volatility*100)}% ${volLabel()}  |  Day ${state.day}`, WC);
    sep(baseRow + 2);

    const isForward = inst.key.startsWith('fwd');
    const isFuture  = inst.key.startsWith('fut');
    const isOption  = inst.key.startsWith('call') || inst.key.startsWith('put');

    if (isForward) {
      const lockP = r10(fLockPrice || spot);
      const days  = Math.max(1, fDays);
      const delDay = state.day + days;
      const fee   = r10(lockP * fQty * 0.10);
      irow(baseRow + 3, `  Lock price:  ${lockP}g  [↑↓ ±0.5]         [focused: ${formFocus===1?'PRICE':'---'}]`, formFocus === 1 ? '#ffd633' : LC);
      irow(baseRow + 4, `  Quantity:    ${fQty} widgets  [←→ ±10]   [focused: ${formFocus===0?'QTY':'---'}]`,  formFocus === 0 ? '#ffd633' : LC);
      irow(baseRow + 5, `  Delivery:    Day ${delDay} (+${days})  [TAB ±1 day]`, LC);
      irow(baseRow + 6, `  Lock-in fee: ${fee}g (10%)`, '#aaaaaa');
      sep(baseRow + 7);
      // Profit scenarios
      irow(baseRow + 8, `  ─── Profit scenarios (lock=${lockP}g, qty=${fQty}) ───`, '#aaaaaa');
      const scenarios = [spot*0.6, spot*0.8, spot, spot*1.2, spot*1.4, spot*1.6].map(r10);
      let sr = baseRow + 9;
      for (const sc of scenarios) {
        const net = inst.key === 'fwd_buy' ? r10((lockP - sc) * fQty - fee) : r10((sc - lockP) * fQty - fee);
        const arr = net > 0 ? '▲' : net < 0 ? '▼' : '─';
        irow(sr++, `    market ${String(sc+'g').padEnd(7)}  you get ${lockP}g   net: ${pStr(net)}g ${arr}`, pnlFg(net));
      }
    } else if (isFuture) {
      const marg = r10(spot * fQty * 0.10);
      const canOpen = state.player.gold >= marg || (state.bank?.card?.tier && (state.bank.card.limit - state.bank.card.balance) >= marg);
      irow(baseRow + 3, `  Direction:   ${inst.key === 'fut_long' ? 'LONG (profit if UP)' : 'SHORT (profit if DOWN)'}`, TC);
      irow(baseRow + 4, `  Size:        ${fQty} widgets  [←→ ±10]`, LC);
      irow(baseRow + 5, `  Entry price: ${spot}g (current)`, LC);
      irow(baseRow + 6, `  Margin:      ${marg}g (10%)  ${canOpen ? '' : '[NOT ENOUGH GOLD]'}`, canOpen ? '#aaaaaa' : '#ff5555');
      sep(baseRow + 7);
      irow(baseRow + 8, `  ─── P&L scenarios (entry=${spot}g, qty=${fQty}) ───`, '#aaaaaa');
      const scenarios = [spot*0.6, spot*0.8, spot, spot*1.2, spot*1.4, spot*1.6].map(r10);
      let sr = baseRow + 9;
      for (const sc of scenarios) {
        const net = inst.key === 'fut_long' ? r10((sc - spot) * fQty) : r10((spot - sc) * fQty);
        const arr = net > 0 ? '▲' : net < 0 ? '▼' : '─';
        irow(sr++, `    market ${String(sc+'g').padEnd(7)}  daily MTM: ${pStr(net)}g ${arr}`, pnlFg(net));
      }
    } else if (isOption) {
      const isCall = inst.key.includes('call');
      const isBuy  = inst.key.includes('buy');
      const days   = Math.max(1, fDays);
      const strike = r10(fStrike || spot);
      const prem   = calcOptionPremium(isCall ? 'call' : 'put', strike, days);
      irow(baseRow + 3, `  Type:        ${isCall ? 'CALL' : 'PUT'} ${isBuy ? '(Buy — pay premium)' : '(Sell — receive premium)'}`, TC);
      irow(baseRow + 4, `  Strike:      ${strike}g  [↑↓ ±0.5]       Qty: ${fQty}  [←→ ±10]`, LC);
      irow(baseRow + 5, `  Expiry:      Day ${state.day + days} (+${days} days)  [TAB ±1]`, LC);
      irow(baseRow + 6, `  Premium:     ${prem}g/contract   Vol: ${volLabel()}`, '#aaaaaa');
      sep(baseRow + 7);
      irow(baseRow + 8, `  ─── P&L scenarios (${isCall?'CALL':'PUT'} @${strike}g, prem=${prem}g) ───`, '#aaaaaa');
      const scenarios = [spot*0.6, spot*0.8, spot, spot*1.2, spot*1.4, spot*1.6].map(r10);
      let sr = baseRow + 9;
      for (const sc of scenarios) {
        const payoff = isCall ? Math.max(0, sc - strike) : Math.max(0, strike - sc);
        const net = isBuy ? r10(payoff * fQty - prem * fQty) : r10(prem * fQty - payoff * fQty);
        const arr = net > 0 ? '▲' : net < 0 ? '▼' : '─';
        irow(sr++, `    market ${String(sc+'g').padEnd(7)}  payoff ${String(r10(payoff)+'g').padEnd(6)}  net: ${pStr(net)}g ${arr}`, pnlFg(net));
      }
    }
  }

  function drawPositions() {
    const pos = state.terminal.positions;
    const spot = state.marketPrice;
    const baseRow = BOX_Y + 5;
    // Header row
    irow(baseRow, '  #  Type         Qty    Entry/Lock  Expiry     P/L       Action', '#aaaaaa');
    sep(baseRow + 1);
    if (pos.length === 0) {
      irow(baseRow + 2, '  No open positions.', WC);
      irow(baseRow + 3, '  Use NEW TRADE tab to open contracts.', DC);
    } else {
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i];
        const row = baseRow + 2 + i;
        if (row >= BOX_Y + BOX_H - 4) { irow(row, `  ... ${pos.length - i} more positions`, DC); break; }
        let typeStr, entryStr, expiryStr, pnl, action;
        if (p.type === 'forward') {
          typeStr  = p.dir === 'buy' ? 'FWD SELL' : 'FWD BUY ';
          entryStr = `${p.lockPrice}g`;
          expiryStr = `Day ${p.deliveryDay}`;
          pnl      = p.dir === 'buy' ? r10((p.lockPrice - spot) * p.qty) : r10((spot - p.lockPrice) * p.qty);
          action   = '[locked]';
        } else if (p.type === 'future') {
          typeStr  = p.dir === 'long' ? 'LONG FUT' : 'SHORT FUT';
          entryStr = `${p.entryPrice}g`;
          expiryStr = 'daily';
          pnl      = p.dir === 'long' ? r10((spot - p.entryPrice) * p.qty) : r10((p.entryPrice - spot) * p.qty);
          action   = `[${i+1}x: close]`;
        } else {
          const isCall = p.optType === 'call';
          const isBuy  = p.side === 'buy';
          typeStr  = `${isCall ? 'CALL' : 'PUT'} ${isBuy ? 'BUY' : 'SELL'}`;
          entryStr = `@${p.strike}g`;
          expiryStr = `Day ${p.expiryDay}`;
          const payoff = isCall ? Math.max(0, spot - p.strike) : Math.max(0, p.strike - spot);
          pnl = isBuy ? r10(payoff * p.qty - p.premium * p.qty) : r10(p.premium * p.qty - payoff * p.qty);
          action   = `[${i+1}x: close]`;
        }
        const pnlStr = `${pStr(pnl)}g`;
        const arr = pnl > 0 ? '▲' : pnl < 0 ? '▼' : '─';
        const line = `  ${String(i+1).padEnd(2)} ${typeStr.slice(0,9).padEnd(9)}  ${String(p.qty).padEnd(5)}  ${entryStr.padEnd(10)}  ${expiryStr.padEnd(9)}  ${(pnlStr+' '+arr).padEnd(10)}  ${action}`;
        irow(row, line.slice(0, IW), pnlFg(pnl));
      }
    }
    sep(BOX_Y + BOX_H - 4);
    irow(BOX_Y + BOX_H - 3, `  Total realized PnL: ${pStr(state.terminal.totalPnL)}g   Today: ${pStr(state.terminal.pnlToday)}g`, WC);
    irow(BOX_Y + BOX_H - 2, '  [number + x] close position   ←→: switch tabs   ESC: exit', DC);
  }

  function redraw() {
    drawFrame();
    if (dvTab === 'trade') drawTradeGrid();
    else drawPositions();
  }

  function openPosition(inst) {
    const spot = r10(state.marketPrice);
    const pos = state.terminal.positions;
    const id = state.terminal._nextId++;

    if (inst.key.startsWith('fwd')) {
      const lockP = r10(fLockPrice || spot);
      const fee   = r10(lockP * fQty * 0.10);
      if (!payForItem(fee, false)) { redraw(); return; }
      const dir = inst.key === 'fwd_buy' ? 'buy' : 'sell';
      pos.push({ id, type: 'forward', dir, qty: fQty, lockPrice: lockP, deliveryDay: state.day + Math.max(1, fDays), openDay: state.day });
      addLog(`Forward opened: ${fQty}wg @ ${lockP}g, delivery day ${state.day + fDays}. Fee: ${fee}g.`, TC);
    } else if (inst.key.startsWith('fut')) {
      const marg = r10(spot * fQty * 0.10);
      const dir = inst.key === 'fut_long' ? 'long' : 'short';
      if (!payForItem(marg, false)) { redraw(); return; }
      pos.push({ id, type: 'future', dir, qty: fQty, entryPrice: spot, lastSettle: spot, marginHeld: marg, openDay: state.day });
      addLog(`Future opened: ${fQty} ${dir} at ${spot}g. Margin: ${marg}g.`, TC);
    } else {
      const isCall = inst.key.includes('call');
      const isBuy  = inst.key.includes('buy');
      const days   = Math.max(1, fDays);
      const strike = r10(fStrike || spot);
      const prem   = calcOptionPremium(isCall ? 'call' : 'put', strike, days);
      const optType = isCall ? 'call' : 'put';
      if (isBuy) {
        const totalPrem = r10(prem * fQty);
        if (!payForItem(totalPrem, false)) { redraw(); return; }
        pos.push({ id, type: 'option', optType, side: 'buy', qty: fQty, strike, premium: prem, expiryDay: state.day + days, marginHeld: 0, openDay: state.day });
        addLog(`Bought ${fQty} ${optType} @ strike ${strike}g exp day ${state.day+days}. Prem: ${r10(totalPrem)}g.`, TC);
      } else {
        const marg   = r10(prem * fQty * 3);
        const netRcv = r10(prem * fQty);
        const netCost = r10(marg - netRcv);
        if (!payForItem(netCost, false)) { redraw(); return; }
        state.player.gold = r10(state.player.gold + netRcv); // received premium back
        pos.push({ id, type: 'option', optType, side: 'sell', qty: fQty, strike, premium: prem, expiryDay: state.day + days, marginHeld: marg, openDay: state.day });
        addLog(`Written ${fQty} ${optType} @ strike ${strike}g. Net margin: ${netCost}g. Rcvd: ${netRcv}g.`, TC);
      }
    }
    drawStatusBar();
    selInst = -1;
    redraw();
  }

  function closePosition(idx) {
    const pos = state.terminal.positions;
    if (idx < 0 || idx >= pos.length) return;
    const p = pos[idx];
    const spot = r10(state.marketPrice);
    let pnl = 0;

    if (p.type === 'forward') {
      addLog('Forward contracts are locked until delivery day.', '#ff5555'); return;
    } else if (p.type === 'future') {
      pnl = p.dir === 'long' ? r10((spot - p.entryPrice) * p.qty) : r10((p.entryPrice - spot) * p.qty);
      state.player.gold = r10(state.player.gold + p.marginHeld + pnl);
      addLog(`Future closed. PnL: ${pStr(pnl)}g. Margin returned: ${p.marginHeld}g.`, pnlFg(pnl));
    } else {
      // Option
      const payoff = p.optType === 'call' ? Math.max(0, spot - p.strike) : Math.max(0, p.strike - spot);
      if (p.side === 'buy') {
        pnl = r10(payoff * p.qty - p.premium * p.qty);
        state.player.gold = r10(state.player.gold + payoff * p.qty);
      } else {
        pnl = r10(p.premium * p.qty - payoff * p.qty);
        state.player.gold = r10(state.player.gold + p.marginHeld - payoff * p.qty);
      }
      addLog(`Option closed. Payoff: ${r10(payoff * p.qty)}g. PnL: ${pStr(pnl)}g.`, pnlFg(pnl));
    }
    state.terminal.pnlToday   = r10(state.terminal.pnlToday + pnl);
    state.terminal.totalPnL   = r10(state.terminal.totalPnL + pnl);
    pos.splice(idx, 1);
    drawStatusBar();
    checkAbstractionCollapse();
    redraw();
  }

  dvMenuRedrawFn = redraw;
  redraw();

  function closeDV() {
    dvMenuRedrawFn = null;
    window.removeEventListener('keydown', dvKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  let closingPositionIdx = -1; // -1 = no close pending

  function dvKeyHandler(e) {
    if (e.key === 'Escape') {
      if (selInst >= 0) { selInst = -1; redraw(); return; }
      if (closingPositionIdx >= 0) { closingPositionIdx = -1; redraw(); return; }
      closeDV(); return;
    }
    // Tab switch
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      dvTab = dvTab === 'trade' ? 'positions' : 'trade';
      selInst = -1; closingPositionIdx = -1;
      redraw(); return;
    }

    if (dvTab === 'trade') {
      // Instrument selection
      if (selInst < 0) {
        const n = parseInt(e.key);
        if (n >= 1 && n <= 8) {
          const inst = INSTRUMENTS[n-1];
          if (inst.phase > state.phase) { addLog(`${inst.name} requires Phase ${inst.phase}.`, '#555555'); return; }
          selInst = n - 1;
          const spot = r10(state.marketPrice);
          fQty = 10; fLockPrice = spot; fStrike = spot; fDays = 2; formFocus = 0;
          redraw(); return;
        }
      } else {
        // In form — adjust values
        const inst = INSTRUMENTS[selInst];
        const isForward = inst.key.startsWith('fwd');
        const isFuture  = inst.key.startsWith('fut');
        const isOption  = inst.key.startsWith('call') || inst.key.startsWith('put');
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (formFocus === 0) fQty = Math.max(1, fQty + 10);
          else if (formFocus === 1) {
            if (isForward) fLockPrice = r10((fLockPrice || state.marketPrice) + 0.5);
            else if (isOption) fStrike = r10((fStrike || state.marketPrice) + 0.5);
          } else fDays = Math.max(1, fDays + 1);
          redraw(); return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (formFocus === 0) fQty = Math.max(1, fQty - 10);
          else if (formFocus === 1) {
            if (isForward) fLockPrice = r10(Math.max(0.5, (fLockPrice || state.marketPrice) - 0.5));
            else if (isOption) fStrike = r10(Math.max(0.5, (fStrike || state.marketPrice) - 0.5));
          } else fDays = Math.max(1, fDays - 1);
          redraw(); return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const maxFocus = (isForward || isOption) ? 2 : 1;
          formFocus = (formFocus + 1) % (maxFocus + 1);
          redraw(); return;
        }
        if (e.key === 'Enter') {
          openPosition(inst);
          return;
        }
      }
    } else {
      // POSITIONS tab
      const pos = state.terminal.positions;
      const n = parseInt(e.key);
      if (!isNaN(n) && n >= 1 && n <= pos.length) {
        if (closingPositionIdx === n - 1) {
          closePosition(n - 1); closingPositionIdx = -1;
        } else {
          closingPositionIdx = n - 1;
          addLog(`Press ${n} again to close position ${n}.`, '#aaaaaa');
          redraw();
        }
        return;
      }
    }
  }
  window.addEventListener('keydown', dvKeyHandler);
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

const CHANGELOG = [
  { version: '1.07.10', summary: 'Inventory revamp: 4x2 grid — carrying, storage, wallet, card, equipment, wardrobe, cooking, stats.' },
  { version: '1.07.09', summary: 'Terminal revamp: 4x2 grid, forwards at Phase 3, futures/options at Phase 4, profit scenarios, positions tab.' },
  { version: '1.07.08', summary: 'Garden is veggies-only. Kitchen cooking with 4 recipes for daily buffs. Veggies regrow.' },
  { version: '1.07.07', summary: 'Shift to pay on credit card anywhere. Pre-pay at bank. Apprentice credit toggle.' },
  { version: '1.07.06', summary: 'Loading Port at market — courier delivery, auto-sell at dawn, capacity upgrade.' },
  { version: '1.07.05', summary: 'Upgrades moved to home station menus. Office UPGRADES tab replaced with INFO stats.' },
  { version: '1.07.04', summary: 'Demand crash removed from phase trigger. Cheaper manipulations/aquatics. Courier wages. More outfits.' },
  { version: '1.07.03', summary: 'Credits renamed to gold. Clearer stamp text. Credit score explained. Office key legend.' },
  { version: '1.07.02', summary: 'Phase unlock popups, market dimming, mine log, cottage door, ASCII weather icons.' },
  { version: '1.07.01', summary: 'Bugfixes: escape/fullscreen, stamps, rain on menus, mine flicker, cottage exit.' },
  { version: '1.06.02', summary: 'Newspaper redesigned as full daily edition — market, weather, production, finance sections.' },
  { version: '1.06.01', summary: 'Weather system: clear, rain, fog, heat wave, storm. Affects demand, worker speed, crafting, mining.' },
  { version: '1.05.07', summary: 'RM storage used before buying. Storage RM shown in RM menu. Apprentices use storage first.' },
  { version: '1.05.06', summary: 'The Mine — enemy, bare hands limit, water shimmer, full-screen clear, station entrance, random discovery.' },
  { version: '1.05.05', summary: 'Phase tracker: green text, white flash on progress, bordered box on log area.' },
  { version: '1.05.03', summary: 'Phase tracker: brighter, all caps, green flash on progress.' },
  { version: '1.05.02', summary: 'Phase goal countdown tracker on hint row. Hint bar shortened.' },
  { version: '1.05.01', summary: 'The Mine — procedural cave dungeon with mining, 4 layouts, GS mining tab, inventory equip tab.' },
  { version: '1.04.02', summary: 'Rocket full message updated.' },
  { version: '1.04.01', summary: 'Major balance: rocket target reduced to 5,000. Bankruptcy stipend. Carry cost capped. Recycle widgets at RM shed. Phase 3 trigger raised.' },
  { version: '1.03.11', summary: 'Hammer animation extracted to hammer.js — 10 frames with anvil.' },
  { version: '1.03.10', summary: 'Workbench hammer animation -- 10 frames via sed (fifth attempt).' },
  { version: '1.03.09', summary: 'All menus updated to double-line border style.' },
  { version: '1.03.08', summary: 'Title menus restyled with cyan double-line borders, removed WIDGETER label.' },
  { version: '1.03.07', summary: 'Workbench 10-frame hammer animation (fourth attempt).' },
  { version: '1.03.06', summary: 'Pause menu widget art replaced with rotating cube and particles.' },
  { version: '1.03.05', summary: 'Workbench hammer animation replaced with 10-frame version.' },
  { version: '1.03.04', summary: 'Redesigned 10-frame workbench hammer animation with anvil and sparks.' },
  { version: '1.03.03', summary: 'Fixed numeric prompt disappearing. Redesigned workbench hammer animation.' },
  { version: '1.03.02', summary: 'Sound effects added: buy, sell, craft, click, start, new game.' },
  { version: '1.03.01', summary: 'Garden tab in General Store. Plant flowers and veggies. Eat veggies from your garden.' },
  { version: '1.02.08', summary: 'Desert expanded 30%. Dense jungle west of pond.' },
  { version: '1.02.07', summary: 'Changelog entries now word-wrap to multiple lines instead of being cut off.' },
  { version: '1.02.06', summary: 'Snow moved to top-right corner, added snowman.' },
  { version: '1.02.05', summary: 'New biomes: snow, rocks, marsh, pond beach, mushrooms, blue flowers.' },
  { version: '1.02.04', summary: 'Changelog menu visual fix — solid background, cyan theme.' },
  { version: '1.02.03', summary: 'Added changelog.' },
  { version: '1.02.02', summary: 'Fixed bank crash. Apprentices start faster, 5 speed levels.' },
  { version: '1.02.01', summary: 'Ending cutscene: liftoff, starfield, moon, credits.' },
  { version: '1.01.02', summary: 'Fixed overwrite menu overlap.' },
  { version: '1.01.01', summary: 'Launch Facility chyron, launch-ready state at 50K widgets.' },
  { version: '1.00.08', summary: 'Dev password persists. Unlock Everything button.' },
  { version: '1.00.07', summary: 'Title menu options: sound, fullscreen, dev mode.' },
  { version: '1.00.06', summary: 'Fixed rotating cube ghost dots.' },
  { version: '1.00.05', summary: 'Title screen layout centered.' },
  { version: '1.00.04', summary: 'Sparkle particles fully erased each frame.' },
  { version: '1.00.03', summary: 'Sparkle particle cap at 4.' },
  { version: '1.00.02', summary: 'Yellow title border. Game map keeps gray border.' },
  { version: '1.00.01', summary: 'Initial version numbering.' },
];

const CHYRON_MSGS = [
  'tightening o-rings...',
  'loading fuel into first chamber...',
  'screwing in carbonite windshield...',
  'calibrating gyroscope array...',
  'pressure testing fuel lines...',
  'welding heat shield plates...',
  'inspecting booster nozzles...',
  'loading freeze-dried rations...',
  'testing emergency abort system...',
  'charging backup battery cells...',
  'sealing cargo bay doors...',
  'aligning navigation computer...',
  'polishing the windshield...',
  'running pre-flight diagnostics...',
  'cross-referencing star charts...',
  'loading widget manifest...',
];

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

    if (state.rocketWidgets >= 5000) {
      rpt(4,  '', WC);
      rpt(5,  '', WC);
      rpt(6,  '╔══════════════════════════╗', RC);
      rpt(7,  '║                          ║', RC);
      rpt(8,  '║      ROCKET  READY       ║', '#ff5555');
      rpt(9,  '║                          ║', RC);
      rpt(10, '║     5,000 / 5,000        ║', '#ffd633');
      rpt(11, '║                          ║', RC);
      rpt(12, '╚══════════════════════════╝', RC);
      rpt(13, '', WC);
      rpt(14, '', WC);
      rpt(15, '═'.repeat(38), DC);
      rpt(16, '', WC);
      const blinkOn = Math.floor(Date.now() / 500) % 2 === 0;
      rpt(17, blinkOn ? '[ PRESS SPACE TO LAUNCH ]' : '', '#ff5555');
      rpt(18, '', WC);
      rpt(19, 'There is no coming back.', '#555555');
      return;
    }

    rpt(4,  'WIDGETS LOADED', WC);

    // Large digit display (rows 5-9, 5 rows tall)
    const rw     = Math.min(state.rocketWidgets, 5000);
    const numStr = rw.toLocaleString('en-US');
    const numFg  = rw >= 4500 ? '#ff5555' : rw >= 2500 ? '#ff9933' : '#ffd633';
    renderLargeNumber(display, RP, BOX_Y + 5, numStr, numFg, RW);

    rpt(10, '/ 5,000', WC);

    // Progress bar (row 12)
    const pct      = rw / 5000;
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
    const status = mktActive ? 'Selling widgets for gold.' : 'Loading the rocket.';
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

    // Row 21: chyron ticker
    drawChyron();
    // Row 22: ─ separator
    for (let i = 0; i < IW; i++) display.draw(BOX_X+1+i, BOX_Y+22, '─', DC, BG);

    drawRocket();
    drawRightPane();
  }

  // ── Chyron ticker (§9) ───────────────────────────────────────────────────────
  let chyronText = '', chyronOffset = 0, chyronTick = 0;

  function buildChyron() {
    const msgs = [];
    for (let i = 0; i < 4; i++)
      msgs.push(CHYRON_MSGS[Math.floor(Math.random() * CHYRON_MSGS.length)]);
    chyronText = msgs.join(' ··· ') + ' ··· ';
    chyronOffset = 0;
  }
  buildChyron();

  function drawChyron() {
    const ay = BOX_Y + 21;
    if (state.rocketWidgets >= 5000) {
      // Static ALL SYSTEMS GO at 5K
      const msg = 'ALL SYSTEMS GO';
      const pad = Math.floor((IW - msg.length) / 2);
      const line = ' '.repeat(pad) + msg;
      const p = menuPad(line, IW);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, p[i] || ' ', '#ff5555', BG);
      return;
    }
    if (state.rocketWidgets <= 0) {
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, ' ', BRIGHT_WHITE, BG);
      return;
    }
    for (let i = 0; i < IW; i++) {
      const ci = (chyronOffset + i) % chyronText.length;
      display.draw(BOX_X + 1 + i, ay, chyronText[ci] || ' ', '#555555', BG);
    }
    chyronTick++;
    if (chyronTick % 6 === 0) chyronOffset++;
    if (chyronOffset >= chyronText.length) buildChyron();
  }

  lfMenuRedrawFn = redraw;
  lfChyronFn     = drawChyron;
  redraw();

  function closeLF() {
    lfMenuRedrawFn = null;
    lfChyronFn     = null;
    window.removeEventListener('keydown', lfKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function lfKeyHandler(e) {
    if (e.key === 'Escape') { closeLF(); return; }
    if (e.key === ' ') {
      e.preventDefault();
      if (state.rocketWidgets >= 5000) {
        state.endingTriggered = true;
        closeLF();
        drawWorld();
        startEndingSequence();
      } else {
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
  const FC = '#2a2a1a', WC = '#886633'; // floor is · in #2a2a1a
  for (let x = 0; x < W; x++) {
    interiorTileMap[x] = [];
    for (let y = 0; y < H; y++) {
      const isBorder = x === 0 || x === W-1 || y === 0 || y === H-1 || y === 10;
      const isDoor   = y === 10 && x === 8; // door indicator at x=8
      interiorTileMap[x][y] = {
        walkable:    !isBorder,
        glyph:       isBorder ? (y===0||y===H-1 ? '═' : '║') : '·',
        fg:          isBorder ? WC : FC,
        description: isBorder ? (isDoor ? 'The way out. The world is still there.' : 'The cottage wall. It keeps the weather out.') : 'Wooden floorboards. They creak in the same spot every time.',
        furniture:   null,
      };
    }
  }
  // Fix border corners and door indicator glyph
  interiorTileMap[0][0].glyph    = '╔'; interiorTileMap[W-1][0].glyph    = '╗';
  interiorTileMap[0][H-1].glyph  = '╚'; interiorTileMap[W-1][H-1].glyph  = '╝';
  interiorTileMap[8][10].glyph   = '-'; // door - in row 10

  function stamp(x1, x2, y1, y2, key, glyph, fg, desc, walkable) {
    for (let x = x1; x <= Math.min(x2, 18); x++) {
      for (let y = y1; y <= Math.min(y2, 9); y++) {
        if (x < 1 || x > 18 || y < 1 || y > 9) continue;
        interiorTileMap[x][y] = { walkable, glyph: glyph[0]||'·', fg, description: desc, furniture: key };
      }
    }
  }
  const fur = state.cottage.furniture;
  if (fur.kitchen) {
    stamp(1,7, 1,3, 'kitchen', '┌', '#886633', 'A modest kitchen. Functional.', false);
    // Stove tile at (3,2) — walkable=false, interactive
    if (interiorTileMap[3] && interiorTileMap[3][2]) {
      interiorTileMap[3][2].glyph = 'π'; interiorTileMap[3][2].fg = '#ff6633';
      interiorTileMap[3][2].description = 'The stove. Press Space to cook.';
      interiorTileMap[3][2].furniture = 'stove';
    }
  }
  if (!fur.kitchen && false) { } // no-op
  if (fur.fireplace)    stamp(8,14,1,3, 'fireplace',    '╔', '#886633', 'A small fireplace. The warmth is real.', false);
  if (fur.bed)          stamp(12,18,1,4, 'bed',         '┌', '#6688cc', 'A small bed. Adequate.', false);
  if (fur.clock)        stamp(1,3, 2,4, 'clock',        '┌', '#aaaaaa', 'A wall clock. It keeps better time than you do.', false);
  if (fur.bookshelf)    stamp(14,18,2,5,'bookshelf',    '╔', '#886633', 'Shelves of records. Your history, such as it is.', false);
  if (fur.table)        stamp(7,13,3,5, 'table',        '┌', '#aa7744', 'A sturdy wooden table. Older than it looks.', false);
  if (fur.rockingchair) stamp(3,5, 5,8, 'rockingchair', '╭', '#aa7744', 'A rocking chair. It faces the fire.', false);
  if (fur.rug)          stamp(8,12,5,5, 'rug',          '▒', '#886633', 'A braided rug. It anchors the room.', true);
  if (fur.candles)      stamp(7,13,6,6, 'candles',      '║', '#ffd633', "Two candles. They've been burning a while.", true);
  if (fur.mat)          stamp(9,14,9,9, 'mat',          '▬', '#aa7744', 'A welcome mat. It says nothing but means it.', true);
  // Cat desc
  if (fur.cat) {
    const cx = state.cottage.catX, cy = state.cottage.catY;
    if (cx >= 1 && cx <= 18 && cy >= 1 && cy <= 9)
      interiorTileMap[cx][cy].description = 'Your cat. It has opinions but shares few of them.';
  }
}

const RECIPES = [
  { key: 'tomatoSoup',  name: 'Tomato Soup',   ingredients: { tomato: 2 },                buff: 'demand',    value: 1.10, desc: '+10% demand',           color: '#ff4444' },
  { key: 'carrotStew',  name: 'Carrot Stew',   ingredients: { carrot: 2, potato: 1 },     buff: 'apprSpeed', value: 1.15, desc: 'Apprentices +15% speed', color: '#ff8833' },
  { key: 'pumpkinPie',  name: 'Pumpkin Pie',   ingredients: { pumpkin: 1, corn: 1 },      buff: 'price',     value: 1.20, desc: '+20% market price',      color: '#ff8800' },
  { key: 'gardenSalad', name: 'Garden Salad',  ingredients: { _any3: true },               buff: 'carryCost', value: 0.50, desc: 'Carry cost halved',       color: '#44aa44' },
];

function canCook(recipe) {
  if (recipe.ingredients._any3) {
    const planted = GARDEN_DEFS.filter(g => state.garden[g.key] === true);
    return planted.length >= 3;
  }
  for (const [ing, qty] of Object.entries(recipe.ingredients)) {
    let count = 0;
    for (let q = 0; q < qty; q++) {
      if (state.garden[ing] === true) count++;
    }
    if (count < qty) return false;
  }
  return true;
}

function consumeIngredients(recipe) {
  if (recipe.ingredients._any3) {
    const planted = GARDEN_DEFS.filter(g => state.garden[g.key] === true);
    const toConsume = planted.slice(0, 3);
    for (const g of toConsume) {
      state.garden[g.key] = 'eaten';
      state.gardenRegrow[g.key] = state.day + 2;
    }
    placeGardenTiles();
    return;
  }
  for (const [ing, qty] of Object.entries(recipe.ingredients)) {
    for (let q = 0; q < qty; q++) {
      state.garden[ing] = 'eaten';
      state.gardenRegrow[ing] = state.day + 2;
    }
  }
  placeGardenTiles();
}

function openCookingMenu() {
  state.gameState = 'cooking_menu';
  const OX = 25, OY = 10, OW = 32, OH = 26;
  const TC = '#ff6633', DC = '#333333', LC = '#ffffff';

  function drawMenu() {
    for (let r = 0; r < OH; r++) for (let x = 0; x < OW; x++) display.draw(OX+x, OY+r, ' ', LC, BG);
    display.draw(OX, OY, '╔', TC, BG); display.draw(OX+OW-1, OY, '╗', TC, BG);
    for (let i = 1; i < OW-1; i++) display.draw(OX+i, OY, '═', TC, BG);
    display.draw(OX, OY+OH-1, '╚', TC, BG); display.draw(OX+OW-1, OY+OH-1, '╝', TC, BG);
    for (let i = 1; i < OW-1; i++) display.draw(OX+i, OY+OH-1, '═', TC, BG);
    for (let r = 1; r < OH-1; r++) { display.draw(OX, OY+r, '║', TC, BG); display.draw(OX+OW-1, OY+r, '║', TC, BG); }
    function row(r, text, fg) {
      const p = menuPad(text, OW-2);
      for (let i = 0; i < OW-2; i++) display.draw(OX+1+i, OY+r, p[i]||' ', fg, BG);
    }
    row(1, '  KITCHEN', TC);
    row(2, '─'.repeat(OW-2), DC);
    const letters = 'abcd';
    let rr = 3;
    for (let ri = 0; ri < RECIPES.length; ri++) {
      const rec = RECIPES[ri];
      const ok = canCook(rec);
      const key = letters[ri];
      row(rr++, `  ${key}) ${rec.name}`, ok ? rec.color : '#555555');
      // Ingredient list
      if (rec.ingredients._any3) {
        const planted = GARDEN_DEFS.filter(g => state.garden[g.key] === true).length;
        row(rr++, `     Any 3 veggies  [${planted}/3]`, planted >= 3 ? '#66cc66' : '#ff5555');
      } else {
        const ingStr = Object.entries(rec.ingredients).map(([k,v]) => {
          const have = state.garden[k] === true ? 1 : 0;
          return `${v}x ${k} [${have}/${v}]`;
        }).join(', ');
        row(rr++, `     ${ingStr}`, ok ? '#555555' : '#ff5555');
      }
      row(rr++, `     → ${rec.desc}`, '#555555');
      row(rr++, '', DC);
    }
    const buff = state.cooking?.activeBuff;
    if (buff) {
      row(rr++, '─'.repeat(OW-2), DC);
      row(rr++, `  Active: ${buff.name}`, buff.color);
      row(rr++, `  Expires: day ${buff.expiresDay}`, '#555555');
    } else {
      row(rr++, '─'.repeat(OW-2), DC);
      row(rr++, '  No active buff.', DC);
    }
    row(OH-2, '  ESC: close', DC);
  }

  drawMenu();

  function closeCooking() {
    window.removeEventListener('keydown', cookKeyHandler);
    state.gameState = 'cottage';
    drawCottageInterior();
  }

  function cookKeyHandler(e) {
    if (e.key === 'Escape') { closeCooking(); return; }
    const idx = 'abcd'.indexOf(e.key);
    if (idx < 0 || !RECIPES[idx]) return;
    const rec = RECIPES[idx];
    if (!canCook(rec)) { addLog(`Missing ingredients for ${rec.name}.`, '#ff5555'); return; }
    consumeIngredients(rec);
    state.cooking.activeBuff = { ...rec, expiresDay: state.day + 1 };
    addLog(`You cook ${rec.name}. Buff active: ${rec.desc}.`, rec.color);
    renderLog(); drawMenu();
  }
  window.addEventListener('keydown', cookKeyHandler);
}

function getCottageGlyphAt(ix, iy) {
  // Returns {ch, fg} for the look cursor to display
  const W = 20, H = 12;
  const fur = state.cottage.furniture;
  if (ix === state.cottage.playerX && iy === state.cottage.playerY) return { ch: '@', fg: state.player.color || BRIGHT_WHITE };
  if (fur.cat && ix === state.cottage.catX && iy === state.cottage.catY) return { ch: 'ค', fg: '#cc9933' };
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

  // H — Kitchen Corner (1,1): 7w × 3h
  if (fur.kitchen) {
    const WC = '#886633', TC = '#aaaaaa';
    ['┌──┬──┐', '│▦▦│▦▦│', '└──┴──┘'].forEach((row, r) => {
      const fg = r === 1 ? TC : WC;
      for (let i = 0; i < row.length; i++) dp(1+i, 1+r, row[i], fg);
    });
    dp(3, 2, 'π', '#ff6633'); // stove
  }

  // D — Fireplace (8,1): 7w × 3h, two-frame animation
  if (fur.fireplace) {
    const WC = '#886633', HC = '#aaaaaa';
    const top = '╔═════╗', bot = '╚═════╝';
    for (let i = 0; i < 7; i++) dp(8+i, 1, top[i], WC);
    const flames = fireplaceFrame === 0
      ? [['║',' ','▲',' ','▲',' ','║'], ['#886633','#886633','#ff9933','#886633','#ff9933','#886633','#886633']]
      : [['║',' ','✸',' ','✸',' ','║'], ['#886633','#886633','#ffd633','#886633','#ffd633','#886633','#886633']];
    for (let i = 0; i < 7; i++) dp(8+i, 2, flames[0][i], flames[1][i]);
    for (let i = 0; i < 7; i++) dp(8+i, 3, bot[i], HC);
  }

  // I — Bed (12,1): 8w × 4h
  if (fur.bed) {
    const BC = '#6688cc', PC = '#ccccff';
    ['┌──────┐', '│ ░░░░ │', '│ ▼▼▼▼ │', '└──────┘'].forEach((row, r) => {
      for (let i = 0; i < row.length && 12+i <= 18; i++) {
        const ch = row[i];
        let fg = BC;
        if (r === 1 && (ch === '░')) fg = PC;
        dp(12+i, 1+r, ch, fg);
      }
    });
  }

  // E — Bookshelf (14,2): 5w × 4h
  if (fur.bookshelf) {
    const BC = '#886633';
    ['╔═══╗', '║▤▤▤║', '║▤▤▤║', '╚═══╝'].forEach((row, r) => {
      for (let i = 0; i < 5; i++) dp(14+i, 2+r, row[i], BC);
    });
  }

  // F — Clock (1,2): 3w × 3h, two-frame animation
  if (fur.clock) {
    const CC = '#aaaaaa', faceColor = state.marketOpen ? '#ffd633' : '#cc66cc';
    const clockFace = state.tick % 60 < 30 ? '◷' : '◶';
    ['┌─┐', `│${clockFace}│`, '└─┘'].forEach((row, r) => {
      for (let i = 0; i < 3; i++) dp(1+i, 2+r, row[i], (r===1&&i===1) ? faceColor : CC);
    });
  }

  // C — Wooden Table (7,3): 7w × 3h
  if (fur.table) {
    const TC = '#aa7744';
    ['┌─────┐', '│     │', '└─┬─┬─┘'].forEach((row, r) => {
      for (let i = 0; i < row.length; i++) dp(7+i, 3+r, row[i], TC);
    });
  }

  // K — Rocking Chair (3,5): 3w × 4h
  if (fur.rockingchair) {
    const CC = '#aa7744', RC = '#886633';
    ['╭─╮', '│ │', '╰┬╯', '╱_╲'].forEach((row, r) => {
      for (let i = 0; i < 3; i++) dp(3+i, 5+r, row[i], r === 3 ? RC : CC);
    });
  }

  // B — Braided Rug (8,5): 5w × 1h
  if (fur.rug) {
    for (let i = 0; i < 5; i++) dp(8+i, 5, '▒', '#886633');
  }

  // J — Candles (7,6): 7w × 1h, two-frame animation
  if (fur.candles) {
    const CF = '#ffd633';
    const row = candlePhase ? '║ ▪ ▪ ║' : '║   ▪ ║';
    for (let i = 0; i < 7; i++) dp(7+i, 6, row[i], CF);
  }

  // L — Welcome Mat (9,9): 6w × 1h
  if (fur.mat) {
    for (let i = 0; i < 6; i++) dp(9+i, 9, '▬', '#aa7744');
  }
}

function handleCottageInteract() {
  const px = state.cottage.playerX, py = state.cottage.playerY;
  const fur = state.cottage.furniture;
  // Stove adjacent (3,2) — open cooking menu
  if (fur.kitchen && Math.abs(px-3)<=1 && Math.abs(py-2)<=1) { openCookingMenu(); return true; }
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

  // Walkable rows y=1..9 — floor is · in FC
  for (let iy = 1; iy <= 9; iy++) {
    const sy = OY + iy;
    display.draw(OX, sy, '║', TC, BG);
    for (let ix = 1; ix <= 18; ix++) {
      const warm = fur.fireplace && iy === 4 && ix >= 7 && ix <= 14;
      display.draw(OX+ix, sy, '·', warm ? WARMC : FC, BG);
    }
    display.draw(OX+W-1, sy, '║', TC, BG);
  }

  // Row 10: bottom wall with door indicator (- at ix=8)
  { const sy = OY + 10;
    display.draw(OX, sy, '║', TC, BG);
    for (let ix = 1; ix <= 18; ix++)
      display.draw(OX+ix, sy, ix===8?'-':' ', ix===8?'#cc9933':'#333333', BG);
    display.draw(OX+W-1, sy, '║', TC, BG);
  }

  // Bottom border
  display.draw(OX, OY+H-1, '╚', TC, BG);
  for (let i = 1; i < W-1; i++) display.draw(OX+i, OY+H-1, '═', TC, BG);
  display.draw(OX+W-1, OY+H-1, '╝', TC, BG);

  // Furniture
  drawInteriorFurniture();

  // Door tile at (8, 9) — visible exit glyph
  if (!(state.cottage.playerX === 8 && state.cottage.playerY === 9))
    display.draw(OX+8, OY+9, '▒', '#886633', BG);

  // Cat
  if (fur.cat) display.draw(OX+state.cottage.catX, OY+state.cottage.catY, 'ค', '#cc9933', BG);

  // Player
  display.draw(OX+state.cottage.playerX, OY+state.cottage.playerY, '@', state.player.color||BRIGHT_WHITE, BG);

  // Hint row
  if (cottageLookActive) {
    // Look mode: show description
    const ix = cottageLookX, iy = cottageLookY;
    let desc = '';
    if (iy===0||iy===H-1||ix===0||ix===W-1||iy===10) {
      desc = (ix===8&&iy===10) ? 'The way out. The world is still there.' : 'The cottage wall. It keeps the weather out.';
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

// ── Fishing minigame (§4.2) ──────────────────────────────────────────────────

function openFishingMenu() {
  state.gameState = 'fishing';
  if (!state.lakeEasterEgg.discovered) {
    state.lakeEasterEgg.discovered = true;
    // Update pond center description now that it's been discovered
    if (tileMap[22]?.[25]) tileMap[22][25].description = 'The center of the lake. The water is calm. Press space to fish.';
  }

  const FC    = '#1a6a8a';   // frame color (deep lake blue)
  const WC    = '#1a6a8a';   // water color (same)
  const DC    = '#333333';
  const TC    = '#aaddff';
  const BOX_W = 54;
  const BOX_H = 18;
  const IW    = 52;
  const LP_W  = 14;
  const RP_W  = 37;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const DIVX  = BOX_X + 1 + LP_W;
  const RPX   = DIVX + 1;
  const SCENE_ROWS = 14; // rows 3–16 inside box

  // Reset transient state
  const f = state.fishing;
  f.currentPhase = 'menu';
  f.fishTimer    = 0;
  f.biteTimer    = 0;
  f.fishX        = 0;
  f.animTick     = 0;

  // ── Bubble art (14 cols × 10 rows) ─────────────────────────────────────
  const BUBBLE_ROWS = [
    '     o        ',
    '  O     o     ',
    '    o      O  ',
    '  o    O      ',
    '       o   o  ',
    '  O       O   ',
    '    o  o      ',
    ' O        o   ',
    '    O   O     ',
    '  o      o    ',
  ];
  // Shift bubbles up by 1 row every 8 ticks (wrap bottom → top)
  function getBubbleRow(r) {
    const shift = Math.floor(f.animTick / 8) % BUBBLE_ROWS.length;
    return BUBBLE_ROWS[(r + shift) % BUBBLE_ROWS.length];
  }

  // ── Drawing helpers ───────────────────────────────────────────────────────
  function border() {
    display.draw(BOX_X, BOX_Y, '╔', FC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', FC, BG);
    display.draw(BOX_X, BOX_Y + BOX_H - 1, '╚', FC, BG);
    display.draw(BOX_X + BOX_W - 1, BOX_Y + BOX_H - 1, '╝', FC, BG);
    for (let i = 1; i < BOX_W - 1; i++) {
      display.draw(BOX_X + i, BOX_Y, '═', FC, BG);
      display.draw(BOX_X + i, BOX_Y + BOX_H - 1, '═', FC, BG);
    }
    for (let y = 1; y < BOX_H - 1; y++) {
      display.draw(BOX_X, BOX_Y + y, '║', FC, BG);
      display.draw(BOX_X + BOX_W - 1, BOX_Y + y, '║', FC, BG);
    }
  }

  function irow(r, text, fg) {
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, BOX_Y + r, p[i] || ' ', fg, BG);
  }

  function rrow(r, text, fg) {
    const p = menuPad(text, RP_W);
    for (let i = 0; i < RP_W; i++) display.draw(RPX + i, BOX_Y + r, p[i] || ' ', fg, BG);
  }

  // Water row helper — animated ripple
  function drawWaterRow(displayY) {
    const offset = Math.floor(f.animTick / 4) % 2;
    for (let i = 0; i < IW; i++) {
      const ch = (i + offset) % 2 === 0 ? '~' : '-';
      display.draw(BOX_X + 1 + i, displayY, ch, WC, BG);
    }
  }

  // Draw scene row (col 0 = BOX_X+1, width = IW)
  function sceneRow(r, chars) {
    const dy = BOX_Y + 3 + r;
    for (let i = 0; i < IW; i++) {
      const ch = (chars[i] !== undefined ? chars[i] : ' ');
      let fg = BRIGHT_WHITE;
      // Coloring rules
      if (ch === '~' || ch === '-') { fg = WC; }
      else if (ch === '\\' || ch === '|' || ch === '_') { fg = '#aa7744'; }
      else if (ch === '●') { fg = f.currentPhase === 'biting' ? '#ff5555' : '#f0f0f0'; }
      else if (ch === '!') { fg = '#ff5555'; }
      else if (ch === '.') { fg = DC; }
      else if (ch !== ' ') { fg = BRIGHT_WHITE; }
      display.draw(BOX_X + 1 + i, dy, ch, fg, BG);
    }
  }

  // ── Menu phase renderer ──────────────────────────────────────────────────
  function renderMenu() {
    // Row 1: header
    { const ay = BOX_Y + 1;
      display.draw(BOX_X, ay, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, ay, '║', FC, BG);
      const title = 'GO FISHIN\'', hint = 'press esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i - (IW - hint.length)] : ' ');
        const fg = i < title.length ? TC : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
    }
    // Row 2: ═ separator
    { const ay = BOX_Y + 2;
      display.draw(BOX_X, ay, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, ay, '║', FC, BG);
      for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay, '═', DC, BG); }

    // Left pane: bubbles (rows 3–12)
    for (let r = 0; r < 10; r++) {
      const dy = BOX_Y + 3 + r;
      display.draw(BOX_X, dy, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, dy, '║', FC, BG);
      const row = getBubbleRow(r);
      for (let i = 0; i < LP_W; i++) {
        const ch = row[i] || ' ';
        const fg = ch === 'O' ? '#4a8aaa' : ch === 'o' ? '#2a5a7a' : BRIGHT_WHITE;
        display.draw(BOX_X + 1 + i, dy, ch, fg, BG);
      }
      display.draw(DIVX, dy, '│', DC, BG);
    }
    // rows 13–16: blank left pane
    for (let r = 10; r < 14; r++) {
      const dy = BOX_Y + 3 + r;
      display.draw(BOX_X, dy, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, dy, '║', FC, BG);
      for (let i = 0; i < LP_W; i++) display.draw(BOX_X + 1 + i, dy, ' ', BRIGHT_WHITE, BG);
      display.draw(DIVX, dy, '│', DC, BG);
    }

    // Right pane rows (0–13)
    const outOfFish = f.catchesToday >= f.dailyLimit;
    rrow(0, '', BRIGHT_WHITE);
    rrow(1, `Catches today:  ${f.catchesToday} / ${f.dailyLimit}`, TC);
    rrow(2, `Total catches:  ${f.totalCatches}`, '#555555');
    rrow(3, `Scrap earned:   ${f.totalCatches}`, '#aa9966');
    rrow(4, '', BRIGHT_WHITE);
    // row 5: separator
    { const dy = BOX_Y + 3 + 5;
      display.draw(BOX_X, dy, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, dy, '║', FC, BG);
      display.draw(DIVX, dy, '│', DC, BG);
      for (let i = 0; i < 35; i++) display.draw(RPX + i, dy, '─', DC, BG);
      for (let i = 35; i < RP_W; i++) display.draw(RPX + i, dy, ' ', BRIGHT_WHITE, BG); }
    rrow(6, '', BRIGHT_WHITE);
    rrow(7, outOfFish ? "You've fished enough for today." : 'The pond is calm today.', '#555555');
    rrow(8, '', BRIGHT_WHITE);
    if (!outOfFish) {
      const castText = '[ SPACE — CAST YOUR LINE ]';
      const cx = Math.floor((RP_W - castText.length) / 2);
      rrow(9, '', BRIGHT_WHITE);
      const dy = BOX_Y + 3 + 9;
      display.draw(BOX_X, dy, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, dy, '║', FC, BG);
      display.draw(DIVX, dy, '│', DC, BG);
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, ' ', BRIGHT_WHITE, BG);
      for (let i = 0; i < castText.length; i++) display.draw(RPX + cx + i, dy, castText[i], '#66cc66', BG);
    } else {
      const outText = '[ FISHED OUT — COME BACK TOMORROW ]';
      const cx = Math.floor((RP_W - outText.length) / 2);
      const dy = BOX_Y + 3 + 9;
      display.draw(BOX_X, dy, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, dy, '║', FC, BG);
      display.draw(DIVX, dy, '│', DC, BG);
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, ' ', BRIGHT_WHITE, BG);
      for (let i = 0; i < outText.length; i++) display.draw(RPX + cx + i, dy, outText[i], DC, BG);
    }
    for (let r = 10; r < 14; r++) {
      const dy = BOX_Y + 3 + r;
      display.draw(BOX_X, dy, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, dy, '║', FC, BG);
      display.draw(DIVX, dy, '│', DC, BG);
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, ' ', BRIGHT_WHITE, BG);
    }
  }

  // ── Scene phase renderer ─────────────────────────────────────────────────
  // Builds 14-row scene strings and draws them
  function renderScene() {
    // Side borders for all scene rows
    for (let r = 0; r < SCENE_ROWS; r++) {
      display.draw(BOX_X, BOX_Y + 3 + r, '║', FC, BG);
      display.draw(BOX_X + BOX_W - 1, BOX_Y + 3 + r, '║', FC, BG);
    }
    const phase = f.currentPhase;
    const baitCol = 37; // column of bait ● in scene (0-indexed, IW=52)

    // Build base 14 rows for scene phases
    const S = Array(SCENE_ROWS).fill(null).map(() => Array(IW).fill(' '));

    // Helper to paint a string into scene row r starting at col c
    function paint(r, c, str, overrideFg) {
      for (let i = 0; i < str.length && c + i < IW; i++) S[r][c + i] = str[i];
    }

    // Rod and line (phases casted/approaching/biting/success)
    if (phase !== 'uncasted') {
      paint(1, 19, '\\');
      paint(2, 20, '\\_______________');
      paint(3, 36, '\\');
      paint(4, 37, '|');
      paint(5, 37, '|');
      paint(6, 37, '|');
      paint(7, 37, '|');
    } else {
      // Uncasted rod
      paint(1, 23, '\\');
      paint(2, 24, '\\');
      paint(3, 25, '|');
      paint(4, 25, '|');
      paint(5, 25, '|  ready...');
    }

    // Water rows 8-9
    const waterOffset = Math.floor(f.animTick / 4) % 2;
    for (let r = 8; r <= 9; r++) {
      for (let i = 0; i < IW; i++) {
        S[r][i] = i === 0 ? ' ' : ((i + waterOffset) % 2 === 0 ? '~' : '-');
      }
    }

    // Phase-specific content
    if (phase === 'casted' || phase === 'approaching') {
      // Line through water and bait
      S[8][baitCol] = '|'; S[9][baitCol] = '|';
      S[10][baitCol] = '●';
      paint(10, baitCol + 1, ' ');
      S[11][baitCol] = '|';
      paint(13, 14, '... waiting ...');
    }

    if (phase === 'approaching') {
      // Fish ><> moving left
      const fx = Math.min(f.fishX, IW - 3);
      if (fx >= 0 && fx + 2 < IW) {
        S[10][fx] = '>'; S[10][fx + 1] = '<'; S[10][fx + 2] = '>';
      }
    }

    if (phase === 'biting') {
      S[8][baitCol] = '!'; S[9][baitCol] = '|';
      // Fish adjacent to bait on left
      S[10][baitCol - 3] = '>'; S[10][baitCol - 2] = '<'; S[10][baitCol - 1] = '>';
      S[10][baitCol] = '●';
      S[11][baitCol] = '|';
      // Blinking row 13
      const blink = Math.floor(f.animTick / 15) % 2 === 0;
      if (blink) paint(13, 14, '!! PRESS SPACE !!');
    }

    if (phase === 'success') {
      S[10][baitCol] = ' '; S[11][baitCol] = '|';
      // Fish on the rod
      S[5][baitCol - 3] = '>'; S[5][baitCol - 2] = '<'; S[5][baitCol - 1] = '>';
      paint(5, baitCol + 1, '  CATCH!');
      paint(11, 15, '+1 SCRAP');
      paint(13, 10, '[ SPACE to continue ]');
    }

    if (phase === 'miss') {
      // Fish swims right
      const fx = Math.min(f.fishX, IW - 1);
      if (fx < IW - 3) {
        S[10][fx] = '>'; S[10][fx + 1] = '<'; S[10][fx + 2] = '>';
      }
      S[10][baitCol] = '●';
      S[11][baitCol] = '|';
      const missTextVisible = f.animTick > 30;
      if (missTextVisible) {
        const missMsg = f.animTick > 60 ? '[ SPACE to try again ]' : 'the fish got away...';
        paint(13, 10, missMsg);
      }
    }

    // Draw each scene row with correct colors
    for (let r = 0; r < SCENE_ROWS; r++) {
      const dy = BOX_Y + 3 + r;
      for (let i = 0; i < IW; i++) {
        const ch = S[r][i];
        let fg = BRIGHT_WHITE;
        if (ch === '~' || ch === '-')            fg = WC;
        else if (ch === '\\' || ch === '_')      fg = '#aa7744';
        else if (ch === '|') {
          // Line below water (rows 10-11) is dim
          fg = (r >= 10) ? '#555555' : '#aa7744';
        }
        else if (ch === '●') {
          fg = phase === 'biting' ? '#ff5555' : '#f0f0f0';
        }
        else if (ch === '!' )                    fg = '#ff5555';
        else if (ch === '>') {
          fg = phase === 'biting' ? '#ff9933' : phase === 'approaching' ? '#4a8a4a' : phase === 'success' ? '#66cc66' : '#555555';
          // For ><> check: fish chars are > < >
        }
        else if (ch === '<') {
          fg = phase === 'biting' ? '#ff9933' : phase === 'approaching' ? '#4a8a4a' : phase === 'success' ? '#66cc66' : '#555555';
        }
        else if (ch === '.')                     fg = DC;
        else if (ch === '+')                     fg = '#aa9966';
        else if (ch === 'C' || ch === 'A' || ch === 'T' || ch === 'H') {
          fg = '#66cc66'; // CATCH!
        }
        else if (ch === 'S' && r === 11)        fg = '#aa9966'; // SCRAP
        else if (ch === 'r' || ch === 'e' || ch === 'a' || ch === 'd' || ch === 'y') {
          fg = '#555555'; // "ready..."
        }
        else if (ch !== ' ')                     fg = BRIGHT_WHITE;
        display.draw(BOX_X + 1 + i, dy, ch, fg, BG);
      }
    }
  }

  // ── Header rows 1-2 for scene phases ────────────────────────────────────
  function renderSceneHeader() {
    const ay1 = BOX_Y + 1;
    display.draw(BOX_X, ay1, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, ay1, '║', FC, BG);
    const title = 'GO FISHIN\'', hint = 'press esc to exit';
    for (let i = 0; i < IW; i++) {
      const ch = i < title.length ? title[i] : (i >= IW - hint.length ? hint[i - (IW - hint.length)] : ' ');
      const fg = i < title.length ? TC : (i >= IW - hint.length ? DC : BRIGHT_WHITE);
      display.draw(BOX_X + 1 + i, ay1, ch, fg, BG);
    }
    const ay2 = BOX_Y + 2;
    display.draw(BOX_X, ay2, '║', FC, BG); display.draw(BOX_X + BOX_W - 1, ay2, '║', FC, BG);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, ay2, '═', DC, BG);
  }

  // ── Phase logic (called from fishingLoop) ────────────────────────────────
  function updateFishingPhase() {
    const phase = f.currentPhase;
    if (phase === 'uncasted') {
      if (f.fishTimer <= 0) { f.currentPhase = 'casted'; f.fishTimer = 180 + Math.floor(Math.random() * 240); }
      else f.fishTimer--;
    } else if (phase === 'casted') {
      if (f.fishTimer <= 0) { f.currentPhase = 'approaching'; f.fishX = IW - 4; }
      else f.fishTimer--;
    } else if (phase === 'approaching') {
      if (f.animTick % 3 === 0) f.fishX--;
      if (f.fishX <= 37 - 3) { f.currentPhase = 'biting'; f.biteTimer = 60; }
    } else if (phase === 'biting') {
      f.biteTimer--;
      if (f.biteTimer <= 0) { f.currentPhase = 'miss'; f.animTick = 0; }
    } else if (phase === 'miss') {
      if (f.animTick % 2 === 0 && f.fishX < IW - 1) f.fishX++;
    }
  }

  // ── Main fishing render/update ────────────────────────────────────────────
  function renderFishingFrame() {
    border();
    renderSceneHeader();
    const phase = f.currentPhase;
    if (phase === 'menu') {
      renderMenu();
    } else {
      renderScene();
    }
  }

  // ── fishingLoop ───────────────────────────────────────────────────────────
  function fishingLoop() {
    if (state.gameState !== 'fishing') return;
    f.animTick++;
    updateFishingPhase();
    renderFishingFrame();
    requestAnimationFrame(fishingLoop);
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────
  function fishKeyHandler(e) {
    if (state.gameState !== 'fishing') { window.removeEventListener('keydown', fishKeyHandler); return; }
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', fishKeyHandler);
      state.gameState = 'playing';
      clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
      renderDirty();
      display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
      return;
    }
    if (e.key !== ' ') return;
    e.preventDefault();
    const phase = f.currentPhase;
    if (phase === 'menu') {
      if (f.catchesToday < f.dailyLimit) { f.currentPhase = 'uncasted'; f.fishTimer = 8; }
    } else if (phase === 'biting') {
      // Caught!
      f.currentPhase = 'success'; f.animTick = 0;
      f.catchesToday++;
      f.totalCatches++;
      awardStamp(1, false);
      addLog('> You caught a fish! +1 scrap.', '#aa9966');
    } else if (phase === 'success') {
      f.currentPhase = 'menu'; f.fishTimer = 0; f.fishX = 0;
    } else if (phase === 'miss') {
      if (f.animTick > 60) { f.currentPhase = 'menu'; f.fishTimer = 0; f.fishX = 0; }
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  window.addEventListener('keydown', fishKeyHandler);
  renderFishingFrame();
  requestAnimationFrame(fishingLoop);
}

// ── Mine (§Mine) ─────────────────────────────────────────────────────────────

let mineRedrawFn = null;
let rainDrops    = [];
let pendingPopups = [];
let activePopup   = null;

function queuePopup(title, lines, color) {
  pendingPopups.push({ title, lines, color });
}

function showNextPopup() {
  if (pendingPopups.length === 0 || state.gameState !== 'playing') return;
  activePopup = pendingPopups.shift();
  const PC    = activePopup.color || '#66ccff';
  const TC    = '#ffd633';
  const WC    = '#f0f0f0';
  const DC    = '#555555';
  const content = activePopup.lines;
  const maxLineLen = Math.max(activePopup.title.length, ...content.map(l => l.length), 18);
  const BOX_IW = maxLineLen + 4;
  const BOX_W  = BOX_IW + 2;
  const BOX_H  = content.length + 6;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.floor((WORLD_ROWS - BOX_H) / 2);
  // Top
  display.draw(BOX_X, BOX_Y, '╔', PC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', PC, BG);
  for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y, '═', PC, BG);
  // Title row
  { const t = ('★ ' + activePopup.title + ' ★');
    const pad = ' '.repeat(Math.max(0, Math.floor((BOX_IW - t.length) / 2)));
    const line = (pad + t).padEnd(BOX_IW);
    display.draw(BOX_X, BOX_Y+1, '║', PC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+1, '║', PC, BG);
    for (let i = 0; i < BOX_IW; i++) display.draw(BOX_X+1+i, BOX_Y+1, line[i]||' ', TC, BG); }
  // Separator
  display.draw(BOX_X, BOX_Y+2, '╠', PC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+2, '╣', PC, BG);
  for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y+2, '═', PC, BG);
  // Blank row
  display.draw(BOX_X, BOX_Y+3, '║', PC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+3, '║', PC, BG);
  for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y+3, ' ', BRIGHT_WHITE, BG);
  // Content rows
  for (let li = 0; li < content.length; li++) {
    const row = BOX_Y + 4 + li;
    const pad = ' '.repeat(Math.max(0, Math.floor((BOX_IW - content[li].length) / 2)));
    const line = ('  ' + content[li]).padEnd(BOX_IW);
    display.draw(BOX_X, row, '║', PC, BG); display.draw(BOX_X+BOX_W-1, row, '║', PC, BG);
    for (let i = 0; i < BOX_IW; i++) display.draw(BOX_X+1+i, row, line[i]||' ', WC, BG);
  }
  // Hint row
  const hint = '[ press any key ]';
  const hintPad = ' '.repeat(Math.max(0, Math.floor((BOX_IW - hint.length) / 2)));
  const hintLine = (hintPad + hint).padEnd(BOX_IW);
  const hr = BOX_Y + 4 + content.length;
  display.draw(BOX_X, hr, '║', PC, BG); display.draw(BOX_X+BOX_W-1, hr, '║', PC, BG);
  for (let i = 0; i < BOX_IW; i++) display.draw(BOX_X+1+i, hr, hintLine[i]||' ', DC, BG);
  // Bottom
  const br = BOX_Y + BOX_H - 1;
  display.draw(BOX_X, br, '╚', PC, BG); display.draw(BOX_X+BOX_W-1, br, '╝', PC, BG);
  for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, br, '═', PC, BG);

  function popupKeyHandler(e) {
    e.preventDefault();
    window.removeEventListener('keydown', popupKeyHandler);
    activePopup = null;
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    showNextPopup();
  }
  window.addEventListener('keydown', popupKeyHandler);
}

function generateMineTiles() {
  const period = Math.floor(state.day / 2);
  if (period === state.mine.lastGenDay) return;

  if (state.mine.kickedOut && period < state.mine.kickedOutUntilPeriod) return;
  state.mine.kickedOut = false;

  state.mine.lastGenDay = period;
  state.mine.playerX = 12;
  state.mine.playerY = 13;
  state.mine.bareHandHits = 0;
  state.mine.handsBloodied = false;

  const W = 25, H = 15;
  const layout = period % 4;
  const tiles = [];
  for (let x = 0; x < W; x++) {
    tiles[x] = [];
    for (let y = 0; y < H; y++) {
      const isBorder = x === 0 || x === W-1 || y === 0 || y === H-1;
      tiles[x][y] = {
        glyph: isBorder ? '#' : '█',
        fg: isBorder ? '#333333' : '#4a4a4a',
        walkable: false,
        hp: isBorder ? -1 : 3,
        ore: null,
        collected: false,
      };
    }
  }

  function carve(x1, y1, x2, y2) {
    for (let x = Math.max(1,x1); x <= Math.min(W-2,x2); x++)
      for (let y = Math.max(1,y1); y <= Math.min(H-2,y2); y++)
        tiles[x][y] = { glyph: '.', fg: '#2a2a1a', walkable: true, hp: 0, ore: null, collected: false };
  }
  function corridor(x1, y1, x2, y2) {
    let cx = x1, cy = y1;
    while (cx !== x2 || cy !== y2) {
      if (cx > 0 && cx < W-1 && cy > 0 && cy < H-1)
        tiles[cx][cy] = { glyph: '.', fg: '#2a2a1a', walkable: true, hp: 0, ore: null, collected: false };
      if (cx !== x2) cx += (x2 > cx ? 1 : -1); else if (cy !== y2) cy += (y2 > cy ? 1 : -1);
    }
    if (cx > 0 && cx < W-1 && cy > 0 && cy < H-1)
      tiles[cx][cy] = { glyph: '.', fg: '#2a2a1a', walkable: true, hp: 0, ore: null, collected: false };
  }

  if (layout === 0) {
    carve(2,2,7,5); carve(10,1,16,4); carve(19,2,23,6);
    carve(3,9,9,13); carve(14,8,20,12);
    corridor(7,4,10,4); corridor(16,3,19,3);
    corridor(6,5,6,9); corridor(15,4,15,8);
  } else if (layout === 1) {
    carve(1,1,5,6); carve(8,3,14,7); carve(17,1,23,5);
    carve(2,9,8,13); carve(11,10,17,13); carve(20,8,23,13);
    corridor(5,4,8,4); corridor(14,5,17,5);
    corridor(4,6,4,9); corridor(14,7,14,10); corridor(20,5,20,8);
  } else if (layout === 2) {
    carve(1,1,23,3);
    carve(1,6,6,10); carve(10,5,15,9); carve(19,6,23,10);
    carve(5,11,20,13);
    corridor(3,3,3,6); corridor(12,3,12,5); corridor(21,3,21,6);
    corridor(6,8,10,8); corridor(15,8,19,8);
    corridor(10,9,10,11);
  } else {
    carve(2,1,10,4); carve(15,1,23,3);
    carve(1,7,8,11); carve(12,6,18,10); carve(21,7,23,11);
    carve(5,12,19,13);
    corridor(10,3,15,3); corridor(5,4,5,7); corridor(15,3,15,6);
    corridor(8,9,12,9); corridor(18,8,21,8);
    corridor(12,10,12,12);
  }

  carve(11,12,13,13);
  tiles[12][13] = { glyph: '>', fg: '#aaaaaa', walkable: true, hp: 0, ore: null, collected: false, isExit: true };

  const seed = period * 7919;
  for (let x = 1; x < W-1; x++) {
    for (let y = 1; y < H-1; y++) {
      if (tiles[x][y].hp <= 0) continue;
      const hash = ((x * 1664525 + y * 1013904223 + seed) >>> 16) % 100;
      if (hash < 70)      tiles[x][y].ore = 'rm';
      else if (hash < 90) tiles[x][y].ore = 'crystal';
      else                tiles[x][y].ore = 'stamp';
    }
  }

  for (const [bx,by] of [[5,5],[12,7],[20,5],[8,11],[17,11]]) {
    if (bx > 0 && bx < W-1 && by > 0 && by < H-1 && tiles[bx][by].walkable)
      tiles[bx][by] = { glyph: 'H', fg: '#886633', walkable: false, hp: -1, ore: null, collected: false };
  }

  const waterPools = [
    [2,12],[3,12],[3,11],
    [21,2],[22,2],[22,3],
    [10,7],[11,7],
    [18,12],[19,12],[19,11],[20,12],
    [1,4],[1,5],
  ];
  for (const [wx,wy] of waterPools) {
    if (wx > 0 && wx < W-1 && wy > 0 && wy < H-1 && tiles[wx][wy].walkable)
      tiles[wx][wy] = { glyph: '~', fg: '#1a4a6a', walkable: false, hp: -1, ore: null, collected: false };
  }

  // Enemy — place in top half, away from entrance
  let enemyPlaced = false;
  for (let attempts = 0; attempts < 50; attempts++) {
    const ex = 1 + ((seed + attempts * 31) % (W - 2));
    const ey = 1 + ((seed + attempts * 47) % (H - 4));
    if (tiles[ex][ey].walkable && !(ex >= 11 && ex <= 13 && ey >= 12)) {
      state.mine.enemyX = ex;
      state.mine.enemyY = ey;
      enemyPlaced = true;
      break;
    }
  }
  if (!enemyPlaced) { state.mine.enemyX = 5; state.mine.enemyY = 3; }

  state.mine.tiles = tiles;
  if (state.mine.totalMined > 0) addLog('The mine has shifted. New deposits available.', '#aaaaaa');
}

function enterMine() {
  if (state.mine.kickedOut) {
    const currentPeriod = Math.floor(state.day / 2);
    if (currentPeriod < state.mine.kickedOutUntilPeriod) {
      addLog('The mine feels hostile. Come back when it resets.', '#ff5555');
      return;
    }
    state.mine.kickedOut = false;
  }

  generateMineTiles();
  state.gameState = 'mine';

  let enemyMoveTimer = 0;

  function drawMineInterior() {
    // Full-screen clear — nothing from overworld should show
    for (let y = 0; y < DISPLAY_HEIGHT; y++)
      for (let x = 0; x < DISPLAY_WIDTH; x++)
        display.draw(x, y, ' ', BRIGHT_WHITE, BG);

    const W = 25, H = 15;
    const OX = Math.floor((DISPLAY_WIDTH - W) / 2);
    const OY = Math.floor((WORLD_ROWS - H) / 2) - 2;
    const tiles = state.mine.tiles;
    const hitsNeeded = [3, 2, 1][state.skills.pickaxeLevel] || 3;

    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const t = tiles[x][y];
        let glyph = t.glyph, fg = t.fg;

        // Water shimmer
        if (t.glyph === '~') {
          fg = (state.tick + x + y) % 20 < 10 ? '#1a4a6a' : '#2a5a7a';
        }

        // Lantern: ore glows through unbroken rocks
        if (state.skills.lantern && t.hp > 0 && t.ore && !t.collected) {
          const pulse = (state.tick + x * 3 + y * 7) % 40 < 8;
          if (pulse) {
            if (t.ore === 'rm')           fg = '#663300';
            else if (t.ore === 'crystal') fg = '#334466';
            else if (t.ore === 'stamp')   fg = '#665500';
          }
        }

        // Revealed ore
        if (t.hp === 0 && t.ore && !t.collected) {
          if (t.ore === 'rm')           { glyph = '●'; fg = '#ff6600'; }
          else if (t.ore === 'crystal') { glyph = '◆'; fg = '#66ccff'; }
          else if (t.ore === 'stamp')   { glyph = '★'; fg = '#ffd633'; }
        }

        // Rock damage
        if (t.hp > 0) {
          const maxHp = hitsNeeded;
          if (t.hp < maxHp && t.hp >= maxHp * 0.66) { glyph = '▓'; fg = '#555555'; }
          else if (t.hp < maxHp * 0.66 && t.hp > 0) { glyph = '░'; fg = '#666666'; }
        }

        display.draw(OX + x, OY + y, glyph, fg, BG);
      }
    }

    // Enemy
    if (state.mine.enemyX >= 0 && state.mine.enemyY >= 0) {
      display.draw(OX + state.mine.enemyX, OY + state.mine.enemyY, 'X', '#ff3333', BG);
    }

    // Player
    display.draw(OX + state.mine.playerX, OY + state.mine.playerY, '@', state.player.color || BRIGHT_WHITE, BG);

    // HUD
    const hudY = OY + H + 1;
    const pickName = ['Bare Hands', 'Pickaxe', 'Brand Name Pickaxe'][state.skills.pickaxeLevel] || 'Bare Hands';
    const hudLine = `THE MINE   Tool: ${pickName}   Crystals: ${state.mine.crystals}/5`;
    for (let i = 0; i < hudLine.length; i++) display.draw(2 + i, hudY, hudLine[i], '#aaaaaa', BG);

    const hintLine = 'arrows: move   space: mine/collect   esc: exit';
    for (let i = 0; i < hintLine.length; i++) display.draw(2 + i, hudY + 1, hintLine[i], '#555555', BG);

    if (state.mine.handsBloodied) {
      const warnLine = 'Your hands are bleeding. You need a pickaxe.';
      for (let i = 0; i < warnLine.length; i++) display.draw(2 + i, hudY + 2, warnLine[i], '#ff5555', BG);
    } else if (state.skills.lantern) {
      const lanternHint = 'Lantern active — ore glows through rock.';
      for (let i = 0; i < lanternHint.length; i++) display.draw(2 + i, hudY + 2, lanternHint[i], '#555555', BG);
    }

    // Last 3 log entries below HUD
    const logY = hudY + 4;
    const recentLogs = state.logLines.slice(-3);
    for (let i = 0; i < recentLogs.length; i++) {
      const entry = recentLogs[i];
      const text = ('> ' + entry.text).slice(0, DISPLAY_WIDTH - 4);
      for (let j = 0; j < DISPLAY_WIDTH - 4; j++) display.draw(2 + j, logY + i, j < text.length ? text[j] : ' ', j < text.length ? (entry.color || '#aaaaaa') : BRIGHT_WHITE, BG);
    }
  }

  function moveEnemy() {
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    const shuffled = dirs.sort(() => Math.random() - 0.5);
    for (const [dx,dy] of shuffled) {
      const nx = state.mine.enemyX + dx;
      const ny = state.mine.enemyY + dy;
      if (nx > 0 && nx < 24 && ny > 0 && ny < 14 && state.mine.tiles[nx][ny].walkable) {
        state.mine.enemyX = nx;
        state.mine.enemyY = ny;
        break;
      }
    }
  }

  function checkEnemyCollision() {
    if (state.mine.playerX === state.mine.enemyX && state.mine.playerY === state.mine.enemyY) {
      state.mine.kickedOut = true;
      state.mine.kickedOutUntilPeriod = Math.floor(state.day / 2) + 1;
      mineRedrawFn = null;
      window.removeEventListener('keydown', mineKeyHandler);
      clearScreen(); drawWorld(); drawStatusBar(); renderLog();
      display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
      state.gameState = 'playing';
      addLog('Something attacked you in the dark! You flee the mine.', '#ff5555');
      return true;
    }
    return false;
  }

  mineRedrawFn = drawMineInterior;
  drawMineInterior();

  function mineKeyHandler(e) {
    const tiles = state.mine.tiles;
    const W = 25, H = 15;

    if (e.key === 'Escape') {
      mineRedrawFn = null;
      window.removeEventListener('keydown', mineKeyHandler);
      clearScreen(); drawWorld(); drawStatusBar(); renderLog();
      display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
      state.gameState = 'playing';
      return;
    }

    const DIRS = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
    const d = DIRS[e.key];
    if (d) {
      e.preventDefault();
      state.mine.playerDir = { x: d[0], y: d[1] };
      const nx = state.mine.playerX + d[0];
      const ny = state.mine.playerY + d[1];
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && tiles[nx][ny].walkable) {
        state.mine.playerX = nx;
        state.mine.playerY = ny;
        if (tiles[nx][ny].isExit) {
          mineRedrawFn = null;
          window.removeEventListener('keydown', mineKeyHandler);
          clearScreen(); drawWorld(); drawStatusBar(); renderLog();
          display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
          state.gameState = 'playing';
          return;
        }
        enemyMoveTimer++;
        if (enemyMoveTimer % 2 === 0) moveEnemy();
        if (checkEnemyCollision()) return;
      }
      drawMineInterior();
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      const px = state.mine.playerX, py = state.mine.playerY;
      const here = tiles[px][py];

      // Collect ore from current tile
      if (here.ore && here.hp === 0 && !here.collected) {
        here.collected = true;
        state.mine.totalMined++;
        if (here.ore === 'rm') {
          const stormBonus = state.weather.current === 'storm' ? 2 : 1;
          if (state.stations.storage?.unlocked) {
            state.storage.rm = Math.min(state.storage.rm + stormBonus, state.storage.rmCap);
            if (stormBonus > 1) addLog('Storm-loosened rock! Double RM.', '#ffaa00');
            else addLog('Mined raw material. Stored at the RM shed.', '#ff6600');
          } else {
            state.player.inventory.rm = Math.min(state.player.inventory.rm + stormBonus, state.player.inventoryCaps.rm);
            if (stormBonus > 1) addLog('Storm-loosened rock! Double RM.', '#ffaa00');
            else addLog('Mined raw material.', '#ff6600');
          }
        } else if (here.ore === 'crystal') {
          if (state.mine.crystals < 5) { state.mine.crystals++; addLog('Found a rare crystal!', '#66ccff'); }
          else addLog('Crystal pouch is full (5/5).', '#555555');
        } else if (here.ore === 'stamp') {
          state.player.stamps += 3;
          addLog('Found a stamp nugget! +3 stamps.', '#ffd633');
        }
        here.glyph = '.'; here.fg = '#2a2a1a';
        playSound('bought');
        drawMineInterior();
        return;
      }

      // Mine the rock we're facing
      const tx = px + state.mine.playerDir.x;
      const ty = py + state.mine.playerDir.y;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) return;
      const target = tiles[tx][ty];
      if (target.hp <= 0) return;

      // Bare hands limit
      if (state.skills.pickaxeLevel === 0) {
        if (state.mine.handsBloodied) {
          addLog('Your hands are too damaged. You need a pickaxe.', '#ff5555');
          drawMineInterior();
          return;
        }
        state.mine.bareHandHits++;
        if (state.mine.bareHandHits >= 5) {
          state.mine.handsBloodied = true;
          addLog("Your hands begin to bleed. You can't mine anymore.", '#ff5555');
        }
      }

      target.hp--;
      playSound('crafted');
      if (target.hp <= 0) {
        target.hp = 0;
        target.walkable = true;
        if (!target.ore) { target.glyph = '.'; target.fg = '#2a2a1a'; }
      }
      drawMineInterior();
      return;
    }
  }
  window.addEventListener('keydown', mineKeyHandler);
}

function handleInteract() {
  const px = state.player.x, py = state.player.y;
  // Mine entrance check
  if (tileMap[px]?.[py]?.station === 'mine') {
    enterMine();
    return;
  }
  // Shiny rock collection — Space on exact tile (first priority, always wins)
  for (const color of ['red', 'yellow', 'blue']) {
    const rock = state.shinyRocks?.[color];
    if (!rock) continue;
    if (!rock.collected && state.player.x === rock.x && state.player.y === rock.y) { collectRock(color, rock); return; }
  }
  // Fishing: pond center (22, 25) with Aquatics
  if (px === 22 && py === 25 && state.skills.aquatics?.purchased) {
    openFishingMenu(); return;
  }
  // Garden veggie eating — player standing on a planted veggie plot
  if (state.cottage.owned) {
    const gix = state.cottage.mapX - 6; // GARDEN_INNER_X = 34
    const giy = state.cottage.mapY;     // GARDEN_INNER_Y = 21
    for (let i = 0; i < GARDEN_DEFS.length; i++) {
      const item = GARDEN_DEFS[i];
      const gpx = gix + (i % 4), gpy = giy + Math.floor(i / 4);
      if (px === gpx && py === gpy && state.garden[item.key] === true && item.type === 'veggie') {
        state.garden[item.key] = 'eaten';
        state.gardenRegrow[item.key] = state.day + 2;
        placeGardenTiles(); markDirty(gpx, gpy); renderDirty();
        display.draw(px, py, '@', state.player.color || BRIGHT_WHITE, BG);
        addLog(`> You eat the ${item.name.toLowerCase()}. Not bad.`, item.fg);
        return;
      }
    }
  }
  // Casino
  const cs = state.stations.casino;
  if (cs && isAdjacentToStation(cs)) { handleCasinoInteract(); return; }
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

// ── Rock collection and casino interact (§4.2) ───────────────────────────────

const ROCK_COLORS      = { red: '#ff5555', yellow: '#ffd633', blue: '#66ccff' };
const ROCK_PEAK_COLORS = { red: '#ff7777', yellow: '#ffea44', blue: '#88ddff' };

function dimColor(hex, factor) {
  const h = hex.replace('#', '');
  const r = Math.floor(parseInt(h.slice(0,2), 16) * factor);
  const g = Math.floor(parseInt(h.slice(2,4), 16) * factor);
  const b = Math.floor(parseInt(h.slice(4,6), 16) * factor);
  const toHex = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function pickThreeBlinkTicks() {
  while (true) {
    const ticks = [
      1 + Math.floor(Math.random() * 239),
      1 + Math.floor(Math.random() * 239),
      1 + Math.floor(Math.random() * 239),
    ].sort((a, b) => a - b);
    if (ticks[1] - ticks[0] >= 30 && ticks[2] - ticks[1] >= 30) return ticks;
  }
}

function rockDirection(rock) {
  const dx = rock.x - state.player.x;
  const dy = rock.y - state.player.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < 5 && ady < 5) return 'nearby';
  if (adx > ady * 2)  return dx > 0 ? 'to the east'      : 'to the west';
  if (ady > adx * 2)  return dy > 0 ? 'to the south'     : 'to the north';
  if (dx > 0 && dy > 0) return 'to the south-east';
  if (dx > 0 && dy < 0) return 'to the north-east';
  if (dx < 0 && dy > 0) return 'to the south-west';
  return 'to the north-west';
}

function collectRock(color, rock) {
  const prevCount = Object.values(state.shinyRocks).filter(r => r.collected).length;
  rock.collected = true;
  addLog(`> You pick up a shiny ${color} stone. It's smaller than expected.`, ROCK_COLORS[color]);
  markDirty(rock.x, rock.y);
  renderDirty();
  if (prevCount === 0) logHistory('Found the first stone.');
  const allCollected = Object.values(state.shinyRocks).every(r => r.collected);
  if (allCollected) setTimeout(() => addLog('> You hold three stones. They are warm in your hand.', '#f0f0f0'), 1000);
}

function handleCasinoUnlock() {
  const cs = state.stations.casino;
  const rocks = state.shinyRocks;
  const have = Object.entries(rocks).filter(([, r]) => r.collected).map(([c]) => `1 ${c} stone`);
  if (have.length < 3) {
    const haveStr = have.length === 0 ? 'none' : have.join(', ');
    wrapLog(`> The door is boarded shut. Heavy lock with three coloured slots. You have: ${haveStr}.`, '#555555');
    return;
  }
  wrapLog('> You fit the red stone into the lock. It clicks.', '#ff5555');
  setTimeout(() => wrapLog('> You fit the yellow stone. Another click.', '#ffd633'), 1000);
  setTimeout(() => wrapLog('> You fit the blue stone. The boards fall away.', '#66ccff'), 2000);
  setTimeout(() => wrapLog('> The door swings open. Behind it: red velvet, yellow lights, blue smoke.', '#2244aa'), 3000);
  setTimeout(() => {
    wrapLog("> A voice from inside: 'we've been waiting.'", '#aa3333');
    cs.unlocked = true;
    logHistory('Cracked open the boarded door.');
    stampCasino(false);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
  }, 4000);
}

function handleCasinoInteract() {
  const cs = state.stations.casino;
  if (!cs.unlocked) { handleCasinoUnlock(); return; }
  if (state.marketOpen && state.bank.card?.tier !== 'black') {
    addLog("> A handwritten sign on the door: 'OPEN AFTER DARK ONLY.'", '#555555');
    return;
  }
  openCasinoMenu();
}

function openCasinoMenu() {
  const cs = state.stations.casino;
  if (state.bank.casinoStartCredits == null) state.bank.casinoStartCredits = state.player.gold;

  state.gameState = 'casino';

  const BOX_W  = 60, INNER_W = 58, LP_W = 18, RP_W = 39;
  const BOX_H  = 24;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const DIVX   = BOX_X + 1 + LP_W;
  const RPX    = DIVX + 1;
  const BC = '#2244aa', DC = '#333333', WC = '#555555';

  const SUITS      = ['♠', '♥', '♦', '♣'];
  const SUIT_COLORS = { '♠': '#f0f0f0', '♥': '#ff5555', '♦': '#ff9933', '♣': '#66cc66' };
  const BLACK_SUITS = new Set(['♠', '♣']);

  let betSize    = cs.lastBetSize || 50;
  let spinState  = 'idle';   // 'idle' | 'spinning' | 'result'
  let spinFrame  = 0;
  let reels      = [null, null, null];
  let finalReels = [null, null, null];
  let resultType = null;
  let payout     = 0;
  let confetti   = [];

  function spawnConfetti(count) {
    const chars  = ['*', '+', '·', '◆', '■', '♦'];
    const colors = ['#ffd633', '#ff5555', '#66cc66', '#ff9933', '#66ccff', '#cc66cc'];
    for (let i = 0; i < count; i++) {
      confetti.push({
        x:     BOX_X + 1 + Math.floor(Math.random() * (BOX_W - 2)),
        y:     BOX_Y + 1,
        fy:    BOX_Y + 1,
        vy:    0.3 + Math.random() * 0.4,
        char:  chars[Math.floor(Math.random() * chars.length)],
        color: colors[Math.floor(Math.random() * colors.length)],
        life:  60 + Math.floor(Math.random() * 40),
      });
    }
  }

  // Machine art: 14 rows × 18 chars.  Rows 5-7 overdrawn by reel frames.
  const MA = [
    '  .------------.  ',
    '  |            |  ',
    '  |     $      |  ',
    '  |            |  ',
    '  |------------|  ',
    '  |            |  ',  // rAy-1 — overdrawn by reel frame top
    '  |            |  ',  // rAy   — overdrawn by reel symbol
    '  |            |  ',  // rAy+1 — overdrawn by reel frame bottom
    '  |------------|  ',
    '  |            |  ',
    '  |  ████      |  ',  // lever
    '  |            |  ',
    '  |            |  ',
    "  '------------'  ",
  ];

  function artCharFg(ch) {
    if (ch === '$')  return '#ffd633';
    if (ch === '█') return '#aa3333';
    if (ch === '.' || ch === "'" || ch === '|' || ch === '-') return BC;
    return '#f0f0f0';
  }

  function reelColor(sym, override) {
    if (override) return override;
    return sym ? SUIT_COLORS[sym] : WC;
  }

  function resultOverrideColor() {
    if (!resultType) return null;
    if (resultType === 'jackpot') return '#ffd633';
    if (resultType === 'pair')    return '#66cc66';
    if (resultType === 'color')   return '#ff9933';
    return '#ff5555';
  }

  function statusLine() {
    if (spinState === 'spinning') return ['...', '#ffd633'];
    if (resultType === 'jackpot') return ['the house... loses tonight.', '#ffd633'];
    if (resultType === 'pair')    return ['well well well.', '#66cc66'];
    if (resultType === 'color')   return ['well well well.', '#66cc66'];
    if (resultType === 'loss')    return ['better luck next time.', WC];
    if (state.player.gold < betSize) return ["come back when you've got somethin'.", '#ff5555'];
    if (cs.dailyBetTotal + betSize > 2000) return ["you've had enough tonight, friend.", '#ff9933'];
    return ['feeling lucky?', '#aa3333'];
  }

  function drawBox() {
    display.draw(BOX_X, BOX_Y, '╔', BC, BG); display.draw(BOX_X + BOX_W - 1, BOX_Y, '╗', BC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, BOX_Y, '═', BC, BG);
    const botY = BOX_Y + BOX_H - 1;
    display.draw(BOX_X, botY, '╚', BC, BG); display.draw(BOX_X + BOX_W - 1, botY, '╝', BC, BG);
    for (let i = 1; i < BOX_W - 1; i++) display.draw(BOX_X + i, botY, '═', BC, BG);
    for (let r = 1; r < BOX_H - 1; r++) {
      display.draw(BOX_X, BOX_Y + r, '║', BC, BG);
      display.draw(BOX_X + BOX_W - 1, BOX_Y + r, '║', BC, BG);
    }
  }

  function drawInnerBlank() {
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++)
        display.draw(BOX_X + x, BOX_Y + r, ' ', '#f0f0f0', BG);
  }

  function drawHeader() {
    const ay = BOX_Y + 1;
    const title = 'THE CASINO', hint = 'press esc to leave';
    for (let i = 0; i < title.length; i++) display.draw(BOX_X + 1 + i, ay, title[i], '#5577cc', BG);
    const hx = BOX_X + 1 + INNER_W - hint.length;
    for (let i = 0; i < hint.length; i++) display.draw(hx + i, ay, hint[i], DC, BG);
    const ay2 = BOX_Y + 2;
    for (let i = 0; i < INNER_W; i++) display.draw(BOX_X + 1 + i, ay2, '═', DC, BG);
  }

  function drawMachine() {
    const oc = resultOverrideColor();
    for (let ri = 0; ri < MA.length; ri++) {
      const ay = BOX_Y + 3 + ri;
      const row = (MA[ri] || '').padEnd(LP_W);
      for (let i = 0; i < LP_W; i++) {
        const ch = row[i] || ' ';
        const fg = (ri >= 5 && ri <= 7) ? BC : artCharFg(ch); // reel rows overdrawn below
        display.draw(BOX_X + 1 + i, ay, ch, fg, BG);
      }
      display.draw(DIVX, ay, '│', DC, BG);
    }
    // Reel frames — 3 rows centred on rAy (art rows 5/6/7)
    const rAy  = BOX_Y + 3 + 6;
    const rPos = [2, 6, 10]; // x-offsets within inner LP area
    const spinSym = () => SUITS[Math.floor(Math.random() * 4)];
    for (let ri = 0; ri < 3; ri++) {
      const x = BOX_X + 1 + rPos[ri];
      // top frame row
      display.draw(x,     rAy - 1, '┌', BC, BG);
      display.draw(x + 1, rAy - 1, '─', BC, BG);
      display.draw(x + 2, rAy - 1, '┐', BC, BG);
      // middle: borders + symbol
      display.draw(x,     rAy, '│', BC, BG);
      if (reels[ri]) {
        display.draw(x + 1, rAy, reels[ri], reelColor(reels[ri], oc), BG);
      } else if (spinState === 'spinning') {
        display.draw(x + 1, rAy, spinSym(), '#888888', BG);
      } else {
        display.draw(x + 1, rAy, '?', WC, BG);
      }
      display.draw(x + 2, rAy, '│', BC, BG);
      // bottom frame row
      display.draw(x,     rAy + 1, '└', BC, BG);
      display.draw(x + 1, rAy + 1, '─', BC, BG);
      display.draw(x + 2, rAy + 1, '┘', BC, BG);
    }
    display.draw(DIVX, rAy, '│', DC, BG);
  }

  function rrow(offset, text, fg) {
    const ay = BOX_Y + 3 + offset;
    const p = menuPad(text, RP_W);
    for (let i = 0; i < RP_W; i++) display.draw(RPX + i, ay, p[i] || ' ', fg, BG);
  }

  function rsep(offset) {
    const ay = BOX_Y + 3 + offset;
    for (let i = 0; i < RP_W; i++) display.draw(RPX + i, ay, '═', DC, BG);
  }

  function drawRightPane() {
    const oc = resultOverrideColor();
    rrow(0, '', '#f0f0f0');
    rrow(1, 'THE BACK ROOM', BC);
    rrow(2, '', '#f0f0f0');
    rrow(3, 'Gold: ' + formatCredits(state.player.gold) + 'g', '#ffd633');
    rrow(4, "Tonight's spend: " + formatCredits(cs.dailyBetTotal) + 'g', WC);
    rrow(5, 'Daily limit: 2000g', WC);
    rrow(6, '', '#f0f0f0');
    rsep(7);
    rrow(8, '', '#f0f0f0');
    rrow(9, 'BET SIZE:', '#f0f0f0');
    // Bet rows — inline coloring
    const bets = [[1,10,'[1] 10g   '],[2,50,'[2] 50g   '],[3,100,'[3] 100g  '],[4,500,'[4] 500g']];
    { const ay1 = BOX_Y + 3 + 10;
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, ay1, ' ', '#f0f0f0', BG);
      let cx = RPX + 2;
      for (const [,val,lbl] of bets.slice(0,2)) { const sel = betSize === val; for (const ch of lbl) { display.draw(cx++, ay1, ch, sel ? BC : WC, BG); } }
    }
    { const ay2 = BOX_Y + 3 + 11;
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, ay2, ' ', '#f0f0f0', BG);
      let cx = RPX + 2;
      for (const [,val,lbl] of bets.slice(2,4)) { const sel = betSize === val; for (const ch of lbl) { display.draw(cx++, ay2, ch, sel ? BC : WC, BG); } }
    }
    rrow(12, '', '#f0f0f0');
    rsep(13);
    rrow(14, '', '#f0f0f0');
    rrow(15, '', '#f0f0f0');
    rrow(16, '', '#f0f0f0');
    const [sTxt, sFg] = statusLine();
    rrow(17, sTxt, sFg);
    rrow(18, '', '#f0f0f0');
    rsep(19);
    // Action hints row
    { const ay = BOX_Y + 3 + 20;
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, ay, ' ', '#f0f0f0', BG);
      const limited = cs.dailyBetTotal + betSize > 2000;
      const cantAfford = state.player.gold < betSize;
      const hint = spinState === 'spinning' ? '[ SPINNING... ]'
                 : limited ? '[ DAILY LIMIT REACHED ]'
                 : '[ SPACE — SPIN ]';
      const hfg  = spinState === 'spinning' ? '#ffd633'
                 : limited ? WC
                 : (cantAfford ? WC : '#66cc66');
      const hx = RPX + Math.max(0, Math.floor((RP_W - hint.length) / 2));
      for (let i = 0; i < hint.length && hx + i < RPX + RP_W; i++) display.draw(hx + i, ay, hint[i], hfg, BG);
    }
  }

  function redraw() {
    drawInnerBlank();
    drawHeader();
    drawMachine();
    drawRightPane();
    // Vertical divider rows 3 onward
    for (let r = 3; r < BOX_H - 1; r++) display.draw(DIVX, BOX_Y + r, '│', DC, BG);
  }

  function startSpin() {
    if (spinState !== 'idle') return;
    if (state.player.gold < betSize) return;
    if (cs.dailyBetTotal + betSize > 2000) return;
    state.player.gold    = Math.round((state.player.gold - betSize) * 10) / 10;
    cs.dailyBetTotal        = Math.round((cs.dailyBetTotal + betSize) * 10) / 10;
    cs.spunToday++;
    drawStatusBar();
    finalReels = [SUITS[Math.floor(Math.random()*4)], SUITS[Math.floor(Math.random()*4)], SUITS[Math.floor(Math.random()*4)]];
    reels = [null, null, null]; resultType = null; payout = 0;
    spinState = 'spinning'; spinFrame = 0;
    redraw();
  }

  function calcPayout() {
    const [a,b,c] = finalReels;
    const allSame = a===b && b===c;
    const anyPair = a===b || b===c || a===c;
    const aB = BLACK_SUITS.has(a), bB = BLACK_SUITS.has(b), cB = BLACK_SUITS.has(c);
    const sameColor = (aB&&bB&&cB) || (!aB&&!bB&&!cB);
    if (allSame)       { resultType = 'jackpot'; payout = Math.round(betSize * 2 * 10) / 10;    spawnConfetti(50); }
    else if (anyPair)  { resultType = 'pair';    payout = Math.round(betSize * 1.25 * 10) / 10; spawnConfetti(12); }
    else if (sameColor){ resultType = 'color';   payout = Math.round(betSize * 1.5 * 10) / 10;  spawnConfetti(25); }
    else               { resultType = 'loss';    payout = 0; }
    if (payout > 0) { state.player.gold = Math.round((state.player.gold + payout) * 10) / 10; drawStatusBar(); }
    if (resultType === 'loss') { cs.lossesTonight = Math.round(((cs.lossesTonight || 0) + betSize) * 10) / 10; }
    if (resultType === 'jackpot') {
      awardStamp(1, false);
      addLog(`> [CASINO] Jackpot! +${formatCredits(payout)}g and 1 stamp.`, '#ffd633');
      if (!cs.jackpotLogged) { cs.jackpotLogged = true; logHistory('The house lost. Once.'); }
    } else if (resultType === 'pair')  addLog(`> [CASINO] Two of a kind. +${formatCredits(payout)}g.`, '#66cc66');
    else if (resultType === 'color') addLog(`> [CASINO] Same color. +${formatCredits(payout)}g.`, '#ff9933');
  }

  function closeCasino() {
    casinoMenuCloseFn = null;
    window.removeEventListener('keydown', casinoKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }
  casinoMenuCloseFn = closeCasino;

  function casinoKeyHandler(e) {
    if (state.gameState !== 'casino') return;
    if (e.key === 'Escape') { e.preventDefault(); closeCasino(); return; }
    if (spinState === 'spinning') return;
    const betMap = { '1': 10, '2': 50, '3': 100, '4': 500 };
    if (betMap[e.key] !== undefined) { betSize = betMap[e.key]; cs.lastBetSize = betSize; redraw(); return; }
    if (e.key === ' ') { e.preventDefault(); startSpin(); return; }
  }
  window.addEventListener('keydown', casinoKeyHandler);

  drawBox();
  redraw();

  // rAF spin animation loop
  ;(function casinoLoop() {
    if (state.gameState !== 'casino') return;
    requestAnimationFrame(casinoLoop);
    // Confetti render — always runs regardless of spin state
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      if (p.y >= BOX_Y + 1 && p.y < BOX_Y + BOX_H - 1) {
        display.draw(Math.floor(p.x), Math.floor(p.y), ' ', '#f0f0f0', BG);
      }
      p.fy = (p.fy || p.y) + p.vy;
      p.y = Math.floor(p.fy);
      p.life--;
      if (p.life <= 0 || p.y >= BOX_Y + BOX_H - 1) {
        confetti.splice(i, 1);
      } else {
        display.draw(Math.floor(p.x), p.y, p.char, p.color, BG);
      }
    }
    if (spinState !== 'spinning') return;
    spinFrame++;
    // Update reel cycling display every 2 frames
    if (spinFrame % 2 === 0) {
      reels = [
        reels[0] || null,   // keep stopped reels
        reels[1] || null,
        reels[2] || null,
      ];
      drawMachine();
      // Update credits and spend lines
      rrow(3, 'Gold: ' + formatCredits(state.player.gold) + 'g', '#ffd633');
    }
    // Reel stop schedule
    if (spinFrame === 60  && !reels[0]) { reels[0] = finalReels[0]; drawMachine(); }
    if (spinFrame === 90  && !reels[1]) { reels[1] = finalReels[1]; drawMachine(); }
    if (spinFrame === 120 && !reels[2]) {
      reels[2] = finalReels[2];
      spinState = 'result';
      calcPayout();
      redraw();
      setTimeout(() => {
        if (spinState === 'result') { spinState = 'idle'; redraw(); }
      }, 1200);
    }
  })();
}

// ── Inventory screen (§3.9) ──────────────────────────────────────────────────

function showInventory() {
  state.gameState = 'inventory';
  let detailCell = null; // null = grid view; 0-7 = detail view index
  let selectedSkill = null;
  let skillErrMsg   = null;
  let skillErrTimer = null;

  const BOX_W  = 70, BOX_H = 38;
  const BOX_X  = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y  = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const IW     = 68;
  const CONT_X = BOX_X + 1;
  const CELL_W = 17, CELL_H = 7;

  const DC = '#333333', WC = '#555555', PC = '#f0f0f0', SC = '#aaaaaa';

  const INV_CELLS = [
    { key: 'carrying',  name: 'CARRYING',    row: 0, col: 0 },
    { key: 'storage',   name: 'STORAGE',     row: 0, col: 1 },
    { key: 'wallet',    name: 'WALLET',      row: 0, col: 2 },
    { key: 'card',      name: 'CREDIT CARD', row: 0, col: 3 },
    { key: 'equipment', name: 'EQUIPMENT',   row: 1, col: 0 },
    { key: 'wardrobe',  name: 'WARDROBE',    row: 1, col: 1 },
    { key: 'cooking',   name: 'COOKING',     row: 1, col: 2 },
    { key: 'stats',     name: 'STATS',       row: 1, col: 3 },
  ];

  const CELL_COLORS = {
    carrying:  '#f0f0f0', storage:  '#ff6600', wallet:  '#ffd633',
    card:      '#66ccff', equipment:'#aa6633', wardrobe:'#aa66ff',
    cooking:   '#ff8800', stats:    '#66cc66',
  };

  const SKILL_DEFS = [
    { key: 'endurance',   name: 'ENDURANCE',   maxPips: 3, costs: [500, 5000, 50000],
      descs: ['You can carry more than before.', 'Your carrying capacity has grown significantly.', 'You can carry a remarkable amount.'] },
    { key: 'aquatics',    name: 'AQUATICS',    maxPips: 1, costs: [3000],
      descs: ['The water no longer stops you.'] },
    { key: 'interfacing', name: 'INTERFACING', maxPips: 3, costs: [500, 5000, 50000],
      descs: ['You no longer need the bench to work.', 'Your technique is improving.', "You've refined this to near-instinct."] },
  ];

  function getSkillPips(def) {
    if (def.key === 'aquatics') return state.skills.aquatics?.purchased ? 1 : 0;
    return state.skills[def.key]?.pips || 0;
  }

  function cellColor(key) {
    return CELL_COLORS[key] || '#66ccff';
  }

  function isCellLocked(key) {
    if (key === 'storage')   return !state.stations.storage?.unlocked;
    if (key === 'card')      return !state.bank.card?.tier;
    if (key === 'equipment') return !state.mine?.discovered;
    if (key === 'cooking')   return !state.player.homeItems?.includes('kitchen');
    return false;
  }

  // ── Shared drawing helpers ────────────────────────────────────────────────
  function outerBorder(ay, col) {
    display.draw(BOX_X, ay, '║', col, BG);
    display.draw(BOX_X + BOX_W - 1, ay, '║', col, BG);
  }
  function irow(ay, text, fg, col) {
    const bc = col || '#66ccff';
    outerBorder(ay, bc);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(CONT_X + i, ay, p[i] || ' ', fg, BG);
  }
  function sep(ay, col) {
    irow(ay, '─'.repeat(IW), DC, col);
  }

  // ── Outer frame ───────────────────────────────────────────────────────────
  function drawOuterFrame(titleStr, bc) {
    const tc = bc || '#66ccff';
    for (let r = 1; r < BOX_H - 1; r++)
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', PC, BG);
    display.draw(BOX_X, BOX_Y, '╔', tc, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', tc, BG);
    for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y, '═', tc, BG);
    { const ay = BOX_Y+1; outerBorder(ay, tc);
      const hint = 'esc to exit';
      for (let i = 0; i < IW; i++) {
        const ch = i < titleStr.length ? titleStr[i] : (i >= IW-hint.length ? hint[i-(IW-hint.length)] : ' ');
        display.draw(CONT_X+i, ay, ch, i < titleStr.length ? PC : (i >= IW-hint.length ? DC : PC), BG);
      }
    }
    { const ay = BOX_Y+2; outerBorder(ay, tc);
      for (let i = 0; i < IW; i++) display.draw(CONT_X+i, ay, '═', DC, BG); }
    { const ay = BOX_Y+BOX_H-2; outerBorder(ay, tc);
      for (let i = 0; i < IW; i++) display.draw(CONT_X+i, ay, '═', DC, BG); }
    display.draw(BOX_X, BOX_Y+BOX_H-1, '╚', tc, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+BOX_H-1, '╝', tc, BG);
    for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y+BOX_H-1, '═', tc, BG);
  }

  // ── Cell drawing (grid view) ──────────────────────────────────────────────
  function drawCell(cell, idx) {
    const cx = CONT_X + cell.col * CELL_W;
    const cy = BOX_Y + 3 + cell.row * CELL_H;
    const locked = isCellLocked(cell.key);
    const cc = locked ? '#222222' : cellColor(cell.key);
    const textFg = locked ? '#444444' : PC;
    const subFg  = locked ? '#333333' : SC;
    // Top border with key number and title
    display.draw(cx, cy, '┌', cc, BG);
    const titleInner = ` ${idx+1} ${cell.name} `;
    for (let i = 1; i < CELL_W-1; i++) {
      const ch = i < titleInner.length ? titleInner[i-1] : '─';
      display.draw(cx+i, cy, ch, ch === '─' ? cc : (locked ? '#444444' : cc), BG);
    }
    display.draw(cx+CELL_W-1, cy, '┐', cc, BG);
    // Side borders + content rows
    for (let r = 1; r < CELL_H-1; r++) {
      display.draw(cx, cy+r, '│', cc, BG);
      display.draw(cx+CELL_W-1, cy+r, '│', cc, BG);
      for (let i = 1; i < CELL_W-1; i++) display.draw(cx+i, cy+r, ' ', PC, BG);
    }
    // Bottom border
    display.draw(cx, cy+CELL_H-1, '└', cc, BG);
    for (let i = 1; i < CELL_W-1; i++) display.draw(cx+i, cy+CELL_H-1, '─', cc, BG);
    display.draw(cx+CELL_W-1, cy+CELL_H-1, '┘', cc, BG);

    // Content lines (up to 4 inside cell, rows cy+1 to cy+4)
    const lines = getCellSummary(cell.key);
    const CW = CELL_W - 2; // inner width
    for (let li = 0; li < Math.min(lines.length, 4); li++) {
      const s = lines[li] || '';
      const fg = li === 0 ? textFg : subFg;
      for (let i = 0; i < CW; i++) display.draw(cx+1+i, cy+1+li, (s[i]||' '), fg, BG);
    }
    if (locked) {
      const lk = '[locked]';
      for (let i = 0; i < CW; i++) display.draw(cx+1+i, cy+2, lk[i]||' ', '#444444', BG);
    }
  }

  function getCellSummary(key) {
    const inv = state.player.inventory;
    const cap = state.player.inventoryCaps;
    switch (key) {
      case 'carrying': return [
        `RM:    ${inv.rm} / ${cap.rm}`,
        `Widg:  ${inv.widgets} / ${cap.widgets}`,
        `Cryst: ${state.mine.crystals || 0} / 5`,
        '',
      ];
      case 'storage': {
        if (!state.stations.storage?.unlocked) return ['[locked]','','',''];
        const s = state.storage;
        const lines = [`RM:   ${s.rm} / ${s.rmCap}`, `Widg: ${s.widgets} / ${s.widgetCap}`];
        if (state.loadingPort?.unlocked) lines.push(`LP:   ${state.loadingPort.widgets} / ${state.loadingPort.capacity}`);
        return lines;
      }
      case 'wallet': {
        const gFg = state.player.gold < 0 ? '#ff5555' : '#ffd633';
        return [
          `Gold:   ${formatCredits(state.player.gold)}g`,
          `Stamps: ${state.player.stamps}`,
          `Bank:   ${formatCredits(state.bank.deposit || 0)}g`,
          state.debt > 0 ? `Debt:   ${formatCredits(state.debt)}g` : '',
        ];
      }
      case 'card': {
        const card = state.bank.card;
        if (!card.tier) return ['[not owned]','','',''];
        const avail = Math.max(0, card.limit - card.balance);
        return [
          `Tier:  ${card.tier.toUpperCase()}`,
          `Bal:   ${formatCredits(card.balance)} / ${formatCredits(card.limit)}`,
          `Avail: ${formatCredits(avail)}g`,
          `Score: ${(state.bank.creditRatingScore||0).toFixed(1)} (${state.bank.creditRating||'CC'})`,
        ];
      }
      case 'equipment': {
        if (!state.mine?.discovered) return ['[locked]','Mine: not found','',''];
        const pNames = ['Bare Hands','Pickaxe','Brand Pickaxe'];
        const daysToReset = 2 - (state.day % 2);
        return [
          `Pick: ${pNames[state.skills.pickaxeLevel||0]}`,
          `Lamp: ${state.skills.lantern ? 'Yes' : 'No'}`,
          `Mine: ${daysToReset}d reset`,
          `Mined: ${state.mine.totalMined||0} total`,
        ];
      }
      case 'wardrobe': {
        const cn = state.player.colorName || 'DEFAULT';
        return [`Outfit:`, ` ${cn}`, `Color:`, ''];
      }
      case 'cooking': {
        if (!state.player.homeItems?.includes('kitchen')) return ['[locked]','Buy cottage','+ kitchen',''];
        const buff = state.cooking?.activeBuff;
        const gardenCount = Object.values(state.garden||{}).filter(v=>v===true).length;
        if (!buff) return ['Buff: None', '', `Garden: ${gardenCount}/12`, ''];
        const daysLeft = buff.expiresDay ? Math.max(0, buff.expiresDay - state.day) : '?';
        return [`Buff: ${buff.name||'active'}`, ` ${buff.desc||''}`, ` ${daysLeft}d left`, `Garden: ${gardenCount}/12`];
      }
      case 'stats': return [
        `Made:  ${formatCredits(state.widgetsMade)}`,
        `Sold:  ${formatCredits(state.lifetimeWidgetsMade||0)}`,
        `Days:  ${state.day}`,
        `Phase: ${state.phase}`,
      ];
    }
    return ['','','',''];
  }

  // ── Grid view ─────────────────────────────────────────────────────────────
  function drawGrid() {
    drawOuterFrame('INVENTORY', '#66ccff');
    for (let i = 0; i < INV_CELLS.length; i++) drawCell(INV_CELLS[i], i);
    // Footer row
    const footerRow = BOX_Y + 3 + 2 * CELL_H;
    for (let r = footerRow; r < BOX_Y + BOX_H - 2; r++) {
      outerBorder(r, '#66ccff');
      for (let x = 1; x < BOX_W - 1; x++) display.draw(BOX_X+x, r, ' ', PC, BG);
    }
    irow(BOX_Y+BOX_H-2, '1-8: open detail   ESC: close', WC);
  }

  // ── Detail views ─────────────────────────────────────────────────────────
  function drawDetail(idx) {
    const cell = INV_CELLS[idx];
    const cc   = cellColor(cell.key);
    drawOuterFrame(`INVENTORY — ${cell.name}`, cc);
    const cy = BOX_Y + 3;
    const detailFns = {
      carrying:  drawDetailCarrying,
      storage:   drawDetailStorage,
      wallet:    drawDetailWallet,
      card:      drawDetailCard,
      equipment: drawDetailEquipment,
      wardrobe:  drawDetailWardrobe,
      cooking:   drawDetailCooking,
      stats:     drawDetailStats,
    };
    (detailFns[cell.key] || (() => {}))(cy, cc);
    irow(BOX_Y+BOX_H-2, 'ESC: back to grid', WC, cc);
  }

  function drawDetailCarrying(cy, cc) {
    const inv = state.player.inventory;
    const cap = state.player.inventoryCaps;
    irow(cy,   'CARRIED ITEMS', cc);
    sep(cy+1,  cc);
    if (inv.rm === 0 && inv.widgets === 0 && (state.mine.crystals||0) === 0) {
      irow(cy+2, 'Your pockets are empty.', WC, cc);
    } else {
      irow(cy+2, `Raw Materials: ${inv.rm} / ${cap.rm}`, PC, cc);
      irow(cy+3, `Widgets:       ${inv.widgets} / ${cap.widgets}`, PC, cc);
      irow(cy+4, `Crystals:      ${state.mine.crystals||0} / 5`, '#66ccff', cc);
    }
    sep(cy+5, cc);
    irow(cy+6, 'CARRYING CAPACITY', cc);
    const e = state.skills.endurance?.pips || 0;
    irow(cy+7, `Endurance level: ${e} / 3`, e > 0 ? '#66cc66' : WC, cc);
    irow(cy+8, `Max RM / Widgets: ${cap.rm} each`, PC, cc);
    irow(cy+9, 'Upgrade at INVENTORY → EQUIPMENT', SC, cc);
  }

  function drawDetailStorage(cy, cc) {
    if (!state.stations.storage?.unlocked) {
      irow(cy,   '[locked]', DC, cc);
      irow(cy+1, 'Storage unlocks in Phase 2.', WC, cc);
      return;
    }
    const s = state.storage;
    irow(cy,   'STORAGE CONTENTS', cc);
    sep(cy+1,  cc);
    irow(cy+2, `Raw Materials: ${s.rm} / ${s.rmCap}`, PC, cc);
    irow(cy+3, `Widgets:       ${s.widgets} / ${s.widgetCap}`, PC, cc);
    if (state.loadingPort?.unlocked) {
      sep(cy+4, cc);
      irow(cy+5, 'LOADING PORT', cc);
      irow(cy+6, `Widgets at port: ${state.loadingPort.widgets} / ${state.loadingPort.capacity}`, PC, cc);
      irow(cy+7, 'Port auto-sells at dawn.', SC, cc);
    }
    sep(cy+(state.loadingPort?.unlocked ? 8 : 4), cc);
    irow(cy+(state.loadingPort?.unlocked ? 9 : 5), 'UPGRADES', cc);
    const exp1 = state.skills.storageExp1 > 0;
    const exp2 = state.skills.storageExp2 > 0;
    irow(cy+(state.loadingPort?.unlocked ? 10 : 6), `RM cap:  ${exp1 ? '✓' : ' '} Exp1   ${exp2 ? '✓' : ' '} Exp2`, exp2 ? '#66cc66' : PC, cc);
  }

  function drawDetailWallet(cy, cc) {
    const goldFg = state.player.gold < 0 ? '#ff5555' : '#ffd633';
    irow(cy,   'FINANCES', cc);
    sep(cy+1,  cc);
    irow(cy+2, `Gold on hand:    ${formatCredits(state.player.gold)}g`, goldFg, cc);
    irow(cy+3, `Stamps:          ${state.player.stamps}`, COLOR_STAMPS, cc);
    irow(cy+4, `Bank deposit:    ${formatCredits(state.bank.deposit||0)}g`, '#66ccff', cc);
    if (state.bank.deposit > 0) {
      const interest = Math.round(state.bank.deposit * 0.01 * 10) / 10;
      irow(cy+5, `  Daily interest: +${interest}g (1%)`, '#66cc66', cc);
    }
    if (state.debt > 0) {
      irow(cy+6, `Debt:            ${formatCredits(state.debt)}g`, '#ff5555', cc);
    }
    sep(cy+7, cc);
    irow(cy+8,  'LIFETIME TOTALS', cc);
    irow(cy+9,  `Gold earned: ${formatCredits(state.lifetimeGoldEarned)}g`, WC, cc);
    irow(cy+10, `Widgets made: ${formatCredits(state.lifetimeWidgetsMade||0)}`, WC, cc);
    sep(cy+11, cc);
    irow(cy+12, 'DAILY COSTS', cc);
    const carryFg = state.player.inventory.widgets > 0 || state.player.inventory.rm > 0 ? '#ff9933' : WC;
    irow(cy+13, `Carry cost: ${state.skills.reducedCarry > 0 ? 'reduced' : 'normal'}`, carryFg, cc);
    const wages = state.workers.couriers.length * 2;
    irow(cy+14, `Courier wages: ${wages > 0 ? wages+'g/day' : 'none'}`, wages > 0 ? '#ff9933' : WC, cc);
  }

  function drawDetailCard(cy, cc) {
    const card = state.bank.card;
    if (!card?.tier) {
      irow(cy,   'CREDIT CARD', cc);
      sep(cy+1,  cc);
      irow(cy+2, 'No card on file.', WC, cc);
      irow(cy+3, 'Visit the Bank to apply.', WC, cc);
      irow(cy+4, 'Requires CC credit rating.', WC, cc);
      sep(cy+5, cc);
      irow(cy+6, 'CREDIT RATING', cc);
      irow(cy+7, `Score: ${(state.bank.creditRatingScore||0).toFixed(1)} (${state.bank.creditRating||'CC'})`, PC, cc);
      irow(cy+8, 'Improve: sell widgets, pay debts.', SC, cc);
      return;
    }
    const tCol   = getCardTierColor(card.tier);
    const tierDef = CARD_TIERS[card.tier];
    const pct  = card.limit > 0 ? card.balance / card.limit : 0;
    const pctP = Math.round(pct * 100);
    const balFg = pct > 0.8 ? '#ff5555' : pct > 0.5 ? '#ff9933' : '#ffd633';
    const avail = Math.max(0, card.limit - card.balance);
    irow(cy,   `${card.tier.toUpperCase()} CARD`, tCol);
    sep(cy+1,  cc);
    irow(cy+2, `Balance: ${formatCredits(card.balance)}g  /  Limit: ${formatCredits(card.limit)}g  (${pctP}%)`, balFg, cc);
    irow(cy+3, `Available: ${formatCredits(avail)}g`, '#66cc66', cc);
    irow(cy+4, `Interest: ${(tierDef.interestRate*100).toFixed(0)}%/statement   Score: ${(state.bank.creditRatingScore||0).toFixed(1)} (${state.bank.creditRating||'CC'})`, PC, cc);
    sep(cy+5, cc);
    irow(cy+6, 'PERKS', tCol);
    const pg = card.tier === 'black' ? '▪' : '✦';
    tierDef.perks.forEach((p, i) => irow(cy+7+i, `${pg} ${p.substring(0,IW-4)}`, WC, cc));
    const nextRow = cy + 7 + tierDef.perks.length;
    sep(nextRow, cc);
    const minPay = card.minimumPaymentDue;
    if (minPay > 0) {
      irow(nextRow+1, `Payment due: ${formatCredits(minPay)}g by day ${card.paymentDueDay}`, state.day >= card.paymentDueDay ? '#ff5555' : PC, cc);
    } else {
      irow(nextRow+1, 'No balance. Nothing due.', '#66cc66', cc);
    }
    irow(nextRow+2, 'Visit the Bank to pre-pay.', SC, cc);
  }

  function drawDetailEquipment(cy, cc) {
    const pickNames = ['Bare Hands', 'Pickaxe', 'Brand Name Pickaxe'];
    const hitsPerRock = [3, 2, 1];
    irow(cy,   'EQUIPMENT', cc);
    sep(cy+1,  cc);
    irow(cy+2, `Pickaxe: ${pickNames[state.skills.pickaxeLevel||0]}`, PC, cc);
    irow(cy+3, `Hits to break rock: ${hitsPerRock[state.skills.pickaxeLevel||0]}`, SC, cc);
    irow(cy+4, `Lantern: ${state.skills.lantern ? 'Yes — ore shows through walls' : 'No'}`, state.skills.lantern ? '#66cc66' : WC, cc);
    irow(cy+5, `Crystals: ${state.mine.crystals||0} / 5`, '#66ccff', cc);
    const daysToReset = 2 - (state.day % 2);
    irow(cy+6, `Mine resets: ${daysToReset}d   Total mined: ${state.mine.totalMined||0}`, WC, cc);
    sep(cy+7, cc);
    irow(cy+8, 'SKILLS', cc);
    const LP = 33, RP = 34;
    SKILL_DEFS.forEach((def, si) => {
      const pips  = getSkillPips(def);
      const baseR = cy + 9 + si * 3;
      const isActive = selectedSkill === def.key;
      const nameFg = isActive ? PC : WC;
      irow(baseR, `${si+1}. ${def.name}`, nameFg, cc);
      // Pip row
      outerBorder(baseR+1, cc);
      let c = CONT_X;
      for (let pi = 0; pi < def.maxPips; pi++) {
        const bought = pi < pips;
        const fg = bought ? '#66cc66' : DC;
        display.draw(c++, baseR+1, '[', fg, BG);
        display.draw(c++, baseR+1, bought ? '●' : '○', fg, BG);
        display.draw(c++, baseR+1, ']', fg, BG);
      }
      display.draw(c++, baseR+1, ' ', PC, BG);
      const nextCost = pips < def.maxPips ? def.costs[pips] : null;
      if (nextCost !== null) {
        const costStr = nextCost.toLocaleString('en-US') + 'g';
        for (const ch of costStr) display.draw(c++, baseR+1, ch, WC, BG);
        if (isActive) {
          const hint = '  ← press again to buy';
          for (const ch of hint) if (c < CONT_X+IW) display.draw(c++, baseR+1, ch, '#66cc66', BG);
        }
      } else {
        for (const ch of '✓ DONE') display.draw(c++, baseR+1, ch, '#66cc66', BG);
      }
      while (c < CONT_X+IW) display.draw(c++, baseR+1, ' ', PC, BG);
    });
    if (skillErrMsg) irow(cy+18, skillErrMsg, '#ff5555', cc);
    irow(BOX_Y+BOX_H-2, '1/2/3: select skill   press twice to buy   ESC: back', WC, cc);
  }

  function drawDetailWardrobe(cy, cc) {
    irow(cy,  'WARDROBE', cc);
    sep(cy+1, cc);
    const cn = state.player.colorName || 'DEFAULT';
    irow(cy+2, `Current: ${cn}`, PC, cc);
    // Draw color swatch
    outerBorder(cy+2, cc);
    display.draw(CONT_X + IW - 3, cy+2, '█', state.player.color || BRIGHT_WHITE, BG);
    display.draw(CONT_X + IW - 2, cy+2, '█', state.player.color || BRIGHT_WHITE, BG);
    sep(cy+3, cc);
    irow(cy+4, 'OWNED OUTFITS', cc);
    const owned = state.player.ownedOutfits || [];
    const letters = 'abcdefghijklm';
    let row = cy + 5;
    for (let i = 0; i < OUTFITS.length && row < BOX_Y+BOX_H-3; i++) {
      const outfit = OUTFITS[i];
      const isOwned = owned.includes(outfit.key) || outfit.key === 'default';
      const isEquipped = state.player.colorName === outfit.name;
      const fg = isOwned ? (isEquipped ? '#ffd633' : PC) : DC;
      const mark = isEquipped ? '►' : (isOwned ? '·' : ' ');
      outerBorder(row, cc);
      let c = CONT_X;
      display.draw(c++, row, mark, isEquipped ? '#ffd633' : WC, BG);
      display.draw(c++, row, letters[i] || ' ', isOwned ? '#66ccff' : DC, BG);
      display.draw(c++, row, '.', WC, BG);
      display.draw(c++, row, ' ', PC, BG);
      display.draw(c++, row, '█', isOwned ? outfit.color : '#333333', BG);
      display.draw(c++, row, ' ', PC, BG);
      const name = outfit.name.padEnd(16);
      for (let ni = 0; ni < 16 && ni < name.length; ni++) display.draw(c++, row, name[ni], fg, BG);
      const priceStr = isOwned ? '✓ owned' : `${outfit.price||15} stamps`;
      const pfg = isOwned ? '#66cc66' : SC;
      for (const ch of priceStr) if (c < CONT_X+IW) display.draw(c++, row, ch, pfg, BG);
      while (c < CONT_X+IW) display.draw(c++, row, ' ', PC, BG);
      row++;
    }
    irow(BOX_Y+BOX_H-2, 'a-m: equip owned outfit   ESC: back', WC, cc);
  }

  function drawDetailCooking(cy, cc) {
    const hasCottage = state.player.homeItems?.includes('kitchen');
    irow(cy, 'COOKING', cc);
    sep(cy+1, cc);
    if (!hasCottage) {
      irow(cy+2, '[locked]', DC, cc);
      irow(cy+3, 'Buy a Cottage + Kitchen from the', WC, cc);
      irow(cy+4, 'General Store to unlock cooking.', WC, cc);
      return;
    }
    const buff = state.cooking?.activeBuff;
    const gardenCount = Object.values(state.garden||{}).filter(v=>v===true).length;
    irow(cy+2, `Garden: ${gardenCount} / 12 planted`, gardenCount >= 6 ? '#66cc66' : WC, cc);
    sep(cy+3, cc);
    irow(cy+4, 'ACTIVE BUFF', cc);
    if (!buff) {
      irow(cy+5, 'None. Cook a recipe at your cottage.', WC, cc);
    } else {
      const daysLeft = buff.expiresDay ? Math.max(0, buff.expiresDay - state.day) : '?';
      irow(cy+5, buff.name || 'Active buff', buff.color || PC, cc);
      irow(cy+6, buff.desc || '', SC, cc);
      irow(cy+7, `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`, daysLeft > 0 ? '#66cc66' : '#ff5555', cc);
    }
    sep(cy+8, cc);
    irow(cy+9, 'RECIPES', cc);
    RECIPES.forEach((rec, i) => {
      if (cy+10+i >= BOX_Y+BOX_H-3) return;
      const canMake = canCook(rec);
      const fg = canMake ? '#66cc66' : WC;
      const ingList = rec.ingredients._any3 ? 'Any 3 veggies' :
        Object.entries(rec.ingredients).map(([k,v]) => `${v}x ${k}`).join(', ');
      irow(cy+10+i, `${rec.name.padEnd(18)} ${ingList.substring(0,30)}`, fg, cc);
    });
    irow(BOX_Y+BOX_H-2, 'Visit your cottage kitchen to cook.', WC, cc);
  }

  function drawDetailStats(cy, cc) {
    irow(cy, 'STATISTICS', cc);
    sep(cy+1, cc);
    irow(cy+2,  `Phase:          ${state.phase}`, PC, cc);
    irow(cy+3,  `Day:            ${state.day}`, PC, cc);
    irow(cy+4,  `Widgets made:   ${formatCredits(state.widgetsMade)}`, PC, cc);
    irow(cy+5,  `Lifetime made:  ${formatCredits(state.lifetimeWidgetsMade||0)}`, WC, cc);
    irow(cy+6,  `Sold today:     ${state.widgetsSoldToday}`, PC, cc);
    sep(cy+7, cc);
    irow(cy+8,  'TODAY', cc);
    const avg = arr => arr.length ? (arr.reduce((s,v)=>s+v,0)/arr.length) : 0;
    irow(cy+9,  `RM/sec:   ${avg(state.stats.rmLastTen).toFixed(1)}`, PC, cc);
    irow(cy+10, `Wdgt/sec: ${avg(state.stats.widgetsLastTen).toFixed(1)}`, PC, cc);
    const net = Math.round((state.stats.revenueToday - state.stats.costsToday)*10)/10;
    irow(cy+11, `Revenue:  ${formatCredits(state.stats.revenueToday)}g   Costs: ${formatCredits(state.stats.costsToday)}g`, PC, cc);
    irow(cy+12, `Net:      ${net >= 0 ? '+' : ''}${formatCredits(net)}g`, net >= 0 ? '#66cc66' : '#ff5555', cc);
    sep(cy+13, cc);
    irow(cy+14, 'WORKERS', cc);
    irow(cy+15, `Apprentices: ${state.workers.apprentices.length}   Couriers: ${state.workers.couriers.length}`, PC, cc);
    sep(cy+16, cc);
    irow(cy+17, 'MARKET', cc);
    const ms  = state.marketOpen ? 'OPEN' : 'CLOSED';
    const mFg = state.marketOpen ? BRIGHT_YELLOW : WC;
    irow(cy+18, `Status: ${ms}   Price: ${state.marketPrice}g   Demand: ${state.demand}`, mFg, cc);
    if (state.phase >= 3) {
      const dl = demandLabel(state.demand);
      irow(cy+19, `Demand level: ${dl.text}`, dl.fg, cc);
    }
    const casino = state.casino;
    if (casino) {
      sep(cy+20, cc);
      irow(cy+21, 'CASINO', cc);
      irow(cy+22, `Wins: ${casino.totalWins||0}   Losses: ${casino.totalLosses||0}`, PC, cc);
    }
  }

  // ── Redraw dispatcher ─────────────────────────────────────────────────────
  function redraw() {
    if (detailCell === null) drawGrid();
    else drawDetail(detailCell);
  }

  inventoryRedrawFn = redraw;
  redraw();

  // ── Skills purchase (used from equipment detail) ──────────────────────────
  function attemptSkillPurchase() {
    if (!selectedSkill) return;
    const def  = SKILL_DEFS.find(d => d.key === selectedSkill);
    const pips = getSkillPips(def);
    if (pips >= def.maxPips) return;
    const cost = def.costs[pips];
    if (state.player.gold < cost) {
      skillErrMsg = 'Insufficient gold.';
      if (skillErrTimer) clearTimeout(skillErrTimer);
      skillErrTimer = setTimeout(() => { skillErrMsg = null; redraw(); }, 2000);
      redraw(); return;
    }
    state.player.gold -= cost;
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
    selectedSkill = null;
    redraw();
  }

  function closeInventory() {
    inventoryRedrawFn = null;
    if (skillErrTimer) clearTimeout(skillErrTimer);
    window.removeEventListener('keydown', invKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    state.gameState = 'playing';
  }

  function invKeyHandler(e) {
    if (e.key === 'Escape' || e.key === 'i') {
      if (detailCell !== null) { detailCell = null; selectedSkill = null; redraw(); return; }
      closeInventory(); return;
    }
    if (detailCell === null) {
      const n = parseInt(e.key);
      if (n >= 1 && n <= 8) { detailCell = n - 1; selectedSkill = null; redraw(); return; }
      return;
    }
    // In detail view
    const cell = INV_CELLS[detailCell];
    if (cell.key === 'equipment') {
      const keyToSkill = { '1': 'endurance', '2': 'aquatics', '3': 'interfacing' };
      const sk = keyToSkill[e.key];
      if (sk) {
        if (selectedSkill === sk) { attemptSkillPurchase(); }
        else { selectedSkill = sk; skillErrMsg = null; redraw(); }
        return;
      }
    }
    if (cell.key === 'wardrobe') {
      const letters = 'abcdefghijklm';
      const li = letters.indexOf(e.key);
      if (li >= 0 && li < OUTFITS.length) {
        const outfit = OUTFITS[li];
        const owned = state.player.ownedOutfits || [];
        if (owned.includes(outfit.key)) {
          state.player.color = outfit.color;
          state.player.colorName = outfit.name;
          addLog(`Outfit changed to ${outfit.name.toLowerCase()}.`, outfit.color);
          display.draw(state.player.x, state.player.y, '@', state.player.color, BG);
          redraw();
        } else {
          addLog('You don\'t own that outfit.', '#555555');
        }
        return;
      }
    }
  }
  window.addEventListener('keydown', invKeyHandler);
}

// ── Worker helpers (§5.3) ────────────────────────────────────────────────────

function workerLabel(w, idx, type) {
  if (w.nickname) return w.nickname;
  return (type === 'courier' || type === 'cour') ? `Courier ${idx + 1}` : `Apprentice ${idx + 1}`;
}

// ── Newspaper menu (§13) ──────────────────────────────────────────────────────

function openNewspaperMenu() {
  if (!state.stations.newspaper?.unlocked) return;
  state.gameState = 'newspaper';

  const NC    = COLOR_NP_FRAME;
  const LC    = '#f0f0f0';
  const DC    = '#333333';
  const HL    = COLOR_NP_LABEL;
  const FG2   = '#aaaaaa';
  const SL    = '#66cc66';
  const SF    = '#555555';
  const BOX_W = 70;
  const IW    = 68;
  const BOX_H = 38;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const CX    = BOX_X + 1;

  let npTab     = 'newspaper';
  let npScroll  = 0;
  let npSel     = 0;
  let npConfirm = false;

  const BULLISH_STORIES = [
    { label: 'Endorse by industry figure',   headline: 'INDUSTRY FIGURE ENDORSES WIDGETS — demand expected to surge',    nudge: +15 },
    { label: 'Gov. subsidy incoming',         headline: 'GOVERNMENT WIDGET SUBSIDY INCOMING — analysts bullish',             nudge: +15 },
    { label: 'Widgets cure mild ailments',    headline: 'WIDGETS LINKED TO HEALTH BENEFITS — sales forecast strong',       nudge: +15 },
    { label: 'Supply running critically low', headline: 'SUPPLY RUNNING CRITICALLY LOW — buyers urged to act now',          nudge: +15 },
    { label: 'Rival producer gone under',     headline: 'RIVAL WIDGET PRODUCER CONFIRMS CLOSURE — market share up',        nudge: +15 },
  ];
  const BEARISH_STORIES = [
    { label: 'Link to food-borne illness',      headline: 'WIDGETS LINKED TO FOOD-BORNE ILLNESS OUTBREAK — demand at risk', nudge: -15 },
    { label: 'Factory environmental breach',    headline: 'FACTORY ENVIRONMENTAL VIOLATIONS REPORTED — confidence shaken', nudge: -15 },
    { label: 'Competing product superior',      headline: 'COMPETING PRODUCT OUTPERFORMS WIDGETS IN INDEPENDENT TESTS',    nudge: -15 },
    { label: 'Widgets contain banned material', headline: 'WIDGETS CONTAIN BANNED MATERIALS — investigation underway',     nudge: -15 },
    { label: 'Demand survey shows sharp drop',  headline: 'DEMAND SURVEY SHOWS SHARP DROP — analysts downgrade outlook',   nudge: -15 },
  ];

  const hasSkill   = !!state.skills.plantStory;
  const hasSmear   = !!state.skills.smearCampaign;
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

  // ── Drawing helpers ──────────────────────────────────────────────────────────
  function border(ay) { display.draw(BOX_X, ay, '║', NC, BG); display.draw(BOX_X + BOX_W - 1, ay, '║', NC, BG); }
  function irow(ay, text, fg) {
    border(ay);
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(CX + i, ay, p[i]||' ', fg, BG);
  }
  function sectTop(ay, x, w, label) {
    display.draw(x, ay, '┌', SF, BG);
    display.draw(x+1, ay, '─', SF, BG);
    display.draw(x+2, ay, ' ', BRIGHT_WHITE, BG);
    for (let i = 0; i < label.length; i++) display.draw(x+3+i, ay, label[i], SL, BG);
    display.draw(x+3+label.length, ay, ' ', BRIGHT_WHITE, BG);
    for (let xi = x+4+label.length; xi < x+w-1; xi++) display.draw(xi, ay, '─', SF, BG);
    display.draw(x+w-1, ay, '┐', SF, BG);
  }
  function sectBot(ay, x, w) {
    display.draw(x, ay, '└', SF, BG);
    for (let xi = x+1; xi < x+w-1; xi++) display.draw(xi, ay, '─', SF, BG);
    display.draw(x+w-1, ay, '┘', SF, BG);
  }
  function sectRow(ay, x, w, text, fg) {
    display.draw(x, ay, '│', SF, BG);
    display.draw(x+w-1, ay, '│', SF, BG);
    const iw = w - 2;
    const str = (' ' + text).padEnd(iw).slice(0, iw);
    for (let i = 0; i < iw; i++) display.draw(x+1+i, ay, str[i]||' ', fg, BG);
  }

  const WEATHER_ICONS = { clear: '*', rain: '~', fog: '%', heatwave: '^', storm: '!' };
  const WEATHER_COLORS = { clear: '#ffd633', rain: '#4a8aaa', fog: '#666666', heatwave: '#ff6633', storm: '#ffaa00' };
  const WEATHER_NAMES  = { clear: 'Clear', rain: 'Rain', fog: 'Fog', heatwave: 'Heat Wave', storm: 'Storm' };
  const WEATHER_EFFECTS = {
    clear:    'No weather effects.',
    rain:     'Workers -20%. Demand -10%.',
    fog:      'Couriers -10%. Look range limited.',
    heatwave: 'Crafting +1s. Demand +20%.',
    storm:    'Workers -30%. Demand -20%. Mine 2x RM.',
  };
  const FORECAST_FG = { Strong:'#66cc66', Positive:'#66cc66', Mixed:'#ffd633', Weak:'#ff9933', Poor:'#ff5555' };

  const SPECIAL_REPORTS = [
    { cond: () => state.phase === 3 && !state.mine.discovered, text: 'Rumors of caves in the southern rocks persist.' },
    { cond: () => state.mine.discovered && state.skills.pickaxeLevel === 0, text: 'Miners report bare-hand injuries. A pickaxe would help.' },
    { cond: () => state.weather.current === 'storm', text: 'Storm conditions make the mine dangerous but lucrative.' },
    { cond: () => state.rocketWidgets > 0 && state.rocketWidgets < 5000, text: `Rocket loading: ${Math.round(state.rocketWidgets/50)}% complete. The facility hums.` },
    { cond: () => state.bank.creditRatingScore < 5, text: 'Financial advisors urge caution. Your credit rating needs work.' },
    { cond: () => state.player.gold > 5000, text: 'Local tycoon spotted buying luxury goods. The economy thanks you.' },
    { cond: () => state.cottage.owned, text: 'Real estate values holding steady. Your cottage appreciates.' },
    { cond: () => state.widgetsMade > 500, text: `Production milestone: ${state.widgetsMade} widgets manufactured to date.` },
    { cond: () => state.fishing.totalCatches > 10, text: 'Pond fishing yields remain stable. Conservationists pleased.' },
    { cond: () => true, text: 'Markets steady. No major developments.' },
  ];

  function drawNewspaperTab() {
    const y0 = BOX_Y + 6;
    // HEADLINE section — full width
    sectTop(y0, CX, IW, 'HEADLINE');
    const hdl = state.newspaper.todayHeadline || '(no report yet today)';
    const hdlLines = wordWrap(hdl, IW - 4);
    sectRow(y0+1, CX, IW, hdlLines[0] || '', LC);
    if (hdlLines.length > 1) sectRow(y0+2, CX, IW, hdlLines[1], LC);
    else { display.draw(CX, y0+2, '│', SF, BG); display.draw(CX+IW-1, y0+2, '│', SF, BG); for (let xi = CX+1; xi < CX+IW-1; xi++) display.draw(xi, y0+2, ' ', BRIGHT_WHITE, BG); }
    sectBot(y0+3, CX, IW);

    // MARKET + WEATHER side by side
    const y1 = y0 + 5;
    const MX = CX, MW = 28;
    const WX = CX + 30, WW = IW - 30;

    sectTop(y1, MX, MW, 'MARKET');
    const dLabel = demandLabel(state.demand);
    sectRow(y1+1, MX, MW, `Demand today: ${state.demand}`, state.demand > 50 ? '#66cc66' : state.demand > 30 ? '#ffd633' : '#ff5555');
    sectRow(y1+2, MX, MW, `Price today:  ${state.marketPrice}g`, '#66cc66');
    sectRow(y1+3, MX, MW, `Sold today:   ${state.widgetsSoldToday}/${state.demand}`, FG2);
    const fLabel = state.newspaper.tomorrowForecastLabel || '—';
    sectRow(y1+4, MX, MW, `Outlook: ${fLabel}`, FORECAST_FG[fLabel] || FG2);
    sectBot(y1+5, MX, MW);

    sectTop(y1, WX, WW, 'WEATHER');
    const wc = state.weather.current, wf = state.weather.forecast;
    const todayStr = `Today:    ${WEATHER_ICONS[wc]||'?'} ${WEATHER_NAMES[wc]||wc}`;
    const tmrwStr  = `Tomorrow: ${WEATHER_ICONS[wf]||'?'} ${WEATHER_NAMES[wf]||wf} (75%)`;
    sectRow(y1+1, WX, WW, todayStr, WEATHER_COLORS[wc] || LC);
    sectRow(y1+2, WX, WW, tmrwStr, WEATHER_COLORS[wf] || FG2);
    sectRow(y1+3, WX, WW, '', BRIGHT_WHITE);
    sectRow(y1+4, WX, WW, WEATHER_EFFECTS[wc] || '', SF);
    sectBot(y1+5, WX, WW);

    // PRODUCTION section
    const y2 = y1 + 7;
    sectTop(y2, CX, IW, 'PRODUCTION');
    const activeAppr = state.workers.apprentices.filter(w => !w.paused).length;
    const courDir = state.courierDestination === 'rocket' ? '→ rocket' : '→ market';
    const estOutput = activeAppr * 16;
    sectRow(y2+1, CX, IW, `Apprentices: ${activeAppr} active   Couriers: ${state.workers.couriers.length} (${courDir})`, FG2);
    sectRow(y2+2, CX, IW, `RM in storage: ${state.storage.rm}/${state.storage.rmCap}   Widgets: ${state.storage.widgets}/${state.storage.widgetCap}`, FG2);
    sectRow(y2+3, CX, IW, `Daily output: ~${estOutput} widgets   Revenue today: ${formatCredits(state.stats.revenueToday)}g`, FG2);
    sectBot(y2+4, CX, IW);

    // FINANCE section
    const y3 = y2 + 6;
    sectTop(y3, CX, IW, 'FINANCE');
    const interestDay = Math.round(state.bank.deposit * 0.10 * 10) / 10;
    const cardStr = state.bank.card.tier ? state.bank.card.tier.toUpperCase() : 'None';
    const carryCost = Math.min(50, Math.round(state.storage.widgets * (state.skills.reducedCarry ? 0.1 : 0.2) * 10) / 10);
    sectRow(y3+1, CX, IW, `Gold: ${formatCredits(state.player.gold)}g   Bank deposit: ${formatCredits(state.bank.deposit)}g (+${formatCredits(interestDay)}/day)`, state.player.gold < 0 ? '#ff5555' : LC);
    sectRow(y3+2, CX, IW, `Card: ${cardStr}   Rating: ${state.bank.creditRating} (${state.bank.creditRatingScore.toFixed(1)})`, FG2);
    sectRow(y3+3, CX, IW, `Debt: ${formatCredits(state.debt)}g   Carry cost: ${formatCredits(carryCost)}g/day`, state.debt > 0 ? '#ff9933' : FG2);
    sectBot(y3+4, CX, IW);

    // SPECIAL REPORT section
    const y4 = y3 + 6;
    const report = SPECIAL_REPORTS.find(r => r.cond());
    const reportLines = report ? wordWrap(report.text, IW - 4) : ['Markets steady.'];
    sectTop(y4, CX, IW, 'SPECIAL REPORT');
    sectRow(y4+1, CX, IW, reportLines[0] || '', FG2);
    sectBot(y4+2, CX, IW);
  }

  function drawInfluenceTab() {
    const hasSkillNow  = !!state.skills.plantStory;
    const hasSmearNow  = !!state.skills.smearCampaign;
    let cr = BOX_Y + 7;
    // Market intelligence upgrades — always shown
    { const dh = state.skills.demandHistory; const fc = state.skills.forecast;
      const dhNode = OFFICE_NODES.find(n => n.key === 'demandHistory');
      const fcNode = OFFICE_NODES.find(n => n.key === 'forecast');
      irow(cr++, '─── MARKET INTELLIGENCE ─────────────────────────────────────────────', '#333333');
      const dhLocked = state.phase < (dhNode?.minPhase || 3);
      const dhStr = dh ? '✓ owned' : (dhLocked ? '[phase 3]' : `${dhNode?.cost}g`);
      const dhFg  = dh ? '#66cc66' : (dhLocked ? '#333333' : (state.player.gold >= (dhNode?.cost||50) ? '#aaaaaa' : '#ff5555'));
      irow(cr++, `  [j] Demand History              ${dhStr}`, dhFg);
      const fcLocked = state.phase < (fcNode?.minPhase || 3);
      const fcStr = fc ? '✓ owned' : (fcLocked ? '[phase 3]' : `${fcNode?.cost}g`);
      const fcFg  = fc ? '#66cc66' : (fcLocked ? '#333333' : (state.player.gold >= (fcNode?.cost||1500) ? '#aaaaaa' : '#ff5555'));
      irow(cr++, `  [l] 7-Day Forecast              ${fcStr}`, fcFg);
      irow(cr++, '', BRIGHT_WHITE);
      // Plant Story / Smear Campaign
      const psNode = OFFICE_NODES.find(n => n.key === 'plantStory');
      const scNode = OFFICE_NODES.find(n => n.key === 'smearCampaign');
      irow(cr++, '─── INFLUENCE ────────────────────────────────────────────────────────', '#333333');
      if (!hasSkillNow) {
        const psLocked = state.phase < (psNode?.minPhase || 3);
        const psStr = psLocked ? '[phase 3]' : `${psNode?.cost}g`;
        const psFg  = psLocked ? '#333333' : (state.player.gold >= (psNode?.cost||750) ? '#aaaaaa' : '#ff5555');
        irow(cr++, `  [p] Plant a Story              ${psStr}`, psFg);
        const scStr = '[need Plant a Story first]';
        irow(cr++, `  [r] Smear Campaign             ${scStr}`, '#333333');
      } else if (!hasSmearNow) {
        irow(cr++, '  [p] Plant a Story              ✓ owned', '#66cc66');
        const scLocked = state.phase < (scNode?.minPhase || 3);
        const scStr = scLocked ? '[phase 3]' : `${scNode?.cost}g`;
        const scFg  = scLocked ? '#333333' : (state.player.gold >= (scNode?.cost||2000) ? '#aaaaaa' : '#ff5555');
        irow(cr++, `  [r] Smear Campaign             ${scStr}`, scFg);
      } else {
        irow(cr++, '  [p] Plant a Story              ✓ owned', '#66cc66');
        irow(cr++, '  [r] Smear Campaign             ✓ owned', '#66cc66');
      }
      irow(cr++, '', BRIGHT_WHITE);
    }
    if (!hasSkillNow) {
      // No stories available yet
    } else if (onCooldown()) {
      const nextDay = (state.stations.newspaper.lastManipulationDay ?? 0) + 3;
      irow(cr++, 'Cooldown active.', SF);
      irow(cr++, `Next story available: day ${nextDay}`, SF);
    } else {
      const stories = allStories();
      const sections = [
        { title: 'BULLISH STORIES  (+demand)  500g', stories: BULLISH_STORIES, offset: 0, tier: 'plant', cost: 500 },
        { title: 'BEARISH STORIES  (-demand)  500g', stories: BEARISH_STORIES, offset: 5, tier: 'plant', cost: 500 },
      ];
      if (hasSmearNow) {
        sections.push({ title: 'SMEAR CAMPAIGN (+/- demand)  2,000g', stories: [...BULLISH_STORIES, ...BEARISH_STORIES], offset: 10, tier: 'smear', cost: 2000, isSmear: true });
      }
      for (const sec of sections) {
        irow(cr++, sec.title, sec.isSmear ? '#ff5555' : NC);
        for (let i = 0; i < sec.stories.length; i++) {
          const isSel = npSel === sec.offset + i;
          const ltr = sec.isSmear ? (i < 5 ? String(i+1) : String(i-4)) : String.fromCharCode((sec.offset < 5 ? 97 : 102) + i);
          irow(cr++, `${isSel ? '>> ' : '   '}${ltr}) ${sec.stories[i].label}`, isSel ? HL : FG2);
        }
        irow(cr++, '', BRIGHT_WHITE);
      }
      if (npConfirm) {
        const chosen = stories[npSel];
        irow(cr++, `File this story for ${chosen.cost}g? (1. Yes / 2. No)`, LC);
      }
    }
  }

  function redraw() {
    _npCloseBOX_H = BOX_H;
    // Clear
    for (let r = 0; r < BOX_H; r++) for (let x = 0; x < BOX_W; x++) display.draw(BOX_X + x, BOX_Y + r, ' ', BRIGHT_WHITE, BG);
    // Outer borders
    display.draw(BOX_X, BOX_Y, '╔', NC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y, '╗', NC, BG);
    for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y, '═', NC, BG);
    display.draw(BOX_X, BOX_Y+BOX_H-1, '╚', NC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+BOX_H-1, '╝', NC, BG);
    for (let i = 1; i < BOX_W-1; i++) display.draw(BOX_X+i, BOX_Y+BOX_H-1, '═', NC, BG);
    for (let r = 1; r < BOX_H-1; r++) { display.draw(BOX_X, BOX_Y+r, '║', NC, BG); display.draw(BOX_X+BOX_W-1, BOX_Y+r, '║', NC, BG); }

    // Row 1: masthead
    { const title = 'THE DAILY WIDGET';
      const tx = CX + Math.floor((IW - title.length) / 2);
      for (let i = 0; i < IW; i++) display.draw(CX+i, BOX_Y+1, ' ', BRIGHT_WHITE, BG);
      for (let i = 0; i < title.length; i++) display.draw(tx+i, BOX_Y+1, title[i], LC, BG); }
    // Row 2: subtitle
    { const wi = WEATHER_ICONS[state.weather.current] || '*';
      const wn = WEATHER_NAMES[state.weather.current] || '';
      const sub = `"All the news that's fit to widget"    Day ${state.day}    ${wi} ${wn}`;
      const fg2 = SF;
      for (let i = 0; i < IW; i++) display.draw(CX+i, BOX_Y+2, ' ', BRIGHT_WHITE, BG);
      const sx = CX + Math.floor((IW - sub.length) / 2);
      for (let i = 0; i < sub.length; i++) display.draw(sx+i, BOX_Y+2, sub[i], fg2, BG); }
    // Row 3: ═ separator
    for (let i = 0; i < IW; i++) display.draw(CX+i, BOX_Y+3, '═', DC, BG);
    // Row 4: tabs
    { const tabs = [{ k:'newspaper', lbl:'[ NEWSPAPER ]' }, { k:'influence', lbl:'[ INFLUENCE ]' }];
      let tx = CX;
      for (const t of tabs) {
        const active = npTab === t.k;
        for (let i = 0; i < t.lbl.length; i++) display.draw(tx+i, BOX_Y+4, t.lbl[i], active ? NC : DC, BG);
        tx += t.lbl.length + 2;
      }
      for (let xi = tx; xi < CX+IW; xi++) display.draw(xi, BOX_Y+4, ' ', BRIGHT_WHITE, BG);
    }
    // Row 5: ─ separator
    for (let i = 0; i < IW; i++) display.draw(CX+i, BOX_Y+5, '─', DC, BG);

    if (npTab === 'newspaper') {
      drawNewspaperTab();
    } else {
      drawInfluenceTab();
    }

    // Footer
    { const ay = BOX_Y + BOX_H - 3;
      for (let i = 0; i < IW; i++) display.draw(CX+i, ay, '─', DC, BG); }
    { const ay = BOX_Y + BOX_H - 2;
      const footTxt = npTab === 'influence' && hasSkill && !onCooldown()
        ? (npConfirm ? '1: confirm  2: cancel' : '↑↓: select  Enter: choose  ←→: tabs  ESC: exit')
        : '←→: switch tabs   ESC: exit';
      const fp = menuPad(footTxt.length < IW ? ' '.repeat(Math.floor((IW-footTxt.length)/2)) + footTxt : footTxt, IW);
      for (let i = 0; i < IW; i++) display.draw(CX+i, ay, fp[i]||' ', DC, BG); }
  }

  let _npCloseBOX_H = BOX_H;
  npMenuRedrawFn = redraw;
  redraw();

  const npAnimInterval = setInterval(() => {
    if (state.gameState !== 'newspaper') { clearInterval(npAnimInterval); return; }
    state.newspaper.animTick++;
    if (npTab === 'newspaper') redraw();
  }, 500);

  function closeNP() {
    npMenuRedrawFn = null;
    clearInterval(npAnimInterval);
    window.removeEventListener('keydown', npKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = 'playing';
  }

  function npKeyHandler(e) {
    if (e.key === 'Escape') { if (npConfirm) { npConfirm = false; redraw(); } else { closeNP(); } return; }
    if (e.key === 'ArrowLeft') {
      e.preventDefault(); npTab = 'newspaper'; npConfirm = false; redraw(); return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault(); npTab = 'influence'; redraw(); return;
    }
    // Intelligence / influence purchases — handled in influence tab regardless of plant story ownership
    if (npTab === 'influence') {
      if (e.key === 'j') {
        const node = OFFICE_NODES.find(n => n.key === 'demandHistory');
        if (!node || state.phase < node.minPhase) { addLog('Demand History not yet available (Phase 3).', '#555555'); redraw(); return; }
        if (state.skills.demandHistory) { addLog('Demand History already purchased.', '#555555'); return; }
        if (state.player.gold < node.cost) { addLog(`Need ${node.cost}g for Demand History.`, '#ff5555'); redraw(); return; }
        state.player.gold -= node.cost; state.skills.demandHistory = 1;
        addLog('Demand History purchased.', NC); playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === 'l') {
        const node = OFFICE_NODES.find(n => n.key === 'forecast');
        if (!node || state.phase < node.minPhase) { addLog('7-Day Forecast not yet available (Phase 3).', '#555555'); redraw(); return; }
        if (state.skills.forecast) { addLog('7-Day Forecast already purchased.', '#555555'); return; }
        if (state.player.gold < node.cost) { addLog(`Need ${node.cost}g for 7-Day Forecast.`, '#ff5555'); redraw(); return; }
        state.player.gold -= node.cost; state.skills.forecast = 1;
        addLog('7-Day Forecast purchased.', NC); playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === 'p') {
        const node = OFFICE_NODES.find(n => n.key === 'plantStory');
        if (!node || state.phase < node.minPhase) { addLog('Plant a Story not yet available (Phase 3).', '#555555'); redraw(); return; }
        if (state.skills.plantStory) { addLog('Plant a Story already purchased.', '#555555'); return; }
        if (state.player.gold < node.cost) { addLog(`Need ${node.cost}g for Plant a Story.`, '#ff5555'); redraw(); return; }
        state.player.gold -= node.cost; state.skills.plantStory = 1;
        addLog('Plant a Story purchased. File stories from the Influence tab.', NC); playSound('bought'); drawStatusBar(); redraw(); return;
      }
      if (e.key === 'r') {
        const node = OFFICE_NODES.find(n => n.key === 'smearCampaign');
        if (!node || state.phase < node.minPhase) { addLog('Smear Campaign not yet available (Phase 3).', '#555555'); redraw(); return; }
        if (!state.skills.plantStory) { addLog('Plant a Story required first.', '#555555'); return; }
        if (state.skills.smearCampaign) { addLog('Smear Campaign already purchased.', '#555555'); return; }
        if (state.player.gold < node.cost) { addLog(`Need ${node.cost}g for Smear Campaign.`, '#ff5555'); redraw(); return; }
        state.player.gold -= node.cost; state.skills.smearCampaign = 1;
        addLog('Smear Campaign purchased.', NC); playSound('bought'); drawStatusBar(); redraw(); return;
      }
    }

    if (npTab !== 'influence' || !hasSkill || onCooldown()) return;

    const stories = allStories();
    const maxSel  = stories.length - 1;
    if (npConfirm) {
      if (e.key === '1') {
        const chosen = stories[npSel];
        if (state.player.gold < chosen.cost) { addLog(`Not enough gold. Need ${chosen.cost}g.`, '#ff5555'); npConfirm = false; redraw(); return; }
        state.player.gold -= chosen.cost;
        state.stations.newspaper.pendingManipulation = { tier: chosen.tier, nudge: chosen.nudge, headline: chosen.headline };
        state.stations.newspaper.lastManipulationDay = state.day;
        addLog('> Story filed. It will run at dawn.', NC);
        drawStatusBar();
        npConfirm = false; closeNP();
      } else if (e.key === '2') { npConfirm = false; redraw(); }
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
  const _silverPlus = cardTierAtLeast('silver');
  const weatherSpeedMult = state.weather.current === 'storm' ? 0.7 : state.weather.current === 'rain' ? 0.8 : 1.0;
  const cookingSpeedMult = state.cooking?.activeBuff?.buff === 'apprSpeed' ? state.cooking.activeBuff.value : 1.0;
  const speed    = Math.max(1, Math.round(WORKER_SPEEDS[state.skills.workerSpeedLevel || 0] * (_silverPlus ? 1.10 : 1.0) * weatherSpeedMult * cookingSpeedMult));
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
        // Take from storage first (free), then buy remainder
        while (bought < space && state.storage.rm > 0) {
          state.storage.rm--;
          w.carryRM++;
          bought++;
        }
        const boughtFree = bought;
        const useCardForRM = w.buyOnCredit && !!state.bank?.card?.tier;
        if (useCardForRM) {
          const cardAvail = Math.max(0, (state.bank.card.limit||0) - (state.bank.card.balance||0));
          const canBuyCard = Math.floor(cardAvail / 3);
          while (bought < space && bought - boughtFree < canBuyCard) {
            state.bank.card.balance = Math.round((state.bank.card.balance + 3) * 10) / 10;
            w.carryRM++;
            bought++;
            if (bought === boughtFree + 1) { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(w.x, w.y, rmD.x + 1, rmD.y + 2, 3); }
          }
        } else {
          while (bought < space && state.player.gold >= 3) {
            state.player.gold -= 3;
            w.carryRM++;
            bought++;
            if (bought === boughtFree + 1) { const rmD = STATION_DEFS.find(s => s.label === 'RM'); if (rmD) effectsManager.coinDrain(w.x, w.y, rmD.x + 1, rmD.y + 2, 3); }
          }
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
          state.lifetimeWidgetsMade = (state.lifetimeWidgetsMade || 0) + 1;
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
  const lpDoor = state.loadingPort?.unlocked ? { x: mtDef.x + 5, y: mtDef.y + 3 } : null;
  const weatherCourierMult = state.weather.current === 'storm' ? 0.85 : state.weather.current === 'fog' ? 0.9 : 1.0;
  const speed    = Math.max(1, Math.round(COURIER_SPEEDS[state.skills.courierSpeedLevel || 0] * weatherCourierMult));
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
  function isHeadingToLP(c) {
    return lpDoor && c.target.x === lpDoor.x && c.target.y === lpDoor.y;
  }

  for (const c of state.workers.couriers) {
    markDirty(c.x, c.y);
    if (c.paused) continue;

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
        c.target = toRocket ? { ...lfDoor } : (lpDoor ? { ...lpDoor } : { ...mtDoor });
        c.courierState = 'delivering';
      }
    }

    if (c.courierState === 'delivering') {
      const destDoor = isHeadingToLF(c) ? lfDoor : (isHeadingToLP(c) ? lpDoor : mtDoor);
      if (!near(c, destDoor)) moveToward(c, destDoor);
      if (near(c, destDoor)) {
        if (isHeadingToLP(c)) {
          // Deliver to Loading Port
          const lp = state.loadingPort;
          const space = lp.capacity - lp.widgets;
          const toLoad = Math.min(c.carryWidgets, space);
          if (toLoad > 0) {
            lp.widgets += toLoad;
            c.carryWidgets -= toLoad;
          }
          c.target = { ...stDoor };
          c.courierState = 'returning';
        } else if (isHeadingToLF(c)) {
          // Deliver to Launch Facility
          if (c.carryWidgets > 0 && state.rocketWidgets < 5000) {
            const toLoad = Math.min(c.carryWidgets, 5000 - state.rocketWidgets);
            state.rocketWidgets += toLoad;
            c.carryWidgets -= toLoad;
            addLog(`Courier loaded ${toLoad} widget${toLoad !== 1 ? 's' : ''}. Total: ${state.rocketWidgets.toLocaleString()} / 5,000.`, '#ff5555');
            drawStatusBar();
            if (!state.rocketFull && state.rocketWidgets >= 5000) {
              state.rocketFull = true;
              addLog('The rocket is full. Open the Launch Facility to begin.', '#ff5555');
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
            state.player.gold += earned;
            state.lifetimeGoldEarned += earned;
            state.stats.revenueToday = Math.round((state.stats.revenueToday + earned) * 10) / 10;
            if (state.phase >= 3) state.widgetsSoldToday += n;
            c.carryWidgets -= n;
            addLog(`Courier sold ${n} widget${n !== 1 ? 's' : ''} for ${formatCredits(earned)}g.`, '#66cc66');
            drawStatusBar();
            { const mtD = STATION_DEFS.find(s => s.label === 'MT'); if (mtD) effectsManager.creditRain(mtD.x + 1, mtD.y + 2, n, false, earned); }
            checkPhase2Trigger();
            drawPhaseGoal();
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
        state.player.gold += Math.round(n * dumpPrice * 10) / 10;
        state.storage.widgets = 0;
        addLog(`Discount dump: ${n} widget${n !== 1 ? 's' : ''} sold at ${dumpPrice}g each.`, '#ff9933');
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
  state.player.gold = credits[n] ?? 10000;
  state.lifetimeGoldEarned = credits[n] ?? 10000;
  if (n >= 2) {
    state.skills.apprenticeCount = 1;
    state.storage.widgets        = 30;
    const ofDef = STATION_DEFS.find(s => s.label === 'OF');
    if (ofDef) state.workers.apprentices.push({ x: ofDef.x+1, y: ofDef.y+2, workerState: 'idle', carryRM: 0, carryWidgets: 0, target: {x:0,y:0}, craftTimer: 0, paused: false });
  }
  if (n >= 3) {
    calculateDailyDemand();
    state.widgetsSoldToday = 0;
  }
  // applyPhaseUnlocks sets all state.stations flags and colorInStation for each tier
  applyPhaseUnlocks(n);
  // Casino dev unlock for phase 3+
  if (n >= 3) {
    state.shinyRocks.red.collected = true;
    state.shinyRocks.yellow.collected = true;
    state.shinyRocks.blue.collected = true;
    state.stations.casino.unlocked = true;
  }
  state.gameState = 'playing';
  clearScreen();
  drawWorld(); // drawWorld calls buildTileMap which stamps casino if visible
  addLog(`DEV: Jumped to Phase ${n}.`, '#ff5555');
}

// ── Ending cutscene (§Phase 5) ────────────────────────────────────────────────
function startEndingSequence() {
  state.gameState = 'ending';
  let frame = 0;

  // Phase 1 state
  let scrollOffset = 0.0, scrollRows = 0;
  let lastCountdownMsg = '> Ignition sequence initiated.', lastCountdownFg = '#ff5555';

  // Phase 2-4 state — star field
  const stars = [];
  let starSpeedMult = 1.0;
  function spawnStar() {
    const rand = Math.random();
    const ch = rand < 0.70 ? '·' : rand < 0.85 ? '*' : rand < 0.95 ? '+' : '✦';
    const cr = Math.random();
    const col = cr < 0.40 ? '#333333' : cr < 0.70 ? '#555555' : cr < 0.90 ? '#777777' : '#aaaaaa';
    stars.push({ x: 1 + Math.floor(Math.random() * (DISPLAY_WIDTH-2)), y: -1.0,
                 ch, color: col, speed: 0.3 + Math.random() * 0.4 });
  }

  // Moon art
  const MOON_ART = [
    "      .----.      ",
    "    .'  o   '.    ",
    "  .'    .  o   '. ",
    " /  o        .   \\",
    "|      .  o      |",
    "|   o       .    |",
    " \\     o  .     / ",
    "  '.   .     .'   ",
    "    '.     .'     ",
    "      '----'      ",
  ];
  const MOON_W = 18;
  const MOON_X = Math.floor((DISPLAY_WIDTH - MOON_W) / 2);
  let moonY = -12.0;

  // Rocket art for phases 2+
  const END_ROCKET = [
    "    /\\    ",
    "   /  \\   ",
    "  | /\\ |  ",
    "  |/  \\|  ",
    "  |████|  ",
    "  |████|  ",
    "  |████|  ",
    "  |████|  ",
    " /+----+\\ ",
    "/  |  |  \\",
    "   +--+   ",
  ];
  const ER_W = END_ROCKET[0].length;
  const ER_X = Math.floor((DISPLAY_WIDTH - ER_W) / 2);
  const FLAME_A = ["   *  *   ", "  ^^^*^^^ ", " * * * * *"];
  const FLAME_B = ["  * ** *  ", " *^*^*^*  ", "  *^*^*^  "];
  let rocketScreenY = 18.0;
  let flameFrame = 0;

  function clearAll() {
    for (let y = 0; y < DISPLAY_HEIGHT; y++)
      for (let x = 0; x < DISPLAY_WIDTH; x++)
        display.draw(x, y, ' ', BRIGHT_WHITE, BG);
  }

  function drawEndRocket(topY) {
    for (let r = 0; r < END_ROCKET.length; r++) {
      const ay = Math.floor(topY) + r;
      if (ay < 0 || ay >= DISPLAY_HEIGHT) continue;
      const line = END_ROCKET[r];
      for (let c = 0; c < line.length; c++) {
        const ax = ER_X + c;
        if (ax < 0 || ax >= DISPLAY_WIDTH) continue;
        const ch = line[c];
        if (ch === ' ') continue;
        display.draw(ax, ay, ch, ch === '█' ? '#ff5555' : '#aaaaaa', BG);
      }
    }
    const flRows = flameFrame % 8 < 4 ? FLAME_A : FLAME_B;
    for (let r = 0; r < 3; r++) {
      const ay = Math.floor(topY) + END_ROCKET.length + r;
      if (ay < 0 || ay >= DISPLAY_HEIGHT) continue;
      const line = flRows[r];
      for (let c = 0; c < line.length; c++) {
        const ax = ER_X + c;
        if (ax < 0 || ax >= DISPLAY_WIDTH) continue;
        const ch = line[c];
        if (ch === ' ') continue;
        display.draw(ax, ay, ch, ch === '^' ? '#ffd633' : r === 0 ? '#ff9933' : '#ff5555', BG);
      }
    }
  }

  function drawMoon(topY) {
    for (let r = 0; r < MOON_ART.length; r++) {
      const ay = Math.floor(topY) + r;
      if (ay < 0 || ay >= DISPLAY_HEIGHT) continue;
      for (let c = 0; c < MOON_W; c++) {
        const ax = MOON_X + c;
        if (ax < 0 || ax >= DISPLAY_WIDTH) continue;
        const ch = MOON_ART[r][c];
        if (ch === ' ') continue;
        display.draw(ax, ay, ch, (ch === 'o' || ch === '.') ? '#888888' : '#aaaaaa', BG);
      }
    }
  }

  function drawArtCredits(baseRow, frameN) {
    for (let row = 0; row < TITLE_ART.length; row++) {
      const line = TITLE_ART[row];
      for (let col = 0; col < line.length; col++) {
        if (line[col] === ' ') continue;
        const wave = Math.sin((col * 0.12) - (frameN * 0.03)) * 0.5 + 0.5;
        const r2 = Math.round(200 + wave * 55);
        const g2 = Math.round(170 + wave * 44);
        const b2 = Math.round(wave * 51);
        const hex = '#' + [r2, g2, b2].map(v => v.toString(16).padStart(2,'0')).join('');
        display.draw(ART_X + col, baseRow + row, line[col], hex, BG);
      }
    }
  }

  // Phase 5 state
  let endKeyActive = false;
  function endingKeyHandler() {
    if (frame < 2060) return;
    window.removeEventListener('keydown', endingKeyHandler);
    state.endingCompleted = true;
    saveGame();
    state.gameState = 'title';
    clearScreen();
    drawTitleBorder();
    drawArt(0);
    drawPrompt(true);
    clearInterval(blinkInterval);
    let pv = true;
    blinkInterval = setInterval(() => { pv = !pv; drawPrompt(pv); }, 500);
    titleFrame = 0;
    requestAnimationFrame(titleAnimLoop);
    showContinueMenu();
  }
  window.addEventListener('keydown', endingKeyHandler);

  function endLoop() {
    if (state.gameState !== 'ending') { window.removeEventListener('keydown', endingKeyHandler); return; }
    flameFrame++;

    // ── Phase 1: Liftoff (0-299) ─────────────────────────────────────────────
    if (frame < 300) {
      if (frame === 0)   { drawRow(LOG_END_ROW, '> Ignition sequence initiated.', '#ff5555'); lastCountdownMsg = '> Ignition sequence initiated.'; lastCountdownFg = '#ff5555'; }
      if (frame === 60)  { drawRow(LOG_END_ROW, '> 3...', '#ff5555'); lastCountdownMsg = '> 3...'; lastCountdownFg = '#ff5555'; }
      if (frame === 120) { drawRow(LOG_END_ROW, '> 2...', '#ff5555'); lastCountdownMsg = '> 2...'; lastCountdownFg = '#ff5555'; }
      if (frame === 180) { drawRow(LOG_END_ROW, '> 1...', '#ff5555'); lastCountdownMsg = '> 1...'; lastCountdownFg = '#ff5555'; }
      if (frame === 240) { drawRow(LOG_END_ROW, '> LIFTOFF.', '#ffd633'); lastCountdownMsg = '> LIFTOFF.'; lastCountdownFg = '#ffd633'; }

      if (frame >= 180) {
        scrollOffset += 0.15;
        while (scrollOffset >= 1.0) { scrollOffset -= 1.0; scrollRows++; }
        if (scrollRows > 0) {
          clearAll();
          // Re-render tileMap with Y offset (world scrolls down)
          for (let ty = 0; ty < WORLD_ROWS && ty + scrollRows < DISPLAY_HEIGHT; ty++) {
            const screenY = ty + scrollRows;
            for (let tx = 0; tx < DISPLAY_WIDTH; tx++) {
              const tile = tileMap[tx] && tileMap[tx][ty];
              if (tile) display.draw(tx, screenY, tile.glyph, tile.fg, tile.bg || BG);
            }
          }
          // Countdown text stays at its row (scrolled down too)
          const msgRow = LOG_END_ROW + scrollRows;
          if (msgRow < DISPLAY_HEIGHT) drawRow(msgRow, lastCountdownMsg, lastCountdownFg);
          // Flames at LF station base, scroll with world
          const lfX = 66, lfBaseY = 37 + scrollRows;
          const fPat = flameFrame % 8 < 4 ? ['*', '^', '*'] : ['*', '^', '^'];
          for (let fi = 0; fi < 3 && lfBaseY + fi < DISPLAY_HEIGHT; fi++) {
            if (lfBaseY + fi < 0) continue;
            for (let fx = -2; fx <= 2; fx++) {
              const ax = lfX + fx;
              if (ax >= 0 && ax < DISPLAY_WIDTH)
                display.draw(ax, lfBaseY + fi, fPat[fi], fi === 2 ? '#ff5555' : '#ff9933', BG);
            }
          }
        }
      }

    // ── Phase 2: Ascent (300-899) ─────────────────────────────────────────────
    } else if (frame < 900) {
      clearAll();
      // Initial star burst at start of phase
      if (frame === 300) for (let i = 0; i < 40; i++) { spawnStar(); stars[stars.length-1].y = Math.random() * DISPLAY_HEIGHT; }
      const spawnRate = 2 + Math.floor((frame - 300) / 200);
      for (let i = 0; i < spawnRate; i++) spawnStar();
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i]; s.y += s.speed;
        if (s.y >= DISPLAY_HEIGHT) { stars.splice(i, 1); continue; }
        const py = Math.floor(s.y);
        if (py >= 0) display.draw(s.x, py, s.ch, s.color, BG);
      }
      drawEndRocket(rocketScreenY);

    // ── Phase 3: Moon (900-1499) ──────────────────────────────────────────────
    } else if (frame < 1500) {
      clearAll();
      for (let i = 0; i < 4; i++) spawnStar();
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i]; s.y += s.speed;
        if (s.y >= DISPLAY_HEIGHT) { stars.splice(i, 1); continue; }
        const py = Math.floor(s.y);
        if (py >= 0) display.draw(s.x, py, s.ch, s.color, BG);
      }
      moonY += 0.12;
      drawMoon(moonY);
      if (frame >= 1200) rocketScreenY -= 0.1;
      drawEndRocket(rocketScreenY);

    // ── Phase 4: Departure (1500-1799) ────────────────────────────────────────
    } else if (frame < 1800) {
      const t = (frame - 1500) / 300;
      starSpeedMult = Math.max(0, 1.0 - t);
      clearAll();
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];
        if (starSpeedMult < 0.05) { stars.splice(i, 1); continue; }
        s.y += s.speed * starSpeedMult;
        if (s.y >= DISPLAY_HEIGHT) { stars.splice(i, 1); continue; }
        const py = Math.floor(s.y);
        if (py >= 0) display.draw(s.x, py, s.ch, dimColor(s.color, starSpeedMult), BG);
      }
      rocketScreenY -= 0.25;
      if (Math.floor(rocketScreenY) + END_ROCKET.length + 3 > 0) drawEndRocket(rocketScreenY);

    // ── Phase 5: Credits (1800+) ──────────────────────────────────────────────
    } else {
      if (frame === 1800) clearAll();

      if (frame >= 1860 && frame < 1960) {
        // WIDGETER fade in (5 chars/frame revealed)
        const revealed = (frame - 1860) * 5;
        let count = 0;
        for (let row = 0; row < TITLE_ART.length; row++) {
          const line = TITLE_ART[row];
          for (let col = 0; col < line.length; col++) {
            if (line[col] !== ' ' && count <= revealed) {
              const wave = Math.sin((col * 0.12) - (frame * 0.03)) * 0.5 + 0.5;
              const r2 = Math.round(200 + wave * 55), g2 = Math.round(170 + wave * 44), b2 = Math.round(wave * 51);
              display.draw(ART_X + col, 18 + row, line[col], '#' + [r2,g2,b2].map(v=>v.toString(16).padStart(2,'0')).join(''), BG);
            }
            count++;
          }
        }
      } else if (frame >= 1960) {
        drawArtCredits(18, frame);
        const byLine = 'game by adam a.';
        const bx = Math.floor((DISPLAY_WIDTH - byLine.length) / 2);
        if (frame < 2060) {
          // "game by adam a." fade in
          const rev = Math.min(byLine.length, frame - 1960);
          for (let i = 0; i < rev; i++) display.draw(bx + i, 25, byLine[i], '#555555', BG);
        } else {
          for (let i = 0; i < byLine.length; i++) display.draw(bx + i, 25, byLine[i], '#555555', BG);
          // Blink "[ press any key ]"
          const pk = '[ press any key ]';
          const pkx = Math.floor((DISPLAY_WIDTH - pk.length) / 2);
          const blinkOn = Math.floor(frame / 30) % 2 === 0;
          for (let i = 0; i < pk.length; i++)
            display.draw(pkx + i, 30, blinkOn ? pk[i] : ' ', '#333333', BG);
        }
      }
    }

    frame++;
    requestAnimationFrame(endLoop);
  }

  requestAnimationFrame(endLoop);
}

function devUnlockEverything() {
  resetState();
  state.phase = 5;
  state.player.gold = 25000;
  state.lifetimeGoldEarned = 50000;
  state.devUnlocked = true;

  // Workers: 5 apprentices, 4 couriers
  state.skills.apprenticeCount = 5;
  state.skills.courierCount = 4;
  state.skills.workerCarryLevel = 5;
  state.skills.workerSpeedLevel = 4;
  state.skills.courierCarryLevel = 4;
  state.skills.courierSpeedLevel = 4;
  const ofDef = STATION_DEFS.find(s => s.label === 'OF');
  if (ofDef) {
    for (let i = 0; i < 5; i++)
      state.workers.apprentices.push({ x: ofDef.x+1, y: ofDef.y+2, workerState: 'idle', carryRM: 0, carryWidgets: 0, target: {x:0,y:0}, craftTimer: 0, paused: false, nickname: '', buyOnCredit: false });
    for (let i = 0; i < 4; i++)
      state.workers.couriers.push({ x: ofDef.x+1, y: ofDef.y+2, courierState: 'idle', carryWidgets: 0, target: {x:0,y:0}, nickname: '', paused: false });
  }

  // Storage maxed
  state.skills.storageExp1 = 1; state.skills.storageExp2 = 1;
  state.storage.widgetCap = 1000; state.storage.rmCap = 1000;
  state.storage.widgets = 200; state.storage.rm = 100;

  // All Office upgrades
  state.skills.reducedCarry = 1; state.skills.discountDump = 1;
  state.skills.demandHistory = 1; state.skills.forecast = 1;
  state.skills.plantStory = 1; state.skills.smearCampaign = 1;
  state.skills.futures = 1; state.skills.optionsBuy = 1;
  state.skills.optionsWrite = 1; state.skills.volatilitySurface = 1;

  // Player skills
  state.skills.endurance = { pips: 3 };
  state.skills.aquatics = { purchased: true };
  state.skills.interfacing = { pips: 3 };

  // Black card
  state.bank.creditRating = 'AAA'; state.bank.creditRatingScore = 10.0;
  state.bank.card = {
    tier: 'black', limit: 50000, balance: 0, interestRate: 0.01,
    statementCycle: 15, lastStatementDay: 0,
    minimumPaymentDue: 0, paymentDueDay: 0, missedPayments: 0,
    consecutiveGoldPayments: 0, demotionWarningDay: null,
    upgradeNotified: { bronze: true, silver: true, gold: true, black: true },
    overdraftUsedThisCycle: false, graceUsedThisCycle: false,
    silverMarketExtraUsedToday: false, demandImmunityUsedThisWeek: false,
    insuranceBalance: 10000, autoRMThreshold: 20,
  };
  state.bank.upgradeLogQueue    = state.bank.upgradeLogQueue    || [];
  state.bank.upgradeLogLastFired = state.bank.upgradeLogLastFired || 0;

  // Casino unlocked
  state.shinyRocks.red.collected = true;
  state.shinyRocks.yellow.collected = true;
  state.shinyRocks.blue.collected = true;
  state.stations.casino.unlocked = true;

  // Cottage with all furniture and full garden
  state.cottage.owned = true;
  for (const f of FURNITURE_DEFS) {
    if (f.key !== 'cottage') state.cottage.furniture[f.key] = true;
  }
  for (const g of GARDEN_DEFS) state.garden[g.key] = true;

  // Stamps
  state.player.stamps = 500;

  // Rocket near-endgame
  state.rocketWidgets = 4990;
  state.courierDestination = 'market';

  // Market and economy
  calculateDailyDemand();
  state.widgetsSoldToday = 0;
  state.terminalUnlocked = true;
  state.officeUnlocked = true;

  // Inventory
  state.player.inventory.rm = 5;
  state.player.inventory.widgets = 5;
  state.player.inventoryCaps = { rm: 10, widgets: 10 };

  // Apply unlocks and enter game
  applyPhaseUnlocks(5);
  state.gameState = 'playing';
  clearScreen();
  drawWorld();
  // Mine
  state.mine.discovered = true;
  state.mine.crystals = 3;
  state.skills.pickaxeLevel = 2;
  state.skills.lantern = true;
  placeMineEntrance();
  state.weather = { current: 'clear', forecast: 'rain', actualTomorrow: 'storm' };

  addLog('DEV: Everything unlocked. Rocket at 4,990. Couriers set to market.', '#ff5555');
  addLog('Toggle couriers to rocket when ready for the finale.', '#ff5555');
}

function showPauseMenu() {
  const prevState = state.gameState !== 'paused' ? state.gameState : 'playing';
  state.gameState = 'paused';

  const PC    = '#cc66cc';
  const DC    = '#333333';
  const WC    = '#555555';
  const TC    = '#f0f0f0';
  const BOX_W = 54;
  const BOX_H = 24;
  const IW    = 52;
  const LP_W  = 20;
  const RP_W  = 31;
  const BOX_X = Math.floor((DISPLAY_WIDTH - BOX_W) / 2);
  const BOX_Y = Math.max(1, Math.floor((WORLD_ROWS - BOX_H) / 2));
  const DIVX  = BOX_X + 1 + LP_W;
  const RPX   = DIVX + 1;
  const PS    = 4;   // pane start row offset (from BOX_Y)
  const PR    = 17;  // pane rows 0–16

  // ── Left pane: mini rotating cube ───────────────────────────────────────────
  const CUBE_V = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const CUBE_E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  let pauseAngleA = 0, pauseAngleB = 0;
  const pauseParticles = [];

  let screen       = 'pause';
  let selOpt       = 0;
  let devPwBuf     = '';
  let devPwErr     = false;
  let devPwErrTimer = null;

  // ── Drawing helpers ──────────────────────────────────────────────────────────

  function drawBorder() {
    display.draw(BOX_X,           BOX_Y,           '╔', PC, BG);
    display.draw(BOX_X + BOX_W-1, BOX_Y,           '╗', PC, BG);
    display.draw(BOX_X,           BOX_Y + BOX_H-1, '╚', PC, BG);
    display.draw(BOX_X + BOX_W-1, BOX_Y + BOX_H-1, '╝', PC, BG);
    for (let i = 1; i < BOX_W-1; i++) {
      display.draw(BOX_X + i, BOX_Y,           '═', PC, BG);
      display.draw(BOX_X + i, BOX_Y + BOX_H-1, '═', PC, BG);
    }
    for (let y = 1; y < BOX_H-1; y++) {
      display.draw(BOX_X,           BOX_Y + y, '║', PC, BG);
      display.draw(BOX_X + BOX_W-1, BOX_Y + y, '║', PC, BG);
    }
  }

  // Full inner-width row (IW=52)
  function irow(r, text, fg) {
    const p = menuPad(text, IW);
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, BOX_Y + r, p[i] || ' ', fg, BG);
  }

  // Right-pane row (RP_W=31), pane-relative row r (0–16)
  function rrow(r, text, fg) {
    const p = menuPad(text, RP_W);
    for (let i = 0; i < RP_W; i++) display.draw(RPX + i, BOX_Y + PS + r, p[i] || ' ', fg, BG);
  }

  // Right-pane separator (29 dashes + 2 spaces)
  function rsep(r) {
    const dy = BOX_Y + PS + r;
    for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, i < 29 ? '─' : ' ', i < 29 ? DC : BRIGHT_WHITE, BG);
  }

  // Right-pane centered header row
  function rhead(r, text, fg) {
    const dy = BOX_Y + PS + r;
    for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, ' ', BRIGHT_WHITE, BG);
    const cx = Math.floor((RP_W - text.length) / 2);
    for (let i = 0; i < text.length; i++) display.draw(RPX + cx + i, dy, text[i], fg || PC, BG);
  }

  // Option row — prefix(>>/#) + number in PC + text in TC/white
  function optRow(r, num, text, selected) {
    const dy  = BOX_Y + PS + r;
    const pre = selected ? '>>' : '  ';
    const p   = menuPad(`${pre} ${num}.  ${text}`, RP_W);
    const txtFg = selected ? '#ffffff' : TC;
    for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, p[i] || ' ', txtFg, BG);
    if (selected) { display.draw(RPX,     dy, '>', PC, BG); display.draw(RPX + 1, dy, '>', PC, BG); }
    display.draw(RPX + 3, dy, String(num), PC, BG);
  }

  // ── Left pane art ────────────────────────────────────────────────────────────

  function drawLeftArt() {
    const cx = BOX_X + 1 + Math.floor(LP_W / 2);
    const cy = BOX_Y + PS + Math.floor(PR / 2) - 1;
    const scale = 2.0;

    // Clear left pane
    for (let r = 0; r < PR; r++) {
      const dy = BOX_Y + PS + r;
      for (let i = 0; i < LP_W; i++) display.draw(BOX_X + 1 + i, dy, ' ', BRIGHT_WHITE, BG);
      display.draw(DIVX, dy, '│', DC, BG);
    }

    pauseAngleA += 0.015;
    pauseAngleB += 0.008;

    const cosA = Math.cos(pauseAngleA), sinA = Math.sin(pauseAngleA);
    const cosB = Math.cos(pauseAngleB), sinB = Math.sin(pauseAngleB);
    const proj = CUBE_V.map(([x, y, z]) => {
      const x1 = x * cosA - z * sinA;
      const z1 = x * sinA + z * cosA;
      const y1 = y * cosB - z1 * sinB;
      const z2 = y * sinB + z1 * cosB;
      const d = z2 + 3.5;
      return [Math.round(cx + (x1 / d) * scale * 2), Math.round(cy + (y1 / d) * scale), d];
    });

    // Draw edges with depth shading into a z-buffer
    const buf = {};
    for (const [i, j] of CUBE_E) {
      const [x0, y0, z0] = proj[i], [x1, y1, z1] = proj[j];
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy, ex = x0, ey = y0;
      const steps = Math.max(dx, dy);
      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const z = z0 + (z1 - z0) * t;
        const adx = Math.abs(x1 - x0), ady = Math.abs(y1 - y0);
        let ch;
        if      (adx > ady * 2)                                          ch = '─';
        else if (ady > adx * 2)                                          ch = '│';
        else if ((x1 - x0 > 0 && y1 - y0 > 0) || (x1 - x0 < 0 && y1 - y0 < 0)) ch = '╲';
        else                                                             ch = '╱';
        const key = `${ex},${ey}`;
        if (!buf[key] || z < buf[key].z) buf[key] = { ch, z, x: ex, y: ey };
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; ex += sx; }
        if (e2 < dx)  { err += dx; ey += sy; }
      }
    }

    for (const key of Object.keys(buf)) {
      const p = buf[key];
      if (p.x < BOX_X + 1 || p.x >= DIVX || p.y < BOX_Y + PS || p.y >= BOX_Y + PS + PR) continue;
      const fg = p.z < 3.0 ? PC : p.z < 3.8 ? '#884488' : '#444444';
      display.draw(p.x, p.y, p.ch, fg, BG);
    }

    // Vertices
    for (const [px, py, pz] of proj) {
      if (px < BOX_X + 1 || px >= DIVX || py < BOX_Y + PS || py >= BOX_Y + PS + PR) continue;
      display.draw(px, py, '+', pz < 3.5 ? PC : '#666666', BG);
    }

    // Particles
    const PCHARS = ['·', '✦', '*'];
    const PCOLS  = ['#553355', '#664466', '#443344'];
    if (pauseParticles.length < 3 && Math.random() < 0.03) {
      pauseParticles.push({
        x: cx - 4 + Math.random() * 8,
        y: cy + 3 + Math.random() * 2,
        vy: -0.05 - Math.random() * 0.03,
        vx: (Math.random() - 0.5) * 0.02,
        char: PCHARS[Math.floor(Math.random() * PCHARS.length)],
        color: PCOLS[Math.floor(Math.random() * PCOLS.length)],
        life: 80 + Math.floor(Math.random() * 40),
      });
    }
    for (let i = pauseParticles.length - 1; i >= 0; i--) {
      const p = pauseParticles[i];
      p.x += p.vx; p.y += p.vy; p.life--;
      const px = Math.floor(p.x), py = Math.floor(p.y);
      if (p.life <= 0 || py <= BOX_Y + PS || px < BOX_X + 1 || px >= DIVX) {
        pauseParticles.splice(i, 1); continue;
      }
      display.draw(px, py, p.char, p.color, BG);
    }

    // Redraw divider (cube/particles may have overwritten it)
    for (let r = 0; r < PR; r++) display.draw(DIVX, BOX_Y + PS + r, '│', DC, BG);
  }

  // ── Right pane per-screen renderers ─────────────────────────────────────────

  function drawRightPause() {
    rrow(0, '', BRIGHT_WHITE);
    rhead(1, 'OPTIONS');
    rrow(2, '', BRIGHT_WHITE);
    rsep(3);
    rrow(4, '', BRIGHT_WHITE);
    optRow(5, 1, 'Resume',       selOpt === 0);
    rrow(6, '', BRIGHT_WHITE);
    optRow(7, 2, 'Settings',     selOpt === 1);
    rrow(8, '', BRIGHT_WHITE);
    optRow(9, 3, 'Quit to Menu', selOpt === 2);
    rrow(10, '', BRIGHT_WHITE);
    rsep(11);
    const rTier = RATING_TIERS[getBankRatingIdx()];
    const statsArr = [
      ['Day:',     String(state.day)],
      ['Gold:', formatCredits(state.player.gold) + 'g'],
      ['Phase:',   String(state.phase)],
      ['Rating:',  rTier],
      ['Stamps:',  String(state.player.stamps || 0) + ' ∙'],
    ];
    statsArr.forEach(([lbl, val], si) => {
      const dy = BOX_Y + PS + 12 + si;
      const padded = menuPad(lbl.padEnd(9) + val, RP_W);
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, padded[i] || ' ', BRIGHT_WHITE, BG);
      for (let i = 0; i < lbl.length; i++) display.draw(RPX + i,     dy, lbl[i], DC, BG);
      for (let i = 0; i < val.length;  i++) display.draw(RPX + 9 + i, dy, val[i], WC, BG);
    });
  }

  function drawRightSettings() {
    rrow(0, '', BRIGHT_WHITE);
    rhead(1, 'OPTIONS > SETTINGS');
    rrow(2, '', BRIGHT_WHITE);
    rsep(3);
    rrow(4, '', BRIGHT_WHITE);
    const soundOn = !state.audio.muted;
    const fsOn    = state.settings.fullscreen;
    optRow(5,  1, `Sound      [${soundOn ? 'ON ' : 'OFF'}]`, selOpt === 0);
    rrow(6, '', BRIGHT_WHITE);
    optRow(7,  2, `Fullscreen [${fsOn    ? 'ON ' : 'OFF'}]`, selOpt === 1);
    rrow(8, '', BRIGHT_WHITE);
    optRow(9,  3, 'Dev Mode',  selOpt === 2);
    rrow(10, '', BRIGHT_WHITE);
    optRow(11, 4, 'Back',      selOpt === 3);
    // Recolor ON/OFF bracket values (both options have value at RPX+19)
    const colorBrack = (rPaneRow, isOn) => {
      const dy    = BOX_Y + PS + rPaneRow;
      const valFg = isOn ? '#66cc66' : WC;
      const vStr  = isOn ? 'ON ' : 'OFF';
      for (let i = 0; i < vStr.length; i++) display.draw(RPX + 19 + i, dy, vStr[i], valFg, BG);
    };
    colorBrack(5, soundOn);
    colorBrack(7, fsOn);
    rrow(12, '', BRIGHT_WHITE);
    if (fsError) {
      const eTrunc = fsError.substring(0, RP_W);
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, BOX_Y + PS + 13, ' ', BRIGHT_WHITE, BG);
      for (let i = 0; i < eTrunc.length; i++) display.draw(RPX + i, BOX_Y + PS + 13, eTrunc[i], '#ff5555', BG);
    } else {
      rrow(13, '', BRIGHT_WHITE);
    }
    rrow(14, '', BRIGHT_WHITE);
    rrow(15, '', BRIGHT_WHITE);
    rrow(16, '', BRIGHT_WHITE);
  }

  function drawRightDevPw() {
    rrow(0, '', BRIGHT_WHITE);
    rhead(1, 'OPTIONS > DEV MODE');
    rrow(2, '', BRIGHT_WHITE);
    rsep(3);
    rrow(4, '', BRIGHT_WHITE);
    rrow(5, '[password protected]', WC);
    rrow(6, '', BRIGHT_WHITE);
    const mask   = devPwBuf.replace(/./g, '*').padEnd(10, ' ');
    const prompt = `Enter code: [${mask}]`;
    rrow(7, prompt, TC);
    // Recolor mask and brackets
    const dy7    = BOX_Y + PS + 7;
    const mOff   = 'Enter code: ['.length;
    for (let i = 0; i < mask.length; i++) display.draw(RPX + mOff + i, dy7, mask[i], '#66cc66', BG);
    display.draw(RPX + mOff - 1, dy7, '[', PC, BG);
    display.draw(RPX + mOff + 10, dy7, ']', PC, BG);
    rrow(8, '', BRIGHT_WHITE);
    rrow(9, devPwErr ? 'Access denied.' : '', devPwErr ? '#ff5555' : BRIGHT_WHITE);
    for (let r = 10; r < PR; r++) rrow(r, '', BRIGHT_WHITE);
  }

  function drawRightDev() {
    rrow(0, '', BRIGHT_WHITE);
    // Title with ⚠ in red
    { const s1 = 'OPTIONS > DEV MODE ', s2 = '⚠';
      const cx = Math.floor((RP_W - s1.length - 1) / 2);
      const dy = BOX_Y + PS + 1;
      for (let i = 0; i < RP_W; i++) display.draw(RPX + i, dy, ' ', BRIGHT_WHITE, BG);
      for (let i = 0; i < s1.length; i++) display.draw(RPX + cx + i, dy, s1[i], PC, BG);
      display.draw(RPX + cx + s1.length, dy, s2, '#ff5555', BG); }
    rrow(2, '', BRIGHT_WHITE);
    rsep(3);
    rrow(4, '', BRIGHT_WHITE);
    const devOpts = [
      'Jump to Phase 1',
      'Jump to Phase 2',
      'Jump to Phase 3',
      'Jump to Phase 4',
      'Give Credits',
      'Give Widgets',
      'Make Credit Score S',
      'Open Casino',
      'Unlock Everything',
      'Back',
    ];
    devOpts.forEach((opt, idx) => optRow(5 + idx, idx + 1, opt, selOpt === idx));
    for (let r = 14; r < PR; r++) rrow(r, '', BRIGHT_WHITE);
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  function render() {
    // Row 1: WIDGETER centered
    irow(1, '', BRIGHT_WHITE);
    { const s = 'WIDGETER'; const cx = BOX_X + 1 + Math.floor((IW - s.length) / 2);
      for (let i = 0; i < s.length; i++) display.draw(cx + i, BOX_Y + 1, s[i], TC, BG); }
    // Row 2: paused centered
    irow(2, '', BRIGHT_WHITE);
    { const s = 'paused'; const cx = BOX_X + 1 + Math.floor((IW - s.length) / 2);
      for (let i = 0; i < s.length; i++) display.draw(cx + i, BOX_Y + 2, s[i], WC, BG); }
    // Row 3: ═ separator
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, BOX_Y + 3, '═', DC, BG);
    // Pane rows
    drawLeftArt();
    if      (screen === 'pause')       drawRightPause();
    else if (screen === 'settings')    drawRightSettings();
    else if (screen === 'devPassword') drawRightDevPw();
    else                               drawRightDev();
    // Row 21: ═ separator
    for (let i = 0; i < IW; i++) display.draw(BOX_X + 1 + i, BOX_Y + 21, '═', DC, BG);
    // Row 22: blank
    irow(22, '', BRIGHT_WHITE);
  }

  // ── Option activation ────────────────────────────────────────────────────────

  function maxOpts() {
    if (screen === 'pause')    return 3;
    if (screen === 'settings') return 4;
    if (screen === 'dev')      return 10;
    return 0;
  }

  function close() {
    pauseMenuRedrawFn = null;
    pauseMenuCloseFn  = null;
    if (devPwErrTimer) clearTimeout(devPwErrTimer);
    window.removeEventListener('keydown', pauseKeyHandler);
    clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
    renderDirty();
    for (const w of state.workers.apprentices) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    for (const c of state.workers.couriers)    display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    display.draw(state.player.x, state.player.y, '@', state.player.color || BRIGHT_WHITE, BG);
    state.gameState = prevState;
  }
  pauseMenuCloseFn = close;

  function activate() {
    if (screen === 'pause') {
      if      (selOpt === 0) { close(); }
      else if (selOpt === 1) { screen = 'settings'; selOpt = 0; render(); }
      else if (selOpt === 2) {
        pauseMenuRedrawFn = null;
        if (devPwErrTimer) clearTimeout(devPwErrTimer);
        window.removeEventListener('keydown', pauseKeyHandler);
        clearMenuRegion(BOX_X, BOX_Y, BOX_W, BOX_H);
        renderDirty();
        saveGame();
        showContinueMenu();
      }
    } else if (screen === 'settings') {
      if      (selOpt === 0) { state.audio.muted = !state.audio.muted; saveGame(); drawBorder(); render(); }
      else if (selOpt === 1) { setFullscreen(!state.settings.fullscreen); drawBorder(); render(); }
      else if (selOpt === 2) {
        if (state.devUnlocked) { screen = 'dev'; selOpt = 0; render(); }
        else { devPwBuf = ''; devPwErr = false; screen = 'devPassword'; render(); }
      }
      else if (selOpt === 3) { screen = 'pause'; selOpt = 0; render(); }
    } else if (screen === 'dev') {
      if (selOpt >= 0 && selOpt <= 3) {
        pauseMenuRedrawFn = null;
        window.removeEventListener('keydown', pauseKeyHandler);
        devJumpToPhase(selOpt + 1);
      } else if (selOpt === 4) {
        pauseMenuRedrawFn = null;
        window.removeEventListener('keydown', pauseKeyHandler);
        showNumericPrompt('Give gold (any amount)', 9999999,
          (v) => {
            state.player.gold += v; state.lifetimeGoldEarned += v;
            drawStatusBar(); addLog(`> DEV: +${v}g added.`, '#ff5555');
            state.gameState = prevState; showPauseMenu();
          },
          () => { state.gameState = prevState; showPauseMenu(); }
        );
      } else if (selOpt === 5) {
        pauseMenuRedrawFn = null;
        window.removeEventListener('keydown', pauseKeyHandler);
        showNumericPrompt('Give widgets (any amount)', 9999999,
          (v) => {
            const space = state.storage.widgetCap - state.storage.widgets;
            const add   = Math.min(v, space);
            state.storage.widgets += add;
            addLog(add < v ? `> DEV: Storage full. Added ${add} widgets.` : `> DEV: +${add} widgets added.`, '#ff5555');
            drawStatusBar(); state.gameState = prevState; showPauseMenu();
          },
          () => { state.gameState = prevState; showPauseMenu(); }
        );
      } else if (selOpt === 6) {
        // Make Credit Score S
        state.bank.creditRatingScore = 10.0;
        addLog('> DEV: Credit score set to S.', '#ff5555');
        if (state.bank.card) {
          for (const t of CARD_TIER_ORDER) {
            const curTIdx = state.bank.card.tier ? CARD_TIER_ORDER.indexOf(state.bank.card.tier) : -1;
            if (CARD_TIER_ORDER.indexOf(t) > curTIdx && !state.bank.card.upgradeNotified[t]) {
              state.bank.card.upgradeNotified[t] = true;
              addLog(`> [BANK] You qualify for a ${t.toUpperCase()} card.`, CARD_TIERS[t].color);
              addLog(`> Visit the Bank to upgrade.`, CARD_TIERS[t].color);
            }
          }
        }
        drawStatusBar();
        close();
      } else if (selOpt === 7) {
        // Open Casino
        state.shinyRocks.red.collected = true;
        state.shinyRocks.yellow.collected = true;
        state.shinyRocks.blue.collected = true;
        state.stations.casino.unlocked = true;
        stampCasino(false);
        renderDirty();
        addLog('> DEV: Casino unlocked.', '#ff5555');
        close();
      } else if (selOpt === 8) {
        // Unlock Everything
        pauseMenuRedrawFn = null;
        window.removeEventListener('keydown', pauseKeyHandler);
        devUnlockEverything();
      } else if (selOpt === 9) {
        screen = 'settings'; selOpt = 0; render();
      }
    }
  }

  // ── Key handler ──────────────────────────────────────────────────────────────

  function pauseKeyHandler(e) {
    // Password screen: text input only
    if (screen === 'devPassword') {
      if (devPwErr) return;
      if (e.key === 'Escape')    { devPwBuf = ''; screen = 'settings'; selOpt = 0; render(); return; }
      if (e.key === 'Backspace') { devPwBuf = devPwBuf.slice(0, -1); render(); return; }
      if (e.key === 'Enter') {
        if (devPwBuf.toLowerCase() === DEV_PASSWORD) {
          state.devUnlocked = true;
          devPwBuf = ''; screen = 'dev'; selOpt = 0; render();
        } else {
          devPwErr = true; render();
          devPwErrTimer = setTimeout(() => {
            devPwErr = false; devPwBuf = ''; screen = 'settings'; selOpt = 0; render();
          }, 2000);
        }
        return;
      }
      if (e.key.length === 1 && devPwBuf.length < 10) { devPwBuf += e.key; render(); }
      return;
    }
    // Arrow / Enter navigation
    const mo = maxOpts();
    if (e.key === 'ArrowUp')   { selOpt = (selOpt - 1 + mo) % mo; playSound('click'); render(); return; }
    if (e.key === 'ArrowDown') { selOpt = (selOpt + 1) % mo;       playSound('click'); render(); return; }
    if (e.key === ' ')         { e.preventDefault(); activate(); return; }
    // ESC
    if (e.key === 'Escape') {
      if      (screen === 'pause')    { close(); return; }
      else if (screen === 'settings') { screen = 'pause';    selOpt = 0; render(); return; }
      else if (screen === 'dev')      { screen = 'settings'; selOpt = 0; render(); return; }
      return;
    }
    // Number key shortcuts
    const n = parseInt(e.key);
    if (!isNaN(n) && n >= 1 && n <= mo) { selOpt = n - 1; activate(); }
  }

  drawBorder();
  render();
  pauseMenuRedrawFn = () => { drawBorder(); render(); };
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
    if (officeMenuRedrawFn && state.officeTab === 'workers') officeMenuRedrawFn();
  }
  if (state.officeAnim.courierFlash > 0) {
    state.officeAnim.courierFlash--;
    if (officeMenuRedrawFn && state.officeTab === 'workers') officeMenuRedrawFn();
  }

  if (state.gameState !== 'playing' && state.gameState !== 'crafting' && state.gameState !== 'dashboard' && state.gameState !== 'inventory' && state.gameState !== 'lf_menu' && state.gameState !== 'rm_menu' && state.gameState !== 'wb_menu' && state.gameState !== 'mt_menu' && state.gameState !== 'dv_menu' && state.gameState !== 'cottage' && state.gameState !== 'fishing' && state.gameState !== 'casino' && state.gameState !== 'mine') return;

  // Stats: snapshot before tick for delta computation
  const _sCr = state.player.gold;
  const _sRM = state.player.inventory.rm + state.storage.rm;
  const _sWg = state.player.inventory.widgets + state.storage.widgets;

  state.tick++;
  state.dayTick++;
  if (state.dayTick >= 240) {
    state.dayTick = 0; state.day++; state.bellFiredToday = false; state.widgetsSoldToday = 0; state.demandMetLogged = false; state._demandImmunityActiveToday = false; state.stats.widgetsMadeToday = 0; state.stats.revenueToday = 0; state.stats.costsToday = 0; state.fishing.catchesToday = 0;
    // Casino daily reset
    if (state.stations.casino) { state.stations.casino.spunToday = 0; state.stations.casino.dailyBetTotal = 0; state.stations.casino.lossesTonight = 0; }
    // Assign three spread-out blink ticks per uncollected rock
    for (const rock of Object.values(state.shinyRocks)) {
      if (!rock.collected) rock.blinkTicks = pickThreeBlinkTicks();
    }
    // Once-per-dawn directional hint for uncollected rocks (day 2 onward)
    if (state.day > 1) {
      const ROCK_HINTS = [
        { color: 'red',    text: (dir) => `> Something red catches your eye ${dir}.`,       fg: '#ff5555' },
        { color: 'yellow', text: (dir) => `> A glint of yellow, ${dir}.`,                   fg: '#ffd633' },
        { color: 'blue',   text: (dir) => `> Something blue, ${dir}. Gone before you look.`, fg: '#66ccff' },
      ];
      let delay = 0;
      for (const hint of ROCK_HINTS) {
        const rock = state.shinyRocks[hint.color];
        if (rock && !rock.collected) {
          const capturedRock = rock;
          const capturedHint = hint;
          setTimeout(() => addLog(capturedHint.text(rockDirection(capturedRock)), capturedHint.fg), delay);
          delay += 800;
        }
      }
    }
    // Auto-close casino at dawn for non-Black card holders
    if (state.gameState === 'casino' && state.bank.card?.tier !== 'black') {
      if (casinoMenuCloseFn) casinoMenuCloseFn();
      addLog('> The dealer pulls down the shutters. The first light is showing.', '#aa3333');
    }
    // Bank notice for big overnight casino losses
    if (state.bank.casinoStartCredits != null) {
      const casinoLoss = state.bank.casinoStartCredits - state.player.gold;
      if (casinoLoss > 500 && state.bank.deposit > 0) {
        setTimeout(() => addLog('> [BANK] Notice: significant overnight withdrawal pattern detected.', '#555555'), 1500);
      }
      state.bank.casinoStartCredits = null;
    }
    // Mine discovery — random event after Phase 2, guaranteed in Phase 3+
    if (state.phase >= 2 && !state.mine.discovered) {
      const chance = state.phase >= 3 ? 1.0 : 0.25;
      if (Math.random() < chance) {
        state.mine.discovered = true;
        state.mine.discoveredDay = state.day;
        placeMineEntrance();
        renderDirty();
        setTimeout(() => addLog('The ground has opened up in the south.', '#66ccff'), 1200);
      }
    }
  }
  const prevMarketOpen = state.marketOpen;
  state.marketOpen = state.dayTick < 180;
  if (state.marketOpen !== prevMarketOpen) {
    startDayNightFlash(state.marketOpen ? 'open' : 'close');
    // Dim MT label tiles when market closes, restore when it opens
    const mtDef = STATION_DEFS.find(s => s.label === 'MT');
    if (mtDef && tileMap[mtDef.x+1]?.[mtDef.y+1] && tileMap[mtDef.x+2]?.[mtDef.y+1]) {
      const lc = state.marketOpen ? (mtDef.lc || '#ffea66') : '#333333';
      tileMap[mtDef.x+1][mtDef.y+1].fg = lc;
      tileMap[mtDef.x+2][mtDef.y+1].fg = lc;
      markDirty(mtDef.x+1, mtDef.y+1); markDirty(mtDef.x+2, mtDef.y+1);
    }
  }
  if (state.dayTick === 0 && !state.bellFiredToday) {
    state.bellFiredToday = true;
    // Garden regrowth
    if (state.gardenRegrow) {
      for (const [key, regrowDay] of Object.entries(state.gardenRegrow)) {
        if (state.day >= regrowDay) {
          state.garden[key] = true;
          delete state.gardenRegrow[key];
          const def = GARDEN_DEFS.find(g => g.key === key);
          if (def) addLog(`Your ${def.name} has regrown.`, def.fg);
          if (state.cottage.owned) placeGardenTiles();
        }
      }
    }
    // Cooking buff expiry
    if (state.cooking?.activeBuff && state.day >= state.cooking.activeBuff.expiresDay) {
      addLog(`Your ${state.cooking.activeBuff.name} buff has worn off.`, state.cooking.activeBuff.color);
      state.cooking.activeBuff = null;
    }
    // Loading Port auto-sell at market open
    if (state.loadingPort?.unlocked && state.loadingPort.widgets > 0 && state.marketOpen) {
      const toSell = Math.min(state.loadingPort.widgets, state.phase >= 3 ? Math.max(0, state.demand - state.widgetsSoldToday) : state.loadingPort.widgets);
      if (toSell > 0) {
        const revenue = Math.round(toSell * state.marketPrice * 10) / 10;
        state.player.gold = Math.round((state.player.gold + revenue) * 10) / 10;
        state.lifetimeGoldEarned = Math.round((state.lifetimeGoldEarned + revenue) * 10) / 10;
        state.stats.revenueToday = Math.round((state.stats.revenueToday + revenue) * 10) / 10;
        state.loadingPort.widgets -= toSell;
        if (state.phase >= 3) state.widgetsSoldToday += toSell;
        addLog(`Loading port auto-sold ${toSell} widget${toSell !== 1 ? 's' : ''} for ${revenue}g.`, '#88cc88');
        drawStatusBar();
      }
    }
    // Weather system — Phase 2+ only
    if (state.phase >= 2) {
      state.weather.current = state.weather.actualTomorrow;
      const roll = Math.random() * 100;
      if (roll < 40)      state.weather.actualTomorrow = 'clear';
      else if (roll < 65) state.weather.actualTomorrow = 'rain';
      else if (roll < 80) state.weather.actualTomorrow = 'fog';
      else if (roll < 90) state.weather.actualTomorrow = 'heatwave';
      else                state.weather.actualTomorrow = 'storm';
      state.weather.forecast = Math.random() < 0.75
        ? state.weather.actualTomorrow
        : ['clear','rain','fog','heatwave','storm'][Math.floor(Math.random()*5)];
      const WEATHER_MSGS = {
        clear:    ['Clear skies. A good day for business.', '#ffd633'],
        rain:     ['Rain falls on the paths. Workers slow down.', '#4a8aaa'],
        fog:      ['A thick fog rolls in. Visibility is low.', '#666666'],
        heatwave: ['The heat is oppressive. Demand is up.', '#ff6633'],
        storm:    ['Thunder shakes the ground. Double ore in the mine.', '#ffaa00'],
      };
      const wm = WEATHER_MSGS[state.weather.current];
      if (wm) addLog(wm[0], wm[1]);
      drawStatusBar();
    }
    addLog('The morning bell has rung.', BRIGHT_CYAN);
    generateBuyOffers();
    if (state.phase >= 3) {
      calculateDailyDemand();
      const dl = demandLabel(state.demand);
      wrapLog(`Market demand today: ${dl.text}. Price: ${state.marketPrice}g/widget.`, dl.fg);
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
      addLog(`> [DAILY WIDGET] ${headline}`, COLOR_NP_FRAME);
      setTimeout(() => addLog('A new edition of The Daily Widget is ready.', COLOR_NP_FRAME), 500);
    }
    // Settle terminal positions at dawn
    { const r10 = v => Math.round(v * 10) / 10;
      // Forwards: deliver widgets at lock price on delivery day
      const dueForwards = state.terminal.positions.filter(p => p.type === 'forward' && p.deliveryDay === state.day);
      for (const p of dueForwards) {
        const spot = state.marketPrice;
        const totalWidgets = state.storage.widgets + state.player.inventory.widgets;
        if (totalWidgets >= p.qty) {
          let remaining = p.qty;
          if (state.storage.widgets >= remaining) { state.storage.widgets -= remaining; }
          else { remaining -= state.storage.widgets; state.storage.widgets = 0; state.player.inventory.widgets -= remaining; }
          const proceeds = r10(p.lockPrice * p.qty);
          state.player.gold = r10(state.player.gold + proceeds);
          const pnl = r10((p.lockPrice - spot) * p.qty);
          state.terminal.pnlToday = r10(state.terminal.pnlToday + pnl);
          state.terminal.totalPnL = r10(state.terminal.totalPnL + pnl);
          addLog(`Forward settled: ${p.qty}wg @ ${p.lockPrice}g (spot ${spot}g). Proceeds: ${proceeds}g.`, pnl >= 0 ? '#66cc66' : '#ff5555');
          if (pnl > 0) changeRating(+0.25, 'Profitable forward contract');
        } else {
          const shortfall = p.qty - totalWidgets;
          const penalty = r10(spot * shortfall);
          let covered = 0;
          if (state.bank.card.tier === 'black' && state.bank.card.insuranceBalance > 0 && state.player.gold - penalty < 0) {
            const deficit = Math.abs(state.player.gold - penalty);
            covered = Math.min(deficit, state.bank.card.insuranceBalance);
            state.bank.card.insuranceBalance = r10(state.bank.card.insuranceBalance - covered);
            addLog(`> Insurance covered ${formatCredits(covered)}g.`, '#f0f0f0');
          }
          if (totalWidgets > 0) {
            state.player.gold = r10(state.player.gold + p.lockPrice * totalWidgets);
            state.storage.widgets = 0; state.player.inventory.widgets = 0;
          }
          state.player.gold = r10(state.player.gold - penalty + covered);
          state.terminal.pnlToday = r10(state.terminal.pnlToday - penalty);
          state.terminal.totalPnL = r10(state.terminal.totalPnL - penalty);
          addLog(`Short delivery on forward. Penalty: ${penalty}g.`, '#ff5555');
        }
        drawStatusBar();
      }
      state.terminal.positions = state.terminal.positions.filter(p => !(p.type === 'forward' && p.deliveryDay === state.day));

      // Futures: daily mark-to-market
      for (const p of state.terminal.positions.filter(p => p.type === 'future')) {
        const spot = state.marketPrice;
        const mtm = p.dir === 'long' ? r10((spot - p.lastSettle) * p.qty) : r10((p.lastSettle - spot) * p.qty);
        if (mtm !== 0) {
          state.player.gold = r10(state.player.gold + mtm);
          state.terminal.pnlToday = r10(state.terminal.pnlToday + mtm);
          state.terminal.totalPnL = r10(state.terminal.totalPnL + mtm);
          p.lastSettle = spot;
          if (Math.abs(mtm) >= 5) addLog(`Future MTM: ${mtm >= 0 ? '+' : ''}${mtm}g.`, mtm >= 0 ? '#66cc66' : '#ff5555');
          drawStatusBar();
        }
      }

      // Options: expiry settlement
      const dueOpts = state.terminal.positions.filter(p => p.type === 'option' && p.expiryDay === state.day);
      for (const p of dueOpts) {
        const spot = state.marketPrice;
        const payoff = p.optType === 'call' ? Math.max(0, spot - p.strike) : Math.max(0, p.strike - spot);
        if (p.side === 'buy') {
          const pnl = r10(payoff * p.qty - p.premium * p.qty);
          state.player.gold = r10(state.player.gold + payoff * p.qty);
          state.terminal.pnlToday = r10(state.terminal.pnlToday + pnl);
          state.terminal.totalPnL = r10(state.terminal.totalPnL + pnl);
          addLog(payoff > 0 ? `Option expired: payoff ${r10(payoff*p.qty)}g. Net: ${pnl >= 0 ? '+' : ''}${pnl}g.` : `Option expired worthless.`, pnl >= 0 ? '#66cc66' : '#ff5555');
        } else {
          const pnl = r10(p.premium * p.qty - payoff * p.qty);
          state.player.gold = r10(state.player.gold + p.marginHeld - payoff * p.qty);
          state.terminal.pnlToday = r10(state.terminal.pnlToday + pnl);
          state.terminal.totalPnL = r10(state.terminal.totalPnL + pnl);
          addLog(payoff > 0 ? `Written option exercised. Paid ${r10(payoff*p.qty)}g.` : `Written option expired. Premium kept.`, pnl >= 0 ? '#66cc66' : '#ff5555');
        }
        drawStatusBar();
      }
      state.terminal.positions = state.terminal.positions.filter(p => !(p.type === 'option' && p.expiryDay === state.day));
    }
    // Reset daily PnL
    state.terminal.pnlToday = 0;

    // Volatility recalculation
    if (state.phase >= 3) calculateVolatility();

    // Credit rating: consecutive profitable days
    if (state.player.gold > 0 && state.debt === 0) {
      state.bank.consecutivePositiveDays++;
      if (state.bank.consecutivePositiveDays >= 5 && state.bank.consecutivePositiveDays % 5 === 0) {
        changeRating(+0.5, `${state.bank.consecutivePositiveDays} profitable days`);
      }
    } else {
      state.bank.consecutivePositiveDays = 0;
    }
    state.bank.creditNegativeLogged = false; // reset per-day flag at dawn

    // Card billing cycle and dawn card checks
    if (state.bank.card.tier) {
      const card = state.bank.card;
      const tierDef = CARD_TIERS[card.tier];

      // Card demotion check
      if (tierDef && state.bank.creditRatingScore < tierDef.requiresScore) {
        if (!card.demotionWarningDay) {
          card.demotionWarningDay = state.day;
          addLog(`> [BANK] Rating below card tier requirements.`, '#ff9933');
          addLog(`> You have 3 days to improve.`, '#ff9933');
        } else if (state.day - card.demotionWarningDay >= 3) {
          const oldTier = card.tier;
          const newEligible = getMaxEligibleCardTier(state.bank.creditRatingScore);
          const newTierDef  = newEligible ? CARD_TIERS[newEligible] : null;
          card.tier          = newEligible;
          card.limit         = newTierDef ? newTierDef.limit : 0;
          card.interestRate  = newTierDef ? newTierDef.interestRate : 0;
          card.statementCycle = newTierDef ? newTierDef.cycle : 10;
          card.demotionWarningDay = null;
          addLog(`> [BANK] Your ${oldTier.toUpperCase()} card has been revoked.`, '#ff5555');
          addLog(`> Credit tier has been adjusted.`, '#ff5555');
        }
      } else if (card.demotionWarningDay) {
        card.demotionWarningDay = null;
        addLog(`> [BANK] Your rating has recovered. Card status maintained.`, '#66cc66');
      }

      // Missed payment check
      if (state.day === card.paymentDueDay && card.minimumPaymentDue > 0) {
        card.missedPayments++;
        card.consecutiveGoldPayments = 0;
        changeRating(-2.0, 'Missed card payment');
        addLog('Card: missed minimum payment. Credit score hit.', '#ff5555');
        card.minimumPaymentDue = 0;
      }

      // Statement close
      if (state.day >= card.lastStatementDay + card.statementCycle) {
        if (card.balance > 0) {
          const interest = Math.round(card.balance * card.interestRate * 10) / 10;
          card.balance   = Math.round((card.balance + interest) * 10) / 10;
        }
        card.minimumPaymentDue    = card.balance > 0 ? Math.round(Math.max(5, card.balance * 0.1) * 10) / 10 : 0;
        card.paymentDueDay        = state.day + 5;
        card.lastStatementDay     = state.day;
        card.overdraftUsedThisCycle = false;
        card.graceUsedThisCycle     = false;
        if (card.balance > 0)
          addLog(`Card statement: ${formatCredits(card.balance)}g balance, min ${formatCredits(card.minimumPaymentDue)}g due day ${card.paymentDueDay}.`, getCardTierColor(card.tier));
      }

      // Silver: auto-RM purchase at dawn
      if (cardTierAtLeast('silver') && card.autoRMThreshold > 0) {
        const rmSpace = state.storage.rmCap - state.storage.rm;
        if (state.storage.rm < card.autoRMThreshold && rmSpace > 0) {
          const needed  = Math.min(card.autoRMThreshold - state.storage.rm, rmSpace);
          const cost    = needed * 3;
          const avail   = Math.max(0, card.limit - card.balance);
          const autoBuy = Math.min(needed, Math.floor(avail / 3));
          if (autoBuy > 0) {
            card.balance    = Math.round((card.balance + autoBuy * 3) * 10) / 10;
            state.storage.rm += autoBuy;
            addLog(`> Auto-purchase: ${autoBuy} RM bought. Charged to card.`, '#aaaaaa');
          }
        }
      }

      // Gold: extra newspaper forecast at dawn
      if (cardTierAtLeast('gold') && state.phase >= 3 && state.newspaper.tomorrowForecastLabel) {
        addLog(`> [GOLD CARD] Tomorrow's forecast: ${state.newspaper.tomorrowForecastLabel}.`, CARD_TIERS.gold.color);
      }

      // Silver: reset extra market sales
      card.silverMarketExtraUsedToday = false;
    }

    // Weekly demand immunity reset (Black card)
    if (state.day % 7 === 0 && state.bank.card.tier === 'black') {
      state.bank.card.demandImmunityUsedThisWeek = false;
    }

  }
  if (state.gameState !== 'mine') drawTimeIndicator();

  // Stamp hint on first night — day 1 night phase only, once ever (§13)
  if (state.day === 1 && state.dayTick === state.player.stampHintTick && !state.player.stampHintFired) {
    state.player.stampHintFired = true;
    const hintText = 'Being observant seems to award stamps';
    const hintEntry = { text: hintText, rich: true, colors: [COLOR_STAMPS, '#f0f0f0'] };
    state.logLines.push(hintEntry);
    if (state.logLines.length > 5) state.logLines.shift();
    if (state.gameState !== 'mine') renderLog();
  }

  // Stamp event timer — only when actively playing (§13)
  if (state.gameState === 'playing') {
    state.player.stampEventTimer = (state.player.stampEventTimer ?? 40) - 1;
    if (state.player.stampEventTimer <= 0) {
      state.player.stampEventTimer = Math.floor(Math.random() * 21) + 40;
      awardStamp(1, true);
    }
  }

  if (state.gameState === 'crafting') {
    const secsLeft = activeCraftTicks - craftProgress;
    drawRow(LOG_END_ROW, `> Crafting — ${secsLeft}s remaining`, '#ff9933');
    const prevHF = state.workbenchHammerFrame;
    state.workbenchHammerFrame = Math.min(9, Math.floor((craftProgress / activeCraftTicks) * 10));
    const wbDef2 = STATION_DEFS.find(s => s.label === 'WB');
    if (wbDef2) {
      const doorX = wbDef2.x + 1, doorY = wbDef2.y + 2;
      if (state.workbenchHammerFrame >= 6 && prevHF < 6) display.draw(doorX, doorY, '*', '#ffd633', BG);
      else if (prevHF >= 6 && prevHF <= 7 && state.workbenchHammerFrame >= 8) { markDirty(doorX, doorY); renderDirty(); }
    }
    craftProgress++;
    if (!craftingRemote) pulseWB();
    if (craftProgress >= activeCraftTicks) {
      craftProgress = 0;
      state.player.inventory.widgets++;
      playSound('crafted');
      state.widgetsMade++;
      state.stats.widgetsMadeToday++;
      state.lifetimeWidgetsMade = (state.lifetimeWidgetsMade || 0) + 1;
      drawStatusBar();
      { const wbD = STATION_DEFS.find(s => s.label === 'WB'); if (wbD) effectsManager.sparkBurst(wbD.x + 1, wbD.y + 1, state.widgetsMade); }
      if (craftQueue > 0) {
        const stillLeft = craftQueue;
        craftQueue--;
        state.player.inventory.rm--;
        state.workbenchHammerFrame = 0;
        state.workbenchHammerTick  = 0;
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
    if (state.gameState !== 'cottage' && state.gameState !== 'mine') { // don't draw workers over interior views
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
  drawPhaseGoal();
  // Safety net: if phase advanced but station unlock was missed, apply it now
  if (state.phase >= 3 && !state.stations.newspaper.unlocked) applyPhaseUnlocks(state.phase);

  // Cost of carry — fires on the last tick of each day (§5.4)
  if (state.dayTick === 239 && state.phase >= 3) {
    // First: attempt to clear any existing debt
    if (state.debt > 0) {
      const debtPayment = Math.min(state.player.gold, state.debt);
      state.player.gold = Math.round((state.player.gold - debtPayment) * 10) / 10;
      state.debt           = Math.round((state.debt - debtPayment) * 10) / 10;
      if (state.debt > 0) {
        state.debtDaysUnpaid++;
        if (state.debtDaysUnpaid >= 3) addLog('Your debts are mounting. Consider the Bank.', '#ff5555');
      } else {
        state.debtDaysUnpaid = 0;
      }
    }
    // Then: charge carry cost on stored widgets
    // Cost of carry — capped at 50cr/day max
    const cookCarryMult = state.cooking?.activeBuff?.buff === 'carryCost' ? state.cooking.activeBuff.value : 1.0;
    const mult      = (state.skills.reducedCarry ? 0.1 : 0.2) * cookCarryMult;
    let carryCost   = Math.round(state.storage.widgets * mult * 10) / 10;
    carryCost       = Math.min(50, carryCost); // cap at 50cr
    if (carryCost > 0) {
      state.stats.costsToday = Math.round((state.stats.costsToday + carryCost) * 10) / 10;
      state.player.gold = Math.round((state.player.gold - carryCost) * 10) / 10;
      addLog(`Storage cost: ${carryCost}g for ${state.storage.widgets} widgets held.`, '#ff5555');
      drawStatusBar();
      checkBankruptcyStipend();
    }
    // Courier daily maintenance
    const courierCount = state.workers.couriers.length;
    const maintenanceCost = courierCount * 5;
    if (maintenanceCost > 0) {
      if (state.player.gold >= maintenanceCost) {
        state.player.gold -= maintenanceCost;
        for (const c of state.workers.couriers) c.paused = false;
        addLog(`Courier wages: ${maintenanceCost}g for ${courierCount} courier${courierCount > 1 ? 's' : ''}.`, '#aaaaaa');
      } else {
        for (const c of state.workers.couriers) c.paused = true;
        addLog(`Can't afford courier wages (${maintenanceCost}g). Couriers idle today.`, '#ff5555');
      }
      drawStatusBar();
    }
    // Emergency RM at the shed — if player is broke
    if (state.player.gold <= 0 && state.player.inventory.rm < state.player.inventoryCaps.rm) {
      state.player.inventory.rm += 1;
      addLog('The RM shed leaves a free brick by the door. Get back on your feet.', '#66cc66');
      drawStatusBar();
    }
    // Deposit interest: 10% per day
    if (state.bank.deposit > 0) {
      const interest = Math.round(state.bank.deposit * 0.10 * 10) / 10;
      if (interest > 0) {
        state.bank.deposit = Math.round((state.bank.deposit + interest) * 10) / 10;
        addLog(`Bank interest: +${interest}g.`, '#66cc66');
      }
      drawStatusBar();
    }

    // Terminal futures: tick-level unrealized PnL display (dawn handles actual settlement)
    if (state.terminal.positions.some(p => p.type === 'future')) {
      checkAbstractionCollapse();
    }
  }

  // Update peak credits each tick
  if (state.player.gold > state.peakCredits) state.peakCredits = state.player.gold;

  // Live-refresh positions dashboard
  if (state.gameState === 'dashboard' && dashboardRedrawFn) dashboardRedrawFn();

  // Live-refresh inventory
  if (state.gameState === 'inventory' && inventoryRedrawFn) inventoryRedrawFn();
  // Bank card $ animation — redraw every 6 ticks
  if (state.gameState === 'menu' && bankMenuRedrawFn && state.bank.card?.owned && state.dayTick % 6 === 0) bankMenuRedrawFn();

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
  const crDelta = Math.round((state.player.gold - _sCr) * 10) / 10;
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
    // Build pool as {text,color} objects; start with core strings at #555555
    const AMB_POOL = AMBIENT.map(t => ({ text: t, color: '#555555' }));
    // Casino night-time ambients
    if (state.stations.casino?.unlocked && !state.marketOpen) {
      AMB_POOL.push(
        { text: '> A faint piano sound carries on the wind.', color: '#555555' },
        { text: '> The casino windows are lit. Yellow light through cracked glass.', color: '#aa3333' },
        { text: '> Someone laughs in the distance. You can\'t tell if it\'s joy.', color: '#555555' },
        { text: '> The night smells like cigar smoke. From which direction?', color: '#555555' },
      );
      // Big-loser line — double frequency when > 500cr lost tonight
      if ((state.stations.casino.lossesTonight || 0) > 500) {
        const loser = { text: '> The casino does not need you tonight.', color: '#aa3333' };
        AMB_POOL.push(loser, loser);
      }
    }
    // No-repeat filter (6-deep)
    const avail = AMB_POOL.filter(a => !recentAmbient.includes(a.text));
    const src   = avail.length > 0 ? avail : AMB_POOL;
    const pick  = src[Math.floor(Math.random() * src.length)];
    recentAmbient.push(pick.text);
    if (recentAmbient.length > 6) recentAmbient.shift();
    addLog(pick.text, pick.color);
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

  // Shiny rock blink — start a 60-frame blink window on matching tick (animation runs in effectsLoop)
  for (const rock of Object.values(state.shinyRocks)) {
    if (!rock.collected && (rock.blinkTicks || [-1,-1,-1]).includes(state.dayTick)) {
      rock.blinkFramesRemaining = 120;
    }
  }

  if (state.tick % 10 === 0) saveGame();
  effectsManager.update();
}, 1000);

// ── Effects render loop — runs at ~60fps independent of game tick ─────────────
;(function effectsLoop(ts) {
  if (state.gameState === 'ending') { requestAnimationFrame(effectsLoop); return; }
  if (state.gameState !== 'cottage' && state.gameState !== 'mine') effectsManager.render(display);

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

  // Shiny rock pulse animation — runs at 60fps, 1 second per blink
  if (state.gameState === 'playing' || state.gameState === 'look') {
    if (!state.shinyRocks) return;
    for (const color of ['red', 'yellow', 'blue']) {
      const rock = state.shinyRocks[color];
      if (!rock || !Array.isArray(rock.blinkTicks)) continue;
      if (rock.collected || rock.blinkFramesRemaining <= 0) continue;
      const elapsed  = 120 - rock.blinkFramesRemaining;
      const peak     = ROCK_PEAK_COLORS[color];
      let glyph, fg;
      if      (elapsed < 30)  { glyph = '·'; fg = dimColor(peak, 0.5); }
      else if (elapsed < 60)  { glyph = '◦'; fg = dimColor(peak, 0.8); }
      else if (elapsed < 90)  { glyph = '●'; fg = peak; }
      else                    { glyph = '◦'; fg = dimColor(peak, 0.6); }
      display.draw(rock.x, rock.y, glyph, fg, BG);
      rock.blinkFramesRemaining--;
      if (rock.blinkFramesRemaining === 0) {
        markDirty(rock.x, rock.y);
        renderDirty();
      }
    }
  }

  // Mine lantern pulse — redraw mine at 60fps when lantern active
  if (state.gameState === 'mine' && mineRedrawFn && state.skills.lantern) {
    mineRedrawFn();
  }

  // Animate pause menu cube at 60fps
  if (state.gameState === 'paused' && pauseMenuRedrawFn) {
    pauseMenuRedrawFn();
  }

  // Fire queued upgrade log lines (1 per second, only while playing)
  if (state.gameState === 'playing' && state.bank
      && state.bank.upgradeLogQueue && state.bank.upgradeLogQueue.length > 0
      && state.bank.upgradeLogLastFired && Date.now() - state.bank.upgradeLogLastFired >= 1000) {
    const item = state.bank.upgradeLogQueue.shift();
    addLog(item.line, item.color);
    state.bank.upgradeLogLastFired = Date.now();
  }

  // LF chyron live scroll (calls drawChyron closure inside openLFMenu)
  if (state.gameState === 'lf_menu' && lfChyronFn) lfChyronFn();

  // Show queued popup when overworld is idle
  if (activePopup === null && pendingPopups.length > 0 && state.gameState === 'playing') showNextPopup();

  // ── Weather visual effects ────────────────────────────────────────────────────

  // Rain / storm particles
  if ((state.weather.current === 'rain' || state.weather.current === 'storm') && state.phase >= 2 && state.gameState === 'playing') {
    const maxDrops = state.weather.current === 'storm' ? 25 : 15;
    if (rainDrops.length < maxDrops && Math.random() < 0.3) {
      rainDrops.push({ x: 1 + Math.floor(Math.random() * (DISPLAY_WIDTH - 2)), y: 1, speed: 1 + Math.random() });
    }
    for (let i = rainDrops.length - 1; i >= 0; i--) {
      const d = rainDrops[i];
      markDirty(d.x, Math.floor(d.y));
      d.y += d.speed;
      const dy = Math.floor(d.y);
      if (dy >= WORLD_ROWS - 1) { rainDrops.splice(i, 1); renderDirty(); continue; }
      if (tileMap[d.x] && tileMap[d.x][dy] && tileMap[d.x][dy].walkable) {
        display.draw(d.x, dy, '|', '#2a5a7a', BG);
      }
    }
  } else if (rainDrops.length > 0) {
    for (const d of rainDrops) markDirty(d.x, Math.floor(d.y));
    rainDrops = [];
    if (state.gameState === 'playing') renderDirty();
  }

  // Fog / storm visibility cone
  if ((state.weather.current === 'fog' || state.weather.current === 'storm') && state.phase >= 2 && state.gameState === 'playing') {
    const px = state.player.x, py = state.player.y;
    for (let y = 1; y < WORLD_ROWS - 1; y++) {
      for (let x = 1; x < DISPLAY_WIDTH - 1; x++) {
        const dist = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
        if (dist > 10) display.draw(x, y, '·', '#111111', BG);
        else if (dist > 7) display.draw(x, y, '·', '#222222', BG);
      }
    }
    display.draw(px, py, '@', state.player.color || BRIGHT_WHITE, BG);
    for (const w of state.workers.apprentices) {
      const wd = Math.sqrt((w.x - px) * (w.x - px) + (w.y - py) * (w.y - py));
      if (wd <= 7) display.draw(w.x, w.y, 'a', '#66ccff', BG);
    }
    for (const c of state.workers.couriers) {
      const cd = Math.sqrt((c.x - px) * (c.x - px) + (c.y - py) * (c.y - py));
      if (cd <= 7) display.draw(c.x, c.y, 'c', '#cc66cc', BG);
    }
  }

  // Storm lightning flash
  if (state.weather.current === 'storm' && state.gameState === 'playing') {
    if (Math.random() < 0.005) {
      const lx = 2 + Math.floor(Math.random() * (DISPLAY_WIDTH - 4));
      for (let y = 1; y < WORLD_ROWS - 1; y++) display.draw(lx, y, '│', '#ffffff', BG);
    }
  }

  // Heat wave shimmer
  if (state.weather.current === 'heatwave' && state.gameState === 'playing' && Math.random() < 0.05) {
    const sx = 53 + Math.floor(Math.random() * 25);
    const sy = 24 + Math.floor(Math.random() * 18);
    if (sx < DISPLAY_WIDTH - 1 && sy < WORLD_ROWS - 1 && tileMap[sx]?.[sy]?.walkable) {
      display.draw(sx, sy, '~', '#ff4400', BG);
      setTimeout(() => { markDirty(sx, sy); renderDirty(); }, 200);
    }
  }

  requestAnimationFrame(effectsLoop);
})(0);
