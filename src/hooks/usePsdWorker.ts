/**
 * src/hooks/usePsdWorker.ts
 *
 * 改善点:
 *   - WorkerDeferredResponse（遅延ビットマップ）の受信・マージ対応
 *   - エラーメッセージをより詳細に伝播
 */

import { useRef, useEffect, useCallback } from 'react';
import type { Psd } from 'ag-psd';
import type {
    WorkerRequest,
    WorkerResponse,
    WorkerDeferredResponse,
    LayerThumbEntry,
} from '../workers/psdWorker';

import PsdWorker from '../workers/psdWorker?worker';

export interface PsdLoadResult {
    psd: Psd;
    layers: LayerThumbEntry[];
}

type IncomingMessage = WorkerResponse | WorkerDeferredResponse;

interface PendingEntry {
    resolve: (result: PsdLoadResult) => void;
    reject:  (err: Error) => void;
    /** 初回レスポンスで受け取った暫定結果 */
    partial?: { psd: Psd; layers: LayerThumbEntry[] };
    /** 遅延ビットマップを受け取るコールバック（optional） */
    onDeferred?: (entries: LayerThumbEntry[], done: boolean) => void;
}

export function usePsdWorker() {
    const workerRef  = useRef<Worker | null>(null);
    const pendingRef = useRef<Map<number, PendingEntry>>(new Map());
    const nextIdRef  = useRef(0);

    useEffect(() => {
        const worker = new PsdWorker();

        worker.onmessage = (event: MessageEvent<IncomingMessage>) => {
            const msg = event.data;

            // ── 遅延レスポンス ────────────────────────────────────────────
            if ('kind' in msg && msg.kind === 'deferred') {
                const { id, layers, done } = msg as WorkerDeferredResponse;
                const pending = pendingRef.current.get(id);
                if (!pending) return;

                if (pending.onDeferred) {
                    pending.onDeferred(layers, done);
                }
                // done フラグが立ったら pending から除去
                if (done) pendingRef.current.delete(id);
                return;
            }

            // ── 初回レスポンス ────────────────────────────────────────────
            const { id, psd, layers, error, hasPending } = msg as WorkerResponse;
            const pending = pendingRef.current.get(id);
            if (!pending) return;

            if (error) {
                pendingRef.current.delete(id);
                pending.reject(new Error(error));
                return;
            }

            if (!hasPending) {
                // 遅延なし: そのまま resolve
                pendingRef.current.delete(id);
                pending.resolve({ psd, layers });
            } else {
                // 遅延あり: 初回分で resolve し、遅延分は onDeferred で通知
                pending.partial = { psd, layers };
                pending.resolve({ psd, layers });
                // pending は残しておき、deferred メッセージを受信し続ける
            }
        };

        worker.onerror = (event: ErrorEvent) => {
            const err = new Error(
                event.message
                    ? `Worker error: ${event.message}`
                    : 'Unknown worker error'
            );
            // 全 pending を reject
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
            // 残った pending を全て reject
            pendingRef.current.forEach(({ reject }) =>
                reject(new Error('Worker terminated'))
            );
            pendingRef.current.clear();
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    /**
     * PSD を Worker で解析する。
     *
     * @param buffer    - ArrayBuffer（Transferable として渡されるため呼び出し後は使用不可）
     * @param onDeferred - 遅延ビットマップを受信するたびに呼ばれるコールバック（任意）
     */
    const loadPsd = useCallback(
        (
            buffer: ArrayBuffer,
            _filePath?: string,
            onDeferred?: (entries: LayerThumbEntry[], done: boolean) => void,
        ): Promise<PsdLoadResult> => {
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
                pendingRef.current.set(id, { resolve, reject, onDeferred });

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