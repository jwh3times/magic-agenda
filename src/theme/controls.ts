import type { CSSProperties } from 'react'
import type { ThemeName } from '../types/task'
import type { ThemeConf } from './themeConf'

/**
 * Form controls on a themed card: buttons, fields, the panel a control group opens into, and the
 * Settings section nav (#464). The Settings page used to style these one file at a time, or not at
 * all, so most of its buttons rendered as browser defaults in every theme.
 *
 * Same model as `chrome.ts`: plain style objects with per-theme branching, where cork is soft
 * paper, brutal is a hard 2px black edge with an offset shadow, and glass is translucent over a dark
 * page. There are no hover or pressed styles, because inline styles cannot express pseudo-classes
 * and nothing here needs one to be usable. Focus keeps the browser's own ring, which is why no
 * style here sets `outline`.
 */

/**
 * `danger` is the outlined form for an action that asks first ("Delete…", "Remove…"). `destructive`
 * is the filled form for the confirming click itself.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'destructive'
export type ButtonSize = 'md' | 'sm'

/** A filled destructive button's background. White on it is 6.6:1, whatever card it sits on. */
export const DESTRUCTIVE_FILL = '#b42318'

interface Surface {
  background: string
  border: string
  color: string
  borderRadius: number
  boxShadow: string
}

/** The resting surface of a secondary button, and of a field, in each theme. */
function surface(theme: ThemeName, conf: ThemeConf, kind: 'button' | 'field'): Surface {
  if (theme === 'brutal') {
    return {
      background: '#fff',
      border: '2px solid #111',
      color: '#111',
      borderRadius: 0,
      boxShadow: kind === 'button' ? '2px 2px 0 #111' : 'none',
    }
  }
  if (theme === 'glass') {
    return {
      background: kind === 'button' ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.06)',
      border: '1px solid rgba(255,255,255,.16)',
      color: conf.toolbarFg,
      borderRadius: 10,
      boxShadow: 'none',
    }
  }
  return {
    background: kind === 'button' ? 'rgba(255,250,240,.6)' : 'rgba(255,250,240,.75)',
    border: '1px solid rgba(74,50,22,.45)',
    color: conf.numFg,
    borderRadius: kind === 'button' ? 8 : 6,
    boxShadow: kind === 'button' ? '0 1px 2px rgba(58,38,17,.18)' : 'none',
  }
}

export function buttonStyle(
  theme: ThemeName,
  conf: ThemeConf,
  variant: ButtonVariant = 'secondary',
  { size = 'md', disabled = false }: { size?: ButtonSize; disabled?: boolean } = {},
): CSSProperties {
  const brutal = theme === 'brutal'
  const base = surface(theme, conf, 'button')
  const look: Surface =
    variant === 'primary'
      ? {
          ...base,
          background: conf.accent,
          color: conf.accentFg,
          border: brutal ? '2px solid #111' : '1px solid transparent',
          boxShadow: brutal
            ? '3px 3px 0 #111'
            : theme === 'glass'
              ? '0 4px 14px rgba(116,82,255,.35)'
              : '0 2px 6px rgba(58,38,17,.25)',
        }
      : variant === 'destructive'
        ? {
            ...base,
            background: DESTRUCTIVE_FILL,
            color: '#fff',
            border: brutal ? '2px solid #111' : `1px solid ${DESTRUCTIVE_FILL}`,
          }
        : variant === 'danger'
          ? {
              ...base,
              color: conf.dangerFg,
              border: `${brutal ? 2 : 1}px solid ${conf.dangerFg}`,
            }
          : base

  return {
    ...look,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: size === 'sm' ? '5px 10px' : '8px 14px',
    fontFamily: conf.ui,
    fontSize: size === 'sm' ? 13 : 14,
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    // A disabled brutal button loses its offset shadow, so it reads as pressed flat rather than
    // merely faded.
    boxShadow: disabled ? 'none' : look.boxShadow,
    backdropFilter: theme === 'glass' ? 'blur(8px)' : undefined,
    WebkitBackdropFilter: theme === 'glass' ? 'blur(8px)' : undefined,
  }
}

