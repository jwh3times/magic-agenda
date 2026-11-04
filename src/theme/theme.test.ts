import { describe, it, expect } from 'vitest'
import { COLORS, STATUS, PAPER } from './constants'
import { themeConf } from './themeConf'
import {
  boardChrome,
  cellChrome,
  inboxChrome,
  columnChrome,
  phoneMonthChrome,
  scrollbars,
} from './chrome'
import { rotOf, cardStyles } from './cardStyles'
import { asTask, NO_RECUR, type Task, type ThemeName, type TaskDraft } from '../types/task'
import { contrast, mix, parseColor, type RGB } from '../test/contrast'

const THEMES: ThemeName[] = ['cork', 'brutal', 'glass']

function task(overrides: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 't1001',
    title: 'Test',
    description: '',
    labelId: null,
    assigneeId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: 'inbox',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...overrides,
  })
}

describe('constants', () => {
  it('has 6 Note Colors and 3 statuses', () => {
    expect(COLORS).toHaveLength(6)
    expect(STATUS).toHaveLength(3)
  })

  it('PAPER defines every color for every theme', () => {
    for (const t of THEMES) for (const c of COLORS) expect(PAPER[t][c]).toBeDefined()
  })
})

describe('themeConf', () => {
  it('returns the prototype app name per theme', () => {
    expect(themeConf('cork').appName).toBe('Corkboard')
    expect(themeConf('brutal').appName).toBe('TASKS//')
    expect(themeConf('glass').appName).toBe('Aurora')
  })
})

describe('rotOf', () => {
  it('is deterministic and within [-3, 3]', () => {
    expect(rotOf('t1001')).toBe(rotOf('t1001'))
    for (const id of ['a', 'task-xyz', 't1234', '']) {
      const r = rotOf(id)
      expect(r).toBeGreaterThanOrEqual(-3)
      expect(r).toBeLessThanOrEqual(3)
    }
  })
})

describe('cardStyles', () => {
  it('the pin is the pinned signal: cork red pin / brutal corner flash, only when pinned', () => {
    expect(cardStyles('cork', task(), 'cell').showPin).toBe(false)
    expect(cardStyles('cork', task({ pinned: true }), 'cell').showPin).toBe(true)
    expect(cardStyles('brutal', task(), 'cell').showPin).toBe(false)
    const b = cardStyles('brutal', task({ pinned: true }), 'cell')
    expect(b.showPin).toBe(true)
    expect(String(b.pinStyle.borderTop)).toContain('#FF4D2E')
    expect(cardStyles('glass', task({ pinned: true }), 'cell').showPin).toBe(false)
  })

  it('glass pinned cards glow; unpinned do not', () => {
    const off = String(cardStyles('glass', task(), 'cell').wrap.boxShadow)
    const on = String(cardStyles('glass', task({ pinned: true }), 'cell').wrap.boxShadow)
    expect(off).not.toContain('rgba(124,92,255')
    expect(on).toContain('rgba(124,92,255')
  })

  it('shows the Completed stamp only for a Completed cork card', () => {
    expect(cardStyles('cork', task({ status: 'completed' }), 'cell').showStamp).toBe(true)
    expect(cardStyles('cork', task({ status: 'todo' }), 'cell').showStamp).toBe(false)
    expect(cardStyles('brutal', task({ status: 'completed' }), 'cell').showStamp).toBe(false)
  })

  it('ghost variant suppresses pin and rotation', () => {
    const g = cardStyles('cork', task({ pinned: true }), 'ghost')
    expect(g.showPin).toBe(false)
    expect(g.wrap.transform).toBe('rotate(0deg)')
  })

  it('glass ghost variant suppresses the pinned glow', () => {
    const ghost = String(cardStyles('glass', task({ pinned: true }), 'ghost').wrap.boxShadow)
    expect(ghost).not.toContain('rgba(124,92,255')
  })

  it('barFill width tracks checklist completion', () => {
    const t = task({
      checklist: [
        { id: 'c1', text: 'a', done: true },
        { id: 'c2', text: 'b', done: true },
        { id: 'c3', text: 'c', done: false },
        { id: 'c4', text: 'd', done: false },
      ],
    })
    expect(cardStyles('glass', t, 'inbox').barFill.width).toBe('50%')
  })

  it('uses the textDecorationLine longhand (no shorthand/longhand mix)', () => {
    const s = cardStyles('cork', task({ status: 'completed' }), 'cell')
    expect(s.titleStyle.textDecorationLine).toBe('line-through')
    expect('textDecoration' in s.titleStyle).toBe(false)
  })

  it('a Completed card is opaque in cork and brutal, and still fades in glass', () => {
    const done = task({ status: 'completed' })
    expect(cardStyles('cork', done, 'cell').wrap.opacity).toBe(1)
    expect(cardStyles('brutal', done, 'cell').wrap.opacity).toBe(1)
    expect(cardStyles('glass', done, 'cell').wrap.opacity).toBe(0.82)
    // Dragging still fades it, in every theme.
    expect(cardStyles('cork', done, 'cell', { dragging: true }).wrap.opacity).toBe(0.18)
  })

  it('overdue cards carry the red inset accent and tinted chip', () => {
    const s = cardStyles('cork', task({ day: '2020-01-01' }), 'kanban', { overdue: true })
    expect(String(s.wrap.boxShadow)).toContain('#e0524a')
    expect(String(s.chipStyle.background)).toContain('rgba(224,82,74')
    const plain = cardStyles('cork', task(), 'kanban')
    expect(String(plain.wrap.boxShadow)).not.toContain('#e0524a')
  })
})

