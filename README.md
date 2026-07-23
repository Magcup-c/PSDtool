# psdStudio

PSD ファイルの閲覧・編集に特化したデスクトップアプリケーション。
Tauri (Rust) + React + TypeScript 製。

!\[Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
!\[License](https://img.shields.io/badge/license-MIT-green.svg)

## 機能一覧

|カテゴリ|機能|
|-|-|
|ファイル操作|PSD を開く・保存・最近使ったファイル履歴|
|プレビュー|ズーム / パン / フィット / 水平・垂直フリップ|
|レイヤー|表示切替・リネーム・追加・削除・ドラッグ並び替え・検索|
|レイヤーモード|Radio（排他表示）/ Fixed（ロック）/ Flip（ミラーバリアント）|
|お気に入り|レイヤー状態スナップショット保存・適用・並び替え・PNG 書き出し|
|タブ|複数 PSD を独立したタブで管理・ドラッグ並び替え|
|書き出し|PNG / JPEG / WebP / SVG（ラスター埋め込み）|
|Tools|Batch 変換 / レイヤー個別 Export / PSD 比較 (Diff) / スプライトシート|
|テーマ|Black / Grey / Light / White（OS 連動オプションあり）|
|言語|日本語 / English（OS 連動オプションあり）|
|CLI|ヘッドレスモードでの変換・バッチ・情報抽出など|

## スクリーンショット

!\[Screenshot](./docs/screenshot.png)

## 技術スタック

* **フロントエンド**: React 18 + TypeScript + Vite
* **バックエンド**: Tauri 2 (Rust)
* **PSD 解析**: ag-psd (WebWorker 内で処理)
* **画像処理**: image crate (Rust)
* **並列処理**: Rayon (Rust)
* **ファイル監視**: notify (Rust)

## インストール

### 必要なツール

* Node.js 18+
* Rust (stable) + Cargo
* Tauri CLI v2

```bash
# Rust のインストール
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLI のインストール
cargo install tauri-cli --version "^2"

# 依存関係のインストール
npm install
```

## 開発

```bash
# 開発サーバー起動
npm run tauri dev

# ビルド
npm run tauri build
```

## 使い方

### キーボードショートカット

|ショートカット|動作|
|-|-|
|`Ctrl + O`|ファイルを開く|
|`Ctrl + Z`|元に戻す|
|`Ctrl + Y` / `Ctrl + Shift + Z`|やり直し|
|`Ctrl + C`|キャンバスをクリップボードにコピー|
|`Ctrl + +`|ズームイン|
|`Ctrl + -`|ズームアウト|
|`Ctrl + 0`|中央に移動|
|`Ctrl + T`|新しいタブ|
|`Ctrl + W`|タブを閉じる|
|`Ctrl + Tab`|次のタブ|
|`Ctrl + Shift + Tab`|前のタブ|
|`Ctrl + ,`|設定を開く|
|`F11`|全画面切替|

### CLI モード

```bash
# GUI でファイルを開く
psdStudio design.psd

# PSD → PNG 変換
psdStudio convert design.psd output.png

# バッチ変換
psdStudio batch "assets/\*.psd" -o ./out -f webp -v

# メタデータ取得
psdStudio info design.psd
psdStudio info design.psd -o meta.json

# サムネイル生成
psdStudio thumbnail design.psd thumb.png -s 256

# レイヤー操作
psdStudio layers design.psd --list
psdStudio layers design.psd --show "Background" -o result.png

# レイヤー個別 Export
psdStudio export-layers design.psd -o ./layers -f png

# PSD 比較（Diff 画像生成）
psdStudio compare v1.psd v2.psd -o diff.png --highlight heat

# スプライトシート生成
psdStudio sprite "frames/\*.psd" --layout grid --cols 8 -o sheet.png

# ディレクトリ監視・自動変換
psdStudio watch ./src -o ./dist -f png --debounce 300
```

### レイヤー命名規則

レイヤー名のプレフィックスによって特殊な動作が有効になります。

|プレフィックス|動作|
|-|-|
|`\*レイヤー名`|Radio グループ — 同じグループで 1 枚だけ表示|
|`! レイヤー名`|ロック — 表示状態を変更不可|

フリップバリアント（Flip モード有効時）:

|サフィックス|動作|
|-|-|
|`レイヤー名:flipx`|水平フリップ時にこのバリアントを表示|
|`レイヤー名:flipy`|垂直フリップ時に表示|
|`レイヤー名:flipxy`|両方フリップ時に表示|

## アーキテクチャ

### WebWorker による非同期 PSD 解析

PSD 解析はメインスレッドをブロックしないよう WebWorker で実行されます。512×512px 以下のレイヤーは即時送信、大きなレイヤーはバッチで遅延送信することで UI の応答性を維持します。

### タブごとの独立した状態管理

各タブはズーム・フリップ・スクロール位置・閉じたグループキーをそれぞれ保持します。

### ImageBitmap のライフサイクル管理

`cleanupResources()` が Undo/Redo スタックと現在の PSD を走査し、不要になった `ImageBitmap` を解放して GPU メモリを管理します。

## 既知の制限

* **SVG エクスポート** はキャンバスをラスター画像として埋め込みます（ベクター変換ではありません）
* **タブ状態** はアプリ再起動後にリセットされます
* **OS 設定連携（デフォルトアプリ）** は現在 Windows 専用です
* 数百以上のレイヤーがある場合、ドラッグ中の描画が重くなる可能性があります

## プロジェクト構造

```
psdStudio/
├── src/                      # フロントエンド (React/TypeScript)
│   ├── components/           # UI コンポーネント
│   ├── hooks/                # カスタムフック
│   ├── workers/              # WebWorker
│   ├── utils/                # ユーティリティ
│   └── types/                # 型定義
├── src-tauri/                # バックエンド (Rust/Tauri)
│   ├── src/
│   │   ├── lib.rs            # Tauri 初期化・CLI ディスパッチ
│   │   ├── gui.rs            # Tauri コマンド
│   │   ├── cli.rs            # CLI サブコマンド
│   │   ├── utils.rs          # PSD 読み込み・画像変換
│   │   └── models.rs         # シリアライズ型
│   └── Cargo.toml
└── package.json
```

## ライセンス

MIT License - [LICENSE](./LICENSE) を参照してください。

## 貢献

Issue や Pull Request を歓迎します！

## 作者

* **Magcup-c** - [GitHub](https://github.com/Magcup-c)



