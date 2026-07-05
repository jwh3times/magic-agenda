import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { ReactNode } from 'react'
import type { ThemeName } from '../types/task'
import { ThemeProvider, useTheme } from './ThemeProvider'

// Note: @testing-library/react's `renderHook` forwards `rerender()` args to the
// *render callback*, not to the `wrapper` component (the wrapper only ever
// receives `children` — see its `wrapUiIfNeeded` helper). To change the
// `initial` prop of a wrapping provider across a rerender, read it from a
// mutable ref inside the wrapper instead of from rerender-provided props.
test('re-syncs when the persisted theme changes elsewhere (initial prop updates)', () => {
  const current: { theme: ThemeName } = { theme: 'cork' }
  const { result, rerender } = renderHook(() => useTheme(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider initial={current.theme}>{children}</ThemeProvider>
    ),
  })
  expect(result.current.theme).toBe('cork')

  current.theme = 'brutal'
  rerender()
  expect(result.current.theme).toBe('brutal')
})
