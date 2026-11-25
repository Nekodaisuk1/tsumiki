/** Okabe–Ito categorical colors. See https://jfly.uni-koeln.de/color/ */
export const OKABE_ITO_COLORS = {
  black: "#000000",
  orange: "#E69F00",
  skyBlue: "#56B4E9",
  bluishGreen: "#009E73",
  yellow: "#F0E442",
  blue: "#0072B2",
  vermilion: "#D55E00",
  reddishPurple: "#CC79A7",
} as const;

/** Shared palette for rendering and settings previews. */
export const COLOR_VISION_PALETTE = {
  id: "okabe-ito",
  colors: OKABE_ITO_COLORS,
  // Layer indices match the existing four assembly slots.
  layers: [
    OKABE_ITO_COLORS.blue,
    OKABE_ITO_COLORS.orange,
    OKABE_ITO_COLORS.bluishGreen,
    OKABE_ITO_COLORS.reddishPurple,
  ],
} as const;

export const STANDARD_LAYER_COLORS = [0x4e9be6, 0x3fbf7f, 0xf0b93a, 0xd9608a];
export function layerColors(palette: string): readonly number[] {
  return palette === "okabe-ito"
    ? COLOR_VISION_PALETTE.layers.map((color) => Number.parseInt(color.slice(1), 16))
    : STANDARD_LAYER_COLORS;
}
