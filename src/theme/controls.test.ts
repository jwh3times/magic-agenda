import { describe, expect, it } from 'vitest'
import type { CSSProperties } from 'react'
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
import { STATUS } from './constants'
import {
  TOOLBAR_CONTROL_FILL,
  TOOLBAR_CONTROL_FILL_ACTIVE,
  TOOLBAR_CONTROL_HEIGHT,
  boardChrome,
  cellChrome,
  columnChrome,
  filterBarChrome,
  inboxChrome,
  phoneDayChrome,
  phonePanelChrome,
  toolbarChrome,
  weekdayStyle,
} from './chrome'
import { contrast, over, parseColor, type RGB } from '../test/contrast'

const THEMES: ThemeName[] = ['cork', 'brutal', 'glass']
const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'danger', 'destructive']

/** A Settings card: the theme's `cellBg` over its page. */
function cardOf(theme: ThemeName): RGB {
  const conf = themeConf(theme)
  return over(conf.cellBg, parseColor(conf.pageBg)[0])
}

// axe cannot judge most day numbers in cork or glass: their cells are translucent over the page, so
// they come back `bgGradient`, and days 1 to 9 come back `shortTextContent`, both as incomplete
// rather than as violations (#579). These hold every number to 4.5:1 instead. The backdrop is the
// page's base colour, and the board's own fill over it where it has one (glass); cork's grain dots
// and glass's drifting blobs are left out, so this is the representative case, not the worst.
describe('the Calendar’s day numbers stay readable on their own cell', () => {
  const day = (inMonth: boolean, isToday: boolean, isWeekend: boolean) => ({
    dateStr: '2026-03-17',
    dayNum: 17,
    dow: isWeekend ? 6 : 2,
    inMonth,
    isToday,
    isWeekend,
  })
  const KINDS = {
    'in-month': day(true, false, false),
    weekend: day(true, false, true),
    today: day(true, true, false),
    'out-of-month': day(false, false, false),
  }
  for (const theme of THEMES) {
    const conf = themeConf(theme)
    const page = parseColor(conf.pageBg)[0]
    const backdrops = { page, board: over(conf.boardBg, page) }
    for (const [kind, meta] of Object.entries(KINDS)) {
      it(`${theme}: the ${kind} number clears 4.5:1`, () => {
        // The desktop cell and the phone day share these colours (`phoneDayChrome` spreads them).
        const { cell, numStyle } = cellChrome(theme, conf, meta)
        for (const [backdrop, under] of Object.entries(backdrops)) {
          const behind = over(String(numStyle.background), over(String(cell.background), under))
          const ratio = contrast(over(String(numStyle.color), behind), behind)
          expect({ backdrop, passesAA: ratio >= 4.5, ratio: ratio.toFixed(2) }).toMatchObject({
            backdrop,
            passesAA: true,
          })
        }
      })
    }
  }
})

