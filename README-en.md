# psdStudio

A desktop application specialized for viewing and editing PSD files.
Built with Tauri (Rust) + React + TypeScript.

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

| Category | Features |
|---|---|
| File Operations | Open, Save, Recent Files History |
| Preview | Zoom / Pan / Fit / Horizontal & Vertical Flip |
| Layers | Toggle Visibility, Rename, Add, Delete, Drag-and-Drop Reorder, Search |
| Layer Modes | Radio (Exclusive display) / Fixed (Locked) / Flip (Mirror variants) |
| Favorites | Layer state snapshot save, apply, reorder, PNG export |
| Tabs | Manage multiple PSDs in independent tabs, Drag-and-Drop reorder |
| Export | PNG / JPEG / WebP / SVG (Raster embedded) |
| Tools | Batch conversion / Individual layer export / PSD comparison (Diff) / Sprite sheet generation |
| Themes | Black / Grey / Light / White (OS sync option available) |
| Languages | Japanese / English (OS sync option available) |
| CLI | Headless mode conversion, batch processing, info extraction, etc. |

## Screenshots

![Screenshot](./docs/screenshot.png)

## Tech Stack

* **Frontend**: React 18 + TypeScript + Vite
* **Backend**: Tauri 2 (Rust)
* **PSD Parsing**: ag-psd (Processed within WebWorkers)
* **Image Processing**: image crate (Rust)
* **Parallel Processing**: Rayon (Rust)
* **File Watching**: notify (Rust)

## Installation

### Prerequisites

* Node.js 18+
* Rust (stable) + Cargo
* Tauri CLI v2

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf [https://sh.rustup.rs](https://sh.rustup.rs) | sh

# Install Tauri CLI
cargo install tauri-cli --version "^2"

# Install dependencies
npm install

```

## Development

```bash
# Start development server
npm run tauri dev

# Build
npm run tauri build

```

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + O` | Open File |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` / `Ctrl + Shift + Z` | Redo |
| `Ctrl + C` | Copy Canvas to Clipboard |
| `Ctrl + +` | Zoom In |
| `Ctrl + -` | Zoom Out |
| `Ctrl + 0` | Center Canvas |
| `Ctrl + T` | New Tab |
| `Ctrl + W` | Close Tab |
| `Ctrl + Tab` | Next Tab |
| `Ctrl + Shift + Tab` | Previous Tab |
| `Ctrl + ,` | Open Settings |
| `F11` | Toggle Fullscreen |

### CLI Mode

```bash
# Open file in GUI
psdStudio design.psd

# PSD to PNG conversion
psdStudio convert design.psd output.png

# Batch conversion
psdStudio batch "assets/*.psd" -o ./out -f webp -v

# Get metadata
psdStudio info design.psd
psdStudio info design.psd -o meta.json

# Generate thumbnail
psdStudio thumbnail design.psd thumb.png -s 256

# Layer operations
psdStudio layers design.psd --list
psdStudio layers design.psd --show "Background" -o result.png

# Export individual layers
psdStudio export-layers design.psd -o ./layers -f png

# PSD Comparison (Generate Diff image)
psdStudio compare v1.psd v2.psd -o diff.png --highlight heat

# Generate sprite sheet
psdStudio sprite "frames/*.psd" --layout grid --cols 8 -o sheet.png

# Watch directory & auto-convert
psdStudio watch ./src -o ./dist -f png --debounce 300

```

### Layer Naming Conventions

Prefixes in layer names enable special behaviors.

| Prefix | Behavior |
| --- | --- |
| `*LayerName` | Radio Group — Only one layer in the same group is displayed at a time |
| `! LayerName` | Locked — Visibility state cannot be changed |

Flip Variants (When Flip Mode is active):

| Suffix | Behavior |
| --- | --- |
| `LayerName:flipx` | Displays this variant when flipped horizontally |
| `LayerName:flipy` | Displays this variant when flipped vertically |
| `LayerName:flipxy` | Displays this variant when flipped both ways |

## Security and Permissions

To allow users to seamlessly open and work with PSD files located anywhere in their local environment (such as additional drives D/E/G or deep directory structures), this application defines broad filesystem capabilities.

* **Access Scope**: Entire local drives and home directory
* **Configuration File**: `src-tauri/capabilities/default.json`
* **Reason**: Designed to enable smooth direct loading, saving, and batch operations for PSD files at arbitrary paths.

## Architecture

### Asynchronous PSD Parsing via WebWorker

PSD parsing is executed inside WebWorkers to avoid blocking the main UI thread. Layers smaller than 512×512px are transmitted immediately, while larger layers are delayed and sent in batches to maintain UI responsiveness.

### Independent Per-Tab State Management

Each tab independently maintains its zoom, flip state, scroll position, and closed group keys.

### ImageBitmap Lifecycle Management

`cleanupResources()` scans the Undo/Redo stacks and the current PSD, releasing unneeded `ImageBitmap` instances to effectively manage GPU memory.

## Known Limitations

* **SVG Export** embeds the canvas as a raster image (it does not perform vector conversion).
* **Tab state** resets upon restarting the application.
* **OS Settings Integration (Default App)** is currently Windows-only.
* Rendering performance during drag operations may slow down when handling hundreds of layers.

## Project Structure

```
psdStudio/
├── src/                      # Frontend (React/TypeScript)
│   ├── components/           # UI Components
│   ├── hooks/                # Custom Hooks
│   ├── workers/              # WebWorker
│   ├── utils/                # Utilities
│   └── types/                # Type Definitions
├── src-tauri/                # Backend (Rust/Tauri)
│   ├── src/
│   │   ├── lib.rs            # Tauri Initialization & CLI Dispatch
│   │   ├── gui.rs            # Tauri Commands
│   │   ├── cli.rs            # CLI Subcommands
│   │   ├── utils.rs          # PSD Loading & Image Conversion
│   │   └── models.rs         # Serialization Types
│   └── Cargo.toml
└── package.json

```

## License

MIT License - See [LICENSE](https://www.google.com/search?q=./LICENSE) for details.

## Contributing

Issues and Pull Requests are welcome!

## Author

* **Magcup-c** - [GitHub](https://www.google.com/search?q=https://github.com/Magcup-c)