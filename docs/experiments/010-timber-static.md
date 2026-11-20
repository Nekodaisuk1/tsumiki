# SI timber static reference analysis

## Decision

Reuse the existing tested 3D Euler–Bernoulli frame assembler and equilibrium solver with an explicit SI material override. A ranking-only calculator would miss structural load paths; an external FEM backend would add deployment and model translation costs. No dependencies were added. Dimensionless rope comparisons and dynamics retain their original meaning.

## Inputs and units

Drawing designs (v6, hitoto-v1) only: one geometry unit is one metre. All members use the selected C16 or C24 reference preset, with width 0.105 m and thickness 0.030 m from the drawing. Axial grain direction follows each member. E and G are Pa, density is kg/m³, force is N, moment is N·m, and solver displacement is m. The UI reports displacement in mm and nominal normal stress in MPa.

Source: [Swedish Wood, Design of timber structures volume 2, edition 2016, table 3.3, p.13](https://www.swedishwood.com/siteassets/5-publikationer/pdfer/design-of-timber-structures-2-2016.pdf), based on EN 338:2016. These are reference strength classes, not confirmed grades of the actual timber or current jurisdiction-specific design rules.

| Preset | E (MPa) | G (MPa) | Density (kg/m³) | Bending (MPa) | Axial tension (MPa) | Axial compression (MPa) |
| --- | --- | --- | --- | --- | --- | --- |
| C16 | 8000 | 500 | 370 | 16 | 8.5 | 17 |
| C24 | 11000 | 690 | 420 | 24 | 14.5 | 21 |

One signed nodal force acts along the selected global axis. Self-weight uses g=9.80665 m/s² along -Y, uniform on each analyzed element. Consistent nodal forces and moments are assembled using the existing eccentric-end transform; recovered internal forces subtract fixed-end loads. Self-weight excludes extensions beyond the analyzed span, rings and ropes.

## Outputs

- A=bh, Iy=bh³/12, Iz=hb³/12 and rectangular Saint-Venant torsional constant approximation.
- 41 samples per element: cubic Hermite beam deflection plus the uniform-load particular solution; linear axial interpolation plus the axial uniform-load term.
- Member peak nominal normal stress: |N|/A + |My|h/(2Iy) + |Mz|b/(2Iz).
- Relative heatmap (blue to red) and white exaggerated deflection curves over undeformed geometry. Results include axial/shear force, bending stress, nodal reactions and full sampled curves in the JSON report.
- Reference strength ratio: axial stress/characteristic axial tension or compression strength + bending stress/characteristic bending strength. This is NOT a code interaction check, allowable stress, safety factor or load capacity.
- Report saves source, original design, inputs, material constants, units and results. Physical settings are not part of the normal design format. Changes invalidate the displayed result; display scale does not.

## Limits

All joints and support nodes are rotationally fixed. Automatic floor support is an assumed clamp, not physical contact. Ropes do not contribute. Gross rectangular sections omit holes, reduced tenons, shoulder stress concentrations and local connection failure. No shear/torsion strength check, buckling, creep, fracture, connection slip or nonlinear geometry. Relative colours are not safety categories. Displacement greater than element length/50 triggers a small-deformation warning. The existing uncalibrated dynamic results are hidden while the SI overlay is active.

## Verification

Analytical cantilever tests cover tip force displacement/stress/reactions, force linearity, inverse stiffness scaling, strong/weak axis rotation, uniform self-weight displacement at tip and midspan, self-weight root moment, and axial response. Legacy units, nonfinite loads and fixed load nodes are rejected. The original design is unchanged. Browser verification covers calculation, SI labels, result export with inputs, and invalidation after a load edit.

Validation run: `npm test` passed 118 tests across 16 files; `npm run test:e2e` passed all 30 browser tests. `npm run build` and `npm run lint` passed. Vite retains the pre-existing large-bundle advisory. No safety capacity or joint calibration is claimed.
