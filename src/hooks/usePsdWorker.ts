import { useCallback } from 'react';
import { readPsd, initializeCanvas } from 'ag-psd';
import type { Psd } from 'ag-psd';
import type { LayerThumbEntry } from '../utils/psdUtils';

initializeCanvas(
    (width: number, height: number) => new OffscreenCanvas(width, height) as any,
);

export interface WorkerResponse {
    id: number;
    psd: Psd;
    layers: LayerThumbEntry[];
    error?: string;
}

// ── サムネイル生成ヘルパー ────────────────────────────────────────────────────

async function collectLayerBitmaps(
    layers: any[],
    parentPath: number[] = [],
): Promise<LayerThumbEntry[]> {
    const results: LayerThumbEntry[] = [];

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const key = [...parentPath, i].join('-');

        // グループレイヤーはビットマップ不要、子を再帰処理
        if (layer.children?.length) {
            const childEntries = await collectLayerBitmaps(layer.children, [...parentPath, i]);
            results.push(...childEntries);
            continue;
        }

        // canvas プロパティがある葉レイヤーのみ処理
        const canvas = layer.canvas as OffscreenCanvas | HTMLCanvasElement | undefined;
        if (!canvas) continue;

        try {
            const bitmap = await createImageBitmap(canvas);
            results.push({
                key,
                bitmap,
                left: layer.left ?? 0,
                top:  layer.top  ?? 0,
            });
        } catch {
            // ビットマップ生成失敗は無視してスキップ
        }
    }

    return results;
}

function stripCanvas(layers: any[]): void {
    for (const layer of layers) {
        if ('canvas' in layer) delete layer.canvas;
        if (layer.children?.length) stripCanvas(layer.children);
    }
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function usePsdWorker() {
    const loadPsd = useCallback(
        async (buffer: ArrayBuffer, _filePath?: string): Promise<WorkerResponse> => {
            try {
                const psd = readPsd(new Uint8Array(buffer), {
                    skipLayerImageData: false,
                    skipCompositeImageData: false,
                });

                // canvas が生きているうちにビットマップを収集
                const layers = psd.children
                    ? await collectLayerBitmaps(psd.children)
                    : [];

                // canvas は postMessage / React state に渡す前に除去
                if (psd.children) stripCanvas(psd.children);
                if ('canvas' in (psd as any)) delete (psd as any).canvas;

                return { id: 0, psd, layers };
            } catch (err) {
                throw new Error(err instanceof Error ? err.message : String(err));
            }
        },
        [],
    );

    return { loadPsd };
}