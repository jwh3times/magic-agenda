import type { CSSProperties } from 'react'
import type { ThemeName } from '../types/task'
import type { ThemeConf } from './themeConf'
import type { CellMeta, DayMarker } from '../data/selectors'
import { OVERDUE_RED, type WorkflowStatusDef } from './constants'
import { chevron } from './selectChevron'

/**
 * Thin, theme-matched scrollbars for any container that can overflow.
 *
 * `scrollbar-width`/`scrollbar-color` are standard properties, so unlike the `::-webkit-scrollbar`
 * rules in `index.css` they work in Firefox — which ignores that pseudo-element entirely and was
 * therefore rendering a bulky platform default in the middle of a themed board. Being standard
 * properties, they also belong in the inline style objects with the rest of the theming rather
 * than in a stylesheet.
 *
 * The `index.css` rules stay as the fallback for engines without standard support (Safari < 18.2,
 * Chrome < 121). Where both are understood the standard properties win, which is what we want.
 */
export function scrollbars(conf: ThemeConf): CSSProperties {
  return { scrollbarWidth: 'thin', scrollbarColor: `${conf.scrollThumb} transparent` }
}

// Chrome (page shell / board / cell / inbox / column) styles, ported verbatim from the
// prototype's buildUI / buildCells / buildColumns. `satisfies` validates every value as a
// CSSProperties while keeping precise keys for consumers.

/** Page shell — the prototype's `root`. Height comes from the `.app-root` CSS class
 *  (100dvh with a 100vh fallback), which inline styles can't express. */
export function rootStyle(conf: ThemeConf): CSSProperties {
  return {
    position: 'relative',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: conf.pageBg,
    backgroundImage: conf.pageImg,
    backgroundSize: conf.pageSize,
    overflow: 'hidden',
  }
}

/** The three floating aurora blobs (glass theme only). */
export function blobStyles(): CSSProperties[] {
  return [
    {
      position: 'absolute',
      top: '-160px',
      left: '-120px',
      width: '520px',
      height: '520px',
      borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(124,92,255,.55), transparent 65%)',
      filter: 'blur(40px)',
      animation: 'blobFloat 14s ease-in-out infinite',
      zIndex: 0,
    },
    {
      position: 'absolute',
      top: '10%',
      right: '-160px',
      width: '560px',
      height: '560px',
      borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(54,209,196,.42), transparent 65%)',
      filter: 'blur(50px)',
      animation: 'blobFloat 18s ease-in-out infinite',
      zIndex: 0,
    },
    {
      position: 'absolute',
      bottom: '-200px',
      left: '30%',
      width: '600px',
      height: '600px',
      borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(236,72,153,.30), transparent 65%)',
      filter: 'blur(55px)',
      animation: 'blobFloat 20s ease-in-out infinite',
      zIndex: 0,
    },
  ]
}

/**
 * One height for every control on the toolbar (#483). Settings, New task, and Sign out sit side by
 * side and used to be three heights: `todayBtn` and `addBtn` had different padding and font sizes,
 * and the ⚙ glyph made a third box. A fixed height with border-box sizing keeps them level whatever
 * their text, font, or border.
 */
export const TOOLBAR_CONTROL_HEIGHT = 34

/** A secondary control's fill: a light wash over the toolbar, the same in every theme. */
export const TOOLBAR_CONTROL_FILL = 'rgba(255,255,255,.12)'

/** The same wash, stronger: a toggle on the toolbar while what it opens is open. */
export const TOOLBAR_CONTROL_FILL_ACTIVE = 'rgba(255,255,255,.28)'

