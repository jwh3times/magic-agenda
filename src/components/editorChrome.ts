import type { CSSProperties } from 'react'
import type { ThemeConf } from '../theme/themeConf'
import type { ThemeName } from '../types/task'

/**
 * The task editor's own palette and control styles.
 *
 * This is a **third styling system** alongside the `themeConf` tokens and the `chrome.ts`
 * functions: it derives its colours from literals rather than from either. That predates this
 * module and is not fixed here — changing the values is a visual change, and `SearchFilterBar`
 * independently derives a *different* set of literals for the same themes, so reconciling them is
 * its own piece of work. What this does fix is that the palette used to live in the editor's
 * closure, which is why the scope prompt could not be a component of its own: it read `panelBg`,
 * `fg`, `border`, `sub`, `fieldBg` and `btn` straight out of scope.
 */
export interface EditorChrome {
  /** Whether this theme is the dark one. Drives `colorScheme` on native date inputs. */
  dark: boolean
  panelBg: string
  fg: string
  sub: string
  fieldBg: string
  border: string
  accent: string
  accentFg: string
  ui: string
  /** Input font size. <16px makes iOS Safari zoom the page in on focus. */
  ctlFont: string
  inputBase: CSSProperties
  fieldLabel: CSSProperties
  btn: (bg: string, fgc: string, extra?: CSSProperties) => CSSProperties
}

export function editorChrome(theme: ThemeName, conf: ThemeConf, isMobile: boolean): EditorChrome {
  const dark = theme === 'glass'
  const panelBg = dark ? '#161a2e' : '#fffdf8'
  const fg = dark ? '#eaf0ff' : '#241c12'
  const sub = dark ? 'rgba(234,240,255,.5)' : 'rgba(60,42,18,.55)'
  const fieldBg = dark ? 'rgba(255,255,255,.05)' : '#f3efe6'
  const border = dark ? 'rgba(255,255,255,.12)' : 'rgba(60,42,18,.18)'

  return {
    dark,
    panelBg,
    fg,
    sub,
    fieldBg,
    border,
    accent: conf.accent,
    accentFg: conf.accentFg,
    ui: conf.ui,
    ctlFont: isMobile ? '16px' : '13px',
    inputBase: {
      width: '100%',
      padding: '11px 13px',
      borderRadius: '10px',
      border: `1px solid ${border}`,
      background: fieldBg,
      color: fg,
      fontFamily: conf.ui,
      fontSize: isMobile ? '16px' : '14px',
      fontWeight: 500,
    },
    fieldLabel: {
      fontSize: '11px',
      fontWeight: 800,
      letterSpacing: '.7px',
      textTransform: 'uppercase',
      color: sub,
      margin: '17px 0 9px',
    },
    btn: (bg, fgc, extra) => ({
      padding: '10px 18px',
      borderRadius: '9px',
      border: 'none',
      cursor: 'pointer',
      fontFamily: conf.ui,
      fontSize: '13.5px',
      fontWeight: 800,
      background: bg,
      color: fgc,
      ...extra,
    }),
  }
}
