/**
 * src/hooks/useToolProgress.ts
 *
 * Rust の gui.rs が emit する "tool-progress" イベントを受信して
 * ログエントリのリストとして管理する共通フック。
 *
 * ⚠️ 修正ポイント:
 *   以前は running=true の間だけ listen していたが、
 *   モーダルがマウントされた時点で常にリッスン開始するよう変更。
 *   こうすることで invoke() を呼ぶ前にリスナーが確実に登録される。
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type LogLevel = 'info' | 'success' | 'error' | 'warn';

export interface LogEntry {
    id: number;
    level: LogLevel;
    message: string;
}

export function useToolProgress() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const counterRef   = useRef(0);
    const unlistenRef  = useRef<UnlistenFn | null>(null);

    // マウント時に即リスナー登録、アンマウント時に解除
    useEffect(() => {
        let cancelled = false;

        listen<{ level: LogLevel; message: string }>('tool-progress', (event) => {
            if (cancelled) return;
            setLogs(prev => [
                ...prev,
                {
                    id: counterRef.current++,
                    level: event.payload.level,
                    message: event.payload.message,
                },
            ]);
        }).then(fn => {
            if (cancelled) {
                fn(); // すでにアンマウントされていたら即解除
            } else {
                unlistenRef.current = fn;
            }
        });

        return () => {
            cancelled = true;
            unlistenRef.current?.();
            unlistenRef.current = null;
        };
    }, []); // 依存配列空 = マウント時に一度だけ

    const clearLogs = useCallback(() => setLogs([]), []);

    return { logs, clearLogs };
}