pub const VERSION: &str = "0.1.0";
pub const BIN: &str = "psdStudio";

/// Prints the top-level help message and exits with code 0.
pub fn print_help() -> ! {
    println!(
r#"psdStudio v{VERSION}  —  PSD viewer & headless processing tool

USAGE:
    {BIN} [OPTIONS]
    {BIN} <COMMAND> [ARGS...]
    {BIN} <file.psd>              Open a PSD file in the GUI editor

OPTIONS:
    -h, --help       Show this help message
    -V, --version    Show version information

COMMANDS:
    convert          Convert a single PSD → image file
    batch            Batch-convert PSD files matching a glob pattern
    info             Extract PSD metadata as JSON
    thumbnail        Generate a thumbnail from a PSD file
    layers           List or manipulate layer visibility
    export-layers    Export each layer as an individual image file
    compare          Generate a diff image highlighting changes between two PSDs
    sprite           Combine multiple PSDs into a single sprite sheet
    watch            Watch a directory and auto-convert PSD files on save

Run '{BIN} <COMMAND> --help' for detailed usage of each command.

EXAMPLES:
    {BIN} design.psd
    {BIN} convert design.psd output.png
    {BIN} batch "assets/*.psd" -o ./out -f webp
    {BIN} info design.psd
    {BIN} watch ./src -o ./out -f png"#
    );
    std::process::exit(0);
}

pub fn print_version() -> ! {
    println!("{BIN} {VERSION}");
    std::process::exit(0);
}

// ── Per-command help ─────────────────────────────────────────

pub fn help_convert() -> ! {
    println!(
r#"psdStudio convert — Convert a single PSD file to an image

USAGE:
    {BIN} convert <INPUT> <OUTPUT>

ARGS:
    <INPUT>     Path to the source .psd file
    <OUTPUT>    Path to the output image file

OPTIONS:
    -h, --help  Show this help message

OUTPUT FORMAT is inferred from the file extension:
    .png          PNG  (lossless, alpha supported)
    .jpg / .jpeg  JPEG (lossy, no alpha)
    .webp         WebP (lossy, alpha supported)

EXAMPLES:
    {BIN} convert design.psd output.png
    {BIN} convert design.psd preview.jpg
    {BIN} convert design.psd compressed.webp"#
    );
    std::process::exit(0);
}

pub fn help_batch() -> ! {
    println!(
r#"psdStudio batch — Batch-convert PSD files matching a glob pattern

USAGE:
    {BIN} batch <PATTERN> [OPTIONS]

ARGS:
    <PATTERN>    Glob pattern for PSD files (e.g. "assets/*.psd")
                 Quote the pattern to prevent shell expansion.

OPTIONS:
    -o, --output <DIR>     Output directory  [default: ./output]
    -f, --format <FMT>     Output format: png | jpeg | webp  [default: png]
    -v, --verbose          Print each converted file path
    -h, --help             Show this help message

EXAMPLES:
    {BIN} batch "*.psd"
    {BIN} batch "src/**/*.psd" -o ./dist -f webp -v
    {BIN} batch "sprites/*.psd" -o ./out -f jpeg"#
    );
    std::process::exit(0);
}

pub fn help_info() -> ! {
    println!(
r#"psdStudio info — Extract metadata from a PSD file as JSON

USAGE:
    {BIN} info <INPUT> [OPTIONS]

ARGS:
    <INPUT>    Path to the source .psd file

OPTIONS:
    -o, --output <FILE>    Write JSON to a file instead of stdout
    -p, --pretty           Pretty-print JSON output  [default: on]
    -h, --help             Show this help message

OUTPUT FIELDS:
    file, width, height, layer_count, layers[]
      layers[]: name, visible, left, top, right, bottom, width, height

EXAMPLES:
    {BIN} info design.psd
    {BIN} info design.psd -o meta.json
    {BIN} info design.psd | jq '.layer_count'"#
    );
    std::process::exit(0);
}

pub fn help_thumbnail() -> ! {
    println!(
r#"psdStudio thumbnail — Generate a thumbnail from a PSD file

USAGE:
    {BIN} thumbnail <INPUT> <OUTPUT> [OPTIONS]

ARGS:
    <INPUT>     Path to the source .psd file
    <OUTPUT>    Path to the output thumbnail file (.png or .jpg)

OPTIONS:
    -s, --size <PX>    Max width/height in pixels (aspect preserved)  [default: 256]
    -h, --help         Show this help message

EXAMPLES:
    {BIN} thumbnail design.psd thumb.png
    {BIN} thumbnail design.psd thumb.jpg -s 128
    {BIN} thumbnail design.psd preview.png -s 512"#
    );
    std::process::exit(0);
}

