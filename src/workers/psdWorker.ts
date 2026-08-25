/**
 * src/workers/psdWorker.ts
 */

import { readPsd, initializeCanvas, Psd } from 'ag-psd';
import { PsdLayerNode } from '../types';

initializeCanvas(
    (width: number, height: number) => new OffscreenCanvas(width, height) as any,
);

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

export interface WorkerMetaResponse {
    id: number;
    kind: 'meta';
    psd: Psd;
}

export interface WorkerLayersResponse {
    id: number;
    kind: 'layers';
    layers: LayerThumbEntry[];
    diag: { totalLeaf: number; eligible: number; rendered: number; failed: number };
}

export interface WorkerErrorResponse {
    id: number;
    kind: 'error';
    error: string;
}

export type WorkerResponse = WorkerMetaResponse | WorkerLayersResponse | WorkerErrorResponse;

interface CanvasTask {
    key: string;
    canvas: OffscreenCanvas;
    left: number;
    top: number;
}

// ── 安全網: 構造化クローン失敗時のみ使う深い探索 ──────────────────────────────
function stripOffscreenCanvasDeep(target: any, seen = new Set<any>()): void {
    if (!target || typeof target !== 'object') return;
    if (seen.has(target)) return;
    seen.add(target);

    if (Array.isArray(target)) {
        for (const item of target) stripOffscreenCanvasDeep(item, seen);
        return;
    }
    for (const key of Object.keys(target)) {
        const value = (target as any)[key];
        if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) {
            delete (target as any)[key];
            continue;
        }
        stripOffscreenCanvasDeep(value, seen);
    }
}

/**
 * 1回のツリー走査で以下を同時に行う。
 * (旧: normalizeRadioGroups → collectLayerBitmaps → stripCanvas の3パスをここに統合)
 *   - ラジオグループ（"*"接頭辞レイヤー）の hidden 再計算
 *   - canvas を持つ葉レイヤーの収集（非同期ビットマップ変換用にキューへ積む）
 *   - layer.canvas の即時削除（postMessage の構造化クローン対象から外す）
 *
 * ビットマップ化自体はここでは行わない（同期処理のみ）。
 * これにより「レイヤー名・表示状態・寸法などのメタ情報」を確定させた時点で
 * すぐにメインスレッドへ送信でき、サムネイル生成の完了を待たなくてよくなる。
 */
function buildTree(
    layers: PsdLayerNode[],
    parentPath: number[],
    canvasTasks: CanvasTask[],
    diag: { totalLeaf: number; eligible: number },
): PsdLayerNode[] {
    const radioIndices = layers
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => (l.name || '').startsWith('*'))
        .map(({ i }) => i);
    const visibleIdx = radioIndices.length >= 2
        ? (radioIndices.find((i) => !layers[i].hidden) ?? radioIndices[0])
        : -1;

    return layers.map((layer, i) => {
        const key = [...parentPath, i].join('-');
        const isLeaf = !layer.children?.length;
        const next: PsdLayerNode = { ...layer };

        if (radioIndices.length >= 2 && radioIndices.includes(i)) {
            next.hidden = i !== visibleIdx;
        }

        if (isLeaf) {
            diag.totalLeaf++;
            if (next.canvas) {
                diag.eligible++;
                canvasTasks.push({
                    key,
                    canvas: next.canvas as OffscreenCanvas,
                    left: next.left ?? 0,
                    top: next.top ?? 0,
                });
                delete next.canvas;
            }
        } else if (next.children?.length) {
            next.children = buildTree(next.children, [...parentPath, i], canvasTasks, diag);
        }

        return next;
    });
}

async function convertCanvasTasks(
    tasks: CanvasTask[],
): Promise<{ entries: LayerThumbEntry[]; failed: number }> {
    let failed = 0;
    const entries = await Promise.all(tasks.map(async ({ key, canvas, left, top }) => {
        try {
            const bitmap = await createImageBitmap(canvas);
            return { key, bitmap, left, top } as LayerThumbEntry;
        } catch (err) {
            failed++;
            console.warn(`[psdWorker] bitmap変換失敗 key=${key}:`, err);
            return null;
        }
    }));
    return { entries: entries.filter((e): e is LayerThumbEntry => e !== null), failed };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { id, buffer } = event.data;

    try {
        const psd = readPsd(new Uint8Array(buffer), {
            skipLayerImageData: false,
            // 合成描画は自前(useEditorCanvas)で行っており、
            // psd.rgba() / 埋め込み合成画像は使わないためデコードをスキップし高速化する。
            skipCompositeImageData: true,
        });

        const canvasTasks: CanvasTask[] = [];
        const diag = { totalLeaf: 0, eligible: 0 };

        if (psd.children) {
            psd.children = buildTree(psd.children, [], canvasTasks, diag);
        }
        if ('canvas' in (psd as any)) delete (psd as any).canvas;

        // ① メタ情報（レイヤー名・表示状態・寸法など）を即座に送信。
        //    サムネイル用ビットマップの生成完了を待たない。
        const metaResponse: WorkerMetaResponse = { id, kind: 'meta', psd };
        try {
            (self as any).postMessage(metaResponse);
        } catch {
            // 構造化クローン失敗（未知の canvas 参照が残っていた等）時のみ
            // コストの高い深い探索でフォールバックして再送する。
            stripOffscreenCanvasDeep(psd);
            (self as any).postMessage(metaResponse);
        }

        // ② サムネイル用ビットマップは非同期に変換し、できてから送信。
        const { entries: layers, failed } = await convertCanvasTasks(canvasTasks);

        console.info(`[psdWorker] レイヤー解析: 総数=${diag.totalLeaf} canvas有=${diag.eligible} 変換成功=${layers.length} 変換失敗=${failed}`);

        const layersResponse: WorkerLayersResponse = {
            id, kind: 'layers', layers,
            diag: { totalLeaf: diag.totalLeaf, eligible: diag.eligible, rendered: layers.length, failed },
        };
        const transferables: Transferable[] = layers.map((e) => e.bitmap);
        (self as any).postMessage(layersResponse, transferables);
    } catch (err) {
        const response: WorkerErrorResponse = {
            id, kind: 'error',
            error: err instanceof Error ? err.message : String(err),
        };
        (self as any).postMessage(response);
    }
};