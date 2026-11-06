import type { ThemeName } from '../types/task'

/** ~37 style tokens per theme. The first ~26 were ported verbatim from prototype `themeConf()`. */
export interface ThemeConf {
  appName: string
  ui: string
  title: string
  pageBg: string
  pageImg: string
  pageSize: string
  toolbarBg: string
  toolbarFg: string
  toolbarSub: string
  toolbarBorder: string
  accent: string
  accentFg: string
  boardBg: string
  boardBorder: string
  boardPad: string
  boardShadow: string
  weekFg: string
  weekBg: string
  cellBg: string
  cellBorder: string
  cellRadius: string
  cellToday: string
  cellTodayRing: string
  cellOut: string
  numFg: string
  /**
   * Today's day number. A separate token from `accent` because the accent doubles as a BACKGROUND
   * under white text, and the two roles pull in opposite contrast directions: brutal's number needs
   * a brighter red than its button bg, glass's needs a LIGHTER purple than its accent (light text
   * on a dark cell). Every value here clears 4.5:1 on what sits behind it on today's cell. Cork's
   * rust doesn't on the cell itself (2.4:1 over the cork), so cork draws the number on a cream pill
   * (`cellChrome`'s `numStyle`, #579). `controls.test.ts` holds every day number, because axe can
   * judge almost none of them in cork or glass.
   */
  numTodayFg: string
  weekendBg: string
  /** Scrollbar thumb. Standard `scrollbar-color`, so Firefox honours it too. */
  scrollThumb: string
  /**
   * The keyboard focus ring on a card (#281).
   *
   * Its own token rather than a reuse of `accent`, for the same reason `numTodayFg` is not
   * `accent`: the ring sits on a CARD, so the six paper colours are the only backgrounds it ever
   * has to beat. Cork and brutal papers are light, so their rings are near-black; glass cards are
   * dark translucent with light ink, so its ring is near-white. The accent would have put glass's
   * #7452ff on a dark card, which is the one combination that disappears.
   *
   * Not covered by the a11y suite — axe does not evaluate focus indicators — so a new theme's
   * value is a judgement call to make deliberately, not a number a check will hand you.
   */
  focusRing: string
  /**
   * How far inside the card's own edge the focus ring is drawn, in px (#361). Applied as a negative
   * `outline-offset` on the rotated card element, so a 3px ring occupies `inset - 3`..`inset` px
   * inside the edge — on the paper, where `focusRing` was chosen to contrast, and where no
   * scrolling day cell can clip it. It was drawn 2px OUTSIDE the card until #361, and the calendar
   * cell's unpadded `overflow: auto` container cut it off entirely in every theme.
   *
   * Per theme because the card edges differ: cork has no border, so its ring sits flush on the
   * paper (a focused card is straightened first, so its tilt never pushes that edge past an
   * unpadded cell); brutal's 2.5px `#111` border would swallow a near-black ring laid against it,
   * so its ring sits 5–8px in, leaving a strip of paper between border and ring; glass clears its
   * 1px edge. Every value stays short of the card's 10px minimum padding, so the ring never covers
   * the title.
   */
  focusRingInset: number
  /**
   * Destructive text on a Settings card: refusals, and the outline of a Delete / Remove / Rotate
   * button (#464). Its own token for the reason `numTodayFg` and `focusRing` are: the one red
   * the app used before, `#b42318`, reads 6.6:1 on brutal's white card but only 3.1:1 on cork's
   * translucent card over the cork page and 2.7:1 on glass's near-black one. Every value here
   * clears 4.5:1 on its own theme's card. A FILLED destructive button does not use this, because
   * white on `#b42318` is 6.6:1 whatever card is under it.
   */
  dangerFg: string
  /**
   * Secondary text on a Settings card, and on the bare page beside it: field labels, hints, the
   * footer (#624). A colour of its own, not `numFg` dimmed with `opacity`, because cork cannot
   * afford the dimming: `numFg` at the `.7` the hints used was 3.6:1 on cork's translucent card,
   * where brutal's was 7.1:1 and glass's 6.2:1. brutal and glass keep the look they had (their
   * `numFg` at .7 and its equivalent); cork is the same ink at `.88`, the strength #579 gave its
   * out-of-month day numbers, at 5.3:1 on the card and 4.9:1 on the page. axe judges almost none
   * of this in cork, so `controls.test.ts` holds all three.
   */
  mutedFg: string
  /**
   * Success text on a Settings card, the counterpart of `dangerFg` (#624). The one green the app
   * used, `#3f9d63`, reads 5.3:1 on glass's dark card but 3.4:1 on brutal's white one and 1.6:1 on
   * cork's, so brutal and cork darken it (5.4:1 and 5.2:1). Every value clears 4.5:1 on its own
   * theme's card; `controls.test.ts` holds them.
   */
  successFg: string
  /**
   * The fill of a data mark — a bar in Admin's 30-day history (#468) — on a card. A mark is a
   * graphic, so it needs 3:1 against the card (WCAG 1.4.11), not text's 4.5:1. brutal and glass
   * reuse their `accent`, at 4.8:1 and 3.7:1; cork's `#b8472e` is only 2.5:1 on its translucent
   * card, so cork darkens the same rust to `#8f3520` (3.7:1). `controls.test.ts` holds all three.
   */
  chartMark: string
  /**
   * The fill of the board's panels: the Inbox, the phone Calendar's day and Inbox panel, and a
   * Kanban column (#625). Their primary text is `toolbarFg` (brutal: `#111`), their secondary text
   * `panelSubFg`. Cork's was `rgba(58,38,17,.40)` and `.42`, a mid-brown over the cork where even
   * pure white reached only about 4.6:1, so its column label read 4.08:1 and its Inbox title 4.23:1.
   * Cork now deepens it to `.60` (primary text 5.96:1) rather than changing its look. Primary text
   * reads 18.88:1 on brutal's white panel and 14.27:1 on glass's (over its board fill). axe judges
   * none of this text in cork or glass, because the panel is translucent over the page, so
   * `controls.test.ts` holds it.
   */
  panelBg: string
  /**
   * Secondary text on a board panel (`panelBg`): the Inbox's hint and empty note, an empty
   * column's "Drop tasks here", the phone panel's inactive tab, and the legal links (#625).
   * `toolbarSub` served here before, and cork's (cream at `.65`, tuned for the toolbar's buttons) was
   * 2.75:1 on the panel; the legal links drew cork's dark `numFg` there at 3.07:1 before their
   * `.6` opacity. brutal keeps the `#767676` its panels already used (4.54:1 on white), glass its
   * `toolbarSub` (4.59:1 over its board fill, 4.72:1 on the page); cork is the same cream at `.85`,
   * 4.84:1 on the deepened panel.
   */
  panelSubFg: string
  /**
   * Text on a control that is toggled on (not CSS `:active`, which means pressed): the search and
   * filter bar's switched-on toggles and its Clear button (#625). Its own token for the reason `numTodayFg` is: `accent` doubles as a fill
   * under white text, and as text on the bar's translucent control it read 3.49:1 in glass and
   * 4.46:1 in cork. brutal keeps its accent (4.64:1); cork darkens the same rust (5.18:1) and glass
   * lightens its purple (5.74:1). The control's border keeps `accent`.
   */
  toggledOnFg: string
}

