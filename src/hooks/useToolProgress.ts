/**
 * src/hooks/useToolProgress.ts
 *
 * Rust の gui.rs が emit する "tool-progress" イベントを受信して
 * ログエントリのリストとして管理する共通フック。
 *
 * 各ツールモーダルから呼び出す。
 *   const { logs, clearLogs } = useToolProgress(running);
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type LogLevel = 'info' | 'success' | 'error' | 'warn';

export interface LogEntry {
    id: number;
    level: LogLevel;
    message: string;
    ts: number;
}

let _counter = 0;

export function useToolProgress(active: boolean) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const counterRef  = useRef(0);

    const clearLogs = useCallback(() => setLogs([]), []);

    const pushLog = useCallback((level: LogLevel, message: string) => {
        const entry: LogEntry = {
            id: counterRef.current++,
            level,
            message,
            ts: Date.now(),
        };
        setLogs(prev => [...prev, entry]);
    }, []);

    useEffect(() => {
        if (!active) return;

        let cancelled = false;

        listen<{ level: LogLevel; message: string }>('tool-progress', (event) => {
            if (cancelled) return;
            pushLog(event.payload.level, event.payload.message);
        }).then(fn => {
            if (cancelled) fn();
            else unlistenRef.current = fn;
        });

        return () => {
            cancelled = true;
            unlistenRef.current?.();
            unlistenRef.current = null;
        };
    }, [active, pushLog]);

    return { logs, clearLogs, pushLog };
}