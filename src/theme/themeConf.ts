import type { ThemeName } from '../types/task'

/** ~26 style tokens per theme. Ported verbatim from prototype `themeConf()`. */
export interface ThemeConf {
  appName: string
  ui: string
  title: string
  pageBg: string
  pageImg: string
  pageSize: string
  toolbarBg: string
  toolbarFg: string
  toolbarSub: string
  toolbarBorder: string
  accent: string
  accentFg: string
  boardBg: string
  boardBorder: string
  boardPad: string
  boardShadow: string
  weekFg: string
  weekBg: string
  cellBg: string
  cellBorder: string
  cellRadius: string
  cellToday: string
  cellTodayRing: string
  cellOut: string
  numFg: string
  weekendBg: string
}

const CORK: ThemeConf = {
  appName: 'Corkboard',
  ui: "'Libre Franklin',sans-serif",
  title: "'Caveat',cursive",
  pageBg: '#caa46b',
  pageImg:
    'radial-gradient(circle at 18% 30%, rgba(110,78,38,.30) 0 1.6px, transparent 2.6px), radial-gradient(circle at 67% 58%, rgba(110,78,38,.24) 0 1.6px, transparent 2.6px), radial-gradient(circle at 42% 82%, rgba(140,100,55,.22) 0 1.3px, transparent 2.2px)',
  pageSize: '24px 24px, 31px 31px, 17px 17px',
  toolbarBg: '#6b4a2b',
  toolbarFg: '#fbf3e6',
  toolbarSub: 'rgba(251,243,230,.6)',
  toolbarBorder: '1px solid rgba(0,0,0,.25)',
  accent: '#b8472e',
  accentFg: '#fff',
  boardBg: 'transparent',
  boardBorder: 'none',
  boardPad: '0',
  boardShadow: 'none',
  weekFg: 'rgba(46,30,12,.8)',
  weekBg: 'transparent',
  cellBg: 'rgba(255,250,240,.10)',
  cellBorder: '1px solid rgba(74,50,22,.32)',
  cellRadius: '3px',
  cellToday: 'rgba(255,247,225,.22)',
  cellTodayRing: 'inset 0 0 0 2px rgba(184,71,46,.85)',
  cellOut: 'rgba(120,90,55,.12)',
  numFg: '#3a2611',
  weekendBg: 'rgba(120,90,55,.06)',
}

const BRUTAL: ThemeConf = {
  appName: 'TASKS//',
  ui: "'Space Grotesk',sans-serif",
  title: "'Archivo Black',sans-serif",
  pageBg: '#F2EEDF',
  pageImg:
    'linear-gradient(rgba(0,0,0,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.05) 1px, transparent 1px)',
  pageSize: '26px 26px, 26px 26px',
  toolbarBg: '#111',
  toolbarFg: '#fff',
  toolbarSub: 'rgba(255,255,255,.55)',
  toolbarBorder: '3px solid #111',
  accent: '#FF4D2E',
  accentFg: '#fff',
  boardBg: '#fff',
  boardBorder: '3px solid #111',
  boardPad: '0',
  boardShadow: '8px 8px 0 #111',
  weekFg: '#111',
  weekBg: '#111',
  cellBg: '#fff',
  cellBorder: '2px solid #111',
  cellRadius: '0',
  cellToday: '#FFF6C2',
  cellTodayRing: 'inset 0 0 0 3px #111',
  cellOut: '#EDE9DA',
  numFg: '#111',
  weekendBg: '#FBF7E4',
}

const GLASS: ThemeConf = {
  appName: 'Aurora',
  ui: "'Manrope',sans-serif",
  title: "'Manrope',sans-serif",
  pageBg: '#0b0f1f',
  pageImg: 'none',
  pageSize: 'auto',
  toolbarBg: 'rgba(255,255,255,.04)',
  toolbarFg: '#eaf0ff',
  toolbarSub: 'rgba(234,240,255,.5)',
  toolbarBorder: '1px solid rgba(255,255,255,.10)',
  accent: '#7c5cff',
  accentFg: '#fff',
  boardBg: 'rgba(255,255,255,.03)',
  boardBorder: '1px solid rgba(255,255,255,.09)',
  boardPad: '0',
  boardShadow: '0 30px 80px rgba(0,0,0,.45)',
  weekFg: 'rgba(234,240,255,.55)',
  weekBg: 'transparent',
  cellBg: 'rgba(255,255,255,.035)',
  cellBorder: '1px solid rgba(255,255,255,.07)',
  cellRadius: '12px',
  cellToday: 'rgba(124,92,255,.16)',
  cellTodayRing: 'inset 0 0 0 1px rgba(150,120,255,.7)',
  cellOut: 'rgba(255,255,255,.012)',
  numFg: 'rgba(234,240,255,.85)',
  weekendBg: 'rgba(255,255,255,.02)',
}

const CONF: Record<ThemeName, ThemeConf> = { cork: CORK, brutal: BRUTAL, glass: GLASS }

export function themeConf(theme: ThemeName): ThemeConf {
  return CONF[theme]
}
