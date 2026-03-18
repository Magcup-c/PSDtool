/**
 * src/workers/psdWorker.ts
 */

import { readPsd, initializeCanvas, Psd } from 'ag-psd';

initializeCanvas(
    (width: number, height: number) => new OffscreenCanvas(width, height) as any,
);

export interface WorkerRequest {
    id: number;
    buffer: ArrayBuffer;
}

export interface LayerThumbEntry {
    key: string;
    /** 描画用 + サムネイル用を兼ねるフルサイズ ImageBitmap */
    bitmap: ImageBitmap;
    left: number;
    top: number;
}

export interface WorkerResponse {
    id: number;
    psd: Psd;
    layers: LayerThumbEntry[];
    error?: string;
}

function normalizeRadioGroups(layers: any[]): any[] {
    const processed = layers.map((layer) =>
        layer.children?.length > 0
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

function stripCanvas(layers: any[]): void {
    for (const layer of layers) {
        if ('canvas' in layer) delete layer.canvas;
        if (layer.children?.length) stripCanvas(layer.children);
    }
}

async function canvasToBitmaps(
    canvas: OffscreenCanvas,
): Promise<{ bitmap: ImageBitmap }> {
    const bitmap = await createImageBitmap(canvas);
    return { bitmap };
}

async function collectLayerBitmaps(
    layers: any[],
    parentPath: number[] = [],
): Promise<LayerThumbEntry[]> {
    const directTasks: Promise<LayerThumbEntry | null>[] = [];
    const childTasks: Promise<LayerThumbEntry[]>[] = [];

    layers.forEach((layer, i) => {
        const key = [...parentPath, i].join('-');
        // グループレイヤー（children あり）は bitmap 不要 → スキップ
        if (layer.canvas && !layer.children?.length) {
            const canvas = layer.canvas as OffscreenCanvas;
            const left = layer.left ?? 0;
            const top = layer.top ?? 0;
            directTasks.push(
                canvasToBitmaps(canvas)
                    .then(({ bitmap }) => ({ key, bitmap, left, top }))
                    .catch(() => null),
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

    return [
        ...directs.filter((e): e is LayerThumbEntry => e !== null),
        ...children.flat(),
    ];
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
        const layers = psd.children ? await collectLayerBitmaps(psd.children) : [];

        // OffscreenCanvas を除去してから postMessage
        if (psd.children) stripCanvas(psd.children);
        if ('canvas' in (psd as any)) delete (psd as any).canvas;

        const transferables: Transferable[] = layers.map((e) => e.bitmap);

        const response: WorkerResponse = { id, psd, layers };
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