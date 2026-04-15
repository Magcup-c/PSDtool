/**
 * src/components/tools/ToolLogPanel.tsx
 *
 * 全ツールモーダルで共有するログ表示パネル。
 * logs が空のときは非表示。実行中は最新行に自動スクロール。
 */

import { useEffect, useRef, memo } from 'react';
import { LogEntry } from '../../hooks/useToolProgress';

interface ToolLogPanelProps {
    logs: LogEntry[];
    running: boolean;
    language: 'ja' | 'en';
}

export const ToolLogPanel = memo(({ logs, running, language }: ToolLogPanelProps) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    // 新しいログが追加されたら末尾へスクロール
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs.length]);

    if (logs.length === 0) return null;

    return (
        <div className="tool-log-panel">
            <div className="tool-log-header">
                <span className="tool-log-title">
                    {language === 'ja' ? 'ログ' : 'Log'}
                </span>
                {running && <span className="tool-log-spinner" />}
            </div>
            <div className="tool-log-body">
                {logs.map(entry => (
                    <div key={entry.id} className={`tool-log-row tool-log-${entry.level}`}>
                        <span className="tool-log-badge">{BADGE[entry.level]}</span>
                        <span className="tool-log-message">{entry.message}</span>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
});

const BADGE: Record<string, string> = {
    info:    'INFO',
    success: ' OK ',
    error:   'ERR ',
    warn:    'WARN',
};