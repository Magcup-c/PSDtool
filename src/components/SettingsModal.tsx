/**
 * src/components/SettingsModal.tsx
 *
 * 変更点:
 *   1. テーマ選択時に即時プレビュー（onPreview コールバック）
 *   2. 書き出し設定セクションを追加（形式・品質）
 *   3. Cancel 時にプレビューをロールバック
 *   4. onError prop を追加し、Windows 以外での open_default_app_settings
 *      エラーをトーストで通知する（console に握りつぶさない）
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Monitor, ZoomIn, Globe, Check, Laptop, HelpCircle, Download } from 'lucide-react';
import { AppSettings, ExportFormat } from '../hooks/useSettings';

interface SettingsModalProps {
    settings: AppSettings;
    onUpdate: (patch: Partial<AppSettings>) => void;
    onClose: () => void;
    /** テーマ即時プレビュー用 — モーダルを閉じずにテーマだけ切り替える */
    onPreview: (theme: AppSettings['theme']) => void;
    /** エラー通知用 — 呼び出し元の showToast などに繋ぐ */
    onError: (msg: string) => void;
}

const T = {
    ja: {
        title: '設定',
        appearance: '外観',
        theme: 'カラーテーマ',
        themeDesc: '配色テーマ（選択で即時プレビュー）',
        canvas: 'キャンバス',
        defaultZoom: '初期ズーム',
        defaultZoomDesc: 'ファイルを開いた時の倍率',
        general: '基本',
        language: '表示言語',
        languageDesc: 'UI言語',
        syncTheme: 'OS設定に従う',
        syncThemeDesc: 'ライト / ダークを自動切り替え',
        syncLang: 'OS設定に従う',
        syncLangDesc: 'システム言語を使用',
        recentFiles: '最近使ったファイル',
        recentFilesDesc: '履歴の最大件数',
        cancel: 'キャンセル',
        apply: 'OK',
        defaultApp: '既定のアプリ',
        defaultAppDesc: '.psdファイルを本アプリに関連付けます',
        openOSSettings: 'OSの設定を開く',
        defaultAppNote: '※OS設定の「ファイルの種類ごとに既定のアプリを選ぶ」から、.psdを本アプリに変更してください。(Windows のみ対応)',
        themes: { black: 'Black', grey: 'Grey', light: 'Light', white: 'White' },
        help: 'ヘルプ',
        shortcuts: 'ショートカット (プレビューエリア)',
        shortcutZoomIn: 'ズームイン',
        shortcutZoomOut: 'ズームアウト',
        shortcutFit: '全画面表示にする',
        shortcutPan: 'パン (移動)',
        about: 'このアプリについて',
        scrollAction: 'スクロール動作',
        scrollActionDesc: 'Ctrl無しのホイール（2本指）操作',
        scrollActionZoom: '拡大・縮小',
        scrollActionPan: '上下移動 (Pan)',
        // 書き出し
        exportSection: '書き出し',
        exportFormat: '書き出し形式',
        exportFormatDesc: 'PNG / JPEG / WebP / SVG',
        exportQuality: '品質 (JPEG / WebP)',
        exportQualityDesc: '数値が大きいほど高品質・大容量',
        exportQualityCustom: 'カスタム',
        exportFormatLabels: { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', svg: 'SVG' },
    },
    en: {
        title: 'Settings',
        appearance: 'Appearance',
        theme: 'Color Theme',
        themeDesc: 'Color scheme (click to preview instantly)',
        syncTheme: 'Follow OS',
        syncThemeDesc: 'Auto-switch light / dark',
        canvas: 'Canvas',
        defaultZoom: 'Default Zoom',
        defaultZoomDesc: 'Zoom level on file open',
        general: 'General',
        language: 'Language',
        languageDesc: 'UI language',
        syncLang: 'Follow OS',
        syncLangDesc: 'Use system language',
        recentFiles: 'Recent Files',
        recentFilesDesc: 'Max entries in history',
        cancel: 'Cancel',
        apply: 'OK',
        defaultApp: 'Default App',
        defaultAppDesc: 'Associate .psd files with this app',
        openOSSettings: 'Open OS Settings',
        defaultAppNote: 'Note: Go to "Choose default apps by file type" in OS settings and change .psd to this app. (Windows only)',
        themes: { black: 'Black', grey: 'Grey', light: 'Light', white: 'White' },
        help: 'Help',
        shortcuts: 'Shortcuts (Preview Area)',
        shortcutZoomIn: 'Zoom In',
        shortcutZoomOut: 'Zoom Out',
        shortcutFit: 'Fit to View',
        shortcutPan: 'Pan Tool',
        about: 'About',
        scrollAction: 'Scroll Action',
        scrollActionDesc: 'Mouse wheel without Ctrl',
        scrollActionZoom: 'Zoom In/Out',
        scrollActionPan: 'Pan Tool',
        // Export
        exportSection: 'Export',
        exportFormat: 'Export Format',
        exportFormatDesc: 'PNG / JPEG / WebP / SVG',
        exportQuality: 'Quality (JPEG / WebP)',
        exportQualityDesc: 'Higher value = better quality, larger file',
        exportQualityCustom: 'Custom',
        exportFormatLabels: { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', svg: 'SVG' },
    },
} as const;

const THEME_COLORS: Record<AppSettings['theme'], { bg: string; panel: string; accent: string }> = {
    black: { bg: '#000000', panel: '#080808', accent: '#a78bfa' },
    grey:  { bg: '#1a1a1a', panel: '#161616', accent: '#e8ff47' },
    light: { bg: '#e8e8e8', panel: '#f0f0f0', accent: '#f97316' },
    white: { bg: '#ffffff', panel: '#f8f8f8', accent: '#3b82f6' },
};

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2];
const QUALITY_PRESETS = [0.6, 0.75, 0.85, 0.95, 1.0];
const EXPORT_FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp', 'svg'];

import { invoke } from '@tauri-apps/api/core';

export const SettingsModal = ({ settings, onUpdate, onClose, onPreview, onError }: SettingsModalProps) => {
    // ローカル編集状態（Cancel 時に捨てる）
    const [local, setLocal] = useState<AppSettings>({ ...settings });
    const [qualityCustom, setQualityCustom] = useState(() => !isPresetQuality(settings.exportQuality ?? 0.92));
    const t = T[local.language];

    const patch = useCallback((p: Partial<AppSettings>) => {
        setLocal(prev => ({ ...prev, ...p }));
    }, []);

    /** テーマ選択: ローカル変更 + 即時プレビュー */
    const handleThemeSelect = useCallback((th: AppSettings['theme']) => {
        if (local.syncThemeWithOS) return;
        patch({ theme: th });
        onPreview(th);
    }, [local.syncThemeWithOS, patch, onPreview]);

    const handleApply = useCallback(() => {
        onUpdate(local);
        onClose();
    }, [local, onUpdate, onClose]);

    /** Cancel: 元のテーマに戻す */
    const handleCancel = useCallback(() => {
        onPreview(settings.theme);
        onClose();
    }, [settings.theme, onPreview, onClose]);

    const handleOpenDefaultApps = async () => {
        try {
            await invoke('open_default_app_settings');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            onError(
                local.language === 'ja'
                    ? `OS設定を開けませんでした: ${msg}`
                    : `Failed to open OS settings: ${msg}`
            );
        }
    };

    const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) handleCancel();
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleCancel();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleCancel]);

    return (
        <div className="settings-overlay" onClick={handleOverlayClick}>
            <div className="settings-modal" onClick={e => e.stopPropagation()}>

                {/* ── ヘッダー ── */}
                <div className="settings-modal-header">
                    <span className="settings-modal-title">{t.title}</span>
                    <button className="settings-modal-close" onClick={handleCancel}>
                        <X size={14} />
                    </button>
                </div>

                {/* ── ボディ ── */}
                <div className="settings-modal-body">

                    {/* 外観 */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <Monitor size={11} /><span>{t.appearance}</span>
                        </div>
                        <div className="settings-field">
                            <div className="settings-field-label">{t.theme}</div>
                            <div className="settings-field-desc">{t.themeDesc}</div>
                            <div className="settings-theme-grid">
                                {(['black', 'grey', 'light', 'white'] as const).map(th => {
                                    const c = THEME_COLORS[th];
                                    const isActive = local.theme === th;
                                    return (
                                        <button
                                            key={th}
                                            className={`settings-theme-card ${isActive ? 'active' : ''} ${local.syncThemeWithOS ? 'disabled' : ''}`}
                                            onClick={() => handleThemeSelect(th)}
                                        >
                                            <div className="theme-preview" style={{ background: c.bg }}>
                                                <div className="theme-preview-panel" style={{ background: c.panel }} />
                                                <div className="theme-preview-accent" style={{ background: c.accent }} />
                                            </div>
                                            <span className="theme-card-label">{t.themes[th]}</span>
                                            {isActive && <div className="theme-card-check"><Check size={9} /></div>}
                                        </button>
                                    );
                                })}
                            </div>
                            <label className="settings-os-sync-row">
                                <div className="settings-os-sync-text">
                                    <Laptop size={12} />
                                    <div>
                                        <div className="settings-os-sync-label">{t.syncTheme}</div>
                                        <div className="settings-os-sync-desc">{t.syncThemeDesc}</div>
                                    </div>
                                </div>
                                <div
                                    className={`settings-toggle ${local.syncThemeWithOS ? 'on' : ''}`}
                                    onClick={() => patch({ syncThemeWithOS: !local.syncThemeWithOS })}
                                />
                            </label>
                        </div>
                    </div>

                    {/* キャンバス */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <ZoomIn size={11} /><span>{t.canvas}</span>
                        </div>
                        <div className="settings-field">
                            <div className="settings-field-label">{t.defaultZoom}</div>
                            <div className="settings-field-desc">{t.defaultZoomDesc}</div>
                            <div className="settings-zoom-presets">
                                {ZOOM_PRESETS.map(z => (
                                    <button
                                        key={z}
                                        className={`settings-zoom-btn ${local.defaultZoom === z ? 'active' : ''}`}
                                        onClick={() => patch({ defaultZoom: z })}
                                    >
                                        {Math.round(z * 100)}%
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="settings-field" style={{ marginTop: 12 }}>
                            <div className="settings-field-label">{t.scrollAction}</div>
                            <div className="settings-field-desc">{t.scrollActionDesc}</div>
                            <div className="settings-lang-toggle" style={{ marginTop: 8, justifyContent: 'flex-start' }}>
                                <button
                                    className={`settings-lang-btn ${(local.scrollAction ?? 'pan') === 'pan' ? 'active' : ''}`}
                                    onClick={() => patch({ scrollAction: 'pan' })}
                                >{t.scrollActionPan}</button>
                                <button
                                    className={`settings-lang-btn ${(local.scrollAction ?? 'pan') === 'zoom' ? 'active' : ''}`}
                                    onClick={() => patch({ scrollAction: 'zoom' })}
                                >{t.scrollActionZoom}</button>
                            </div>
                        </div>
                    </div>

                    {/* ── 書き出し ── */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <Download size={11} /><span>{t.exportSection}</span>
                        </div>

                        {/* 形式 */}
                        <div className="settings-field">
                            <div className="settings-field-label">{t.exportFormat}</div>
                            <div className="settings-field-desc">{t.exportFormatDesc}</div>
                            <div className="settings-export-format-grid">
                                {EXPORT_FORMATS.map(fmt => (
                                    <button
                                        key={fmt}
                                        className={`settings-export-format-btn ${(local.exportFormat ?? 'png') === fmt ? 'active' : ''}`}
                                        onClick={() => patch({ exportFormat: fmt })}
                                    >
                                        <span className="export-fmt-badge">{fmt.toUpperCase()}</span>
                                        <span className="export-fmt-desc">{getFormatDesc(fmt, local.language)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 品質スライダー (JPEG / WebP のみ有効) */}
                        {(local.exportFormat === 'jpeg' || local.exportFormat === 'webp') && (
                            <div className="settings-field" style={{ marginTop: 12 }}>
                                <div className="settings-field-label">{t.exportQuality}</div>
                                <div className="settings-field-desc">{t.exportQualityDesc}</div>
                                <div className="settings-quality-row">
                                    <div className="settings-zoom-presets">
                                        {QUALITY_PRESETS.map(q => (
                                            <button
                                                key={q}
                                                className={`settings-zoom-btn ${!qualityCustom && isSameQuality(local.exportQuality ?? 0.92, q) ? 'active' : ''}`}
                                                onClick={() => {
                                                    setQualityCustom(false);
                                                    patch({ exportQuality: q });
                                                }}
                                            >
                                                {Math.round(q * 100)}%
                                            </button>
                                        ))}
                                        <button
                                            className={`settings-zoom-btn ${qualityCustom ? 'active' : ''}`}
                                            onClick={() => {
                                                setQualityCustom(true);
                                                if (local.exportQuality == null) patch({ exportQuality: 0.92 });
                                            }}
                                        >
                                            {t.exportQualityCustom}
                                        </button>
                                    </div>
                                    {qualityCustom && (
                                        <div className="settings-quality-slider-row">
                                            <input
                                                type="range"
                                                className="settings-quality-slider"
                                                min={10} max={100}
                                                value={Math.round((local.exportQuality ?? 0.92) * 100)}
                                                onChange={e => {
                                                    setQualityCustom(true);
                                                    const next = clampQuality(parseInt(e.target.value, 10) / 100);
                                                    patch({ exportQuality: next });
                                                }}
                                            />
                                            <div className="settings-quality-input" aria-live="polite">
                                                {Math.round((local.exportQuality ?? 0.92) * 100)}
                                            </div>
                                            <div className="settings-quality-value">%</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* SVG 注意書き */}
                        {local.exportFormat === 'svg' && (
                            <div className="settings-export-note">
                                {local.language === 'ja'
                                    ? (
                                        <>
                                            SVGはキャンバスをラスターとして埋め込みます
                                            <br />
                                            (ベクター変換ではありません)
                                        </>
                                    )
                                    : 'SVG embeds the canvas as a raster image (not vector conversion)'}
                            </div>
                        )}
                    </div>

                    {/* 一般 */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <Globe size={11} /><span>{t.general}</span>
                        </div>
                        <div className="settings-field">
                            <div className="settings-field-label">{t.language}</div>
                            <div className="settings-field-desc">{t.languageDesc}</div>
                            <div className="settings-lang-toggle">
                                {(['ja', 'en'] as const).map(lang => (
                                    <button
                                        key={lang}
                                        className={`settings-lang-btn ${local.language === lang ? 'active' : ''} ${local.syncLangWithOS ? 'disabled' : ''}`}
                                        onClick={() => !local.syncLangWithOS && patch({ language: lang })}
                                    >
                                        {lang === 'ja' ? '日本語' : 'English'}
                                    </button>
                                ))}
                            </div>
                            <label className="settings-os-sync-row" style={{ marginTop: 8 }}>
                                <div className="settings-os-sync-text">
                                    <Laptop size={12} />
                                    <div>
                                        <div className="settings-os-sync-label">{t.syncLang}</div>
                                        <div className="settings-os-sync-desc">{t.syncLangDesc}</div>
                                    </div>
                                </div>
                                <div
                                    className={`settings-toggle ${local.syncLangWithOS ? 'on' : ''}`}
                                    onClick={() => patch({ syncLangWithOS: !local.syncLangWithOS })}
                                />
                            </label>
                        </div>
                        <div className="settings-field" style={{ marginTop: 12 }}>
                            <div className="settings-field-label">{t.recentFiles}</div>
                            <div className="settings-field-desc">{t.recentFilesDesc}</div>
                            <div className="settings-zoom-presets">
                                {[5, 10, 15, 20].map(n => (
                                    <button
                                        key={n}
                                        className={`settings-zoom-btn ${(local.maxRecentFiles ?? 10) === n ? 'active' : ''}`}
                                        onClick={() => patch({ maxRecentFiles: n })}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="settings-field" style={{ marginTop: 12 }}>
                            <div className="settings-field-label">{t.defaultApp}</div>
                            <div className="settings-field-desc">{t.defaultAppDesc}</div>
                            <div style={{ marginTop: 8 }}>
                                <button className="settings-action-btn" onClick={handleOpenDefaultApps}>
                                    {t.openOSSettings}
                                </button>
                                <div style={{ fontSize: '10px', color: 'var(--text-weak)', marginTop: 4, lineHeight: '1.4' }}>
                                    {t.defaultAppNote}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ヘルプ */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <HelpCircle size={11} /><span>{t.help}</span>
                        </div>
                        <div className="settings-field">
                            <div className="settings-field-label">{t.shortcuts}</div>
                            <div className="shortcut-list">
                                {[
                                    [t.shortcutZoomIn,  'Ctrl', '+'],
                                    [t.shortcutZoomOut, 'Ctrl', '-'],
                                    [t.shortcutFit,     'Ctrl', '0'],
                                    [t.shortcutPan,     'Space','Drag'],
                                ].map(([label, k1, k2]) => (
                                    <div key={label} className="shortcut-row">
                                        <span>{label}</span>
                                        <div className="shortcut-keys">
                                            <kbd>{k1}</kbd><span>+</span><kbd>{k2}</kbd>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="settings-field" style={{ marginTop: 12 }}>
                            <div className="settings-field-label">{t.about}</div>
                            <div className="settings-field-desc">psdStudio v0.1.0</div>
                        </div>
                    </div>
                </div>

                {/* ── フッター ── */}
                <div className="settings-modal-footer">
                    <button onClick={handleCancel}>{t.cancel}</button>
                    <button className="btn-primary" onClick={handleApply}>{t.apply}</button>
                </div>
            </div>
        </div>
    );
};

function getFormatDesc(fmt: ExportFormat, lang: 'ja' | 'en'): string {
    const ja: Record<ExportFormat, string> = {
        png:  '透過対応・可逆',
        jpeg: '高圧縮・写真向け',
        webp: '高効率・透過対応',
        svg:  '埋め込みラスター',
    };
    const en: Record<ExportFormat, string> = {
        png:  'Lossless, alpha',
        jpeg: 'Lossy, photos',
        webp: 'Efficient, alpha',
        svg:  'Embedded raster',
    };
    return lang === 'ja' ? ja[fmt] : en[fmt];
}

function isSameQuality(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.0001;
}

function isPresetQuality(q: number): boolean {
    return QUALITY_PRESETS.some(p => isSameQuality(q, p));
}

function clampQuality(q: number): number {
    if (Number.isNaN(q)) return 0.92;
    return Math.min(1, Math.max(0.1, q));
}