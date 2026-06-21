/**
 * Convert an HSV colour to a CSS hex string. The DIRIGERA hub reports an RGB
 * light's colour as hue (0–360) + saturation (0–1); the swatch is rendered at
 * full value so the hue stays visible regardless of the light's brightness
 * (brightness is shown separately as a percentage).
 * @param hue - hue in degrees, 0–360
 * @param saturation - saturation, 0–1
 * @param value - brightness value, 0–1. Defaults to `1`.
 * @returns a `#rrggbb` colour string
 */
export function hsvToHex(hue: number, saturation: number, value = 1): string {
  const chroma = value * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = value - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;
  if (sector < 1) [red, green, blue] = [chroma, secondary, 0];
  else if (sector < 2) [red, green, blue] = [secondary, chroma, 0];
  else if (sector < 3) [red, green, blue] = [0, chroma, secondary];
  else if (sector < 4) [red, green, blue] = [0, secondary, chroma];
  else if (sector < 5) [red, green, blue] = [secondary, 0, chroma];
  else [red, green, blue] = [chroma, 0, secondary];

  const toHex = (channel: number): string =>
    Math.round((channel + match) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}
