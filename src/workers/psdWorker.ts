import { readPsd, initializeCanvas } from 'ag-psd';

// ── Canvas ファクトリ登録 ─────────────────────────────────────────────────────
// Worker スコープには document がないため OffscreenCanvas を使う。
// 第2引数で createImageData も上書きして tempCanvas の生成に使うバグを回避。
initializeCanvas(
  (width: number, height: number) => new OffscreenCanvas(width, height) as any,
  (width: number, height: number) => {
    const oc = new OffscreenCanvas(1, 1);
    return (oc.getContext('2d') as OffscreenCanvasRenderingContext2D).createImageData(width, height);
  },
);

// ── 型定義 ───────────────────────────────────────────────────────────────────

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
  psd: PlainPsd;
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

// ── プレーンオブジェクト型 ───────────────────────────────────────────────────

interface PlainLayer {
  name?: string;
  hidden?: boolean;
  opacity?: number;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  children?: PlainLayer[];
}

interface PlainPsd {
  width: number;
  height: number;
  children: PlainLayer[];
}

// ── シリアライズ ─────────────────────────────────────────────────────────────
// ag-psd の layer は通常のプレーンオブジェクトだが、
// canvas / imageData などの非シリアライズ可能プロパティを除去する。

function serializeLayer(layer: any): PlainLayer {
  const plain: PlainLayer = {};

  if (layer.name    !== undefined) plain.name    = layer.name;
  if (layer.hidden  !== undefined) plain.hidden  = layer.hidden;
  if (layer.opacity !== undefined) plain.opacity = layer.opacity;
  if (layer.left    !== undefined) plain.left    = layer.left;
  if (layer.top     !== undefined) plain.top     = layer.top;
  if (layer.right   !== undefined) plain.right   = layer.right;
  if (layer.bottom  !== undefined) plain.bottom  = layer.bottom;

  // width/height を補完 (right-left / bottom-top から計算)
  const w = layer.width  ?? ((layer.right  ?? 0) - (layer.left ?? 0));
  const h = layer.height ?? ((layer.bottom ?? 0) - (layer.top  ?? 0));
  if (w > 0) plain.width  = w;
  if (h > 0) plain.height = h;

  // children は空配列でも保持 (グループ識別に必要)
  if (Array.isArray(layer.children)) {
    plain.children = layer.children.map(serializeLayer);
  }

  return plain;
}

function serializePsd(psd: any): PlainPsd {
  return {
    width:    psd.width  || 0,
    height:   psd.height || 0,
    children: Array.isArray(psd.children) ? psd.children.map(serializeLayer) : [],
  };
}

// ── OffscreenCanvas / ImageData → ImageBitmap 変換 ───────────────────────────

async function canvasToBitmap(canvas: OffscreenCanvas): Promise<ImageBitmap | null> {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

  // 方法1: OffscreenCanvas から直接
  try {
    return await createImageBitmap(canvas);
  } catch (_e1) {}

  // 方法2: getImageData → ImageData → createImageBitmap
  try {
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return await createImageBitmap(imgData);
  } catch (e2) {
    console.warn('[psdWorker] canvasToBitmap 失敗:', e2);
    return null;
  }
}

// ag-psd の imageData は 8/16/32bit のいずれかの可能性がある
async function imageDataToBitmap(imgDataLike: any): Promise<ImageBitmap | null> {
  const w = imgDataLike.width  || 0;
  const h = imgDataLike.height || 0;
  if (w <= 0 || h <= 0) return null;

  try {
    const src = imgDataLike.data;

    if (src instanceof Uint8ClampedArray) {
      // 8bit: そのまま ImageData として渡せる
      const data = new Uint8ClampedArray(src);
      return await createImageBitmap(new ImageData(data, w, h));
    }

    // 16bit または 32bit → 8bit に変換してから ImageBitmap 化
    const dst = new Uint8ClampedArray(w * h * 4);
    if (src instanceof Uint16Array) {
      for (let i = 0; i < src.length; i++) dst[i] = src[i] >>> 8;
    } else if (src instanceof Float32Array) {
      for (let i = 0; i < src.length; i += 4) {
        dst[i]   = Math.round(Math.pow(Math.max(0, Math.min(1, src[i])),   1 / 2.2) * 255);
        dst[i+1] = Math.round(Math.pow(Math.max(0, Math.min(1, src[i+1])), 1 / 2.2) * 255);
        dst[i+2] = Math.round(Math.pow(Math.max(0, Math.min(1, src[i+2])), 1 / 2.2) * 255);
        dst[i+3] = Math.round(Math.min(1, Math.max(0, src[i+3])) * 255);
      }
    } else {
      return null;
    }
    return await createImageBitmap(new ImageData(dst, w, h));
  } catch (e) {
    console.warn('[psdWorker] imageDataToBitmap 失敗:', e);
    return null;
  }
}

