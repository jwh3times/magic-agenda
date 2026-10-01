import { describe, expect, it } from 'vitest'
import type { ThemeName } from '../types/task'
import {
  buttonStyle,
  checkboxStyle,
  DESTRUCTIVE_FILL,
  fieldStyle,
  navItemStyle,
  type ButtonVariant,
} from './controls'
import { themeConf } from './themeConf'

const THEMES: ThemeName[] = ['cork', 'brutal', 'glass']
const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'danger', 'destructive']

type RGB = [number, number, number]

/** `#rgb`, `#rrggbb`, or `rgba(r,g,b,a)` → [rgb, alpha]. */
function parse(color: string): [RGB, number] {
  const rgba = /^rgba?\(([^)]+)\)$/.exec(color)
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((v) => v.trim())
    return [[Number(r), Number(g), Number(b)], Number(a)]
  }
  let hex = color.replace('#', '')
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  return [[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB, 1]
}

/** `color` painted over an opaque `under`. */
function over(color: string, under: RGB): RGB {
  const [rgb, a] = parse(color)
  return rgb.map((c, i) => c * a + under[i] * (1 - a)) as RGB
}

function contrast(a: RGB, b: RGB): number {
  const lum = (c: RGB) => {
    const [r, g, b2] = c.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A Settings card: the theme's `cellBg` over its page. */
function cardOf(theme: ThemeName): RGB {
  const conf = themeConf(theme)
  return over(conf.cellBg, parse(conf.pageBg)[0])
}

// The e2e a11y scan covers Settings in one theme, so these are what hold the other two to 4.5:1.
describe('control colours clear WCAG AA on a Settings card, in every theme', () => {
  for (const theme of THEMES) {
    const conf = themeConf(theme)
    const card = cardOf(theme)

    it(`${theme}: every button variant's label reads against its own background`, () => {
      for (const variant of VARIANTS) {
        const style = buttonStyle(theme, conf, variant)
        const background = over(String(style.background), card)
        const text = over(String(style.color), background)
        expect({ variant, passesAA: contrast(text, background) >= 4.5 }).toEqual({
          variant,
          passesAA: true,
        })
      }
    })

    it(`${theme}: danger text reads on the bare card`, () => {
      expect(contrast(over(conf.dangerFg, card), card)).toBeGreaterThanOrEqual(4.5)
    })

    it(`${theme}: a chart mark stands out from the card (3:1, WCAG 1.4.11)`, () => {
      expect(contrast(over(conf.chartMark, card), card)).toBeGreaterThanOrEqual(3)
    })

    it(`${theme}: field text reads against the field`, () => {
      const style = fieldStyle(theme, conf)
      const background = over(String(style.background), card)
      expect(contrast(over(String(style.color), background), background)).toBeGreaterThanOrEqual(
        4.5,
      )
    })
  }
})

describe('buttonStyle', () => {
  it('a destructive button is the same filled red in every theme', () => {
    for (const theme of THEMES) {
      const style = buttonStyle(theme, themeConf(theme), 'destructive')
      expect(style).toMatchObject({ background: DESTRUCTIVE_FILL, color: '#fff' })
    }
  })

  it('a danger button is outlined in the theme’s own danger colour', () => {
    for (const theme of THEMES) {
      const conf = themeConf(theme)
      const style = buttonStyle(theme, conf, 'danger')
      expect(style.color).toBe(conf.dangerFg)
      expect(String(style.border)).toContain(conf.dangerFg)
    }
  })

  it('disabled fades, refuses the pointer, and drops the shadow', () => {
    for (const theme of THEMES) {
      const style = buttonStyle(theme, themeConf(theme), 'primary', { disabled: true })
      expect(style).toMatchObject({ opacity: 0.5, cursor: 'not-allowed', boxShadow: 'none' })
    }
  })

  it('brutal keeps its hard edge: square corners and an offset black shadow', () => {
    const style = buttonStyle('brutal', themeConf('brutal'), 'secondary')
    expect(style).toMatchObject({ borderRadius: 0, boxShadow: '2px 2px 0 #111' })
  })

  it('never sets an outline, so the browser’s focus ring survives', () => {
    for (const theme of THEMES)
      for (const variant of VARIANTS)
        expect(buttonStyle(theme, themeConf(theme), variant)).not.toHaveProperty('outline')
  })
})

describe('fieldStyle', () => {
  it('uses 16px text in every theme, or iOS Safari zooms the page on focus', () => {
    for (const theme of THEMES) expect(fieldStyle(theme, themeConf(theme)).fontSize).toBe(16)
  })

  it('renders native pickers dark only on glass, the one dark theme', () => {
    expect(fieldStyle('glass', themeConf('glass')).colorScheme).toBe('dark')
    expect(checkboxStyle('glass', themeConf('glass')).colorScheme).toBe('dark')
    expect(fieldStyle('cork', themeConf('cork')).colorScheme).toBe('light')
  })
})

describe('navItemStyle', () => {
  it('marks the active entry and leaves the rest transparent', () => {
    for (const theme of THEMES) {
      const conf = themeConf(theme)
      expect(navItemStyle(theme, conf, false).background).toBe('transparent')
      expect(navItemStyle(theme, conf, true).background).not.toBe('transparent')
      expect(navItemStyle(theme, conf, true).fontWeight).toBe(700)
    }
  })
})
