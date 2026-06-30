import type { CSSProperties } from 'react'
import type { Task, ThemeName } from '../types/task'
import { CAT, PAPER } from './constants'
import { themeConf } from './themeConf'

export type CardVariant = 'cell' | 'inbox' | 'kanban' | 'ghost'

/** A style object that may also carry the --rot custom property used by the notePop keyframe. */
type WrapStyle = CSSProperties & { '--rot'?: string }

export interface CardStyles {
  wrap: WrapStyle
  titleStyle: CSSProperties
  meta: CSSProperties
  showPin: boolean
  pinStyle: CSSProperties
  showStamp: boolean
  stampStyle: CSSProperties
  dot: CSSProperties
  catStyle: CSSProperties
  progStyle: CSSProperties
  check: CSSProperties
  barTrack: CSSProperties
  barFill: CSSProperties
  chipStyle: CSSProperties
  descStyle: CSSProperties
}

export interface CardStyleOpts {
  dragging?: boolean
  pop?: boolean
}

/** Deterministic per-id rotation in [-3, 3]. Ported from prototype `rotOf`. */
export function rotOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 7) - 3
}

/**
 * The style half of the prototype's `noteView` — produces every inline-style object
 * for a task card in a given theme/variant. Data (labels, progress text, handlers) is
 * assembled by the TaskCard component.
 */
