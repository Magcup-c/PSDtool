/**
 * src/components/tools/ExportLayersModal.tsx
 * 修正: Escape で閉じる
 */

import { useState, useCallback, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { X, FolderOpen, Play, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
    language: 'ja' | 'en';
    currentFilePath?: string | null;
    onClose: () => void;
}

const L = {
    ja: {
        title:      'レイヤー書き出し',
        input:      '入力ファイル (*.psd)',
        outputDir:  '出力フォルダ',
        format:     '形式',
        run:        '書き出し実行',
        cancel:     'キャンセル',
        selectFile: 'ファイルを選択',
        selectDir:  'フォルダを選択',
        running:    '書き出し中…',
        done:       (n: number) => `完了 — ${n}枚のレイヤーを保存しました`,
        noInput:    '入力ファイルを選択してください',
        noOutput:   '出力フォルダを選択してください',
    },
    en: {
        title:      'Export Layers',
        input:      'Input File (*.psd)',
        outputDir:  'Output Folder',
        format:     'Format',
        run:        'Export',
        cancel:     'Cancel',
        selectFile: 'Select PSD',
        selectDir:  'Select Folder',
        running:    'Exporting…',
        done:       (n: number) => `Done — exported ${n} layers`,
        noInput:    'Please select an input file',
        noOutput:   'Please select an output folder',
    },
} as const;

const FORMATS = ['png', 'jpeg', 'webp'] as const;
type Fmt = typeof FORMATS[number];

export const ExportLayersModal = ({ language, currentFilePath, onClose }: Props) => {
    const t = L[language];
    const [inputPath,  setInputPath]  = useState('');
    const [outputDir,  setOutputDir]  = useState('');
    const [format,     setFormat]     = useState<Fmt>('png');
    const [running,    setRunning]    = useState(false);
    const [resultCount,setResultCount]= useState<number | null>(null);
    const [error,      setError]      = useState('');

    // 既存ファイルがあるなら初期値として利用
    useEffect(() => {
        if (!inputPath && currentFilePath) setInputPath(currentFilePath);
    }, [currentFilePath, inputPath]);

    // Escape で閉じる
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const pickInput = useCallback(async () => {
        const f = await open({ multiple: false, filters: [{ name: 'PSD', extensions: ['psd'] }] });
        if (typeof f === 'string') setInputPath(f);
    }, []);

    const pickOutput = useCallback(async () => {
        const dir = await open({ directory: true });
        if (typeof dir === 'string') setOutputDir(dir);
    }, []);

    const run = useCallback(async () => {
        if (!inputPath) { setError(t.noInput);  return; }
        if (!outputDir) { setError(t.noOutput); return; }
        setError(''); setRunning(true); setResultCount(null);
        try {
            const count = await invoke<number>('run_export_layers', {
                input: inputPath, outputDir, format,
            });
            setResultCount(count);
        } catch (e) {
            setError(String(e));
        } finally {
            setRunning(false);
        }
    }, [inputPath, outputDir, format, t]);

    return (
        <div className="tool-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="tool-modal">
                <div className="tool-modal-header">
                    <span className="tool-modal-title">{t.title}</span>
                    <button className="settings-modal-close" onClick={onClose}><X size={14} /></button>
                </div>

                <div className="tool-modal-body">
                    <div className="tool-field">
                        <label className="tool-label">{t.input}</label>
                        <div className="tool-path-row">
                            <span className="tool-path-value">{inputPath || '—'}</span>
                            <button className="tool-pick-btn" onClick={pickInput} disabled={running}>
                                <FolderOpen size={13} />{t.selectFile}
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

                    {resultCount !== null && (
                        <div className="tool-result success">
                            <CheckCircle2 size={14} />
                            <div>{t.done(resultCount)}</div>
                        </div>
                    )}
                </div>

                <div className="tool-modal-footer">
                    <button onClick={onClose}>{t.cancel}</button>
                    <button className="btn-primary" onClick={run} disabled={running || !inputPath || !outputDir}>
                        {running ? <><span className="tab-spinner" />{t.running}</> : <><Play size={13} />{t.run}</>}
                    </button>
                </div>
            </div>
        </div>
    );
};