export function toolbarChrome(theme: ThemeName, conf: ThemeConf) {
  const glass = theme === 'glass'
  const control: CSSProperties = {
    boxSizing: 'border-box',
    height: `${TOOLBAR_CONTROL_HEIGHT}px`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontFamily: conf.ui,
    fontSize: '13px',
    fontWeight: 700,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  }
  const secondary: CSSProperties = {
    ...control,
    padding: '0 14px',
    background: TOOLBAR_CONTROL_FILL,
    color: conf.toolbarFg,
  }
  return {
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      padding: '13px 22px',
      background: conf.toolbarBg,
      color: conf.toolbarFg,
      borderBottom: conf.toolbarBorder,
      position: 'relative',
      zIndex: 2,
      backdropFilter: glass ? 'blur(16px)' : 'none',
      WebkitBackdropFilter: glass ? 'blur(16px)' : 'none',
      flexWrap: 'wrap',
    },
    navGroup: { display: 'flex', alignItems: 'center', gap: '8px' },
    /** ‹ and ›: a square of the shared height. */
    navBtn: {
      ...secondary,
      width: `${TOOLBAR_CONTROL_HEIGHT}px`,
      padding: 0,
      fontSize: '18px',
    },
    monthLabel: {
      fontFamily: conf.ui,
      fontSize: '16px',
      fontWeight: 700,
      minWidth: '150px',
      textAlign: 'center',
      color: conf.toolbarFg,
    },
    /** Today, Sign out: text buttons on the toolbar's wash. */
    todayBtn: secondary,
    /** Settings (⚙): a square of the shared height, so the glyph cannot set its own size. */
    iconBtn: {
      ...secondary,
      width: `${TOOLBAR_CONTROL_HEIGHT}px`,
      padding: 0,
      fontSize: '16px',
    },
    /**
     * New task: primary by colour alone. Brutal used to add a 2.5px #111 border and offset shadow,
     * which on its #111 toolbar showed nothing and only made the button taller than its neighbours.
     */
    addBtn: {
      ...control,
      padding: '0 16px',
      fontWeight: 800,
      background: conf.accent,
      color: conf.accentFg,
      // A soft lift where the toolbar has room to show it; brutal's would be #111 on #111.
      boxShadow: theme === 'brutal' ? 'none' : '0 4px 14px rgba(0,0,0,.18)',
    },
    /**
     * The Board select and the new-board name (#483). A native control, so keyboard and screen
     * reader behaviour is the browser's, but drawn as part of the toolbar. 16px text so iOS Safari
     * does not zoom on focus. Every toolbar is dark, so `colorScheme: 'dark'` gives the native
     * option list light-on-dark text in every theme instead of light text on a white popup.
     */
    field: {
      ...control,
      justifyContent: 'flex-start',
      cursor: 'auto',
      fontSize: '16px',
      fontWeight: 600,
      padding: '0 10px',
      background: TOOLBAR_CONTROL_FILL,
      color: conf.toolbarFg,
      colorScheme: 'dark',
      minWidth: 0,
    },
    select: {
      ...control,
      justifyContent: 'flex-start',
      fontSize: '16px',
      fontWeight: 600,
      padding: '0 26px 0 10px',
      background: `${chevron(conf.toolbarFg)} no-repeat right 9px center / 10px 6px, ${TOOLBAR_CONTROL_FILL}`,
      color: conf.toolbarFg,
      colorScheme: 'dark',
      appearance: 'none',
      WebkitAppearance: 'none',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      minWidth: 0,
    },
    /** An option in the select's list: a solid background, since the toolbar's may be translucent. */
    option: {
      background: glass ? conf.pageBg : conf.toolbarBg,
      color: conf.toolbarFg,
    },
  } satisfies Record<string, CSSProperties>
}

/** The pill container that wraps a segmented control. */
export function segWrapStyle(theme: ThemeName): CSSProperties {
  const glass = theme === 'glass'
  const brutal = theme === 'brutal'
  return {
    display: 'flex',
    gap: '3px',
    padding: '3px',
    borderRadius: '11px',
    background: brutal ? '#222' : 'rgba(0,0,0,.18)',
    border: glass ? '1px solid rgba(255,255,255,.08)' : 'none',
  }
}

/** Segmented view button (Calendar / Board / …). */
export function viewBtnStyle(theme: ThemeName, conf: ThemeConf, active: boolean): CSSProperties {
  const brutal = theme === 'brutal'
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 13px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12.5px',
    fontWeight: 700,
    fontFamily: conf.ui,
    background: active ? (brutal ? '#fff' : 'rgba(255,255,255,.18)') : 'transparent',
    color: active ? (brutal ? '#111' : conf.toolbarFg) : conf.toolbarSub,
    boxShadow: active && brutal ? `2px 2px 0 ${conf.accent}` : 'none',
  }
}

