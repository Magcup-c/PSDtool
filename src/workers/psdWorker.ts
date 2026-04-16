import { readPsd, initializeCanvas, Psd } from 'ag-psd';
import { PsdLayerNode } from '../types';

initializeCanvas(
  (width: number, height: number) => new OffscreenCanvas(width, height) as any,
);

// ── 型 ─────────────────────────────

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
  psd: Psd;
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

// ── 定数 ───────────────────────────

const IMMEDIATE_THRESHOLD_PX = 512 * 512;
const DEFERRED_BATCH_SIZE = 8;

// ── OffscreenCanvas完全除去 ─────────

function removeCanvasDeep(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas) {
    return undefined;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeCanvasDeep);
  }

  const result: any = {};
  for (const key in obj) {
    const value = obj[key];

    if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) {
      continue;
    }

    result[key] = removeCanvasDeep(value);
  }

  return result;
}

// ── bitmap変換 ─────────────────────

async function canvasToBitmap(canvas: OffscreenCanvas): Promise<ImageBitmap | null> {
  if (!canvas.width || !canvas.height) return null;

  try {
    return await createImageBitmap(canvas);
  } catch (err) {
    console.warn('[psdWorker] bitmap失敗:', err);
    return null;
  }
}

// ── レイヤー収集 ───────────────────

interface CollectResult {
  immediate: LayerThumbEntry[];
  deferred: Array<{
    key: string;
    canvas: OffscreenCanvas;
    left: number;
    top: number;
  }>;
}

async function collectLayerBitmaps(
  layers: PsdLayerNode[],
  parentPath: number[] = [],
): Promise<CollectResult> {

  const immediate: LayerThumbEntry[] = [];
  const deferred: CollectResult['deferred'] = [];
  const tasks: Promise<void>[] = [];

  layers.forEach((layer, i) => {
    const key  = [...parentPath, i].join('-');
    const left = layer.left ?? 0;
    const top  = layer.top  ?? 0;

    if (layer.children?.length) {
      // グループ: canvas は使わず子を再帰処理
      tasks.push(
        collectLayerBitmaps(layer.children, [...parentPath, i]).then((r) => {
          immediate.push(...r.immediate);
          deferred.push(...r.deferred);
        }),
      );
    } else if (layer.canvas) {
      // 通常レイヤー: canvas → bitmap 変換
      const canvas = layer.canvas as OffscreenCanvas;
      const px = (canvas.width || 0) * (canvas.height || 0);

      if (px <= IMMEDIATE_THRESHOLD_PX) {
        tasks.push(
          canvasToBitmap(canvas).then((bitmap) => {
            immediate.push({ key, bitmap, left, top });
          }),
        );
      } else {
        // 大きいレイヤーは遅延送信
        deferred.push({ key, canvas, left, top });
      }
    } else {
      // canvas なし (空レイヤー・調整レイヤー等): null として登録
      immediate.push({ key, bitmap: null, left, top });
    }
  });

  await Promise.all(tasks);

  return { immediate, deferred };
}

// ── メイン処理 ─────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer } = event.data;

  if (!buffer || buffer.byteLength === 0) {
    (self as any).postMessage({
      id,
      psd: {} as Psd,
      layers: [],
      error: 'Empty buffer',
    });
    return;
  }

  try {
    const psd = readPsd(new Uint8Array(buffer), {
      skipLayerImageData: false,
      skipCompositeImageData: false,
    });

    const { immediate, deferred } = psd.children
      ? await collectLayerBitmaps(psd.children)
      : { immediate: [], deferred: [] };

    // 送信前に OffscreenCanvas を完全除去
    const safePsd = removeCanvasDeep(psd);

    const hasPending = deferred.length > 0;

    // ── 初回送信 ──
    (self as any).postMessage(
      {
        id,
        psd: safePsd,
        layers: immediate,
        hasPending,
      },
      immediate
        .filter(e => e.bitmap)
        .map(e => e.bitmap!)
    );

    if (!hasPending) return;

    // ── 遅延送信 ──
    for (let i = 0; i < deferred.length; i += DEFERRED_BATCH_SIZE) {
      const batch = deferred.slice(i, i + DEFERRED_BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async ({ key, canvas, left, top }) => {
          const bitmap = await canvasToBitmap(canvas);
          return { key, bitmap, left, top };
        }),
      );

      (self as any).postMessage(
        {
          kind: 'deferred',
          id,
          layers: results,
          done: i + DEFERRED_BATCH_SIZE >= deferred.length,
        },
        results
          .filter(e => e.bitmap)
          .map(e => e.bitmap!)
      );
    }

  } catch (err) {
    (self as any).postMessage({
      id,
      psd: {} as Psd,
      layers: [],
      error: String(err),
    });
  }
};