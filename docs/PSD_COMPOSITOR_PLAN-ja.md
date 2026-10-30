# PSDコンポジタ実装計画

## 目的

PSD内のレイヤーを、保存済みの合成画像に頼らず、アプリ内で再合成できるようにする。編集後もPhotoshopで保存した初期表示と比較可能な品質を目標にする。

## 現状の前提

- `ag-psd` はレイヤー画像、マスク、クリッピング、調整レイヤーの情報を読み取る。
- `ag-psd` はレイヤー変更後の合成画像を生成しないため、合成はアプリ側で行う必要がある。
- 現在のCanvas描画は簡易実装で、複雑なPSDでは保存済み合成画像をフォールバック表示する。
- 検証用PSD:
  - `花隈千冬_体操着.psd`: 114 leaf layers / 45 clipping layers / 7 masks / 1 curves adjustment
  - `小春六花_ギャル衣装.psd`: 24 leaf layers / simple radio groups

## 実装段階と完了条件

### Phase 0 — 安全な描画基盤

- 合成処理をReact hookから独立した `src/compositor/` モジュールへ移す。
- ドキュメント座標のCanvasを1枚作り、各グループは独立サーフェスへ描画する。
- レイヤー順、非表示、opacity、通常合成、boundsを固定する。
- 合成不能時に限り保存済みcompositeへフォールバックする。
- gate: 既存の単純PSDと小春六花PSDで初期表示・タブ切替・単純な表示切替が崩れない。

### Phase 1 — ブレンドモードとパススルー

- `ag-psd` の正式なブレンドモード名を共通テーブルで扱う。
- Canvasの標準合成で表現できないモードは、ピクセル演算へ切り替える。
- `pass through` グループは子レイヤーを親の合成先へ直接流し、その他のグループは一時サーフェスへ隔離する。
- gate: normal / multiply / screen / overlay / pass through の基準画像比較。

### Phase 2 — クリッピング

- 同一親内の非クリップ基底レイヤーを特定する。
- 連続するクリップレイヤーを基底レイヤーのalphaでマスクする。
- グループ境界を越えてクリッピングしない。
- gate: 花隈千冬の45クリップを含む領域で、表示切替前後の形状が崩れない。

### Phase 3 — 通常マスクとグループマスク

- user maskの白黒、反転、density、featherの基本処理。
- グループマスクをグループ合成後に適用する。
- マスク座標とレイヤー座標を分離する。
- gate: 花隈千冬の7マスクを含む領域で、マスク外に色が漏れない。

### Phase 4 — 調整レイヤー

- まず curves、levels、brightness/contrast の順に実装する。
- 調整レイヤーは同一親内の下側にある合成結果へ適用する。
- 調整レイヤー自身のmask、opacity、clippingを適用する。
- gate: 「トーンカーブ 2」のRGBカーブを適用した画像とPSDの保存済みcompositeを比較する。

### Phase 5 — 色管理

- RGB/8bitを基準経路として明示する。
- CMYK、Lab、16bit、32bitは色変換経路を分離する。
- 対応できない色空間は、読み込み失敗ではなく理由付きフォールバックにする。
- gate: colorMode/bitsPerChannel別の診断表示と、変換前後の色差確認。

## 検証方法

- 各PhaseでPSDの保存済みcompositeを基準画像として保持する。
- 表示切替、ラジオ切替、Undo/Redo、タブ切替、保存・再読込を確認する。
- 目視だけでなく、基準画像との差分率を記録する。
- Phaseのgateを満たすまで、次のPhaseの機能を有効化しない。

## 現在の着手点

Phase 0〜Phase 1の土台を実装中。ブレンドモード表を `src/compositor/blendMode.ts` へ分離し、`pass through` を親の合成先へ流す経路を追加した。複雑PSD向けフォールバックは、各Phaseのgateを通過するまで維持する。

Phase 2の基盤として、クリップ後に親の合成先へブレンドする順序、連続クリップの基底alpha、グループマスクの適用位置を実装した。`src/compositor/clipping.ts` に基底レイヤー判定とクリッピングランの判定を分離した。Phase 3の基盤として、通常マスク・グループマスクをPSDのグレースケール値からalphaへ正規化し、densityとfeatherを扱う `src/compositor/mask.ts` を追加した。Phase 4として、`curves`、`levels`、`brightness/contrast`調整レイヤーを共通の `src/compositor/adjustment.ts` で処理し、未知の調整レイヤーはフォールバックするようにした。Phase 5の前提として `src/compositor/color.ts` を追加し、RGB/8bit経路とそれ以外のフォールバック境界をPSDメタデータへ記録するようにした。まだ複雑PSDの実画像比較検証は未完了である。

次は、小さな合成テスト画像でPhase 2の基準画像を作り、花隈千冬のフォールバックを外した検証経路へ進む。