describe('a card’s text stays readable', () => {
  // #607. axe sees only the seeded colours on cards that aren't overdue. It also fades a chip's text toward
  // the chip's own tint, where a browser's group opacity fades it toward the paper, so it reads high:
  // 4.33:1 on cork's yellow at the old 0.9, where a browser paints 4.21:1. Glass papers are
  // translucent, so their result depends on what's behind them, and they have contrast to spare.
  it('clears 4.5:1 on every opaque paper of an open card, overdue or not', () => {
    for (const theme of THEMES.filter((t) => t !== 'glass')) {
      for (const color of COLORS) {
        for (const overdue of [false, true]) {
          const { opacity, background } = cardStyles(theme, task({ color }), 'kanban', {
            overdue,
          }).chipStyle
          const paper = parseColor(PAPER[theme][color].bg)[0]
          const [tint, tintAlpha] = parseColor(String(background))
          const text = mix(parseColor(PAPER[theme][color].ink)[0], Number(opacity), paper)
          const behind = mix(tint, tintAlpha * Number(opacity), paper)
          expect({ theme, color, overdue, passesAA: contrast(text, behind) >= 4.5 }).toEqual({
            theme,
            color,
            overdue,
            passesAA: true,
          })
        }
      }
    }
  })

  // #613. A Completed card used to fade whole, to 0.82, which took its chips below 4.5:1 on every
  // cork paper and four brutal ones. The seed completes nothing, so axe never saw it. The card's own
  // fade is composited over the theme's page here, so a fade that came back fails this rather than
  // passing on the paper alone. Glass keeps its fade, on translucent papers with contrast to spare.
  it('clears 4.5:1 for the chip and title of a Completed card on every opaque paper', () => {
    for (const theme of THEMES.filter((t) => t !== 'glass')) {
      const page = parseColor(themeConf(theme).pageBg)[0]
      for (const color of COLORS) {
        for (const overdue of [false, true]) {
          const s = cardStyles(theme, task({ color, status: 'completed' }), 'kanban', { overdue })
          const card = Number(s.wrap.opacity ?? 1)
          const paper = parseColor(PAPER[theme][color].bg)[0]
          const ink = parseColor(PAPER[theme][color].ink)[0]
          // Each pair as the card paints it, then the whole card over the page.
          const onPage = (c: RGB) => mix(c, card, page)
          const title = mix(ink, Number(s.titleStyle.opacity ?? 1), paper)
          const chipOpacity = Number(s.chipStyle.opacity ?? 1)
          const [tint, tintAlpha] = parseColor(String(s.chipStyle.background))
          const chip = mix(tint, tintAlpha * chipOpacity, paper)
          const chipText = mix(ink, chipOpacity, paper)
          const titleRatio = contrast(onPage(title), onPage(paper))
          const chipRatio = contrast(onPage(chipText), onPage(chip))
          expect({
            theme,
            color,
            overdue,
            title: titleRatio.toFixed(2),
            chip: chipRatio.toFixed(2),
            passesAA: titleRatio >= 4.5 && chipRatio >= 4.5,
          }).toMatchObject({ theme, color, overdue, passesAA: true })
        }
      }
    }
  })

  // The stamp is the one text a Completed cork card adds, and it sits on the paper, translucent.
  it('cork’s COMPLETED stamp clears 4.5:1 on every paper', () => {
    for (const color of COLORS) {
      const { stampStyle } = cardStyles('cork', task({ color, status: 'completed' }), 'kanban')
      const paper = parseColor(PAPER.cork[color].bg)[0]
      const [ink, alpha] = parseColor(String(stampStyle.color))
      const ratio = contrast(mix(ink, alpha, paper), paper)
      expect({ color, passesAA: ratio >= 4.5, ratio: ratio.toFixed(2) }).toMatchObject({
        color,
        passesAA: true,
      })
    }
  })
})

