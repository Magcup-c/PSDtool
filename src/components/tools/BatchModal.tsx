/**
 * src/components/tools/BatchModal.tsx
 * 追加: useToolProgress + ToolLogPanel で進捗ログを表示
 */

import { useState, useCallback, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { X, FolderOpen, Play, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToolProgress } from '../../hooks/useToolProgress';
import { ToolLogPanel } from './ToolLogPanel';

interface Props {
    language: 'ja' | 'en';
    onClose: () => void;
}

const L = {
    ja: {
        title:     'Batch変換',
        inputDir:  '入力フォルダ',
        outputDir: '出力フォルダ',
        format:    '形式',
        run:       '変換開始',
        cancel:    'キャンセル',
        selectDir: 'フォルダを選択',
        running:   '変換中…',
        done:      (ok: number, err: number) => `完了 — ${ok}件成功、${err}件失敗`,
        noInput:   '入力フォルダを選択してください',
        noOutput:  '出力フォルダを選択してください',
        errors:    'エラー詳細',
    },
    en: {
        title:     'Batch Convert',
        inputDir:  'Input Folder',
        outputDir: 'Output Folder',
        format:    'Format',
        run:       'Run',
        cancel:    'Cancel',
        selectDir: 'Select Folder',
        running:   'Converting…',
        done:      (ok: number, err: number) => `Done — ${ok} succeeded, ${err} failed`,
        noInput:   'Please select an input folder',
        noOutput:  'Please select an output folder',
        errors:    'Error Details',
    },
} as const;

const FORMATS = ['png', 'jpeg', 'webp'] as const;
type Fmt = typeof FORMATS[number];

interface BatchResult { ok: number; err: number; total: number; errors: string[] }

export const BatchModal = ({ language, onClose }: Props) => {
    const t = L[language];
    const [inputDir,  setInputDir]  = useState('');
    const [outputDir, setOutputDir] = useState('');
    const [format,    setFormat]    = useState<Fmt>('png');
    const [running,   setRunning]   = useState(false);
    const [result,    setResult]    = useState<BatchResult | null>(null);
    const [error,     setError]     = useState('');

    const { logs, clearLogs } = useToolProgress(running);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const pickInput = useCallback(async () => {
        const dir = await open({ directory: true, title: t.inputDir });
        if (typeof dir === 'string') setInputDir(dir);
    }, [t]);

    const pickOutput = useCallback(async () => {
        const dir = await open({ directory: true, title: t.outputDir });
        if (typeof dir === 'string') setOutputDir(dir);
    }, [t]);

    const run = useCallback(async () => {
        if (!inputDir)  { setError(t.noInput);  return; }
        if (!outputDir) { setError(t.noOutput); return; }
        setError('');
        clearLogs();
        setRunning(true);
        setResult(null);
        try {
            const sep = inputDir.includes('\\') ? '\\' : '/';
            const pattern = `${inputDir}${sep}*.psd`;
            const res = await invoke<BatchResult>('run_batch', { pattern, outputDir, format });
            setResult(res);
        } catch (e) {
            setError(String(e));
        } finally {
            setRunning(false);
        }
    }, [inputDir, outputDir, format, t, clearLogs]);

    return (
        <div className="tool-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="tool-modal">
                <div className="tool-modal-header">
                    <span className="tool-modal-title">{t.title}</span>
                    <button className="settings-modal-close" onClick={onClose}><X size={14} /></button>
                </div>

                <div className="tool-modal-body">
                    <div className="tool-field">
                        <label className="tool-label">{t.inputDir}</label>
                        <div className="tool-path-row">
                            <span className="tool-path-value">{inputDir || '—'}</span>
                            <button className="tool-pick-btn" onClick={pickInput} disabled={running}>
                                <FolderOpen size={13} />{t.selectDir}
                            </button>
                        </div>
                    </div>

                    <div className="tool-field">
                        <label className="tool-label">{t.outputDir}</label>
                        <div className="tool-path-row">
                            <span className="tool-path-value">{outputDir || '—'}</span>
                            <button className="tool-pick-btn" onClick={pickOutput} disabled={running}>
                                <FolderOpen size={13} />{t.selectDir}
                            </button>
                        </div>
                    </div>

                    <div className="tool-field">
                        <label className="tool-label">{t.format}</label>
                        <div className="tool-format-row">
                            {FORMATS.map(f => (
                                <button key={f} className={`settings-zoom-btn ${format === f ? 'active' : ''}`}
                                    onClick={() => setFormat(f)} disabled={running}>
                                    {f.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <div className="tool-error"><AlertCircle size={13} /><span>{error}</span></div>}

                    {/* 進捗ログ */}
                    <ToolLogPanel logs={logs} running={running} language={language} />

                    {result && !running && (
                        <div className={`tool-result ${result.err === 0 ? 'success' : 'warn'}`}>
                            <CheckCircle2 size={14} />
                            <div>
                                <div>{t.done(result.ok, result.err)}</div>
                                {result.errors.length > 0 && (
                                    <details style={{ marginTop: 4 }}>
                                        <summary className="tool-error-summary">{t.errors}</summary>
                                        <ul className="tool-error-list">
                                            {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                                        </ul>
                                    </details>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="tool-modal-footer">
                    <button onClick={onClose}>{t.cancel}</button>
                    <button className="btn-primary" onClick={run} disabled={running || !inputDir || !outputDir}>
                        {running ? <><span className="tab-spinner" />{t.running}</> : <><Play size={13} />{t.run}</>}
                    </button>
                </div>
            </div>
        </div>
    );
};