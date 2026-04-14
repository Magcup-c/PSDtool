/**
 * src/components/tools/CompareModal.tsx
 *
 * 2つのPSDを比較してDiff画像を生成するモーダル。
 * [FIX] Escape キーで閉じる処理を追加
 */

import { useState, useCallback, useEffect } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { X, FolderOpen, Play, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
    language: 'ja' | 'en';
    currentFilePath: string | null;
    onClose: () => void;
}

const L = {
    ja: {
        title:       'PSD比較 (Diff)',
        fileA:       'ファイルA（元）',
        fileB:       'ファイルB（比較先）',
        output:      '出力先',
        threshold:   'しきい値',
        highlight:   'ハイライトカラー',
        run:         '比較実行',
        cancel:      'キャンセル',
        selectFile:  'PSDを選択',
        selectOut:   '保存先を選択',
        running:     '比較中…',
        done:        (pct: string, px: string) => `差分: ${pct}% (${px}px)`,
        noA:         'ファイルAを選択してください',
        noB:         'ファイルBを選択してください',
        noOutput:    '出力先を選択してください',
        currentFile: '現在のファイル',
        hlRed:       '赤',
        hlMagenta:   'マゼンタ',
        hlHeat:      'ヒートマップ',
        threshDesc:  '(0–255、差分を無視する最小値)',
    },
    en: {
        title:       'Compare PSDs',
        fileA:       'File A (original)',
        fileB:       'File B (compare)',
        output:      'Output',
        threshold:   'Threshold',
        highlight:   'Highlight Color',
        run:         'Compare',
        cancel:      'Cancel',
        selectFile:  'Select PSD',
        selectOut:   'Select Output',
        running:     'Comparing…',
        done:        (pct: string, px: string) => `Changed: ${pct}% (${px}px)`,
        noA:         'Please select File A',
        noB:         'Please select File B',
        noOutput:    'Please select an output path',
        currentFile: 'Current file',
        hlRed:       'Red',
        hlMagenta:   'Magenta',
        hlHeat:      'Heatmap',
        threshDesc:  '(0–255, min delta to count)',
    },
} as const;

type Highlight = 'red' | 'magenta' | 'heat';

interface CompareResult { changed_px: number; total_px: number; changed_pct: number; width: number; height: number }

export const CompareModal = ({ language, currentFilePath, onClose }: Props) => {
    const t = L[language];
    const [fileA,     setFileA]     = useState(currentFilePath ?? '');
    const [fileB,     setFileB]     = useState('');
    const [output,    setOutput]    = useState('');
    const [threshold, setThreshold] = useState(10);
    const [highlight, setHighlight] = useState<Highlight>('red');
    const [running,   setRunning]   = useState(false);
    const [result,    setResult]    = useState<CompareResult | null>(null);
    const [error,     setError]     = useState('');

    // [FIX] Escape で閉じる
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const pickFile = useCallback(async (setter: (v: string) => void) => {
        const f = await open({ multiple: false, filters: [{ name: 'PSD', extensions: ['psd'] }] });
        if (typeof f === 'string') setter(f);
    }, []);

    const pickOutput = useCallback(async () => {
        const f = await save({ filters: [{ name: 'PNG Image', extensions: ['png'] }], defaultPath: 'diff.png' });
        if (typeof f === 'string') setOutput(f);
    }, []);

    const run = useCallback(async () => {
        if (!fileA)  { setError(t.noA);      return; }
        if (!fileB)  { setError(t.noB);      return; }
        if (!output) { setError(t.noOutput); return; }
        setError(''); setRunning(true); setResult(null);
        try {
            const res = await invoke<CompareResult>('run_compare', {
                inputA: fileA, inputB: fileB, output, threshold, highlight,
            });
            setResult(res);
        } catch (e) {
            setError(String(e));
        } finally {
            setRunning(false);
        }
    }, [fileA, fileB, output, threshold, highlight, t]);

    const basename = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

    const hlOptions: { key: Highlight; label: string }[] = [
        { key: 'red',     label: t.hlRed     },
        { key: 'magenta', label: t.hlMagenta },
        { key: 'heat',    label: t.hlHeat    },
    ];

    return (
        <div className="tool-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="tool-modal">
                <div className="tool-modal-header">
                    <span className="tool-modal-title">{t.title}</span>
                    <button className="settings-modal-close" onClick={onClose}><X size={14} /></button>
                </div>

                <div className="tool-modal-body">
                    {/* ファイルA */}
                    <div className="tool-field">
                        <label className="tool-label">{t.fileA}</label>
                        <div className="tool-path-row">
                            <span className="tool-path-value" title={fileA}>
                                {fileA ? basename(fileA) : '—'}
                                {fileA && currentFilePath === fileA && (
                                    <span className="tool-badge">{t.currentFile}</span>
                                )}
                            </span>
                            <button className="tool-pick-btn" onClick={() => pickFile(setFileA)} disabled={running}>
                                <FolderOpen size={13} />{t.selectFile}
                            </button>
                        </div>
                    </div>

                    {/* ファイルB */}
                    <div className="tool-field">
                        <label className="tool-label">{t.fileB}</label>
                        <div className="tool-path-row">
                            <span className="tool-path-value" title={fileB}>{fileB ? basename(fileB) : '—'}</span>
                            <button className="tool-pick-btn" onClick={() => pickFile(setFileB)} disabled={running}>
                                <FolderOpen size={13} />{t.selectFile}
                            </button>
                        </div>
                    </div>

                    {/* 出力先 */}
                    <div className="tool-field">
                        <label className="tool-label">{t.output}</label>
                        <div className="tool-path-row">
                            <span className="tool-path-value" title={output}>{output ? basename(output) : '—'}</span>
                            <button className="tool-pick-btn" onClick={pickOutput} disabled={running}>
                                <FolderOpen size={13} />{t.selectOut}
                            </button>
                        </div>
                    </div>

                    {/* しきい値 */}
                    <div className="tool-field">
                        <label className="tool-label">{t.threshold} <span className="tool-label-sub">{t.threshDesc}</span></label>
                        <div className="tool-slider-row">
                            <input
                                type="range" min={0} max={255} value={threshold}
                                onChange={e => setThreshold(Number(e.target.value))}
                                className="settings-quality-slider"
                                disabled={running}
                            />
                            <span className="tool-slider-value">{threshold}</span>
                        </div>
                    </div>

                    {/* ハイライトカラー */}
                    <div className="tool-field">
                        <label className="tool-label">{t.highlight}</label>
                        <div className="tool-format-row">
                            {hlOptions.map(o => (
                                <button
                                    key={o.key}
                                    className={`settings-zoom-btn ${highlight === o.key ? 'active' : ''}`}
                                    onClick={() => setHighlight(o.key)}
                                    disabled={running}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <div className="tool-error"><AlertCircle size={13} /><span>{error}</span></div>}

                    {result && (
                        <div className={`tool-result ${result.changed_pct < 5 ? 'success' : 'warn'}`}>
                            <CheckCircle2 size={14} />
                            <div>
                                <div>{t.done(result.changed_pct.toFixed(2), result.changed_px.toLocaleString())}</div>
                                <div className="tool-result-sub">{result.width}×{result.height}px</div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="tool-modal-footer">
                    <button onClick={onClose}>{t.cancel}</button>
                    <button className="btn-primary" onClick={run} disabled={running || !fileA || !fileB || !output}>
                        {running ? <><span className="tab-spinner" />{t.running}</> : <><Play size={13} />{t.run}</>}
                    </button>
                </div>
            </div>
        </div>
    );
};