export function cardStyles(
  theme: ThemeName,
  task: Task,
  variant: CardVariant,
  opts: CardStyleOpts = {},
): CardStyles {
  const { dragging = false, pop = false } = opts
  const C = themeConf(theme)
  const P = PAPER[theme][task.color] ?? PAPER[theme].yellow
  const cat = CAT[task.category] ?? CAT.work
  const done = task.status === 'done'
  const total = task.checklist.length
  const ck = task.checklist.filter((c) => c.done).length
  const pct = total ? Math.round((ck / total) * 100) : 0
  const rot =
    theme === 'cork' ? rotOf(task.id) : theme === 'brutal' ? (rotOf(task.id) % 2 ? 1 : -1) : 0
  const isGhost = variant === 'ghost'
  const isKanbanCard = variant === 'kanban'
  // Kanban cards share the inbox card's sizing.
  const v: CardVariant = isKanbanCard ? 'inbox' : variant

  const wrap: WrapStyle = {
    position: 'relative',
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
    transition: 'box-shadow .15s, transform .12s',
    opacity: done ? 0.82 : 1,
  }
  let titleStyle: CSSProperties
  const meta: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '7px',
    flexWrap: 'wrap',
  }
  let pinStyle: CSSProperties = {}
  let stampStyle: CSSProperties = {}

  if (theme === 'cork') {
    Object.assign(wrap, {
      background: P.bg,
      color: P.ink,
      padding: v === 'inbox' ? '14px 13px 11px' : '11px 11px 9px',
      borderRadius: '2px',
      fontFamily: C.ui,
      boxShadow: dragging
        ? '0 22px 40px rgba(35,22,5,.45)'
        : '0 5px 12px rgba(40,28,8,.32), inset 0 1px 0 rgba(255,255,255,.45)',
      transform: `rotate(${isGhost ? 0 : rot}deg)`,
      '--rot': `${isGhost ? 0 : rot}deg`,
    })
    pinStyle = {
      position: 'absolute',
      top: '-7px',
      left: '50%',
      width: '14px',
      height: '14px',
      marginLeft: '-7px',
      borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 30%, #ff8a7a, #c0392b 60%, #7c1d12)',
      boxShadow: '0 2px 3px rgba(0,0,0,.4)',
      zIndex: 2,
    }
    titleStyle = {
      fontFamily: C.title,
      fontSize: v === 'inbox' ? '22px' : '19px',
      lineHeight: 1.05,
      fontWeight: 700,
      textDecorationLine: done ? 'line-through' : 'none',
      textDecorationColor: 'rgba(120,30,20,.6)',
      display: '-webkit-box',
      WebkitLineClamp: v === 'inbox' ? 3 : 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      wordBreak: 'break-word',
    }
    if (done)
      stampStyle = {
        position: 'absolute',
        top: '40%',
        left: '50%',
        transform: 'translate(-50%,-50%) rotate(-14deg)',
        color: 'rgba(176,42,28,.62)',
        border: '2.5px solid rgba(176,42,28,.55)',
        borderRadius: '5px',
        padding: '1px 7px',
        fontFamily: C.title,
        fontWeight: 700,
        fontSize: '17px',
        letterSpacing: '1px',
        pointerEvents: 'none',
        zIndex: 3,
      }
  } else if (theme === 'brutal') {
    Object.assign(wrap, {
      background: P.bg,
      color: P.ink,
      padding: v === 'inbox' ? '13px 13px' : '10px 11px',
      border: '2.5px solid #111',
      borderRadius: '1px',
      fontFamily: C.ui,
      fontWeight: 600,
      boxShadow: dragging ? '9px 9px 0 #111' : '4px 4px 0 #111',
      transform: `rotate(${isGhost ? 0 : rot}deg)`,
      '--rot': `${isGhost ? 0 : rot}deg`,
    })
    titleStyle = {
      fontSize: v === 'inbox' ? '16px' : '14px',
      lineHeight: 1.12,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.3px',
      textDecorationLine: done ? 'line-through' : 'none',
      display: '-webkit-box',
      WebkitLineClamp: v === 'inbox' ? 3 : 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      wordBreak: 'break-word',
    }
  } else {
    Object.assign(wrap, {
      background: P.bg,
      color: P.ink,
      padding: v === 'inbox' ? '13px 14px' : '11px 12px',
      border: `1px solid ${P.edge}`,
      borderRadius: '13px',
      fontFamily: C.ui,
      fontWeight: 500,
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: dragging
        ? '0 26px 50px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.18)'
        : '0 10px 26px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.14)',
      transform: 'none',
      '--rot': '0deg',
    })
    titleStyle = {
      fontSize: v === 'inbox' ? '16px' : '14px',
      lineHeight: 1.2,
      fontWeight: 700,
      letterSpacing: '.1px',
      textDecorationLine: done ? 'line-through' : 'none',
      opacity: done ? 0.8 : 1,
      display: '-webkit-box',
      WebkitLineClamp: v === 'inbox' ? 3 : 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      wordBreak: 'break-word',
    }
  }

  if (dragging && !isGhost) wrap.opacity = 0.18
  if (pop && !isGhost) wrap.animation = 'notePop .5s ease'

  const inkSoft = (a: number) =>
    theme === 'glass'
      ? `rgba(234,240,255,${a})`
      : theme === 'brutal'
        ? `rgba(17,17,17,${a})`
        : `rgba(60,42,18,${a})`

  const dot: CSSProperties = {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: cat.dot,
    flex: 'none',
    boxShadow: theme === 'cork' ? '0 0 0 1.5px rgba(255,255,255,.5)' : 'none',
  }
  const catStyle: CSSProperties = {
    fontSize: '10.5px',
    fontWeight: 700,
    letterSpacing: '.4px',
    textTransform: 'uppercase',
    opacity: 0.75,
    color: 'inherit',
  }
  const progStyle: CSSProperties = {
    marginLeft: 'auto',
    fontSize: '10.5px',
    fontWeight: 700,
    opacity: 0.7,
    fontVariantNumeric: 'tabular-nums',
  }
  const check: CSSProperties = {
    width: '19px',
    height: '19px',
    flex: 'none',
    marginLeft: total ? '6px' : 'auto',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    borderRadius: theme === 'glass' ? '6px' : theme === 'brutal' ? '1px' : '4px',
    border: `1.5px solid ${inkSoft(0.4)}`,
    background: done ? cat.dot : 'transparent',
    color: done ? '#fff' : 'transparent',
    fontSize: '12px',
    lineHeight: 1,
    fontWeight: 800,
    padding: 0,
  }
  const barTrack: CSSProperties = {
    marginTop: '7px',
    height: '4px',
    borderRadius: '3px',
    background: inkSoft(0.16),
    overflow: 'hidden',
  }
  const barFill: CSSProperties = {
    width: `${pct}%`,
    height: '100%',
    borderRadius: '3px',
    background: done
      ? cat.dot
      : theme === 'glass'
        ? (P.edge ?? '').replace(/[\d.]+\)$/, '.9)')
        : inkSoft(0.55),
    transition: 'width .25s',
  }
  const chipStyle: CSSProperties = {
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '20px',
    background: inkSoft(0.12),
    color: 'inherit',
    opacity: 0.9,
    whiteSpace: 'nowrap',
  }
  const descStyle: CSSProperties = {
    fontSize: '12px',
    lineHeight: 1.35,
    marginTop: '5px',
    opacity: 0.7,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }

  return {
    wrap,
    titleStyle,
    meta,
    showPin: theme === 'cork' && !isGhost,
    pinStyle,
    showStamp: done && theme === 'cork' && !isGhost,
    stampStyle,
    dot,
    catStyle,
    progStyle,
    check,
    barTrack,
    barFill,
    chipStyle,
    descStyle,
  }
}