pub fn help_layers() -> ! {
    println!(
r#"psdStudio layers — List or manipulate layer visibility in a PSD

USAGE:
    {BIN} layers <INPUT> [OPTIONS]

ARGS:
    <INPUT>    Path to the source .psd file

OPTIONS:
    -l, --list              List all layers and exit (no output written)
    --show <NAMES>          Comma-separated layer name patterns to show
    --hide <NAMES>          Comma-separated layer name patterns to hide
    -o, --output <FILE>     Output PNG file path  [default: output.png]
    -h, --help              Show this help message

NOTES:
    Name matching is case-insensitive substring search.
    --show / --hide can be combined.

EXAMPLES:
    {BIN} layers design.psd --list
    {BIN} layers design.psd --show "Background,Shadow" -o visible.png
    {BIN} layers design.psd --hide "Draft" --show "Final" -o result.png"#
    );
    std::process::exit(0);
}

pub fn help_export_layers() -> ! {
    println!(
r#"psdStudio export-layers — Export each layer as an individual image file

USAGE:
    {BIN} export-layers <INPUT> [OPTIONS]

ARGS:
    <INPUT>    Path to the source .psd file

OPTIONS:
    -o, --output <DIR>     Output directory  [default: ./layers]
    -f, --format <FMT>     Output format: png | jpeg | webp  [default: png]
    --visible-only         Skip hidden layers
    --flatten              Flatten group layers before export
    -h, --help             Show this help message

NOTES:
    Output filenames are derived from layer names.
    Special characters are replaced with underscores.
    Duplicate names get a numeric suffix (_1, _2, …).

EXAMPLES:
    {BIN} export-layers design.psd
    {BIN} export-layers design.psd -o ./parts -f webp
    {BIN} export-layers design.psd --visible-only -o ./export"#
    );
    std::process::exit(0);
}

pub fn help_compare() -> ! {
    println!(
r#"psdStudio compare — Diff two PSD files and generate a highlight image

USAGE:
    {BIN} compare <INPUT_A> <INPUT_B> [OPTIONS]

ARGS:
    <INPUT_A>    Path to the first .psd file
    <INPUT_B>    Path to the second .psd file

OPTIONS:
    -o, --output <FILE>       Output diff image path  [default: diff.png]
    -t, --threshold <0-255>   Pixel delta to count as changed  [default: 10]
    --highlight <MODE>        Highlight color mode  [default: red]
                              red | magenta | heat
    -h, --help                Show this help message

HIGHLIGHT MODES:
    red       Changed pixels → solid red
    magenta   Changed pixels → solid magenta
    heat      Changed pixels → gradient from yellow (low) to red (high)

EXAMPLES:
    {BIN} compare v1.psd v2.psd
    {BIN} compare v1.psd v2.psd -o changes.png -t 5
    {BIN} compare v1.psd v2.psd --highlight heat -o heatmap.png"#
    );
    std::process::exit(0);
}

pub fn help_sprite() -> ! {
    println!(
r#"psdStudio sprite — Combine multiple PSDs into a single sprite sheet

USAGE:
    {BIN} sprite <PATTERN> [OPTIONS]

ARGS:
    <PATTERN>    Glob pattern for PSD files (e.g. "frames/*.psd")
                 Files are sorted alphabetically before packing.

OPTIONS:
    -o, --output <FILE>     Output sprite sheet path  [default: sprite.png]
    --layout <MODE>         Packing layout  [default: horizontal]
                            horizontal | vertical | grid
    --cols <N>              Columns for grid layout  [default: 4]
    --padding <PX>          Padding between sprites in pixels  [default: 4]
    -f, --format <FMT>      Output format: png | jpeg | webp  [default: png]
    --json <FILE>           Write a JSON frame map to this file
    -h, --help              Show this help message

JSON MAP FIELDS (per frame):
    name, x, y, width, height

EXAMPLES:
    {BIN} sprite "frames/*.psd" -o sheet.png
    {BIN} sprite "icons/*.psd" --layout grid --cols 8 --padding 2
    {BIN} sprite "frames/*.psd" -o sheet.png --json frames.json
    {BIN} sprite "assets/*.psd" --layout vertical -f webp -o sheet.webp"#
    );
    std::process::exit(0);
}

pub fn help_watch() -> ! {
    println!(
r#"psdStudio watch — Watch a directory and auto-convert PSD files on save

USAGE:
    {BIN} watch [DIR] [OPTIONS]

ARGS:
    [DIR]    Directory to watch recursively  [default: current directory]

OPTIONS:
    -o, --output <DIR>       Output directory for converted files  [default: ./output]
    -f, --format <FMT>       Output format: png | jpeg | webp  [default: png]
    --debounce <MS>          Debounce delay in milliseconds  [default: 300]
    -h, --help               Show this help message

NOTES:
    Press Ctrl+C to stop watching.
    Output filenames mirror the input PSD stem (e.g. design.psd → design.png).
    Multiple rapid saves are coalesced using the debounce window.

EXAMPLES:
    {BIN} watch
    {BIN} watch ./src -o ./dist -f webp
    {BIN} watch ./assets -o ./out --debounce 500"#
    );
    std::process::exit(0);
}

// ── Argument helpers ─────────────────────────────────────────

/// Returns true if any arg in `args` is `-h` or `--help`.
pub fn wants_help(args: &[String]) -> bool {
    args.iter().any(|a| a == "-h" || a == "--help")
}
