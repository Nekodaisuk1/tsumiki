import type { GeometryProfile, Member } from "./design";

/** Drawing dimensions are mm; geometry coordinates use 1000 mm per model unit. */
export const DRAWING_SCALE = 1000;
export const HITOTO_GEOMETRY: GeometryProfile = {
  specification: "hitoto-v1",
  boardWidth: 0.105,
  thickness: 0.03,
  tenonSize: 0.03,
  tenonLength: 0.165,
  holeSize: 0.039,
  // The user confirmed rounded square tenons. This radius remains an editable assumption.
  tenonCornerRadius: 0.0063,
};
export type CatalogPart = {
  id: string;
  label: string;
  kind: Member["kind"];
  totalMm: number;
  span: number;
  holes: number[];
  end: "square" | "round";
  page: number;
};
const sizes = [300, 450, 600, 750, 900, 1050, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600];
export const HITOTO_PARTS: CatalogPart[] = sizes.map((nominal, i) => {
  const totalMm = 156 + nominal * 0.935;
  return {
    id: `male-${nominal}`,
    label: `${nominal}♂`,
    kind: "male",
    totalMm,
    span: (totalMm - 330) / DRAWING_SCALE,
    holes: [],
    end: "square",
    page: i + 4,
  };
});
// Pages 22–41 depict the 140.25 mm pitch option; later dimensioned parts use 280.5 mm.
for (const nominal of [150, ...sizes]) {
  const spanMm = nominal * 0.935;
  const pitch = nominal <= 1800 ? 140.25 : 280.5;
  const holes = Array.from({ length: Math.round(spanMm / pitch) + 1 }, (_, i) => (i * pitch) / DRAWING_SCALE);
  const page =
    nominal <= 1200
      ? 22 + (nominal / 150 - 1) * 2
      : 38 + ((nominal - 1500) / 300) * 2 + (nominal >= 2700 ? 2 : 0);
  for (const end of ["square", "round"] as const) {
    const totalMm = spanMm + (end === "square" ? 156 : 105);
    HITOTO_PARTS.push({
      id: `female-${nominal}-${end}`,
      label: `${nominal}♀${end === "square" ? "角" : "丸"}`,
      kind: "female",
      totalMm,
      span: spanMm / DRAWING_SCALE,
      holes,
      end,
      page: page + (end === "round" ? 1 : 0),
    });
  }
}
for (const end of ["square", "round"] as const) {
  const original = HITOTO_PARTS.find((p) => p.id === `female-2400-${end}`);
  if (!original) throw new Error("Missing drawing part");
  HITOTO_PARTS.push({
    ...original,
    id: `${original.id}-dense`,
    label: `${original.label}（140.25ピッチ）`,
    page: end === "square" ? 46 : 47,
    holes: Array.from({ length: 17 }, (_, i) => i * 0.14025),
  });
}
export function catalogPart(id: string): CatalogPart {
  const part = HITOTO_PARTS.find((p) => p.id === id);
  if (!part) throw new Error(`図面規格が不明です: ${id}`);
  return part;
}
export function memberPart(member?: Member): CatalogPart | undefined {
  return member?.catalogId ? catalogPart(member.catalogId) : undefined;
}
export function femaleMargin(profile: GeometryProfile, member?: Member): number {
  return profile.specification === "hitoto-v1"
    ? memberPart(member)?.end === "round"
      ? 0.0525
      : 0.078
    : profile.boardWidth * 0.7;
}
export function holeOffsets(length: number, count: number, member?: Member): number[] {
  return memberPart(member)?.holes ?? Array.from({ length: count }, (_, i) => (length * i) / (count - 1));
}
export function tenonOuterRadius(profile: GeometryProfile): number {
  const radius = profile.tenonCornerRadius ?? 0;
  return Math.SQRT2 * (profile.tenonSize / 2 - radius) + radius;
}
