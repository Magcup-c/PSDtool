# psdStudio

PSDファイルの閲覧・編集に特化したデスクトップアプリケーション。  
Tauri (Rust) + React + TypeScript 製。

---

## 機能一覧

| カテゴリ | 機能 |
|---|---|
| ファイル操作 | PSDを開く・保存・最近使ったファイル履歴 |
| プレビュー | ズーム / パン / フィット / 水平・垂直フリップ |
| レイヤー | 表示切替・リネーム・追加・削除・ドラッグ並び替え・検索 |
| レイヤーモード | Radio（排他表示）/ Fixed（ロック）/ Flip（ミラーバリアント） |
| お気に入り | レイヤー状態スナップショット保存・適用・並び替え・PNG書き出し |
| タブ | 複数PSDを独立したタブで管理・ドラッグ並び替え |
| 書き出し | PNG / JPEG / WebP / SVG（ラスター埋め込み） |
| Tools | Batch変換 / レイヤー個別Export / PSD比較(Diff) / スプライトシート |
| テーマ | Black / Grey / Light / White（OS連動オプションあり） |
| 言語 | 日本語 / English（OS連動オプションあり） |
| CLI | ヘッドレスモードでの変換・バッチ・情報抽出など |

---

## 技術スタック

```
フロントエンド : React 18 + TypeScript + Vite
バックエンド   : Tauri 2 (Rust)
PSD解析        : ag-psd (WebWorker内で処理)
画像処理       : image crate (Rust)
並列処理       : Rayon (Rust)
ファイル監視   : notify (Rust)
```

---

## ディレクトリ構成

```
psdStudio/
├── src/
│   ├── PsdEditor.tsx          # メインコンポーネント
│   ├── PsdEditor.css          # デザイントークン・全スタイル
│   ├── components/
│   │   ├── editor/            # EditorHeader, LayerPanel, PreviewArea など
│   │   ├── tools/             # BatchModal, ExportLayersModal など
│   │   ├── TabBar.tsx
│   │   ├── SettingsModal.tsx
│   │   └── ...
│   ├── hooks/
│   │   ├── usePsdHistory.ts   # Undo/Redo・ImageBitmap管理
│   │   ├── usePsdWorker.ts    # WebWorker通信
│   │   ├── usePsdLoader.ts    # ファイル読み込み・タブ連携
│   │   ├── useTabManager.ts   # タブ状態管理
│   │   ├── useZoomPan.ts      # ズーム・パン・スクロール
│   │   ├── useSettings.ts     # 設定永続化
│   │   ├── useLayerFavorites.ts
│   │   └── ...
│   ├── workers/
│   │   └── psdWorker.ts       # PSD解析WebWorker
│   ├── utils/
│   │   ├── psdUtils.ts        # ImageBitmap注入・ツリー操作
│   │   └── psdTreeOps.ts      # レイヤー移動（イミュータブル）
│   └── types/index.ts
└── src-tauri/
    ├── src/
    │   ├── lib.rs             # Tauri初期化・CLIディスパッチ
    │   ├── gui.rs             # Tauriコマンド（invoke）
    │   ├── cli.rs             # CLIサブコマンド実装
    │   ├── utils.rs           # PSD読み込み・画像変換
    │   └── models.rs          # シリアライズ型
    └── Cargo.toml
```

---

## 開発環境のセットアップ

### 必要なツール

- Node.js 18+
- Rust (stable) + Cargo
- Tauri CLI v2

```bash
# Rustのインストール
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLIのインストール
cargo install tauri-cli --version "^2"

# 依存関係のインストール
npm install
```

### 開発サーバー起動

```bash
npm run tauri dev
```

### ビルド

```bash
npm run tauri build
```

---

## キーボードショートカット

| ショートカット | 動作 |
|---|---|
| `Ctrl + O` | ファイルを開く |
| `Ctrl + S` | PSDを保存 |
| `Ctrl + Z` | 元に戻す |
| `Ctrl + Y` / `Ctrl + Shift + Z` | やり直し |
| `Ctrl + C` | キャンバスをクリップボードにコピー |
| `Ctrl + +` | ズームイン |
| `Ctrl + -` | ズームアウト |
| `Ctrl + 0` | 中央に移動 |
| `Ctrl + T` | 新しいタブ |
| `Ctrl + W` | タブを閉じる |
| `Ctrl + Tab` | 次のタブ |
| `Ctrl + Shift + Tab` | 前のタブ |
| `Ctrl + ,` | 設定を開く |
| `F11` | 全画面切替 |

プレビューエリアでの操作:

| 操作 | 動作 |
|---|---|
| マウスドラッグ / 中クリックドラッグ | パン（スクロール） |
| `Ctrl + ホイール` | ズーム（カーソル基準） |
| ホイール（設定による） | パン または ズーム |
| トラックパッドピンチ | ズーム |

---

