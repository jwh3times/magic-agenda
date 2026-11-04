export type RGB = [number, number, number]

/** `#rgb`, `#rrggbb`, `rgba(r,g,b,a)`, or `transparent` → [rgb, alpha]. */
export function parseColor(color: string): [RGB, number] {
  if (color === 'transparent') return [[0, 0, 0], 0]
  const rgba = /^rgba?\(([^)]+)\)$/.exec(color)
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((v) => v.trim())
    return [[Number(r), Number(g), Number(b)], Number(a)]
  }
  let hex = color.replace('#', '')
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  return [[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB, 1]
}

/** `top` at `alpha` painted over an opaque `under`. */
export function mix(top: RGB, alpha: number, under: RGB): RGB {
  return top.map((c, i) => c * alpha + under[i] * (1 - alpha)) as RGB
}

/** `color` painted over an opaque `under`. */
export function over(color: string, under: RGB): RGB {
  const [rgb, a] = parseColor(color)
  return mix(rgb, a, under)
}

export function contrast(a: RGB, b: RGB): number {
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