// axe cannot judge the selected day's number in any theme: it reports `elmPartiallyObscured`, so a
// failing colour here still scans clean (measured by making it fail, #565). This is what holds it.
describe('the phone Calendar’s selected day stays readable', () => {
  const meta = {
    dateStr: '2026-03-17',
    dayNum: 17,
    dow: 2,
    inMonth: true,
    isToday: false,
    isWeekend: false,
  }
  for (const theme of THEMES) {
    it(`${theme}: its number clears 4.5:1 on its pill`, () => {
      const { num } = phoneDayChrome(theme, themeConf(theme), meta, true)
      const pill = over(String(num.background), [255, 255, 255])
      expect(contrast(over(String(num.color), pill), pill)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

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

    // axe returns most of cork's Settings text as incomplete (`bgGradient`, its card is translucent
    // over the dotted page), and the success notice only appears after an export or import, so no
    // scan judges either colour (#624). These are what hold them.
    it(`${theme}: muted and success text read on the bare card`, () => {
      for (const [token, color] of Object.entries({
        mutedFg: conf.mutedFg,
        successFg: conf.successFg,
      })) {
        const ratio = contrast(over(color, card), card)
        expect({ token, passesAA: ratio >= 4.5, ratio: ratio.toFixed(2) }).toMatchObject({
          token,
          passesAA: true,
        })
      }
    })

    it(`${theme}: muted text reads on the bare page, where Settings' footer sits`, () => {
      const page = parseColor(conf.pageBg)[0]
      expect(contrast(over(conf.mutedFg, page), page)).toBeGreaterThanOrEqual(4.5)
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

/**
 * What the board's panels, its weekday headers and the search bar sit on: the page's base colour,
 * and glass's board fill over it. As with the day numbers, cork's grain and glass's blobs are left
 * out, so this is the representative case.
 */
function backdropsOf(theme: ThemeName): Record<string, RGB> {
  const conf = themeConf(theme)
  const page = parseColor(conf.pageBg)[0]
  return { page, board: over(conf.boardBg, page) }
}

/** One piece of text: its colour, and the fills under it from the outermost in. */
interface Text {
  name: string
  color: CSSProperties['color']
  fills: CSSProperties['background'][]
}

/** Every text reads at AA on each backdrop. */
function expectReadable(theme: ThemeName, texts: Text[]) {
  for (const [backdrop, under] of Object.entries(backdropsOf(theme))) {
    for (const { name, color, fills } of texts) {
      const behind = fills.reduce<RGB>((below, fill) => over(String(fill), below), under)
      const ratio = contrast(over(String(color), behind), behind)
      expect({ backdrop, name, passesAA: ratio >= 4.5, ratio: ratio.toFixed(2) }).toMatchObject({
        backdrop,
        name,
        passesAA: true,
      })
    }
  }
}

// axe judges none of a cork or glass column's text: the panel is translucent over the page, so it
// comes back `bgGradient` (#625). brutal's "Drop tasks here" was #9a9a9a on its white panel, 2.81:1
// (#615). cork's panel was `rgba(58,38,17,.40)`, where the placeholder read 2.68:1 and the label
// 4.08:1; even white reaches only about 4.6 on it, so the panel was deepened rather than the text.
describe('a Kanban column’s text stays readable on its panel', () => {
  for (const theme of THEMES) {
    it(`${theme}: label, count, add button and empty placeholder clear 4.5:1`, () => {
      const c = columnChrome(theme, themeConf(theme), STATUS[0])
      const panel = c.col.background
      expectReadable(theme, [
        { name: 'label', color: c.labelStyle.color, fills: [panel] },
        { name: 'count', color: c.countStyle.color, fills: [panel, c.countStyle.background] },
        { name: 'add', color: c.addStyle.color, fills: [panel, c.addStyle.background] },
        { name: 'empty placeholder', color: c.emptyStyle.color, fills: [panel] },
      ])
    })
  }
})

// The Inbox and the phone Calendar's panel share the column's fill, and had the same gap: cork's
// `.42` panel put its title at 4.23:1, its hint, empty note and inactive tab at 2.75:1, and the
// legal links (dark `numFg` at `.6` opacity) lower still (#625).
describe('the Inbox’s text stays readable on its panel', () => {
  for (const theme of THEMES) {
    it(`${theme}: title, count, hint, empty note, add button and legal links clear 4.5:1`, () => {
      const c = inboxChrome(theme, themeConf(theme))
      const panel = c.inbox.background
      expectReadable(theme, [
        { name: 'title', color: c.inboxHead.color, fills: [panel] },
        { name: 'count', color: c.inboxCount.color, fills: [panel, c.inboxCount.background] },
        { name: 'hint', color: c.inboxHint.color, fills: [panel] },
        { name: 'empty note', color: c.inboxEmpty.color, fills: [panel] },
        { name: 'add button', color: c.inboxAdd.color, fills: [panel, c.inboxAdd.background] },
        { name: 'legal links', color: c.inboxLegal.color, fills: [panel] },
      ])
    })

    it(`${theme}: the phone panel's tabs and buttons clear 4.5:1`, () => {
      const p = phonePanelChrome(theme, themeConf(theme))
      const panel = p.panel.background
      expectReadable(theme, [
        { name: 'inactive tab', color: p.tab.color, fills: [panel] },
        { name: 'active tab', color: p.tabActive.color, fills: [panel] },
        { name: 'count', color: p.count.color, fills: [panel, p.count.background] },
        { name: 'add', color: p.add.color, fills: [panel, p.add.background] },
        { name: 'empty note', color: p.empty.color, fills: [panel] },
      ])
    })
  }
})

// The weekday headers sit straight on the board in cork and glass, so axe returns them `bgGradient`
// (#625). They passed when measured (cork 4.71:1, glass 5.49:1); this keeps them there.
describe('the weekday headers stay readable', () => {
  for (const theme of THEMES) {
    it(`${theme}: clear 4.5:1 on their row`, () => {
      const conf = themeConf(theme)
      const b = boardChrome(theme, conf)
      expectReadable(theme, [
        {
          name: 'weekday',
          color: weekdayStyle(theme, conf).color,
          fills: [b.boardWrap.background, b.weekRow.background],
        },
      ])
    })
  }
})

// The search and filter bar's controls are translucent over the page, so axe judges none of their
// text in cork or glass (#625). Switched on, a toggle and Clear drew `accent` as text: 3.49:1 in
// glass, whose accent is a fill colour meant for white text, and 4.46:1 in cork.
describe('the search and filter bar stays readable', () => {
  for (const theme of THEMES) {
    it(`${theme}: a control's text, and a toggled-on control's, clear 4.5:1`, () => {
      const c = filterBarChrome(theme, themeConf(theme))
      expectReadable(theme, [
        { name: 'control', color: c.control.color, fills: [c.control.background] },
        { name: 'toggled on', color: c.toggledOn.color, fills: [c.control.background] },
      ])
    })
  }
})

// The toolbar is not a card: every theme draws it dark, and glass's is translucent over its page.
describe('toolbar controls (#483)', () => {
  for (const theme of THEMES) {
    const conf = themeConf(theme)
    const c = toolbarChrome(theme, conf)
    const toolbar = over(conf.toolbarBg, parseColor(conf.pageBg)[0])
    const wash = over(TOOLBAR_CONTROL_FILL, toolbar)

    it(`${theme}: Settings, New task, Sign out, Today, and the arrows are one height`, () => {
      for (const [name, style] of Object.entries({
        settings: c.iconBtn,
        newTask: c.addBtn,
        signOut: c.todayBtn,
        today: c.todayBtn,
        arrow: c.navBtn,
        select: c.select,
        field: c.field,
      })) {
        expect({ name, height: style.height, boxSizing: style.boxSizing }).toEqual({
          name,
          height: `${TOOLBAR_CONTROL_HEIGHT}px`,
          boxSizing: 'border-box',
        })
      }
      // A border or margin on one of them is how the row drifted apart before.
      for (const style of [c.iconBtn, c.addBtn, c.todayBtn]) {
        expect(style.border).toBe('none')
        expect('marginLeft' in style).toBe(false)
      }
      expect(c.addBtn.fontSize).toBe(c.todayBtn.fontSize)
      expect(c.iconBtn.width).toBe(c.iconBtn.height)
    })

    it(`${theme}: text on the toolbar's controls reads at AA`, () => {
      expect(contrast(over(conf.toolbarFg, wash), wash)).toBeGreaterThanOrEqual(4.5)
      const accent = over(conf.accent, toolbar)
      expect(contrast(over(conf.accentFg, accent), accent)).toBeGreaterThanOrEqual(4.5)
      const option = over(String(c.option.background), toolbar)
      expect(contrast(over(String(c.option.color), option), option)).toBeGreaterThanOrEqual(4.5)
    })

    // A graphic rather than text, so WCAG 1.4.11's 3:1: the phone's controls button draws only its
    // icon on the open state's stronger wash (#564), and the filter marker's ring is the same colour.
    it(`${theme}: the open controls button's icon and marker read as graphics`, () => {
      const active = over(TOOLBAR_CONTROL_FILL_ACTIVE, toolbar)
      expect(contrast(over(conf.toolbarFg, active), active)).toBeGreaterThanOrEqual(3)
    })

    it(`${theme}: the select is a native control drawn for a dark toolbar`, () => {
      expect(c.select.appearance).toBe('none')
      expect(c.select.colorScheme).toBe('dark')
      // ≥16px, or iOS Safari zooms the page when the control takes focus.
      expect(c.select.fontSize).toBe('16px')
      expect(c.field.fontSize).toBe('16px')
      expect(String(c.select.background)).toContain(encodeURIComponent(conf.toolbarFg))
    })
  }
})