const CORK: ThemeConf = {
  appName: 'Corkboard',
  ui: "'Libre Franklin',sans-serif",
  title: "'Caveat',cursive",
  pageBg: '#caa46b',
  pageImg:
    'radial-gradient(circle at 18% 30%, rgba(110,78,38,.30) 0 1.6px, transparent 2.6px), radial-gradient(circle at 67% 58%, rgba(110,78,38,.24) 0 1.6px, transparent 2.6px), radial-gradient(circle at 42% 82%, rgba(140,100,55,.22) 0 1.3px, transparent 2.2px)',
  pageSize: '24px 24px, 31px 31px, 17px 17px',
  toolbarBg: '#6b4a2b',
  toolbarFg: '#fbf3e6',
  // .65, not .6: at .6 this sits at 4.41:1 on the inactive view-switcher buttons — an AA near-miss
  // flagged by the E2E a11y ratchet. The bump is imperceptible; do not round it back down.
  toolbarSub: 'rgba(251,243,230,.65)',
  toolbarBorder: '1px solid rgba(0,0,0,.25)',
  accent: '#b8472e',
  accentFg: '#fff',
  boardBg: 'transparent',
  boardBorder: 'none',
  boardPad: '0',
  boardShadow: 'none',
  weekFg: 'rgba(46,30,12,.8)',
  weekBg: 'transparent',
  cellBg: 'rgba(255,250,240,.10)',
  cellBorder: '1px solid rgba(74,50,22,.32)',
  cellRadius: '3px',
  cellToday: 'rgba(255,247,225,.22)',
  cellTodayRing: 'inset 0 0 0 2px rgba(184,71,46,.85)',
  cellOut: 'rgba(120,90,55,.12)',
  numFg: '#3a2611',
  numTodayFg: '#b8472e',
  weekendBg: 'rgba(120,90,55,.06)',
  scrollThumb: 'rgba(74,50,22,.38)',
  focusRing: '#2f1d0c',
  focusRingInset: 3,
  dangerFg: '#7f1a10',
  mutedFg: 'rgba(58,38,17,.88)',
  successFg: '#174424',
  chartMark: '#8f3520',
  panelBg: 'rgba(58,38,17,.60)',
  panelSubFg: 'rgba(251,243,230,.85)',
  toggledOnFg: '#a8402a',
}

