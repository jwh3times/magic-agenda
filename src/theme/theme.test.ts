import { describe, it, expect } from 'vitest'
import { CAT, COLORS, STATUS, PAPER } from './constants'
import { themeConf } from './themeConf'
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
  it('cork shows a pin; non-cork themes do not', () => {
    expect(cardStyles('cork', task(), 'cell').showPin).toBe(true)
    expect(cardStyles('brutal', task(), 'cell').showPin).toBe(false)
    expect(cardStyles('glass', task(), 'cell').showPin).toBe(false)
  })

  it('shows the DONE stamp only for a completed cork card', () => {
    expect(cardStyles('cork', task({ status: 'done' }), 'cell').showStamp).toBe(true)
    expect(cardStyles('cork', task({ status: 'todo' }), 'cell').showStamp).toBe(false)
    expect(cardStyles('brutal', task({ status: 'done' }), 'cell').showStamp).toBe(false)
  })

  it('ghost variant suppresses pin and rotation', () => {
    const g = cardStyles('cork', task(), 'ghost')
    expect(g.showPin).toBe(false)
    expect(g.wrap.transform).toBe('rotate(0deg)')
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
})
