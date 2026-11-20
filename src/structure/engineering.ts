import type { Design, Material } from "./design";
import { solvePhysicalFrame } from "./solver";

export const TIMBER_SOURCE =
  "https://www.swedishwood.com/siteassets/5-publikationer/pdfer/design-of-timber-structures-2-2016.pdf";
// Table 3.3, EN 338:2016 reference examples; characteristic strengths are not allowable stresses.
export const TIMBER_PRESETS = {
  C16: { E: 8000e6, G: 500e6, density: 370, bending: 16, tension: 8.5, compression: 17 },
  C24: { E: 11000e6, G: 690e6, density: 420, bending: 24, tension: 14.5, compression: 21 },
} as const;
export type EngineeringSettings = {
  preset: keyof typeof TIMBER_PRESETS;
  node: string;
  direction: "x" | "y" | "z";
  forceN: number;
  selfWeight: boolean;
};
export const ENGINEERING_LIMITATIONS = [
  "剛接合・線形弾性梁の参考計算です。実物の材種・等級は未確認。安全判定や耐荷重保証ではありません。",
  "105×30mmの無欠損断面で計算。穴・凸部・接合部の局所応力、滑り、抜け、割裂、座屈、クリープ、破壊は未評価です。",
  "支持節点は回転を含む全6自由度固定です。床に置いただけの支持とは異なり、たわみを小さく見積もる可能性があります。",
  "ロープの補強効果・丸材の質量は含みません。自重は解析区間のみで、端の張り出し・凸部の重量は含みません。",
  "色は公称垂直応力の相対比較です。青でも安全を意味しません。変形曲線は41点のサンプルです。",
];
export function analyzeTimber(design: Design, settings: EngineeringSettings) {
  if (design.version !== 6 || design.geometry.specification !== "hitoto-v1")
    throw new Error("実寸解析は図面規格の設計（v6）で使用できます");
  if (
    !Object.hasOwn(TIMBER_PRESETS, settings.preset) ||
    !["x", "y", "z"].includes(settings.direction) ||
    !Number.isFinite(settings.forceN) ||
    Math.abs(settings.forceN) > 100000 ||
    typeof settings.selfWeight !== "boolean"
  )
    throw new Error("木材プリセット・荷重条件が不正です（荷重は±100000 N以内）");
  const wood = TIMBER_PRESETS[settings.preset];
  const b = design.geometry.boardWidth,
    h = design.geometry.thickness;
  const material: Material = {
    id: "physical-timber",
    E: wood.E,
    G: wood.G,
    density: wood.density,
    A: b * h,
    Iy: (b * h ** 3) / 12,
    Iz: (h * b ** 3) / 12,
    J: b * h ** 3 * (1 / 3 - 0.21 * (h / b) * (1 - h ** 4 / (12 * b ** 4))),
  };
  const physical = structuredClone(design);
  physical.jointModel = "rigid-approximation";
  physical.analysis.loadNode = settings.node;
  physical.analysis.direction = settings.direction;
  const result = solvePhysicalFrame(physical, material, settings.forceN, settings.selfWeight);
  const members = design.members
    .map((member) => {
      const elements = result.elements.filter((e) => e.id === member.id);
      let normalMPa = 0,
        bendingMPa = 0,
        axialN = 0,
        shearN = 0,
        displacementMm = 0,
        referenceRatio = 0;
      for (const element of elements)
        for (const s of element.samples) {
          const bending =
            ((Math.abs(s.my) * h) / 2 / material.Iy + (Math.abs(s.mz) * b) / 2 / material.Iz) / 1e6;
          const axial = Math.abs(s.axial) / material.A / 1e6;
          normalMPa = Math.max(normalMPa, axial + bending);
          bendingMPa = Math.max(bendingMPa, bending);
          axialN = Math.max(axialN, Math.abs(s.axial));
          shearN = Math.max(shearN, Math.hypot(s.shearY, s.shearZ));
          displacementMm = Math.max(displacementMm, Math.hypot(...s.displacement) * 1000);
          referenceRatio = Math.max(
            referenceRatio,
            axial / (s.axial >= 0 ? wood.tension : wood.compression) + bending / wood.bending,
          );
        }
      return { id: member.id, normalMPa, bendingMPa, axialN, shearN, displacementMm, referenceRatio };
    })
    .sort((a, b) => b.normalMPa - a.normalMPa);
  const maxDisplacementMm = Math.max(0, ...members.map((m) => m.displacementMm));
  const warnings: string[] = [...ENGINEERING_LIMITATIONS];
  if (result.elements.some((e) => e.samples.some((s) => Math.hypot(...s.displacement) > e.length / 50)))
    warnings.unshift("変位が解析区間長の1/50を超えています。小変形の仮定から外れる可能性があります。");
  if (members.some((m) => m.referenceRatio >= 1))
    warnings.unshift("公称応力が基準強度との単純比較で1以上です。接合や欠損を含めた再検討が必要です。");
  return { ...result, settings: structuredClone(settings), material, members, maxDisplacementMm, warnings };
}
export type EngineeringResult = ReturnType<typeof analyzeTimber>;
