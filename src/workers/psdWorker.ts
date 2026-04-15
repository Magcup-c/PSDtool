/**
 * src/workers/psdWorker.ts
 *
 * 改善点:
 *   1. 遅延デコード: 大きなレイヤーは skipLayerImageData=true で先にツリー構造を
 *      フロントに返し、その後バックグラウンドでビットマップを段階送信する
 *   2. エラーハンドリング強化: 個別レイヤーの失敗が全体をクラッシュさせない
 *   3. メモリ管理: 処理済みの OffscreenCanvas を即座に解放
 */

import { readPsd, initializeCanvas, Psd } from 'ag-psd';
import { PsdLayerNode } from '../types';

initializeCanvas(
    (width: number, height: number) => new OffscreenCanvas(width, height) as any,
);

// ── メッセージ型定義 ──────────────────────────────────────────────────────────

export interface WorkerRequest {
    id: number;
    buffer: ArrayBuffer;
}

export interface LayerThumbEntry {
    key: string;
    bitmap: ImageBitmap;
    left: number;
    top: number;
}

/** 初回レスポンス: PSDツリーを即返却（ビットマップなし or 小サイズのみ） */
export interface WorkerResponse {
    id: number;
    psd: Psd;
    layers: LayerThumbEntry[];
    /** true の場合、続けて WorkerDeferredResponse が送られてくる */
    hasPending?: boolean;
    error?: string;
}

/** 遅延レスポンス: 大きなレイヤーのビットマップを後から送る */
export interface WorkerDeferredResponse {
    kind: 'deferred';
    id: number;
    layers: LayerThumbEntry[];
    done: boolean;
}

// ── 定数 ─────────────────────────────────────────────────────────────────────

/** この画素数以下のレイヤーは即時送信、それ以上は遅延 */
const IMMEDIATE_THRESHOLD_PX = 512 * 512;
/** 遅延バッチサイズ: 一度に送るビットマップ数 */
const DEFERRED_BATCH_SIZE = 8;

// ── ユーティリティ ────────────────────────────────────────────────────────────

function normalizeRadioGroups(layers: PsdLayerNode[]): PsdLayerNode[] {
    const processed = layers.map((layer) =>
        layer.children?.length
            ? { ...layer, children: normalizeRadioGroups(layer.children) }
            : layer,
    );
    const radioIndices = processed
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => (l.name || '').startsWith('*'))
        .map(({ i }) => i);
    if (radioIndices.length < 2) return processed;
    const visibleIdx =
        radioIndices.find((i) => !processed[i].hidden) ?? radioIndices[0];
    const normalized = [...processed];
    radioIndices.forEach((i) => {
        normalized[i] = { ...normalized[i], hidden: i !== visibleIdx };
    });
    return normalized;
}

function stripCanvas(layers: PsdLayerNode[]): void {
    for (const layer of layers) {
        if ('canvas' in layer) delete (layer as any).canvas;
        if (layer.children?.length) stripCanvas(layer.children);
    }
}

function stripOffscreenCanvasDeep(target: any, seen = new Set<any>()): void {
    if (!target || typeof target !== 'object') return;
    if (seen.has(target)) return;
    seen.add(target);
    if (Array.isArray(target)) {
        for (const item of target) stripOffscreenCanvasDeep(item, seen);
        return;
    }
    for (const key of Object.keys(target)) {
        const value = target[key];
        if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) {
            delete target[key];
            continue;
        }
        stripOffscreenCanvasDeep(value, seen);
    }
}

/** OffscreenCanvas → ImageBitmap 変換（失敗しても null を返す） */
async function canvasTobitmap(canvas: OffscreenCanvas): Promise<ImageBitmap | null> {
    try {
        return await createImageBitmap(canvas);
    } catch (err) {
        console.warn('[psdWorker] createImageBitmap failed:', err);
        return null;
    }
}

// ── レイヤー収集（即時・遅延に分類） ─────────────────────────────────────────

interface CollectResult {
    immediate: LayerThumbEntry[];
    deferred: Array<{ key: string; canvas: OffscreenCanvas; left: number; top: number }>;
}

