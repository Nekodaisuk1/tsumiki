# Preferences

The header's Settings button opens a separate, resizable 760 × 720 browser window. Repeated clicks focus the existing named window. The browser may choose a tab on mobile or according to its window policy; blocked popups produce an actionable error in the editor.

Preferences apply immediately and persist under `tsumiki-preferences-v1` in local storage, separately from design files. Storage events synchronize open windows; same-window changes use an explicit event. Invalid settings and storage failures are reported rather than silently discarded.

Available categories:

- Appearance: dark, light or system theme; larger text.
- Viewport: plain or wood surfaces, material or layer colors, nodes, grid, axes, and pixel-density quality presets. Low quality disables wood shadows. Quality never alters design geometry or physical calculations.
- Camera: orbit, pan and zoom speed, inertia, and zoom toward the cursor.
- Editing: translation and rotation increments, plus 20/80/200 undo entries (default 80). Lowering the limit discards the oldest excess entries.
- Guidance: shortcut guide, hover labels, and reduced motion (no placement flash or camera inertia).
- Save and recovery: save after each edit, last saved timestamp, startup recovery notice, and explicit draft deletion. Turning off automatic saving retains the existing draft; deleting it does not clear the current editor design.
- Assembly: 1.5, 3 or 5 seconds per step.

The settings window supports search, category resets and a full reset. Resetting preferences does not delete a design or its draft. Surface, color, node visibility, increments and assembly speed remain available in their original controls and synchronize with preferences.

Validation includes schema rejection and undo retention tests, popup synchronization and reuse, reload persistence, reset, and draft preservation/deletion browser tests. Existing editor and export tests also cover compatibility.

## 文字・色・線の見やすさ設定

設定画面上部の同名ボタンから、背景と文字 → 部材の色分け → 線と段番号の順に調整する。3Dプレビューは実際の描画処理を使用する。診断名や健康情報の入力は不要。色の違いが分からない場合は段番号を有効にして確認に進める。

保存するまでは編集中の設計・保存済み設定を変更しない。「保存して終了」でこのブラウザに保存し、開いている編集画面へ同期する。キャンセルとEscは調整前の外観に戻す。保存後も外観カテゴリから個別に変更できる。OS追従は背景のみで、配色を自動判定・変更しない。

配色は標準／Okabe–Ito、文字は標準／拡大、選択輪郭は標準／太線、段番号は表示／非表示。木目と動きの軽減も調整できる。選択輪郭はWebGLの線幅制限を避けて立体の線として描画する。段番号は雌材の中央に表示するため、密集した構造では重なり得る。
