import {
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react'
import { Link, type LinkProps } from 'react-router'
import {
  buttonStyle,
  checkboxStyle,
  colorInputStyle,
  fieldStyle,
  type ButtonSize,
  type ButtonVariant,
} from '../theme/controls'
import { chevronSelect } from '../theme/selectChevron'
import { useThemeOrDefault } from '../theme/ThemeProvider'

/**
 * Themed form controls (#464). Each is the native element with the current theme's style from
 * `theme/controls.ts` underneath, so roles, accessible names, and keyboard behaviour are the
 * browser's own. A `style` prop is merged last, for layout only (width, flex, alignment).
 */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { theme, conf } = useThemeOrDefault()
  return (
    <button
      type={type}
      disabled={disabled}
      style={{ ...buttonStyle(theme, conf, variant, { size, disabled: !!disabled }), ...style }}
      {...rest}
    />
  )
}

/** A router link that looks like a button, for navigation that sits among buttons. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  style,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  const { theme, conf } = useThemeOrDefault()
  return <Link style={{ ...buttonStyle(theme, conf, variant, { size }), ...style }} {...rest} />
}

/** An external or same-page link that looks like a button. */
export function AnchorButton({
  variant = 'secondary',
  size = 'md',
  style,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const { theme, conf } = useThemeOrDefault()
  return <a style={{ ...buttonStyle(theme, conf, variant, { size }), ...style }} {...rest} />
}

/**
 * A text input. It draws its own focus ring from the theme's `focusRing` token, because
 * `index.css` removes the browser's outline from every focused input and a field with neither
 * would give no sign of where typing will go.
 */
export function TextInput({
  style,
  disabled,
  onFocus,
  onBlur,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const { theme, conf } = useThemeOrDefault()
  const [focused, setFocused] = useState(false)
  return (
    <input
      disabled={disabled}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      style={{
        ...fieldStyle(theme, conf, { disabled: !!disabled }),
        boxShadow: focused ? `0 0 0 2px ${conf.focusRing}` : 'none',
        ...style,
      }}
      {...rest}
    />
  )
}

export function Select({ style, disabled, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const { theme, conf } = useThemeOrDefault()
  const field = fieldStyle(theme, conf, { disabled: !!disabled })
  const merged: CSSProperties = {
    ...field,
    // The browser's own arrow ignored the theme (#484): draw a chevron in the field's text colour.
    ...chevronSelect(String(field.background), String(field.color), { y: 8, x: 10 }),
    cursor: disabled ? 'not-allowed' : 'pointer',
    ...style,
  }
  return <select disabled={disabled} style={merged} {...rest} />
}

export function Checkbox({ style, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { theme, conf } = useThemeOrDefault()
  return <input type="checkbox" style={{ ...checkboxStyle(theme, conf), ...style }} {...rest} />
}

export function ColorInput({
  style,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { theme, conf } = useThemeOrDefault()
  return <input type="color" style={{ ...colorInputStyle(theme, conf), ...style }} {...rest} />
}
