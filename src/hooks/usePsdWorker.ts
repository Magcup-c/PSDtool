/**
 * src/hooks/usePsdWorker.ts
 *
 * PSD Worker のライフサイクルを管理するフック。
 *
 * - Worker は初回マウント時に生成し、アンマウント時に終了する
 * - loadPsd(buffer) を呼ぶと Promise<WorkerResponse> が返る
 * - 複数ファイルを連続で開いた場合も id で応答を照合するので混線しない
 */

import { useRef, useEffect, useCallback } from 'react';
import type { WorkerRequest, WorkerResponse } from '../workers/psdWorker';

type PendingResolver = {
    resolve: (res: WorkerResponse) => void;
    reject: (err: Error) => void;
};

export function usePsdWorker() {
    const workerRef = useRef<Worker | null>(null);
    const pendingRef = useRef<Map<number, PendingResolver>>(new Map());
    const nextIdRef = useRef(0);

    // Worker 初期化（マウント時に一度だけ）
    useEffect(() => {
        // Vite の ?worker 構文でバンドル時にワーカーファイルを分割する
        const worker = new Worker(
            new URL('../workers/psdWorker.ts', import.meta.url),
            { type: 'module' },
        );

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const { id, error } = event.data;
            const pending = pendingRef.current.get(id);
            if (!pending) return;
            pendingRef.current.delete(id);
            if (error) {
                pending.reject(new Error(error));
            } else {
                pending.resolve(event.data);
            }
        };

        worker.onerror = (err) => {
            // 全 pending を reject（Worker がクラッシュした場合）
            for (const { reject } of pendingRef.current.values()) {
                reject(new Error(err.message ?? 'Worker error'));
            }
            pendingRef.current.clear();
        };

        workerRef.current = worker;
        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    /**
     * PSD ファイルの ArrayBuffer を Worker に渡してデコードさせる。
     * buffer は Transferable として転送されるのでゼロコピー。
     */
    const loadPsd = useCallback((buffer: ArrayBuffer): Promise<WorkerResponse> => {
        return new Promise((resolve, reject) => {
            const worker = workerRef.current;
            if (!worker) {
                reject(new Error('Worker not initialized'));
                return;
            }
            const id = nextIdRef.current++;
            pendingRef.current.set(id, { resolve, reject });

            const request: WorkerRequest = { id, buffer };
            // buffer を transfer することでコピーなし渡し
            worker.postMessage(request, [buffer]);
        });
    }, []);

    return { loadPsd };
}