## CLIモード

```bash
# GUIでファイルを開く
psdStudio design.psd

# PSD → PNG変換
psdStudio convert design.psd output.png

# バッチ変換
psdStudio batch "assets/*.psd" -o ./out -f webp -v

# メタデータ取得
psdStudio info design.psd
psdStudio info design.psd -o meta.json

# サムネイル生成
psdStudio thumbnail design.psd thumb.png -s 256

# レイヤー操作
psdStudio layers design.psd --list
psdStudio layers design.psd --show "Background" -o result.png

# レイヤー個別Export
psdStudio export-layers design.psd -o ./layers -f png

# PSD比較（Diff画像生成）
psdStudio compare v1.psd v2.psd -o diff.png --highlight heat

# スプライトシート生成
psdStudio sprite "frames/*.psd" --layout grid --cols 8 -o sheet.png

# ディレクトリ監視・自動変換
psdStudio watch ./src -o ./dist -f png --debounce 300
```

---

## レイヤー命名規則

レイヤー名のプレフィックスによって特殊な動作が有効になります（Radioモード/Fixedモード有効時）。

| プレフィックス | 動作 |
|---|---|
| `*レイヤー名` | Radioグループ — 同じグループで1枚だけ表示 |
| `!レイヤー名` | ロック — 表示状態を変更不可 |

フリップバリアント（Flipモード有効時）:

| サフィックス | 動作 |
|---|---|
| `レイヤー名:flipx` | 水平フリップ時にこのバリアントを表示 |
| `レイヤー名:flipy` | 垂直フリップ時に表示 |
| `レイヤー名:flipxy` | 両方フリップ時に表示 |

---

## アーキテクチャのポイント

### WebWorkerによる非同期PSD解析

PSD解析はメインスレッドをブロックしないよう `psdWorker.ts` で実行されます。  
512×512px以下のレイヤーは即時送信、大きなレイヤーはバッチで遅延送信することでUIの応答性を維持します。

```
ファイル読み込み
    ↓
WebWorker (psdWorker.ts)
    ├─ 小レイヤー → 即時 ImageBitmap 送信
    └─ 大レイヤー → バッチで遅延送信 (DEFERRED_BATCH_SIZE=8)
    ↓
usePsdWorker.ts が受信
    ↓
attachThumbs() でPSDツリーに注入（イミュータブル）
    ↓
React再レンダリング
```

### タブごとの独立した状態管理

各タブはズーム・フリップ・スクロール位置・閉じたグループキーをそれぞれ保持します。  
タブ切替時に現在の状態を `useTabSync.ts` が保存・復元します。タブ状態はセッション内のみ保持（再起動で初期化）。

### ImageBitmapのライフサイクル管理

`usePsdHistory.ts` 内の `cleanupResources()` が Undo/Redoスタックと現在のPSDを走査し、  
どこからも参照されなくなった `ImageBitmap` を `close()` してGPUメモリを解放します。

### Tauriコマンド（invoke）

| コマンド | 機能 |
|---|---|
| `run_batch` | Rayon並列バッチ変換 |
| `run_export_layers` | レイヤー個別Export |
| `run_compare` | 差分画像生成 |
| `run_sprite` | スプライトシート生成 |
| `parse_psd_metadata` | メタデータJSON取得 |
| `open_default_app_settings` | OS設定画面を開く（Windows） |

---

## 既知の注意点・制限

- **SVGエクスポート** はキャンバスをラスター画像として埋め込みます。ベクター変換ではありません。
- **タブ状態** はアプリ再起動後にリセットされます（ファイルパスは最近使ったファイル履歴から復元可能）。
- **ドラッグ中の仮想スクロール無効化**: レイヤーリストはドラッグ中に全行を描画するため、レイヤー数が非常に多い（数百以上）場合に描画が重くなる可能性があります。
- **OS設定連携（デフォルトアプリ）** は現在Windows専用です。

---

## 既知のリスクと対処

### メモリ管理
- ImageBitmapはUndoスタック内でも保持されるため、大きなPSDを繰り返し編集するとメモリ使用量が増加します。Undoスタックの上限は50件です。
- タブを閉じると、そのタブのPSDに紐づくImageBitmapは `cleanupResources()` の次回実行時に解放されます。

### 遅延ビットマップとタブの競合
- PSD読み込み中にタブを閉じた場合、世代管理（`loadGenByTabRef`）により古いロード結果は破棄されます。ただし既に resolve 済みの遅延ビットマップが届いた場合、対象タブが存在しなければ `onDeferred` コールバック内の `tabsRef` 参照で安全にスキップされます。

### レイヤードラッグのクリーンアップ
- `cleanupDrag()` と `onMouseUp` の両方から `layerDragCleanupRef.current()` が呼ばれる二重呼び出しが発生しますが、`removeEventListener` の冪等性により実害はありません。

---

## ライセンス

MIT