/**
 * A text input or select. 16px text on every viewport, because smaller text makes iOS Safari zoom
 * the page on focus. Glass sets `color-scheme: dark` so a select's native option list and the
 * checkbox and colour pickers render dark to match, instead of white on the dark page.
 */
export function fieldStyle(
  theme: ThemeName,
  conf: ThemeConf,
  { disabled = false }: { disabled?: boolean } = {},
): CSSProperties {
  const { background, border, color, borderRadius } = surface(theme, conf, 'field')
  return {
    background,
    border,
    color,
    borderRadius,
    padding: '8px 10px',
    fontFamily: conf.ui,
    fontSize: 16,
    lineHeight: 1.25,
    minWidth: 0,
    boxSizing: 'border-box',
    colorScheme: theme === 'glass' ? 'dark' : 'light',
    opacity: disabled ? 0.6 : 1,
  }
}

/** A checkbox: the native control, tinted with the theme's accent. */
export function checkboxStyle(theme: ThemeName, conf: ThemeConf): CSSProperties {
  return {
    width: 18,
    height: 18,
    margin: 0,
    flex: '0 0 auto',
    accentColor: conf.accent,
    colorScheme: theme === 'glass' ? 'dark' : 'light',
    cursor: 'pointer',
  }
}

/** An `<input type="color">` swatch, framed like a field. */
export function colorInputStyle(theme: ThemeName, conf: ThemeConf): CSSProperties {
  const { background, border, borderRadius } = surface(theme, conf, 'field')
  return {
    background,
    border,
    borderRadius,
    width: 44,
    height: 36,
    padding: 3,
    flex: '0 0 auto',
    boxSizing: 'border-box',
    cursor: 'pointer',
    colorScheme: theme === 'glass' ? 'dark' : 'light',
  }
}

/**
 * The inset area a row opens into, such as a Board's Members or Calendar feed panel. It separates
 * the panel from the list around it without a second card-in-card shadow.
 */
export function insetPanelStyle(theme: ThemeName): CSSProperties {
  const look: CSSProperties =
    theme === 'brutal'
      ? { background: '#F2EEDF', border: '2px solid #111', borderRadius: 0 }
      : theme === 'glass'
        ? {
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 10,
          }
        : {
            background: 'rgba(255,250,240,.35)',
            border: '1px solid rgba(74,50,22,.28)',
            borderRadius: 6,
          }
  return { ...look, padding: 12 }
}

/** One entry in the Settings section nav. The active entry is the section currently in view. */
export function navItemStyle(theme: ThemeName, conf: ThemeConf, active: boolean): CSSProperties {
  const activeLook: CSSProperties =
    theme === 'brutal'
      ? { background: '#111', color: '#fff' }
      : theme === 'glass'
        ? { background: 'rgba(255,255,255,.1)', color: conf.toolbarFg }
        : { background: 'rgba(255,250,240,.6)', color: conf.numFg }
  return {
    display: 'block',
    padding: '7px 10px',
    borderRadius: theme === 'brutal' ? 0 : 6,
    fontSize: 14,
    fontWeight: active ? 700 : 500,
    color: 'inherit',
    textDecoration: 'none',
    ...(active ? activeLook : { background: 'transparent' }),
  }
}

/**
 * A `<ul>` of Settings rows: unstyled, stacked with `gap`, and in one column that may shrink below
 * its content (#464). A plain `display: grid` column cannot: its minimum is the widest row's
 * min-content, and a text input's min-content is its default ~20-character width whatever its
 * `min-width`. Once a row held a name field plus themed buttons, that pushed a Label row's Delete
 * button off a 402px phone screen.
 */
export function rowListStyle(gap: number): CSSProperties {
  return {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap,
  }
}
