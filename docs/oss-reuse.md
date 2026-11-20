# Reusing existing geometry and physics tools

調査日: 2026-11-19。公式ドキュメントと公開リポジトリを確認。

## Recommendation

短期は既存依存Three.jsのOBB・TransformControlsを利用。今後の移動中の衝突・剛体接触にはRapierを第一候補とする。大きな任意メッシュを扱う段階でthree-mesh-bvhを評価する。汎用の交差計算・操作ハンドル・物理エンジンをゼロから作らず、部材の形状構成と接合規則をアプリ側に保持する。

| Candidate | Reusable capability | Cost and limits | Decision |
| --- | --- | --- | --- |
| Three.js OBB | 回転した箱の交差判定 | 既存依存。穴を持つ板は実体ブロックへ分解する必要がある。衝突応答なし | 今回採用 |
| Three.js TransformControls | 移動・回転・ローカル軸・角度スナップ | 既に移動に使用。接合を保持するグループ操作と回転中心の指定はアプリ側で実装 | 斜め材編集に再利用 |
| Rapier | 剛体・接触・摩擦・ジョイント・shape casting | JS/WASM統合と設計同期が必要。木材の曲げ・ねじりを含む現行の梁解析の代替と決めつけない | 移動中の衝突・接触応答の第一候補、未導入 |
| three-mesh-bvh | Three.jsメッシュのレイ・交差・距離探索の高速化 | BVH更新が必要。メッシュ表面の交差だけで実体の包含や接合成立を判定しない | 任意形状・大規模化の段階で評価、未導入 |

## Shape and joint policy

穴のある材全体を単一の凸包にすると穴が埋まるため採用しない。Rapierでも板を複数の凸形状に分けて同じ剛体へ取り付ける方式を基本候補とする。動的な三角形メッシュには公式文書上の制約があり、見た目のメッシュを渡すだけで完了とはしない。

4枚分の組立段・先端1枚分のロープ領域・角棒と角穴の向き・穴の占有・巻き取り材の専有はtsumikiの規則として残す。ライブラリのジョイントだけでこれらは表現されない。差し込みを自由回転する関節に置き換えない。

## Licenses and sources

Three.jsはMIT、three-mesh-bvhはMIT、RapierはApache-2.0。実際の導入時は固定する配布物のライセンス・通知を維持する。

- [Three.js OBB](https://threejs.org/docs/pages/OBB.html)
- [Three.js TransformControls](https://threejs.org/docs/pages/TransformControls.html)
- [Three.js license](https://github.com/mrdoob/three.js/blob/dev/LICENSE)
- [Rapier colliders](https://rapier.rs/docs/user_guides/javascript/colliders/)
- [Rapier joints](https://rapier.rs/docs/user_guides/javascript/joints/)
- [Rapier scene queries](https://rapier.rs/docs/user_guides/javascript/scene_queries/)
- [Rapier source and license](https://github.com/dimforge/rapier)
- [three-mesh-bvh documentation](https://gkjohnson.github.io/tools/docs/three-mesh-bvh/)
- [three-mesh-bvh dependencies and license](https://github.com/gkjohnson/three-mesh-bvh/blob/master/package.json)
