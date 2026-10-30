/**
 * src/hooks/usePsdWorker.ts
 */

import { useRef, useEffect, useCallback } from 'react';
import type { Psd } from 'ag-psd';
import type { WorkerRequest, WorkerResponse, LayerThumbEntry } from '../workers/psdWorker';

import PsdWorker from '../workers/psdWorker?worker';

export interface PsdLoadResult {
    layers: LayerThumbEntry[];
    composite?: ImageBitmap;
    useCompositeFallback: boolean;
    diag?: { totalLeaf: number; eligible: number; rendered: number; failed: number };
}

interface PendingEntry {
    onMeta?: (psd: Psd) => void;
    resolve: (result: PsdLoadResult) => void;
    reject:  (err: Error) => void;
}

export function usePsdWorker() {
    const workerRef  = useRef<Worker | null>(null);
    const pendingRef = useRef<Map<number, PendingEntry>>(new Map());
    const nextIdRef  = useRef(0);

    useEffect(() => {
        const worker = new PsdWorker();

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const data = event.data;
            const pending = pendingRef.current.get(data.id);
            if (!pending) return;

            if (data.kind === 'error') {
                pendingRef.current.delete(data.id);
                pending.reject(new Error(data.error));
                return;
            }
            if (data.kind === 'meta') {
                // メタ情報はまだ完了ではないので pendingRef は残したまま通知のみ行う
                pending.onMeta?.(data.psd);
                return;
            }
            // data.kind === 'layers' → 完了
            pendingRef.current.delete(data.id);
            pending.resolve({
                layers: data.layers,
                composite: data.composite,
                useCompositeFallback: data.useCompositeFallback,
                diag: data.diag,
            });
        };

        worker.onerror = (event: ErrorEvent) => {
            const err = new Error(
                event.message
                    ? `Worker error: ${event.message} (${event.filename || 'psdWorker'}:${event.lineno || 0})`
                    : 'Unknown worker error'
            );
            console.error('[usePsdWorker] worker error', event);
            pendingRef.current.forEach(({ reject }) => reject(err));
            pendingRef.current.clear();
        };

        worker.onmessageerror = () => {
            const err = new Error('Worker message deserialization error');
            console.error('[usePsdWorker] worker message deserialization error');
            pendingRef.current.forEach(({ reject }) => reject(err));
            pendingRef.current.clear();
        };

        workerRef.current = worker;

        return () => {
            pendingRef.current.forEach(({ reject }) =>
                reject(new Error('Worker terminated'))
            );
            pendingRef.current.clear();
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    /**
     * @param onMeta レイヤーツリー（構造・表示状態）が確定した時点で呼ばれる。
     *               サムネイル用ビットマップの生成完了は待たない。
     */
    const loadPsd = useCallback(
        (buffer: ArrayBuffer, onMeta?: (psd: Psd) => void): Promise<PsdLoadResult> => {
            return new Promise((resolve, reject) => {
                const worker = workerRef.current;
                if (!worker) {
                    reject(new Error('PSD Worker is not initialized'));
                    return;
                }
                if (!buffer || buffer.byteLength === 0) {
                    reject(new Error('Cannot load PSD: buffer is empty'));
                    return;
                }

                const id = nextIdRef.current++;
                pendingRef.current.set(id, { onMeta, resolve, reject });

                const request: WorkerRequest = { id, buffer };
                try {
                    worker.postMessage(request, [buffer]);
                } catch (err) {
                    pendingRef.current.delete(id);
                    reject(new Error(
                        `Failed to send message to worker: ${err instanceof Error ? err.message : String(err)}`
                    ));
                }
            });
        },
        [],
    );

    return { loadPsd };
}