/** Segmented theme button (Cork / Neon / Aurora). */
export function themeBtnStyle(theme: ThemeName, conf: ThemeConf, active: boolean): CSSProperties {
  const glass = theme === 'glass'
  const brutal = theme === 'brutal'
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 11px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12.5px',
    fontWeight: 700,
    fontFamily: conf.ui,
    background: active
      ? glass
        ? 'rgba(255,255,255,.16)'
        : brutal
          ? '#fff'
          : 'rgba(255,255,255,.18)'
      : 'transparent',
    color: active ? (brutal ? '#111' : conf.toolbarFg) : conf.toolbarSub,
    boxShadow: active && brutal ? `2px 2px 0 ${conf.accent}` : 'none',
  }
}

export function swatchStyle(sw: string): CSSProperties {
  return {
    width: '11px',
    height: '11px',
    borderRadius: '3px',
    background: sw,
    flex: 'none',
    boxShadow: '0 0 0 1px rgba(0,0,0,.2)',
  }
}

export function boardChrome(theme: ThemeName, conf: ThemeConf) {
  const glass = theme === 'glass'
  const brutal = theme === 'brutal'
  const cork = theme === 'cork'
  return {
    boardWrap: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: conf.boardBg,
      border: conf.boardBorder,
      borderRadius: glass ? '18px' : brutal ? '2px' : '8px',
      boxShadow: conf.boardShadow,
      padding: cork ? '0' : '10px',
      overflow: 'hidden',
      backdropFilter: glass ? 'blur(8px)' : 'none',
      WebkitBackdropFilter: glass ? 'blur(8px)' : 'none',
    },
    weekRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(7,1fr)',
      gap: brutal ? '0' : '6px',
      padding: brutal ? '0' : '2px 2px 8px',
      background: brutal ? conf.weekBg : 'transparent',
    },
    grid: {
      flex: 1,
      minHeight: 0,
      display: 'grid',
      gridTemplateColumns: 'repeat(7,1fr)',
      gridAutoRows: '1fr',
      gap: brutal ? '0' : '6px',
      overflow: 'auto',
      ...scrollbars(conf),
    },
  } satisfies Record<string, CSSProperties>
}

export function weekdayStyle(theme: ThemeName, conf: ThemeConf): CSSProperties {
  const brutal = theme === 'brutal'
  return {
    textAlign: brutal ? 'center' : 'left',
    padding: brutal ? '8px 6px' : '2px 6px',
    fontFamily: conf.ui,
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '.8px',
    textTransform: 'uppercase',
    color: brutal ? '#fff' : conf.weekFg,
  }
}

export function cellChrome(theme: ThemeName, conf: ThemeConf, meta: CellMeta) {
  const cork = theme === 'cork'
  const brutal = theme === 'brutal'
  const glass = theme === 'glass'
  const { inMonth, isToday, isWeekend } = meta
  return {
    cell: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '62px',
      padding: brutal ? '5px 6px 6px' : '5px 6px 7px',
      background: !inMonth
        ? conf.cellOut
        : isToday
          ? conf.cellToday
          : isWeekend
            ? conf.weekendBg
            : conf.cellBg,
      border: conf.cellBorder,
      borderRadius: conf.cellRadius,
      overflow: 'hidden',
      boxShadow: isToday ? conf.cellTodayRing : 'none',
      transition: 'box-shadow .12s',
    },
    head: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '4px',
    },
    numStyle: {
      fontFamily: cork ? conf.title : conf.ui,
      fontSize: cork ? '17px' : '12.5px',
      fontWeight: brutal ? 800 : 700,
      lineHeight: 1,
      color: inMonth
        ? isToday
          ? conf.numTodayFg
          : conf.numFg
        : glass
          ? 'rgba(234,240,255,.3)'
          : brutal
            ? // Neutral black, not cork's warm brown: on brutal's opaque #EDE9DA out-of-month
              // cells the brown maxes out near 3.6:1 at any workable alpha; .55 black is 4.52:1.
              'rgba(0,0,0,.55)'
            : 'rgba(90,70,40,.45)',
      padding: cork ? '1px 5px' : '0',
      borderRadius: cork ? '10px' : '0',
      background: cork && isToday ? 'rgba(184,71,46,.14)' : 'transparent',
    },
    addStyle: {
      width: '18px',
      height: '18px',
      border: 'none',
      borderRadius: '5px',
      cursor: 'pointer',
      fontSize: '13px',
      lineHeight: 1,
      display: 'grid',
      placeItems: 'center',
      background: 'transparent',
      color: glass ? 'rgba(234,240,255,.4)' : brutal ? '#999' : 'rgba(60,42,18,.4)',
      opacity: 0.9,
      padding: 0,
    },
    notesWrap: {
      display: 'flex',
      flexDirection: 'column',
      gap: '7px',
      overflow: 'auto',
      ...scrollbars(conf),
      flex: 1,
      minHeight: 0,
    },
  } satisfies Record<string, CSSProperties>
}

