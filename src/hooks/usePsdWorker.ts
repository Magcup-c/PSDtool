/**
 * src/hooks/usePsdWorker.ts
 *
 * PSD の解析と ImageBitmap 生成を Web Worker で行う。
 * メインスレッドのブロックを防ぎ、大きな PSD でも UI が固まらない。
 */

import { useRef, useEffect, useCallback } from 'react';
import type { Psd } from 'ag-psd';
import type { WorkerRequest, WorkerResponse, LayerThumbEntry } from '../workers/psdWorker';

// Vite の ?worker サフィックスで Worker をバンドル
import PsdWorker from '../workers/psdWorker?worker';

export interface PsdLoadResult {
    psd: Psd;
    layers: LayerThumbEntry[];
}

export function usePsdWorker() {
    const workerRef    = useRef<Worker | null>(null);
    const pendingRef   = useRef<Map<number, {
        resolve: (result: PsdLoadResult) => void;
        reject:  (err: Error) => void;
    }>>(new Map());
    const nextIdRef    = useRef(0);

    // Worker を初期化
    useEffect(() => {
        const worker = new PsdWorker();

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const { id, psd, layers, error } = event.data;
            const pending = pendingRef.current.get(id);
            if (!pending) return;
            pendingRef.current.delete(id);

            if (error) {
                pending.reject(new Error(error));
            } else {
                pending.resolve({ psd, layers });
            }
        };

        worker.onerror = (event: ErrorEvent) => {
            // Worker 自体がクラッシュした場合、全ての pending を reject
            const err = new Error(event.message ?? 'Worker error');
            pendingRef.current.forEach(({ reject }) => reject(err));
            pendingRef.current.clear();
        };

        workerRef.current = worker;

        return () => {
            // pending があれば全て reject してから terminate
            pendingRef.current.forEach(({ reject }) =>
                reject(new Error('Worker terminated'))
            );
            pendingRef.current.clear();
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    const loadPsd = useCallback(
        (buffer: ArrayBuffer, _filePath?: string): Promise<PsdLoadResult> => {
            return new Promise((resolve, reject) => {
                const worker = workerRef.current;
                if (!worker) {
                    reject(new Error('Worker not initialized'));
                    return;
                }

                const id = nextIdRef.current++;
                pendingRef.current.set(id, { resolve, reject });

                const request: WorkerRequest = { id, buffer };
                // buffer を Transferable として渡すことでコピーなしに転送
                worker.postMessage(request, [buffer]);
            });
        },
        [],
    );

    return { loadPsd };
}