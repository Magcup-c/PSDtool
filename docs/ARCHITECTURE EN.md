\# psdStudio



A desktop application specifically designed for viewing and editing PSD files.  

Built with Tauri (Rust) + React + TypeScript.



\---



\## Features



| Category | Description |

|---|---|

| File Operations | Open/Save PSD files, Recent file history |

| Preview | Zoom / Pan / Fit / Horizontal \& Vertical Flip |

| Layers | Toggle Visibility / Rename / Add / Delete / Drag to Reorder / Search |

| Layer Modes | Radio (Exclusive display) / Fixed (Locked) / Flip (Mirror variant) |

| Favorites | Layer state snapshot saving, applying, reordering, and PNG export |

| Tabs | Manage multiple PSD files in independent tabs, Drag to reorder |

| Export | PNG / JPEG / WebP / SVG (Raster embedded) |

| Tools | Batch Conversion / Export Individual Layers / PSD Comparison (Diff) / Sprite Sheet |

| Themes | Black / Grey / Light / White (Includes OS integration option) |

| Languages | Japanese / English (Includes OS integration option) |

| CLI | Headless conversion, batch processing, metadata extraction, etc. |



\---



\## Tech Stack



```

Frontend    : React 18 + TypeScript + Vite

Backend     : Tauri 2 (Rust)

PSD Parsing : ag-psd (Processed within WebWorker)

Image Proc  : image crate (Rust)

Parallelism : Rayon (Rust)

File Watch  : notify (Rust)

```



\---



\## Directory Structure



```

psdStudio/

├── src/

│   ├── PsdEditor.tsx          # Main component

│   ├── PsdEditor.css          # Design tokens \& all styles

│   ├── components/

│   │   ├── editor/            # EditorHeader, LayerPanel, PreviewArea, etc.

│   │   ├── tools/             # BatchModal, ExportLayersModal, etc.

│   │   ├── TabBar.tsx

│   │   ├── SettingsModal.tsx

│   │   └── ...

│   ├── hooks/

│   │   ├── usePsdHistory.ts   # Undo/Redo \& ImageBitmap management

│   │   ├── usePsdWorker.ts    # WebWorker communication

│   │   ├── usePsdLoader.ts    # File loading \& tab sync

│   │   ├── useTabManager.ts   # Tab state management

│   │   ├── useZoomPan.ts      # Zoom, pan, and scroll

│   │   ├── useSettings.ts     # Settings persistence

│   │   ├── useLayerFavorites.ts

│   │   └── ...

│   ├── workers/

│   │   └── psdWorker.ts       # PSD parsing WebWorker

│   ├── utils/

│   │   ├── psdUtils.ts        # ImageBitmap injection \& tree ops

│   │   └── psdTreeOps.ts      # Layer reordering (Immutable)

│   └── types/index.ts

└── src-tauri/

&#x20;   ├── src/

&#x20;   │   ├── lib.rs             # Tauri initialization \& CLI dispatch

&#x20;   │   ├── gui.rs             # Tauri commands (invoke)

&#x20;   │   ├── cli.rs             # CLI subcommands implementation

&#x20;   │   ├── utils.rs           # PSD reading \& image conversion

&#x20;   │   └── models.rs          # Serialized models

&#x20;   └── Cargo.toml

```



\---



\## Development Setup



\### Prerequisites



\- Node.js 18+

\- Rust (stable) + Cargo

\- Tauri CLI v2



```bash

\# Install Rust

curl --proto '=https' --tlsv1.2 -sSf \[https://sh.rustup.rs](https://sh.rustup.rs) | sh



\# Install Tauri CLI

cargo install tauri-cli --version "^2"



\# Install dependencies

npm install

```



\### Start Development Server



```bash

npm run tauri dev

```



\### Build



```bash

npm run tauri build

```



\---



\## Keyboard Shortcuts



| Shortcut | Action |

|---|---|

| `Ctrl + O` | Open file |

| `Ctrl + Z` | Undo |

| `Ctrl + Y` / `Ctrl + Shift + Z` | Redo |

| `Ctrl + C` | Copy canvas to clipboard |

| `Ctrl + +` | Zoom In |

| `Ctrl + -` | Zoom Out |

| `Ctrl + 0` | Fit to center |

| `Ctrl + T` | New tab |

| `Ctrl + W` | Close tab |

| `Ctrl + Tab` | Next tab |

| `Ctrl + Shift + Tab` | Previous tab |

| `Ctrl + ,` | Open Settings |

| `F11` | Toggle Fullscreen |



Preview Area Operations:



| Action | Description |

|---|---|

| Mouse Drag / Middle-click Drag | Pan (Scroll) |

| `Ctrl + Wheel` | Zoom (Centered on cursor) |