export function inboxChrome(theme: ThemeName, conf: ThemeConf) {
  const cork = theme === 'cork'
  const brutal = theme === 'brutal'
  const glass = theme === 'glass'
  return {
    inbox: {
      width: '288px',
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      background: cork ? 'rgba(58,38,17,.42)' : brutal ? '#fff' : 'rgba(255,255,255,.04)',
      border: brutal
        ? '3px solid #111'
        : glass
          ? '1px solid rgba(255,255,255,.09)'
          : '1px solid rgba(0,0,0,.18)',
      borderRadius: brutal ? '2px' : '14px',
      boxShadow: brutal
        ? '8px 8px 0 #111'
        : glass
          ? '0 30px 80px rgba(0,0,0,.4)'
          : '0 10px 30px rgba(0,0,0,.2)',
      overflow: 'hidden',
      backdropFilter: glass ? 'blur(12px)' : 'none',
      WebkitBackdropFilter: glass ? 'blur(12px)' : 'none',
    },
    inboxHead: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 16px 4px',
      fontFamily: conf.title,
      fontWeight: brutal ? 900 : 700,
      fontSize: cork ? '26px' : '18px',
      color: brutal ? '#111' : conf.toolbarFg,
    },
    inboxCount: {
      fontFamily: conf.ui,
      fontSize: '12px',
      fontWeight: 700,
      padding: '2px 9px',
      borderRadius: '20px',
      background: conf.accent,
      color: conf.accentFg,
    },
    inboxHint: {
      padding: '0 16px 10px',
      fontFamily: conf.ui,
      fontSize: '11.5px',
      color: brutal ? '#767676' : conf.toolbarSub,
      fontWeight: 500,
    },
    inboxList: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
      ...scrollbars(conf),
      display: 'flex',
      flexDirection: 'column',
      gap: '13px',
      padding: '8px 16px 4px',
    },
    inboxEmpty: {
      fontFamily: conf.ui,
      fontSize: '12.5px',
      lineHeight: 1.5,
      // #767676 like inboxHint, or an empty inbox would put #999 on white at 2.85:1. The desktop
      // scans never see this node, because the seeded inbox is never empty; `phone-empty-brutal` does.
      color: brutal ? '#767676' : conf.toolbarSub,
      textAlign: 'center',
      padding: '24px 10px',
    },
    inboxAdd: {
      margin: '12px 16px 16px',
      padding: '10px',
      border: brutal
        ? '2.5px solid #111'
        : `1px dashed ${glass ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.3)'}`,
      borderRadius: '9px',
      cursor: 'pointer',
      fontFamily: conf.ui,
      fontSize: '13px',
      fontWeight: 700,
      background: 'transparent',
      color: brutal ? '#111' : conf.toolbarFg,
    },
  } satisfies Record<string, CSSProperties>
}

/** Tall enough to tap, and six of them leave the panel most of a 390×844 screen. */
const PHONE_DAY_HEIGHT = '46px'

