import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Select } from '../components/controls'
import { ThemeProvider } from './ThemeProvider'
import { chevron, chevronSelect } from './selectChevron'
import { themeConf } from './themeConf'
import { fieldStyle } from './controls'

test('the chevron is drawn in the colour it is given', () => {
  expect(chevron('#3a2611')).toContain(encodeURIComponent('stroke="#3a2611"'))
  expect(chevron('#3a2611')).toMatch(/^url\("data:image\/svg\+xml,/)
})

test('a themed select drops the browser arrow and makes room for its own (#484)', () => {
  const style = chevronSelect('#fff', '#111', { y: 8, x: 11 })
  expect(style.appearance).toBe('none')
  expect(style.WebkitAppearance).toBe('none')
  // The control's own padding, plus room on the right for the chevron.
  expect(style.padding).toBe('8px 27px 8px 11px')
  // The chevron is layered over the control's fill, which stays the last (colour) layer.
  expect(String(style.background)).toMatch(
    /^url\(.*\) no-repeat right 11px center \/ 10px 6px, #fff$/,
  )
})

test.each(['cork', 'brutal', 'glass'] as const)(
  'Settings selects draw the chevron in the field text colour (%s)',
  (theme) => {
    const { container } = render(
      <ThemeProvider initial={theme}>
        <Select aria-label="Pick">
          <option>One</option>
        </Select>
      </ThemeProvider>,
    )
    const color = String(fieldStyle(theme, themeConf(theme)).color)
    expect(container.querySelector('select')?.getAttribute('style')).toContain(
      encodeURIComponent(`stroke="${color}"`),
    )
  },
)
