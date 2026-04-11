import { useCallback } from 'react';
import { readPsd, initializeCanvas } from 'ag-psd';
import type { Psd } from 'ag-psd';
import type { LayerThumbEntry } from '../utils/psdUtils';

initializeCanvas(
    (width: number, height: number) => new OffscreenCanvas(width, height) as any,
);

export interface PsdMetadata {
    width: number;
    height: number;
    layers: PsdLayerInfo[];
}

export interface PsdLayerInfo {
    name: string;
    visible: boolean;
    opacity: number;
    left: number;
    top: number;
    width: number;
    height: number;
    children?: PsdLayerInfo[];
}

export interface WorkerResponse {
    id: number;
    psd: Psd;
    layers: LayerThumbEntry[];
    error?: string;
}

export function usePsdWorker() {
    const loadPsd = useCallback(
        async (buffer: ArrayBuffer, _filePath?: string): Promise<WorkerResponse> => {
            try {
                const psd = readPsd(new Uint8Array(buffer), {
                    skipLayerImageData: false,
                    skipCompositeImageData: false,
                });

                // parse_psd_metadata の invoke は戻り値を使用していないため削除。
                // 将来的にRust側のメタデータが必要になった場合は
                // invoke<PsdMetadata>('parse_psd_metadata', { filePath: _filePath })
                // のようにキャメルケースで渡すこと。

                return { id: 0, psd, layers: [] };
            } catch (err) {
                throw new Error(err instanceof Error ? err.message : String(err));
            }
        },
        [],
    );

    return { loadPsd };
}