/** The phone Calendar's month (#565). Its columns share the width, and it never shrinks or pans. */
export function phoneMonthChrome(theme: ThemeName, conf: ThemeConf) {
  const b = boardChrome(theme, conf)
  const brutal = theme === 'brutal'
  const columns = 'repeat(7,minmax(0,1fr))'
  const gap = brutal ? '0' : '2px'
  return {
    root: {
      flex: 1,
      minHeight: 0,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      // A window too short for both the month and the panel scrolls rather than crushing either.
      overflowY: 'auto',
      ...scrollbars(conf),
      // Out over `main`'s padding, so this scroller does not clip brutal's offset shadows.
      margin: '-10px -10px -8px',
      padding: '10px 10px 8px',
    },
    wrap: { ...b.boardWrap, flex: 'none', padding: theme === 'cork' ? '0' : '6px' },
    weekRow: { ...b.weekRow, gridTemplateColumns: columns, gap, padding: brutal ? '0' : '0 0 3px' },
    weekday: {
      ...weekdayStyle(theme, conf),
      minWidth: 0,
      textAlign: 'center',
      padding: brutal ? '4px 0' : '0',
      letterSpacing: 0,
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: columns,
      gridAutoRows: PHONE_DAY_HEIGHT,
      gap,
    },
  } satisfies Record<string, CSSProperties>
}

/** A phone grid cell or the Inbox tab under a dragged card. Drawn inside, so brutal's shared borders can't hide it. */
function dropOverStyle(conf: ThemeConf): CSSProperties {
  return {
    outline: `3px solid ${conf.accent}`,
    outlineOffset: '-3px',
    background: `${conf.accent}55`,
  }
}

/** One phone Calendar day: `cellChrome`'s colours, as a button with a number and its markers. */
export function phoneDayChrome(
  theme: ThemeName,
  conf: ThemeConf,
  meta: CellMeta,
  selected: boolean,
  dropOver = false,
) {
  const c = cellChrome(theme, conf, meta)
  return {
    cell: {
      ...c.cell,
      minHeight: 0,
      minWidth: 0,
      width: '100%',
      alignItems: 'center',
      // Tight enough that `+N` wrapping under the markers in a 320px window still fits the cell.
      gap: '2px',
      padding: '3px 1px',
      cursor: 'pointer',
      font: 'inherit',
      ...(dropOver && dropOverStyle(conf)),
    },
    num: {
      ...c.numStyle,
      minWidth: '20px',
      boxSizing: 'border-box',
      padding: '1px 3px',
      textAlign: 'center',
      // A filled pill rather than a colour change alone, and today's ring stays visible around it.
      ...(selected && {
        background: conf.accent,
        color: conf.accentFg,
        borderRadius: '10px',
      }),
    },
    markers: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '2px',
      minWidth: 0,
      maxWidth: '100%',
    },
    more: {
      fontFamily: conf.ui,
      fontSize: '10px',
      fontWeight: 700,
      lineHeight: 1,
      // Never the number's dimmed or today colour: this is a count, in small type, at full strength.
      color: conf.numFg,
    },
  } satisfies Record<string, CSSProperties>
}

/** A marker's shape carries its meaning as well as its colour, so it survives without colour. */
export function dayMarkerStyle(
  kind: DayMarker['kind'],
  labelColor: string,
  conf: ThemeConf,
): CSSProperties {
  const base: CSSProperties = { width: 7, height: 7, flex: 'none', boxSizing: 'border-box' }
  if (kind === 'overdue') return { ...base, background: OVERDUE_RED, transform: 'rotate(45deg)' }
  if (kind === 'completed') {
    return { ...base, border: `1.5px solid ${conf.numFg}`, borderRadius: '50%' }
  }
  return { ...base, background: labelColor, borderRadius: '50%' }
}

