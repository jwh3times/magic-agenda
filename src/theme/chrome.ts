import type { CSSProperties } from 'react'
import type { ThemeName } from '../types/task'
import type { ThemeConf } from './themeConf'
import type { CellMeta } from '../data/selectors'
import type { StatusDef } from './constants'

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

export function toolbarChrome(theme: ThemeName, conf: ThemeConf) {
  const glass = theme === 'glass'
  const brutal = theme === 'brutal'
  const cork = theme === 'cork'
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
    brand: {
      fontFamily: conf.title,
      fontSize: cork ? '30px' : brutal ? '22px' : '21px',
      fontWeight: brutal ? 900 : 700,
      letterSpacing: brutal ? '-.5px' : '0',
      lineHeight: 1,
      color: conf.toolbarFg,
    },
    segWrap: {
      display: 'flex',
      gap: '3px',
      padding: '3px',
      borderRadius: '11px',
      background: brutal ? '#222' : 'rgba(0,0,0,.18)',
      border: glass ? '1px solid rgba(255,255,255,.08)' : 'none',
    },
    navGroup: { display: 'flex', alignItems: 'center', gap: '8px' },
    navBtn: {
      width: '30px',
      height: '30px',
      display: 'grid',
      placeItems: 'center',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: 1,
      background: 'rgba(255,255,255,.12)',
      color: conf.toolbarFg,
      fontFamily: conf.ui,
    },
    monthLabel: {
      fontFamily: conf.ui,
      fontSize: '16px',
      fontWeight: 700,
      minWidth: '150px',
      textAlign: 'center',
      color: conf.toolbarFg,
    },
    yearLabel: { opacity: 0.5, fontWeight: 600, marginLeft: '2px' },
    todayBtn: {
      marginLeft: '4px',
      padding: '7px 13px',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '12.5px',
      fontWeight: 700,
      fontFamily: conf.ui,
      background: 'rgba(255,255,255,.12)',
      color: conf.toolbarFg,
    },
    addBtn: {
      padding: '9px 16px',
      border: brutal ? '2.5px solid #111' : 'none',
      borderRadius: '9px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: 800,
      fontFamily: conf.ui,
      background: conf.accent,
      color: conf.accentFg,
      boxShadow: brutal ? '3px 3px 0 #111' : '0 4px 14px rgba(0,0,0,.18)',
      whiteSpace: 'nowrap',
    },
    kanbanWrap: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      gap: '16px',
      width: '100%',
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

/** Drop-gap indicator between cards (Phase 4 shows it; harmless when unused). */
export function gapStyle(conf: ThemeConf): CSSProperties {
  return {
    height: '3px',
    borderRadius: '2px',
    background: conf.accent,
    margin: '1px 2px',
    boxShadow: `0 0 8px ${conf.accent}`,
  }
}

export function cellChrome(theme: ThemeName, conf: ThemeConf, meta: CellMeta, isDrop: boolean) {
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
      boxShadow: isDrop ? `inset 0 0 0 2px ${conf.accent}` : isToday ? conf.cellTodayRing : 'none',
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
          ? conf.accent
          : conf.numFg
        : glass
          ? 'rgba(234,240,255,.3)'
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
      color: brutal ? '#888' : conf.toolbarSub,
      fontWeight: 500,
    },
    inboxList: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '13px',
      padding: '8px 16px 4px',
    },
    inboxEmpty: {
      fontFamily: conf.ui,
      fontSize: '12.5px',
      lineHeight: 1.5,
      color: brutal ? '#999' : conf.toolbarSub,
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

export function columnChrome(theme: ThemeName, conf: ThemeConf, col: StatusDef, isDrop: boolean) {
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
      boxShadow: isDrop
        ? `inset 0 0 0 2px ${conf.accent}, ${brutal ? '8px 8px 0 #111' : '0 16px 36px rgba(0,0,0,.3)'}`
        : brutal
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
