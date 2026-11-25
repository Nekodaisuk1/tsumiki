# tsumiki

規格化された木材とロープで構造物をデジタル設計し、荷重・揺れへの応答を調べるソフトウェア。

## Start

```sh
npm ci
npm run dev
```

表示されたローカルURL（標準は http://127.0.0.1:5173/ ）を開く。Node.js 22.12以上、WebGL対応ブラウザが必要。

## Structure Studio

- 左右端が凸の横向き雄材、貫通穴のある雌材、雄材の角棒にはめる丸材を3D表示。
- 雄材は穴をクリックして垂直にスナップ追加。シャフトを通る雌材との構造接続を自動保存。
- 雌材は最外側へ追加。凸部は板厚5枚分で、先端1枚分はロープ専用。
- 枠の面を選び、専用の巻き取り雄材を指定して最外側にロープを張る。
- 部材選択、移動矢印、区画追加、Undo/Redo、下書き復元。
- 雌材の回転・穴数・重ね段と、丸材を入れる空き段を編集。
- 静的荷重、人による外力加振、床からの加振を、ロープなし／たるみ／張力ありで比較。
- 穴と角棒の隙間・接触による接合の遊びと、ロープの巻き取りによる着座を解析。剛接合近似と切り替えて比較。
- ロープの掛け点の摩擦は「滑る」「滑らない」の両極端で比較し、結果の幅を表示。
- 相対変位と時系列、静的部材端内力・ねじり、接合の遊びの使用率を表示。3D解析は小変形の梁と摩擦なし接触。
- `.tsumiki.json` に設計と解析入力を保存・再読込し、同じ条件で再計算。
- 解析結果も設計とともにレポート出力。

部材寸法は保留中。座標・物性・荷重・隙間・接触剛性は無次元の仮定値。接合の摩擦・実際の穴適合・強度限界は未評価。揺れの途中で隙間が開閉する動的応答は、接触状態を固定した参考値。丸材は取付先・空き段を記録・表示し、接触・質量・剛性への寄与は未解析。動的な張り／たるみ切替を検知した結果は参考値として警告する。

旧2DのRope Labは `/rope.html` で確認できる。編集中の設計はブラウザにも下書き保存し、「下書きを復元」で戻せる。持ち運び・長期保存には専用ファイルを使う。

## Documents

- [Product requirements](docs/product.md)
- [Experiment plan](docs/experiments/README.md)
- [3D prototype model and limitations](docs/prototype-3d.md)
- [Hole snapping and outer rope workflow](docs/hole-snap-and-rope.md)
- [Joint clearance and rope seating](docs/joint-clearance.md)
- [Historical patterned parts editor](docs/editor.md)
- [Dedicated design format](docs/design-format.md)
- [JSON Schema](public/schemas/tsumiki-design-v5.schema.json)
- [Example design](public/examples/box-frame.tsumiki.json)
- [Historical 2D prototype](docs/prototype.md)

## Verification

```sh
npm test
npm run build
npm run lint
npm run test:e2e
```

E2Eはインストール済みGoogle Chromeを使用し、5174番ポートでテストサーバーを自動起動・終了する。
`npm run artifacts` でJSON Schemaと標準サンプルを再生成できる。
