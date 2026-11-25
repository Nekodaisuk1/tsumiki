# 001: Material geometry

## Status
In progress

## Objective
雌材・雄材・丸のパラメータ表現と形状を再現する。

## Inputs and dependencies
部材寸法、穴形状・位置、差し込み部の規格。

## Acceptance criteria
寸法と穴位置が入力規格に一致する。無効な寸法を説明付きで拒否する。

## Implementation
未着手。規格が未確定の場合は、仮の値と実物の値を区別する。実装先は experiments/001-material-geometry/ を予定する。

## Verification plan
規格値を用いた形状確認と寸法検査。

## Results
[Prototype 03](../editor.md)で左右凸の雄材、雌材の実際の貫通穴、雄材に通す丸材を実装。形状の仮パラメータを専用形式v2に保存する。レイ交差と形状範囲を検証。実物の規格寸法・適合の検証は未実施。

## Integration notes
未判定。採用するモデルの仮定、適用範囲、既知の制約を記録する。

## Next steps
入力条件と測定可能な受け入れ条件を確定する。
