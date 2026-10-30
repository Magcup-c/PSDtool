/**
 * src/workers/psdWorker.ts
 */

import { readPsd, initializeCanvas, Psd } from 'ag-psd';
import { PsdLayerNode } from '../types';
import { getColorPipeline } from '../compositor/color';

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
    kind?: 'layer' | 'mask';
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
    composite?: ImageBitmap;
    useCompositeFallback: boolean;
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
    kind: 'layer' | 'mask';
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
    unsupported: { value: boolean },
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

        // The browser renderer intentionally falls back to Photoshop's saved
        // composite for features that cannot be reproduced faithfully yet.
        // These adjustment operators are handled by the compositor. Other
        // adjustment types and smart objects remain on the saved-composite
        // path until their pixel operators are implemented.
        if ((next.adjustment && !['curves', 'levels', 'brightness/contrast'].includes((next.adjustment as any).type)) || next.placedLayer) {
            unsupported.value = true;
        }
        if (next.children && ((next.opacity ?? 1) !== 1 ||
            ((next.blendMode ?? 'normal') !== 'normal' && (next.blendMode ?? 'normal') !== 'pass through'))) {
            unsupported.value = true;
        }
        if (next.blendMode && ![
            'pass through', 'normal', 'dissolve', 'darken', 'multiply', 'lighten',
            'screen', 'overlay', 'difference', 'exclusion', 'hue', 'saturation',
            'color', 'luminosity', 'color burn', 'color dodge', 'linear burn',
            'linear dodge', 'hard light', 'soft light', 'vivid light', 'linear light',
            'pin light', 'hard mix', 'subtract', 'divide', 'darker color', 'lighter color',
        ].includes(next.blendMode)) unsupported.value = true;

        if (radioIndices.length >= 2 && radioIndices.includes(i)) {
            next.hidden = i !== visibleIdx;
        }

        // Masks can also belong to adjustment layers and groups, which do not
        // have a normal layer canvas. Transfer those masks independently.
        if ((next as any).mask?.canvas) {
            canvasTasks.push({
                key,
                canvas: (next as any).mask.canvas as OffscreenCanvas,
                left: (next as any).mask.left ?? next.left ?? 0,
                top: (next as any).mask.top ?? next.top ?? 0,
                kind: 'mask',
            });
            (next as any).mask = { ...(next as any).mask };
            delete (next as any).mask.canvas;
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
                    kind: 'layer',
                });
                delete next.canvas;
            }
        } else if (next.children?.length) {
            next.children = buildTree(next.children, [...parentPath, i], canvasTasks, diag, unsupported);
        }

        return next;
    });
}

async function convertCanvasTasks(
    tasks: CanvasTask[],
): Promise<{ entries: LayerThumbEntry[]; failed: number }> {
    let failed = 0;
    const entries = await Promise.all(tasks.map(async ({ key, canvas, left, top, kind }) => {
        try {
            const bitmap = await createImageBitmap(canvas);
            return { key, bitmap, left, top, kind } as LayerThumbEntry;
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
            // Keep Photoshop's saved composite as a reliable fallback for
            // masks, adjustment layers, smart objects and advanced groups.
            skipCompositeImageData: false,
        });

        const canvasTasks: CanvasTask[] = [];
        const diag = { totalLeaf: 0, eligible: 0 };
        // The browser renderer operates on 8-bit RGB canvas data. For other
        // document formats the saved Photoshop composite is the safe view.
        const unsupported = {
            value: (psd as any).colorMode !== 3 || (psd as any).bitsPerChannel !== 8,
        };
        (psd as any)._colorPipeline = getColorPipeline(
            (psd as any).colorMode,
            (psd as any).bitsPerChannel,
        );

        if (psd.children) {
            psd.children = buildTree(psd.children, [], canvasTasks, diag, unsupported);
        }
        // 大規模なイラストは、開いた直後から全レイヤーをフルサイズの
        // 作業キャンバスへ合成すると、初回表示だけで非常に大きな負荷に
        // なる。保存済みの合成画像を先に表示し、編集操作が入った時点で
        // usePsdHistory が編集用レンダラーへ切り替える。
        if (diag.totalLeaf >= 80) unsupported.value = true;
        const compositeCanvas = (psd as any).canvas as OffscreenCanvas | undefined;
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
        // Avoid creating hundreds of ImageBitmaps at once. This is important
        // for large illustration PSDs with many clipped layers.
        const layers: LayerThumbEntry[] = [];
        let failed = 0;
        for (let i = 0; i < canvasTasks.length; i += 16) {
            const part = await convertCanvasTasks(canvasTasks.slice(i, i + 16));
            layers.push(...part.entries);
            failed += part.failed;
        }

        let composite: ImageBitmap | undefined;
        if (compositeCanvas) {
            try { composite = await createImageBitmap(compositeCanvas); }
            catch (err) { console.warn('[psdWorker] composite変換失敗:', err); }
        }

        console.info(`[psdWorker] レイヤー解析: 総数=${diag.totalLeaf} canvas有=${diag.eligible} 変換成功=${layers.length} 変換失敗=${failed}`);

        const layersResponse: WorkerLayersResponse = {
            id, kind: 'layers', layers, composite,
            useCompositeFallback: unsupported.value,
            diag: { totalLeaf: diag.totalLeaf, eligible: diag.eligible, rendered: layers.length, failed },
        };
        const transferables: Transferable[] = layers.map((e) => e.bitmap);
        if (composite) transferables.push(composite);
        (self as any).postMessage(layersResponse, transferables);
    } catch (err) {
        const response: WorkerErrorResponse = {
            id, kind: 'error',
            error: err instanceof Error ? err.message : String(err),
        };
        (self as any).postMessage(response);
    }
};
