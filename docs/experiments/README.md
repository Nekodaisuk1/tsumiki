# Experiment plan

## Workflow

1. 対象Markdownの目的・入力・受け入れ条件を具体化する。
2. 未確定事項を確認するか、検証用の仮定として明示する。
3. 実験ごとに作業ブランチ・実装ディレクトリを分ける。並行作業にはworktreeを使う。
4. 実装し、記載した条件で検証する。
5. コマンド、条件、結果、制約、採否を対象Markdownに記録する。
6. 検証済みの成果を小さく統合し、構造全体でも再検証する。

Status: Draft / Ready / In progress / Verified / Rejected / Integrated

## Experiments

- [001: Material geometry](001-material-geometry.md)
- [002: Joint behavior](002-joint-behavior.md)
- [003: Assembly and motion](003-assembly-motion.md)
- [004: Rope constraints](004-rope-constraints.md)
- [005: Structural analysis](005-structural-analysis.md)
- [006: Rectangle shaping](006-rectangle-shaping.md)
- [007: Three-dimensional reinforcement](007-3d-reinforcement.md)
- [010: SI timber static reference analysis](010-timber-static.md)

001 → 002 → 003を基礎とし、004・005を検証する。006は対象形状の定義後に、接合・ロープの制約と統合する。実装順は実験で見つかった依存関係に応じて更新する。

## Current priority
荷重や揺れに耐えるための補強が主目的。次の試作は007の3D荷重・揺れ比較を優先する。006は接合部の遊びや歪み是正の局所的な検証として位置付け直す。3D静的応答を先に検証し、動的応答へ進む。

- [011: Floor contact and friction](011-floor-contact.md)
- [012: Assembly planning and video](012-assembly-planning.md)
- [013: Stress distribution and local FEM specimens](013-stress-distribution.md)
