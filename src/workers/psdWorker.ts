import { readPsd, initializeCanvas } from 'ag-psd';

initializeCanvas(
  (width: number, height: number) => new OffscreenCanvas(Math.max(1, width), Math.max(1, height)) as any,
  (width: number, height: number) => new ImageData(Math.max(1, width), Math.max(1, height)),
);

export interface WorkerRequest {
  id: number;
  buffer: ArrayBuffer;
}

export interface LayerThumbEntry {
  key: string;
  bitmap: ImageBitmap | null;
  left: number;
  top: number;
}

export interface WorkerResponse {
  id: number;
  psd: any;
  layers: LayerThumbEntry[];
  hasPending?: boolean;
  error?: string;
}

export interface WorkerDeferredResponse {
  kind: 'deferred';
  id: number;
  layers: LayerThumbEntry[];
  done: boolean;
}

// ── 定数 ──────────────────────────────────────────────────────────────────────

/**
 * この面積（px²）以下は即時・直列デコード。
 * それを超えるレイヤーは小さいものを先に送った後、直列で逐次送信する。
 */
const IMMEDIATE_THRESHOLD_PX = 512 * 512;

// ── ユーティリティ ────────────────────────────────────────────────────────────

const yieldControl = (): Promise<void> => new Promise(r => setTimeout(r, 0));

function removeCanvasDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof OffscreenCanvas) return undefined;
  if (obj instanceof ImageData) return undefined;
  if (obj instanceof ArrayBuffer) return obj;
  if (ArrayBuffer.isView(obj)) return undefined;
  if (Array.isArray(obj)) return obj.map(removeCanvasDeep);
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v instanceof OffscreenCanvas || v instanceof ImageData || ArrayBuffer.isView(v)) continue;
    out[k] = removeCanvasDeep(v);
  }
  return out;
}

/**
 * OffscreenCanvas → ImageBitmap。
 * transferToImageBitmap が使えればゼロコピー。失敗時は null。
 */
async function canvasToBitmap(canvas: OffscreenCanvas): Promise<ImageBitmap | null> {
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  try {
    if (typeof canvas.transferToImageBitmap === 'function') {
      return canvas.transferToImageBitmap();
    }
    return await createImageBitmap(canvas);
  } catch (err) {
    console.warn('[psdWorker] canvasToBitmap failed:', err);
    return null;
  }
}

// ── ツリー走査 ────────────────────────────────────────────────────────────────

interface RawEntry {
  key: string;
  canvas: OffscreenCanvas;
  left: number;
  top: number;
  px: number;
}

interface Collected {
  immediate: RawEntry[];   // ≤ IMMEDIATE_THRESHOLD_PX
  large: RawEntry[];       // > IMMEDIATE_THRESHOLD_PX（面積降順で後送）
  nullEntries: LayerThumbEntry[];
}

/**
 * レイヤーツリーを再帰走査してキャンバス参照を収集する（I/O なし・同期）。
 *
 * キー生成: [...parentPath, i].join('-')
 * attachThumbs の walk と完全一致。グループ自身はスキップ。
 */
function collectRaw(layers: any[], parentPath: number[], out: Collected): void {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const key  = [...parentPath, i].join('-');
    const left = typeof layer.left === 'number' ? layer.left : 0;
    const top  = typeof layer.top  === 'number' ? layer.top  : 0;

    if (layer.children && layer.children.length > 0) {
      collectRaw(layer.children, [...parentPath, i], out);
      continue;
    }

    const canvas = layer.canvas;
    if (canvas instanceof OffscreenCanvas && canvas.width > 0 && canvas.height > 0) {
      const px = canvas.width * canvas.height;
      if (px <= IMMEDIATE_THRESHOLD_PX) {
        out.immediate.push({ key, canvas, left, top, px });
      } else {
        out.large.push({ key, canvas, left, top, px });
      }
    } else {
      // テキスト・調整・空レイヤー等 → bitmap なし
      out.nullEntries.push({ key, bitmap: null, left, top });
    }
  }
}

// ── デコード（直列） ──────────────────────────────────────────────────────────

/**
 * エントリを 1 件ずつ直列でデコードする。
 * Promise.all による一斉実行は行わない。
 * GPU リソース競合によるサイレント失敗を防ぐため直列化が最重要。
 */
async function decodeSerial(entries: RawEntry[]): Promise<LayerThumbEntry[]> {
  const results: LayerThumbEntry[] = [];
  for (const e of entries) {
    const bitmap = await canvasToBitmap(e.canvas);
    results.push({ key: e.key, bitmap, left: e.left, top: e.top });
  }
  return results;
}

// ── メッセージハンドラ ────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer } = event.data;

  if (!buffer || buffer.byteLength === 0) {
    (self as any).postMessage({ id, psd: {}, layers: [], error: 'Empty buffer' });
    return;
  }

  try {
    // 1. PSD パース
    const psd = readPsd(new Uint8Array(buffer), {
      skipLayerImageData: false,
      skipCompositeImageData: true,
    });

    // 2. ツリー走査（同期）
    const collected: Collected = { immediate: [], large: [], nullEntries: [] };
    if (psd.children) collectRaw(psd.children, [], collected);

    // 3. 小さいレイヤーを直列デコード
    const immediateDecoded = await decodeSerial(collected.immediate);

    // null エントリと合わせて初回レスポンス
    const allImmediate: LayerThumbEntry[] = [
      ...immediateDecoded,
      ...collected.nullEntries,
    ];

    const safePsd    = removeCanvasDeep(psd);
    const hasPending = collected.large.length > 0;

    const immediateBitmaps = allImmediate
      .filter(e => e.bitmap != null)
      .map(e => e.bitmap as ImageBitmap);

    (self as any).postMessage(
      { id, psd: safePsd, layers: allImmediate, hasPending },
      immediateBitmaps,
    );

    if (!hasPending) return;

    // 4. 大きいレイヤーを面積降順（大→小）で 1 件ずつ直列デコードして送信
    //    1 件ごとに送信することで、メインスレッドが受け取り次第描画できる。
    //    バッチにまとめると GPU 競合が再発するため 1 件単位とする。
    const largeSorted = [...collected.large].sort((a, b) => b.px - a.px);

    for (let i = 0; i < largeSorted.length; i++) {
      const e    = largeSorted[i];
      const done = i === largeSorted.length - 1;

      // デコード前に yield してブラウザに制御を返す
      await yieldControl();

      const bitmap = await canvasToBitmap(e.canvas);

      // デコード後も yield
      await yieldControl();

      const entry: LayerThumbEntry = { key: e.key, bitmap, left: e.left, top: e.top };
      const bitmaps = bitmap != null ? [bitmap] : [];

      (self as any).postMessage(
        { kind: 'deferred', id, layers: [entry], done },
        bitmaps,
      );
    }

  } catch (err) {
    console.error('[psdWorker] fatal error:', err);
    (self as any).postMessage({ id, psd: {}, layers: [], error: String(err) });
  }
};