// レイヤーから bitmap を取得 (canvas → imageData の順にフォールバック)
async function layerToBitmap(layer: any): Promise<ImageBitmap | null> {
  if (layer.canvas) {
    const bm = await canvasToBitmap(layer.canvas as OffscreenCanvas);
    if (bm) return bm;
  }
  if (layer.imageData) {
    const bm = await imageDataToBitmap(layer.imageData);
    if (bm) return bm;
  }
  return null;
}

// ── 定数 ─────────────────────────────────────────────────────────────────────

const IMMEDIATE_THRESHOLD_PX = 512 * 512; // 512×512 以下は即時処理
const DEFERRED_BATCH_SIZE = 8;

// ── レイヤーツリー走査 ───────────────────────────────────────────────────────

interface DeferredEntry {
  key: string;
  layer: any;
  left: number;
  top: number;
}

interface CollectResult {
  immediate: LayerThumbEntry[];
  deferred:  DeferredEntry[];
}

async function collectLayerBitmaps(
  layers: any[],
  parentPath: number[] = [],
): Promise<CollectResult> {
  const immediate: LayerThumbEntry[] = [];
  const deferred:  DeferredEntry[]   = [];
  const tasks:     Promise<void>[]   = [];

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const key   = [...parentPath, i].join('-');
    const left  = layer.left ?? 0;
    const top   = layer.top  ?? 0;

    if (Array.isArray(layer.children)) {
      // グループ: 自身は bitmap 不要、子を再帰
      tasks.push(
        collectLayerBitmaps(layer.children, [...parentPath, i]).then((r) => {
          immediate.push(...r.immediate);
          deferred.push(...r.deferred);
        }),
      );
      continue;
    }

    // 通常レイヤー: サイズを推定
    const canvas  = layer.canvas as OffscreenCanvas | undefined;
    const imgData = layer.imageData;
    const w = canvas?.width  || imgData?.width  || ((layer.right  ?? 0) - (layer.left ?? 0));
    const h = canvas?.height || imgData?.height || ((layer.bottom ?? 0) - (layer.top  ?? 0));

    if (!canvas && !imgData) {
      // 空・調整レイヤー等 (canvas/imageData なし)
      immediate.push({ key, bitmap: null, left, top });
      continue;
    }

    const px = w * h;
    if (px <= IMMEDIATE_THRESHOLD_PX) {
      tasks.push(
        layerToBitmap(layer).then((bitmap) => {
          immediate.push({ key, bitmap, left, top });
        }),
      );
    } else {
      deferred.push({ key, layer, left, top });
    }
  }

  await Promise.all(tasks);
  return { immediate, deferred };
}

// ── メイン処理 ───────────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer } = event.data;

  if (!buffer || buffer.byteLength === 0) {
    (self as any).postMessage({ id, psd: { width: 0, height: 0, children: [] }, layers: [], error: 'Empty buffer' });
    return;
  }

  try {
    const psd = readPsd(new Uint8Array(buffer), {
      skipLayerImageData:     false,
      skipCompositeImageData: false,
    });

    const children = Array.isArray(psd.children) ? psd.children : [];
    const { immediate, deferred } = children.length > 0
      ? await collectLayerBitmaps(children)
      : { immediate: [], deferred: [] };

    const safePsd    = serializePsd(psd);
    const hasPending = deferred.length > 0;

    // 初回送信
    const transferable = immediate
      .filter(e => e.bitmap != null)
      .map(e => e.bitmap!) as Transferable[];

    (self as any).postMessage(
      { id, psd: safePsd, layers: immediate, hasPending },
      transferable,
    );

    if (!hasPending) return;

    // 遅延送信 (大きいレイヤー)
    for (let i = 0; i < deferred.length; i += DEFERRED_BATCH_SIZE) {
      const batch = deferred.slice(i, i + DEFERRED_BATCH_SIZE);
      const done  = (i + DEFERRED_BATCH_SIZE) >= deferred.length;

      const results = await Promise.all(
        batch.map(async ({ key, layer, left, top }) => ({
          key,
          bitmap: await layerToBitmap(layer),
          left,
          top,
        })),
      );

      const deferredTransferable = results
        .filter(e => e.bitmap != null)
        .map(e => e.bitmap!) as Transferable[];

      (self as any).postMessage(
        { kind: 'deferred', id, layers: results, done },
        deferredTransferable,
      );
    }

  } catch (err) {
    console.error('[psdWorker] Error:', err);
    (self as any).postMessage({
      id,
      psd: { width: 0, height: 0, children: [] },
      layers: [],
      error: String(err),
    });
  }
};