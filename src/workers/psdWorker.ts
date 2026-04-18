import { readPsd, initializeCanvas } from 'ag-psd';

// ================================================================
// Worker 内での ag-psd 初期化
// 第1引数: createCanvas → OffscreenCanvas を返す
// 第2引数: createImageData → Worker 内の new ImageData() を返す
// ★ 両方渡さないと document.createElement / document.createImageData
//    が呼ばれ Worker 内でエラーになる
// ================================================================
initializeCanvas(
  (width: number, height: number) => new OffscreenCanvas(width, height) as any,
  (width: number, height: number) => new ImageData(width, height),
);

// ── 型定義 ────────────────────────────────────────────────────────

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

// ── 定数 ──────────────────────────────────────────────────────────

// 512x512 以下は即時転送、それ以上は遅延
const IMMEDIATE_THRESHOLD_PX = 512 * 512;
const DEFERRED_BATCH_SIZE = 6;

// ── OffscreenCanvas を postMessage 前に除去 ───────────────────────
// ag-psd は layer.canvas に OffscreenCanvas を格納するが
// OffscreenCanvas は Transferable ではないため structuredClone でエラーになる

function removeCanvasDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof OffscreenCanvas) return undefined;
  if (obj instanceof ImageData) return undefined;
  if (obj instanceof ArrayBuffer) return obj;
  if (ArrayBuffer.isView(obj)) return undefined; // TypedArray も除去
  if (Array.isArray(obj)) {
    return obj.map(removeCanvasDeep);
  }
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val instanceof OffscreenCanvas) continue;
    if (val instanceof ImageData) continue;
    if (ArrayBuffer.isView(val)) continue;
    result[key] = removeCanvasDeep(val);
  }
  return result;
}

// ── OffscreenCanvas → ImageBitmap 変換 ───────────────────────────

async function canvasToBitmap(canvas: OffscreenCanvas): Promise<ImageBitmap | null> {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  try {
    // OffscreenCanvas.transferToImageBitmap() が使えれば最速
    if (typeof canvas.transferToImageBitmap === 'function') {
      return canvas.transferToImageBitmap();
    }
    return await createImageBitmap(canvas);
  } catch (err) {
    console.warn('[psdWorker] canvasToBitmap failed:', err);
    return null;
  }
}

// ── レイヤーツリーを再帰走査して bitmap を収集 ────────────────────
// ag-psd の Layer 型:
//   .canvas?   : OffscreenCanvas  (描画データ、initializeCanvas後)
//   .children? : Layer[]
//   .left?     : number
//   .top?      : number
//   .name?     : string
//   .hidden?   : boolean

interface CollectResult {
  immediate: LayerThumbEntry[];
  deferred: Array<{ key: string; canvas: OffscreenCanvas; left: number; top: number }>;
}

async function collectLayerBitmaps(
  layers: any[],
  parentPath: number[] = [],
): Promise<CollectResult> {
  const immediate: LayerThumbEntry[] = [];
  const deferred: CollectResult['deferred'] = [];
  const tasks: Promise<void>[] = [];

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const key = [...parentPath, i].join('-');
    const left = typeof layer.left === 'number' ? layer.left : 0;
    const top  = typeof layer.top  === 'number' ? layer.top  : 0;

    if (layer.children && layer.children.length > 0) {
      // グループ: 自身は bitmap なし、子を再帰
      tasks.push(
        collectLayerBitmaps(layer.children, [...parentPath, i]).then(r => {
          immediate.push(...r.immediate);
          deferred.push(...r.deferred);
        })
      );
    } else if (layer.canvas && layer.canvas instanceof OffscreenCanvas) {
      const canvas = layer.canvas as OffscreenCanvas;
      const px = canvas.width * canvas.height;

      if (px <= IMMEDIATE_THRESHOLD_PX) {
        tasks.push(
          canvasToBitmap(canvas).then(bitmap => {
            immediate.push({ key, bitmap, left, top });
          })
        );
      } else {
        deferred.push({ key, canvas, left, top });
      }
    } else {
      // canvas なし（空・調整・テキストレイヤーなど）
      immediate.push({ key, bitmap: null, left, top });
    }
  }

  await Promise.all(tasks);
  return { immediate, deferred };
}

// ── メッセージハンドラ ────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer } = event.data;

  if (!buffer || buffer.byteLength === 0) {
    (self as any).postMessage({ id, psd: {}, layers: [], error: 'Empty buffer' });
    return;
  }

  try {
    const psd = readPsd(new Uint8Array(buffer), {
      skipLayerImageData: false,
      skipCompositeImageData: true, // 合成画像は不要、レイヤー個別で描画する
    });

    const { immediate, deferred } = psd.children
      ? await collectLayerBitmaps(psd.children)
      : { immediate: [], deferred: [] };

    // OffscreenCanvas / ImageData / TypedArray を除去してから送信
    const safePsd = removeCanvasDeep(psd);
    const hasPending = deferred.length > 0;

    // 即時転送する bitmap を Transferable リストへ
    const immediateBitmaps = immediate
      .filter(e => e.bitmap != null)
      .map(e => e.bitmap as ImageBitmap);

    (self as any).postMessage(
      { id, psd: safePsd, layers: immediate, hasPending },
      immediateBitmaps,
    );

    if (!hasPending) return;

    // 大きいレイヤーをバッチで遅延送信
    for (let i = 0; i < deferred.length; i += DEFERRED_BATCH_SIZE) {
      const batch = deferred.slice(i, i + DEFERRED_BATCH_SIZE);
      const done = i + DEFERRED_BATCH_SIZE >= deferred.length;

      const results = await Promise.all(
        batch.map(async ({ key, canvas, left, top }) => ({
          key,
          bitmap: await canvasToBitmap(canvas),
          left,
          top,
        }))
      );

      const deferredBitmaps = results
        .filter(e => e.bitmap != null)
        .map(e => e.bitmap as ImageBitmap);

      (self as any).postMessage(
        { kind: 'deferred', id, layers: results, done },
        deferredBitmaps,
      );
    }

  } catch (err) {
    console.error('[psdWorker] fatal error:', err);
    (self as any).postMessage({
      id,
      psd: {},
      layers: [],
      error: String(err),
    });
  }
};