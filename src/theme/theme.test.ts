import { describe, it, expect } from 'vitest'
import { CAT, COLORS, STATUS, PAPER } from './constants'
import { themeConf } from './themeConf'
import { boardChrome, cellChrome, inboxChrome, columnChrome, scrollbars } from './chrome'
import { rotOf, cardStyles } from './cardStyles'
import { NO_RECUR, type Task, type ThemeName } from '../types/task'

const THEMES: ThemeName[] = ['cork', 'brutal', 'glass']

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1001',
    title: 'Test',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: 'inbox',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...overrides,
  }
}

describe('constants', () => {
  it('has 5 categories, 6 colors, 3 statuses', () => {
    expect(Object.keys(CAT)).toHaveLength(5)
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

  it('shows the DONE stamp only for a completed cork card', () => {
    expect(cardStyles('cork', task({ status: 'done' }), 'cell').showStamp).toBe(true)
    expect(cardStyles('cork', task({ status: 'todo' }), 'cell').showStamp).toBe(false)
    expect(cardStyles('brutal', task({ status: 'done' }), 'cell').showStamp).toBe(false)
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
    const s = cardStyles('cork', task({ status: 'done' }), 'cell')
    expect(s.titleStyle.textDecorationLine).toBe('line-through')
    expect('textDecoration' in s.titleStyle).toBe(false)
  })

  it('overdue cards carry the red inset accent and tinted chip', () => {
    const s = cardStyles('cork', task({ day: '2020-01-01' }), 'kanban', { overdue: true })
    expect(String(s.wrap.boxShadow)).toContain('#e0524a')
    expect(String(s.chipStyle.background)).toContain('rgba(224,82,74')
    const plain = cardStyles('cork', task(), 'kanban')
    expect(String(plain.wrap.boxShadow)).not.toContain('#e0524a')
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
        inMonth: true,
        isToday: false,
        isWeekend: false,
      }
      const containers = [
        boardChrome(t, conf).grid,
        cellChrome(t, conf, meta, false).notesWrap,
        inboxChrome(t, conf).inboxList,
        columnChrome(t, conf, STATUS[0], false).listStyle,
      ]
      for (const c of containers) {
        expect(c.overflow).toBe('auto')
        expect(c.scrollbarWidth).toBe('thin')
        expect(c.scrollbarColor).toBe(`${conf.scrollThumb} transparent`)
      }
    }
  })
})
