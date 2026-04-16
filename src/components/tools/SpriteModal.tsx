/**
 * src/components/tools/SpriteModal.tsx
 * 追加: useToolProgress + ToolLogPanel で進捗ログを表示
 */

import { useState, useCallback, useEffect } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
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
        title:      'スプライトシート',
        inputDir:   '入力フォルダ (*.psd)',
        output:     '出力ファイル',
        layout:     'レイアウト',
        cols:       '列数 (Grid時)',
        padding:    'パディング (px)',
        format:     '形式',
        jsonOut:    'JSONマップを出力',
        run:        '生成',
        cancel:     'キャンセル',
        selectDir:  'フォルダを選択',
        selectOut:  '保存先を選択',
        running:    '生成中…',
        done:       (w: number, h: number, n: number) => `完了 — ${w}×${h}px、${n}枚`,
        noInput:    '入力フォルダを選択してください',
        noOutput:   '出力先を選択してください',
        lHoriz:     '横並び',
        lVert:      '縦並び',
        lGrid:      'グリッド',
    },
    en: {
        title:      'Sprite Sheet',
        inputDir:   'Input Folder (*.psd)',
        output:     'Output File',
        layout:     'Layout',
        cols:       'Columns (Grid)',
        padding:    'Padding (px)',
        format:     'Format',
        jsonOut:    'Export JSON map',
        run:        'Generate',
        cancel:     'Cancel',
        selectDir:  'Select Folder',
        selectOut:  'Select Output',
        running:    'Generating…',
        done:       (w: number, h: number, n: number) => `Done — ${w}×${h}px, ${n} frames`,
        noInput:    'Please select an input folder',
        noOutput:   'Please select an output path',
        lHoriz:     'Horizontal',
        lVert:      'Vertical',
        lGrid:      'Grid',
    },
} as const;

const FORMATS = ['png', 'jpeg', 'webp'] as const;
type Fmt     = typeof FORMATS[number];
type Layout  = 'horizontal' | 'vertical' | 'grid';

interface SpriteResult { width: number; height: number; frame_count: number }

export const SpriteModal = ({ language, onClose }: Props) => {
    const t = L[language];
    const [inputDir,   setInputDir]   = useState('');
    const [output,     setOutput]     = useState('');
    const [layout,     setLayout]     = useState<Layout>('horizontal');
    const [cols,       setCols]       = useState(4);
    const [padding,    setPadding]    = useState(4);
    const [format,     setFormat]     = useState<Fmt>('png');
    const [exportJson, setExportJson] = useState(false);
    const [running,    setRunning]    = useState(false);
    const [result,     setResult]     = useState<SpriteResult | null>(null);
    const [error,      setError]      = useState('');

    const { logs, clearLogs } = useToolProgress();

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const pickInput = useCallback(async () => {
        const dir = await open({ directory: true });
        if (typeof dir === 'string') setInputDir(dir);
    }, []);

    const pickOutput = useCallback(async () => {
        const ext = format === 'jpeg' ? 'jpg' : format;
        const f = await save({ filters: [{ name: 'Image', extensions: [ext] }], defaultPath: `sprite.${ext}` });
        if (typeof f === 'string') setOutput(f);
    }, [format]);

    const run = useCallback(async () => {
        if (!inputDir) { setError(t.noInput);  return; }
        if (!output)   { setError(t.noOutput); return; }
        setError('');
        clearLogs();
        setRunning(true);
        setResult(null);
        const sep = inputDir.includes('\\') ? '\\' : '/';
        const pattern = `${inputDir}${sep}*.psd`;
        const jsonOut = exportJson
            ? output.replace(/\.[^.]+$/, '.json')
            : null;
        try {
            const res = await invoke<SpriteResult>('run_sprite', {
                pattern, output, layout, cols, padding, format, jsonOut,
            });
            setResult(res);
        } catch (e) {
            setError(String(e));
        } finally {
            setRunning(false);
        }
    }, [inputDir, output, layout, cols, padding, format, exportJson, t, clearLogs]);

    const basename = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

    const layouts: { key: Layout; label: string }[] = [
        { key: 'horizontal', label: t.lHoriz },
        { key: 'vertical',   label: t.lVert  },
        { key: 'grid',       label: t.lGrid  },
    ];

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
                        <label className="tool-label">{t.output}</label>
                        <div className="tool-path-row">
                            <span className="tool-path-value">{output ? basename(output) : '—'}</span>
                            <button className="tool-pick-btn" onClick={pickOutput} disabled={running}>
                                <FolderOpen size={13} />{t.selectOut}
                            </button>
                        </div>
                    </div>

                    <div className="tool-field">
                        <label className="tool-label">{t.layout}</label>
                        <div className="tool-format-row">
                            {layouts.map(l => (
                                <button
                                    key={l.key}
                                    className={`settings-zoom-btn ${layout === l.key ? 'active' : ''}`}
                                    onClick={() => setLayout(l.key)}
                                    disabled={running}
                                >
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {layout === 'grid' && (
                        <div className="tool-field">
                            <label className="tool-label">{t.cols}</label>
                            <div className="tool-slider-row">
                                <input
                                    type="range" min={1} max={16} value={cols}
                                    onChange={e => setCols(Number(e.target.value))}
                                    className="settings-quality-slider"
                                    disabled={running}
                                />
                                <span className="tool-slider-value">{cols}</span>
                            </div>
                        </div>
                    )}

                    <div className="tool-field">
                        <label className="tool-label">{t.padding}</label>
                        <div className="tool-slider-row">
                            <input
                                type="range" min={0} max={32} value={padding}
                                onChange={e => setPadding(Number(e.target.value))}
                                className="settings-quality-slider"
                                disabled={running}
                            />
                            <span className="tool-slider-value">{padding}px</span>
                        </div>
                    </div>

                    <div className="tool-field">
                        <label className="tool-label">{t.format}</label>
                        <div className="tool-format-row">
                            {FORMATS.map(f => (
                                <button
                                    key={f}
                                    className={`settings-zoom-btn ${format === f ? 'active' : ''}`}
                                    onClick={() => setFormat(f)}
                                    disabled={running}
                                >
                                    {f.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    <label className="tool-checkbox-row">
                        <input
                            type="checkbox"
                            checked={exportJson}
                            onChange={e => setExportJson(e.target.checked)}
                            disabled={running}
                        />
                        <span>{t.jsonOut}</span>
                    </label>

                    {error && <div className="tool-error"><AlertCircle size={13} /><span>{error}</span></div>}

                    {/* 進捗ログ */}
                    <ToolLogPanel logs={logs} running={running} language={language} />

                    {result && !running && (
                        <div className="tool-result success">
                            <CheckCircle2 size={14} />
                            <div>{t.done(result.width, result.height, result.frame_count)}</div>
                        </div>
                    )}
                </div>

                <div className="tool-modal-footer">
                    <button onClick={onClose}>{t.cancel}</button>
                    <button className="btn-primary" onClick={run} disabled={running || !inputDir || !output}>
                        {running ? <><span className="tab-spinner" />{t.running}</> : <><Play size={13} />{t.run}</>}
                    </button>
                </div>
            </div>
        </div>
    );
};