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

export interface WorkerResponse {
    id: number;
    psd: Psd;
    layers: LayerThumbEntry[];
    error?: string;
    failedLayerCount?: number;
}

function normalizeRadioGroups(layers: PsdLayerNode[]): PsdLayerNode[] {
    const processed = layers.map((layer) =>
        layer.children && layer.children.length > 0
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
        if ('canvas' in layer) delete layer.canvas;
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
        const value = (target as any)[key];
        if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) {
            delete (target as any)[key];
            continue;
        }
        stripOffscreenCanvasDeep(value, seen);
    }
}

async function canvasToBitmaps(
    canvas: OffscreenCanvas,
): Promise<{ bitmap: ImageBitmap }> {
    const bitmap = await createImageBitmap(canvas);
    return { bitmap };
}

async function collectLayerBitmaps(
    layers: PsdLayerNode[],
    parentPath: number[] = [],
): Promise<{ entries: LayerThumbEntry[]; failed: number }> {
    const directTasks: Promise<LayerThumbEntry | null>[] = [];
    const childTasks: Promise<{ entries: LayerThumbEntry[]; failed: number }>[] = [];

    layers.forEach((layer, i) => {
        const key = [...parentPath, i].join('-');
        if (layer.canvas && !layer.children?.length) {
            const canvas = layer.canvas as OffscreenCanvas;
            const left = layer.left ?? 0;
            const top  = layer.top  ?? 0;
            directTasks.push(
                canvasToBitmaps(canvas)
                    .then(({ bitmap }) => ({ key, bitmap, left, top }))
                    .catch((err) => {
                        // ★ ここで握りつぶさずログに残す
                        console.warn(`[psdWorker] bitmap生成失敗 layer=${key}:`, err);
                        return null;
                    }),
            );
        }
        if (layer.children?.length) {
            childTasks.push(collectLayerBitmaps(layer.children, [...parentPath, i]));
        }
    });

    const [directs, children] = await Promise.all([
        Promise.all(directTasks),
        Promise.all(childTasks),
    ]);

    const failedHere = directs.filter(e => e === null).length;
    return {
        entries: [
            ...directs.filter((e): e is LayerThumbEntry => e !== null),
            ...children.flatMap(c => c.entries),
        ],
        failed: failedHere + children.reduce((acc, c) => acc + c.failed, 0),
    };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { id, buffer } = event.data;

    try {
        const psd = readPsd(new Uint8Array(buffer), {
            skipLayerImageData: false,
            skipCompositeImageData: false,
        });

        if (psd.children) {
            psd.children = normalizeRadioGroups(psd.children);
        }

        // canvas が生きている間に bitmap 生成（stripCanvas より前）
        const { entries: layers, failed } = psd.children
            ? await collectLayerBitmaps(psd.children)
            : { entries: [], failed: 0 };

        // OffscreenCanvas を除去してから postMessage
        if (psd.children) stripCanvas(psd.children);
        if ('canvas' in (psd as any)) delete (psd as any).canvas;
        stripOffscreenCanvasDeep(psd);

        const transferables: Transferable[] = layers.map((e) => e.bitmap);

        const response: WorkerResponse = { id, psd, layers, failedLayerCount: failed };
        (self as any).postMessage(response, transferables);
    } catch (err) {
        const response: WorkerResponse = {
            id,
            psd: {} as Psd,
            layers: [],
            error: err instanceof Error ? err.message : String(err),
        };
        (self as any).postMessage(response);
    }
};