const BRUTAL: ThemeConf = {
  appName: 'TASKS//',
  ui: "'Space Grotesk',sans-serif",
  title: "'Archivo Black',sans-serif",
  pageBg: '#F2EEDF',
  pageImg:
    'linear-gradient(rgba(0,0,0,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.05) 1px, transparent 1px)',
  pageSize: '26px 26px, 26px 26px',
  toolbarBg: '#111',
  toolbarFg: '#fff',
  toolbarSub: 'rgba(255,255,255,.55)',
  toolbarBorder: '3px solid #111',
  // #CD4128, not the prototype's #FF4D2E: white text on the original red was 3.3:1. The pin
  // triangle and ThemeSwitcher-adjacent card literals in cardStyles.ts keep #FF4D2E — they carry
  // no text and theme.test.ts pins them.
  accent: '#CD4128',
  accentFg: '#fff',
  boardBg: '#fff',
  boardBorder: '3px solid #111',
  boardPad: '0',
  boardShadow: '8px 8px 0 #111',
  weekFg: '#111',
  weekBg: '#111',
  cellBg: '#fff',
  cellBorder: '2px solid #111',
  cellRadius: '0',
  cellToday: '#FFF6C2',
  cellTodayRing: 'inset 0 0 0 3px #111',
  cellOut: '#EDE9DA',
  numFg: '#111',
  numTodayFg: '#E10000',
  weekendBg: '#FBF7E4',
  scrollThumb: 'rgba(17,17,17,.55)',
  focusRing: '#111111',
  focusRingInset: 8,
  dangerFg: '#b42318',
  mutedFg: 'rgba(17,17,17,.7)',
  successFg: '#1e7a3e',
  chartMark: '#CD4128',
  panelBg: '#fff',
  panelSubFg: '#767676',
  toggledOnFg: '#CD4128',
}

const GLASS: ThemeConf = {
  appName: 'Aurora',
  ui: "'Manrope',sans-serif",
  title: "'Manrope',sans-serif",
  pageBg: '#0b0f1f',
  pageImg: 'none',
  pageSize: 'auto',
  toolbarBg: 'rgba(255,255,255,.04)',
  toolbarFg: '#eaf0ff',
  toolbarSub: 'rgba(234,240,255,.5)',
  toolbarBorder: '1px solid rgba(255,255,255,.10)',
  // #7452ff, not #7c5cff: the original is 4.35:1 under white text (an AA near-miss); this keeps the
  // hue and clears 4.5:1 with margin. The rgba(124,92,255,…) glow/tint literals deliberately keep
  // the old value — they carry no text and theme.test.ts pins them.
  accent: '#7452ff',
  accentFg: '#fff',
  boardBg: 'rgba(255,255,255,.03)',
  boardBorder: '1px solid rgba(255,255,255,.09)',
  boardPad: '0',
  boardShadow: '0 30px 80px rgba(0,0,0,.45)',
  weekFg: 'rgba(234,240,255,.55)',
  weekBg: 'transparent',
  cellBg: 'rgba(255,255,255,.035)',
  cellBorder: '1px solid rgba(255,255,255,.07)',
  cellRadius: '12px',
  cellToday: 'rgba(124,92,255,.16)',
  cellTodayRing: 'inset 0 0 0 1px rgba(150,120,255,.7)',
  cellOut: 'rgba(255,255,255,.012)',
  numFg: 'rgba(234,240,255,.85)',
  numTodayFg: '#9379FF',
  weekendBg: 'rgba(255,255,255,.02)',
  scrollThumb: 'rgba(234,240,255,.28)',
  focusRing: '#eaf0ff',
  focusRingInset: 4,
  dangerFg: '#ff8f85',
  mutedFg: 'rgba(234,240,255,.6)',
  successFg: '#3f9d63',
  chartMark: '#7452ff',
  panelBg: 'rgba(255,255,255,.04)',
  panelSubFg: 'rgba(234,240,255,.5)',
  toggledOnFg: '#9d85ff',
}

const CONF: Record<ThemeName, ThemeConf> = { cork: CORK, brutal: BRUTAL, glass: GLASS }

export function themeConf(theme: ThemeName): ThemeConf {
  return CONF[theme]
}
