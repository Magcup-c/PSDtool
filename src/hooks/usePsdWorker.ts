/**
 * src/hooks/usePsdWorker.ts
 */

import { useRef, useEffect, useCallback } from 'react';
import type { Psd } from 'ag-psd';
import type { WorkerRequest, WorkerResponse, LayerThumbEntry } from '../workers/psdWorker';

import PsdWorker from '../workers/psdWorker?worker';

export interface PsdLoadResult {
    psd: Psd;
    layers: LayerThumbEntry[];
    diag?: { totalLeaf: number; eligible: number; rendered: number; failed: number }; // ★ 追加
}

interface PendingEntry {
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
            const { id, psd, layers, error, diag } = event.data; // ★ diag を受け取る
            const pending = pendingRef.current.get(id);
            if (!pending) return;
            pendingRef.current.delete(id);

            if (error) {
                pending.reject(new Error(error));
                return;
            }
            pending.resolve({ psd, layers, diag }); // ★ diag を渡す
        };

        worker.onerror = (event: ErrorEvent) => {
            const err = new Error(
                event.message ? `Worker error: ${event.message}` : 'Unknown worker error'
            );
            pendingRef.current.forEach(({ reject }) => reject(err));
            pendingRef.current.clear();
        };

        worker.onmessageerror = () => {
            const err = new Error('Worker message deserialization error');
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

    const loadPsd = useCallback(
        (buffer: ArrayBuffer): Promise<PsdLoadResult> => {
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
                pendingRef.current.set(id, { resolve, reject });

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