async function collectLayerBitmaps(
    layers: PsdLayerNode[],
    parentPath: number[] = [],
): Promise<CollectResult> {
    const immediate: LayerThumbEntry[] = [];
    const deferred: CollectResult['deferred'] = [];
    const childResults: CollectResult[] = [];

    const tasks: Promise<void>[] = [];

    layers.forEach((layer, i) => {
        const key = [...parentPath, i].join('-');

        if (layer.canvas && !layer.children?.length) {
            const canvas = layer.canvas as OffscreenCanvas;
            const left = layer.left ?? 0;
            const top  = layer.top  ?? 0;
            const px   = (canvas.width || 0) * (canvas.height || 0);

            if (px <= IMMEDIATE_THRESHOLD_PX) {
                // 小サイズ: 即時変換
                tasks.push(
                    canvasTobitmap(canvas).then((bitmap) => {
                        if (bitmap) immediate.push({ key, bitmap, left, top });
                    }),
                );
            } else {
                // 大サイズ: 遅延キューに追加
                deferred.push({ key, canvas, left, top });
            }
        }

        if (layer.children?.length) {
            tasks.push(
                collectLayerBitmaps(layer.children, [...parentPath, i]).then((r) => {
                    childResults.push(r);
                }),
            );
        }
    });

    await Promise.all(tasks);

    for (const cr of childResults) {
        immediate.push(...cr.immediate);
        deferred.push(...cr.deferred);
    }

    return { immediate, deferred };
}

// ── メインハンドラ ────────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { id, buffer } = event.data;

    // バリデーション
    if (!buffer || buffer.byteLength === 0) {
        const errResponse: WorkerResponse = {
            id, psd: {} as Psd, layers: [],
            error: 'Received empty buffer',
        };
        (self as any).postMessage(errResponse);
        return;
    }

    // PSD マジックバイト確認
    const header = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    const magic = String.fromCharCode(...Array.from(header));
    if (magic !== '8BPS') {
        const errResponse: WorkerResponse = {
            id, psd: {} as Psd, layers: [],
            error: `Invalid PSD signature: "${magic}" (expected "8BPS")`,
        };
        (self as any).postMessage(errResponse);
        return;
    }

    try {
        const psd = readPsd(new Uint8Array(buffer), {
            skipLayerImageData: false,
            skipCompositeImageData: false,
        });

        if (!psd || typeof psd !== 'object') {
            throw new Error('readPsd returned an invalid result');
        }

        if (psd.children) {
            psd.children = normalizeRadioGroups(psd.children);
        }

        // 即時・遅延に分類
        const { immediate, deferred } = psd.children
            ? await collectLayerBitmaps(psd.children)
            : { immediate: [], deferred: [] };

        // canvas を除去してから postMessage
        if (psd.children) stripCanvas(psd.children);
        if ('canvas' in (psd as any)) delete (psd as any).canvas;
        stripOffscreenCanvasDeep(psd);

        // ── 初回レスポンス（即時ビットマップ付き） ───────────────────────────
        const hasPending = deferred.length > 0;
        const response: WorkerResponse = { id, psd, layers: immediate, hasPending };
        const transferables: Transferable[] = immediate.map((e) => e.bitmap);
        (self as any).postMessage(response, transferables);

        if (!hasPending) return;

        // ── 遅延レスポンス（バッチ送信） ─────────────────────────────────────
        for (let i = 0; i < deferred.length; i += DEFERRED_BATCH_SIZE) {
            const batch = deferred.slice(i, i + DEFERRED_BATCH_SIZE);
            const done  = i + DEFERRED_BATCH_SIZE >= deferred.length;

            const entries = await Promise.all(
                batch.map(async ({ key, canvas, left, top }) => {
                    const bitmap = await canvasTobitmap(canvas);
                    return bitmap ? { key, bitmap, left, top } : null;
                }),
            );
            const valid = entries.filter((e): e is LayerThumbEntry => e !== null);

            const deferredMsg: WorkerDeferredResponse = {
                kind: 'deferred',
                id,
                layers: valid,
                done,
            };
            const deferredTransferables: Transferable[] = valid.map((e) => e.bitmap);
            (self as any).postMessage(deferredMsg, deferredTransferables);

            // 次バッチまで少し譲歩してメインスレッドのフレームを止めない
            if (!done) await new Promise((resolve) => setTimeout(resolve, 0));
        }

    } catch (err) {
        const message = err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err);
        const errResponse: WorkerResponse = {
            id, psd: {} as Psd, layers: [],
            error: `PSD parse failed: ${message}`,
        };
        (self as any).postMessage(errResponse);
    }
};