/** The phone Calendar's panel, which is the Inbox's surface with tabs for a header. */
export function phonePanelChrome(theme: ThemeName, conf: ThemeConf) {
  const c = inboxChrome(theme, conf)
  const tab: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '40px',
    padding: '0 8px',
    border: 'none',
    borderBottom: '3px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: conf.ui,
    fontSize: '13px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    color: c.inboxHint.color,
  }
  return {
    panel: { ...c.inbox, width: '100%', flex: '1 1 200px', minHeight: '200px' },
    head: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px 0 8px' },
    tabs: { display: 'flex', flex: 1, minWidth: 0, gap: '4px' },
    tab,
    // The whole shorthand, not just its colour: React clears a longhand it no longer sees, which
    // leaves the tab a black underline when it stops being the active one.
    tabActive: {
      ...tab,
      color: c.inboxHead.color,
      fontWeight: 800,
      borderBottom: `3px solid ${conf.accent}`,
    },
    tabDropOver: dropOverStyle(conf),
    count: { ...c.inboxCount, padding: '1px 7px', fontSize: '11px' },
    add: {
      ...c.inboxAdd,
      flex: 'none',
      width: '34px',
      height: '34px',
      margin: 0,
      padding: 0,
      fontSize: '18px',
      lineHeight: 1,
    },
    body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
    list: c.inboxList,
    empty: c.inboxEmpty,
    emptyAdd: { ...c.inboxAdd, margin: '0 16px 16px', alignSelf: 'center' },
  } satisfies Record<string, CSSProperties>
}

export function columnChrome(theme: ThemeName, conf: ThemeConf, col: WorkflowStatusDef) {
  const cork = theme === 'cork'
  const brutal = theme === 'brutal'
  const glass = theme === 'glass'
  const panelBg = cork ? 'rgba(58,38,17,.40)' : brutal ? '#fff' : 'rgba(255,255,255,.04)'
  const headFg = brutal ? '#111' : conf.toolbarFg
  return {
    col: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: panelBg,
      border: brutal
        ? '3px solid #111'
        : glass
          ? '1px solid rgba(255,255,255,.09)'
          : '1px solid rgba(0,0,0,.18)',
      borderRadius: brutal ? '2px' : '16px',
      boxShadow: brutal
        ? '6px 6px 0 #111'
        : glass
          ? '0 24px 60px rgba(0,0,0,.4)'
          : '0 10px 30px rgba(0,0,0,.18)',
      overflow: 'hidden',
      backdropFilter: glass ? 'blur(12px)' : 'none',
      WebkitBackdropFilter: glass ? 'blur(12px)' : 'none',
      transition: 'box-shadow .12s',
    },
    accentBar: { height: '4px', background: col.accent, flex: 'none' },
    head: { display: 'flex', alignItems: 'center', gap: '9px', padding: '13px 15px 10px' },
    dotStyle: {
      width: '9px',
      height: '9px',
      borderRadius: '50%',
      background: col.accent,
      flex: 'none',
      boxShadow: `0 0 0 3px ${col.accent}33`,
    },
    labelStyle: {
      fontFamily: conf.ui,
      fontWeight: 800,
      fontSize: '13px',
      letterSpacing: '.4px',
      textTransform: 'uppercase',
      color: headFg,
    },
    countStyle: {
      fontFamily: conf.ui,
      fontSize: '12px',
      fontWeight: 800,
      minWidth: '22px',
      height: '22px',
      padding: '0 7px',
      display: 'grid',
      placeItems: 'center',
      borderRadius: '20px',
      background: brutal ? '#111' : 'rgba(128,128,128,.18)',
      color: brutal ? '#fff' : headFg,
    },
    addStyle: {
      marginLeft: 'auto',
      width: '25px',
      height: '25px',
      border: 'none',
      borderRadius: '7px',
      cursor: 'pointer',
      fontSize: '17px',
      lineHeight: 1,
      display: 'grid',
      placeItems: 'center',
      background: brutal ? '#111' : 'rgba(128,128,128,.16)',
      color: brutal ? '#fff' : headFg,
      padding: 0,
    },
    listStyle: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
      ...scrollbars(conf),
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '10px 14px 14px',
    },
    emptyStyle: {
      fontFamily: conf.ui,
      fontSize: '12.5px',
      lineHeight: 1.5,
      color: brutal ? '#9a9a9a' : conf.toolbarSub,
      textAlign: 'center',
      padding: '26px 12px',
      border: `1.5px dashed ${brutal ? '#ccc' : glass ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.16)'}`,
      borderRadius: '12px',
    },
  } satisfies Record<string, CSSProperties>
}
