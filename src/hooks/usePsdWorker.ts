/**
 * src/hooks/usePsdWorker.ts
 *
 * PSD パース（メタデータ取得）を Rust に委譲する Hook。
 *
 * - readPsdMetadata(filePath) を呼ぶと Promise<PsdMetadata> が返る
 * - Rust の parse_psd_metadata コマンドを invoke を使って呼び出す
 */

import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
    /**
     * ファイルパスと ArrayBuffer から PSD メタデータを取得する。
     * - Rust に メタデータパース処理を委譲
     * - ag-psd でビットマップ生成（別の Hook で対応）
     */
    const loadPsd = useCallback(
        async (buffer: ArrayBuffer, filePath?: string): Promise<WorkerResponse> => {
            try {
                // TS 側で ag-psd を使って Psd オブジェクトを作成（メモリ側）
                const psd = readPsd(new Uint8Array(buffer), {
                    skipLayerImageData: false,
                    skipCompositeImageData: false,
                });

                // Rust に メタデータ取得を委譲（ファイルパスが必要）
                // ※ filePath がない場合は、TS 側の情報のみを使用
                if (filePath) {
                    // メタデータを取得（将来的に使用予定）
                    await invoke<PsdMetadata>('parse_psd_metadata', { file_path: filePath });
                }

                // 現在は layers を空にして返す（ビットマップ生成は別で対応）
                const response: WorkerResponse = {
                    id: 0,
                    psd,
                    layers: [],
                };

                return response;
            } catch (err) {
                const response: WorkerResponse = {
                    id: 0,
                    psd: {} as Psd,
                    layers: [],
                    error: err instanceof Error ? err.message : String(err),
                };
                throw new Error(response.error);
            }
        },
        [],
    );

    return { loadPsd };
}