| Mouse Wheel (Based on settings) | Pan or Zoom |

| Trackpad Pinch | Zoom |



\---



\## CLI Mode



```bash

\# Open file in GUI

psdStudio design.psd



\# PSD to PNG conversion

psdStudio convert design.psd output.png



\# Batch conversion

psdStudio batch "assets/\*.psd" -o ./out -f webp -v



\# Extract metadata

psdStudio info design.psd

psdStudio info design.psd -o meta.json



\# Generate thumbnail

psdStudio thumbnail design.psd thumb.png -s 256



\# Layer operations

psdStudio layers design.psd --list

psdStudio layers design.psd --show "Background" -o result.png



\# Export individual layers

psdStudio export-layers design.psd -o ./layers -f png



\# PSD Comparison (Generate Diff image)

psdStudio compare v1.psd v2.psd -o diff.png --highlight heat



\# Generate Sprite Sheet

psdStudio sprite "frames/\*.psd" --layout grid --cols 8 -o sheet.png



\# Directory Watch \& Auto Conversion

psdStudio watch ./src -o ./dist -f png --debounce 300

```



\---



\## Layer Naming Conventions



Prefixing layer names enables special behaviors when Radio or Fixed modes are active.



| Prefix | Behavior |

|---|---|

| `\*LayerName` | Radio Group — Only one layer in the same group is visible at a time |

| `!LayerName` | Locked — Visibility status cannot be changed |



Flip Variants (When Flip mode is active):



| Suffix | Behavior |

|---|---|

| `LayerName:flipx` | Displayed when flipped horizontally |

| `LayerName:flipy` | Displayed when flipped vertically |

| `LayerName:flipxy` | Displayed when flipped both horizontally and vertically |



\---



\## Architecture Highlights



\### Asynchronous PSD Parsing via WebWorker



PSD parsing is executed inside `psdWorker.ts` to prevent blocking the main thread.  

Layers up to 512×512px are sent immediately, while larger layers are sent in delayed batches to keep the UI responsive.



```

File Load

&#x20;   ↓

WebWorker (psdWorker.ts)

&#x20;   ├─ Small layers → Immediate ImageBitmap transfer

&#x20;   └─ Large layers → Delayed batch transfer (DEFERRED\_BATCH\_SIZE=8)

&#x20;   ↓

Received by usePsdWorker.ts

&#x20;   ↓

Injected into PSD tree via attachThumbs() (Immutable)

&#x20;   ↓

React Re-render

```



\### Independent Tab State Management



Each tab maintains its own zoom, flip, scroll position, and collapsed group keys.  

When switching tabs, `useTabSync.ts` saves and restores the active state. Tab states persist within the current session only (reset on restart).



\### ImageBitmap Lifecycle Management



The `cleanupResources()` function in `usePsdHistory.ts` traverses the Undo/Redo stack as well as the current PSD tree to call `close()` on any unreferenced `ImageBitmap` instances, freeing up GPU memory.



\### Tauri Commands (invoke)



| Command | Functionality |

|---|---|

| `run\_batch` | Parallel batch conversion via Rayon |

| `run\_export\_layers` | Export individual layers |

| `run\_compare` | Generate difference image |

| `run\_sprite` | Generate sprite sheets |

| `parse\_psd\_metadata` | Get metadata JSON |

| `open\_default\_app\_settings` | Open OS default app settings (Windows) |



\---



\## Known Limitations \& Notes



\- \*\*SVG Export\*\* embeds the canvas as a raster image; it does not convert elements to native vectors.

\- \*\*Tab State\*\* resets upon restarting the application (File paths can be recovered from the recent file history).

\- \*\*Disabled Virtual Scrolling During Dragging\*\*: The layer list renders all rows while dragging, which may cause performance lag if a document contains hundreds of layers or more.

\- \*\*OS Default App Association Settings\*\* is currently exclusive to Windows.



\---



\## Known Risks \& Mitigation



\### Memory Management

\- `ImageBitmap` instances are retained within the Undo stack, meaning repetitive edits on large PSDs can increase memory usage. The Undo stack limit is set to 50 entries.

\- Closing a tab releases associated `ImageBitmap` instances during the subsequent run of `cleanupResources()`.



\### Deferred Bitmaps \& Tab Race Conditions

\- If a tab is closed while a PSD is loading, generation tracking (`loadGenByTabRef`) discards older load results. Should a resolved deferred bitmap arrive late, it is safely skipped via the `tabsRef` check inside the `onDeferred` callback if the target tab no longer exists.



\### Layer Drag Cleanup

\- A double call occurs as `layerDragCleanupRef.current()` is triggered by both `cleanupDrag()` and `onMouseUp`. However, this causes no issue due to the idempotency of `removeEventListener`.



\---



\## License



MIT