describe('scrollbars', () => {
  // Firefox ignores ::-webkit-scrollbar entirely, so the global rules in index.css never applied
  // there and it fell back to a bulky platform default. `scrollbar-width`/`scrollbar-color` are
  // standard properties, so they belong in the inline style objects with the rest of the theming.
  it('is thin, with a themed thumb on a transparent track, for every theme', () => {
    for (const t of THEMES) {
      const s = scrollbars(themeConf(t))
      expect(s.scrollbarWidth).toBe('thin')
      expect(s.scrollbarColor).toBe(`${themeConf(t).scrollThumb} transparent`)
      expect(themeConf(t).scrollThumb).toMatch(/^(#|rgba?\()/)
    }
  })

  it('gives each theme its own thumb rather than one shared grey', () => {
    const thumbs = THEMES.map((t) => themeConf(t).scrollThumb)
    expect(new Set(thumbs).size).toBe(THEMES.length)
  })

  // Every surface that can overflow must carry it — one missed container is one bulky
  // Firefox scrollbar in the middle of an otherwise themed board.
  it('is applied to every scrollable container in the chrome layer', () => {
    for (const t of THEMES) {
      const conf = themeConf(t)
      const meta = {
        dateStr: '2026-07-24',
        dayNum: 24,
        dow: 5,
        inMonth: true,
        isToday: false,
        isWeekend: false,
      }
      const containers = [
        boardChrome(t, conf).grid,
        cellChrome(t, conf, meta).notesWrap,
        inboxChrome(t, conf).inboxList,
        columnChrome(t, conf, STATUS[0]).listStyle,
      ]
      for (const c of containers) {
        expect(c.overflow).toBe('auto')
        expect(c.scrollbarWidth).toBe('thin')
        expect(c.scrollbarColor).toBe(`${conf.scrollThumb} transparent`)
      }
      // The phone Calendar's month scrolls only up and down, so it names the one axis.
      const phoneRoot = phoneMonthChrome(t, conf).root
      expect(phoneRoot.overflowY).toBe('auto')
      expect(phoneRoot.scrollbarWidth).toBe('thin')
      expect(phoneRoot.scrollbarColor).toBe(`${conf.scrollThumb} transparent`)
    }
  })
})
