import { useState } from 'react';
import { X, Monitor, ZoomIn, Globe, Check, Laptop } from 'lucide-react';
import { AppSettings } from '../hooks/useSettings';

interface SettingsModalProps {
    settings: AppSettings;
    onUpdate: (patch: Partial<AppSettings>) => void;
    onClose: () => void;
}

const T = {
    ja: {
        title: '設定',
        appearance: '外観',
        theme: 'カラーテーマ',
        themeDesc: '配色テーマ',
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
        themes: {
            black: 'Black',
            grey: 'Grey',
            light: 'Light',
            white: 'White',
        },
    },
    en: {
        title: 'Settings',
        appearance: 'Appearance',
        theme: 'Color Theme',
        themeDesc: 'Color scheme',
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
        themes: {
            black: 'Black',
            grey: 'Grey',
            light: 'Light',
            white: 'White',
        },
    },
} as const;

const THEME_COLORS: Record<AppSettings['theme'], { bg: string; panel: string; accent: string }> = {
    black: { bg: '#000000', panel: '#080808', accent: '#a78bfa' },
    grey:  { bg: '#1a1a1a', panel: '#161616', accent: '#e8ff47' },
    light: { bg: '#e8e8e8', panel: '#f0f0f0', accent: '#f97316' },
    white: { bg: '#ffffff', panel: '#f8f8f8', accent: '#3b82f6' },
};

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2];

export const SettingsModal = ({ settings, onUpdate, onClose }: SettingsModalProps) => {
    const [local, setLocal] = useState<AppSettings>({
        ...settings,
    });
    const t = T[local.language];

    const patch = (p: Partial<AppSettings>) => setLocal(prev => ({ ...prev, ...p }));

    const handleApply = () => {
        onUpdate(local);
        onClose();
    };

    const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <div className="settings-overlay" onClick={handleOverlayClick}>
            <div className="settings-modal" onClick={e => e.stopPropagation()}>

                {/* ── ヘッダー ── */}
                <div className="settings-modal-header">
                    <span className="settings-modal-title">{t.title}</span>
                    <button className="settings-modal-close" onClick={onClose}>
                        <X size={14} />
                    </button>
                </div>

                {/* ── ボディ ── */}
                <div className="settings-modal-body">

                    {/* 外観セクション */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <Monitor size={11} />
                            <span>{t.appearance}</span>
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
                                            onClick={() => !local.syncThemeWithOS && patch({ theme: th })}
                                        >
                                            {/* ミニプレビュー */}
                                            <div className="theme-preview" style={{ background: c.bg }}>
                                                <div className="theme-preview-panel" style={{ background: c.panel }} />
                                                <div className="theme-preview-accent" style={{ background: c.accent }} />
                                            </div>
                                            <span className="theme-card-label">{t.themes[th]}</span>
                                            {isActive && (
                                                <div className="theme-card-check">
                                                    <Check size={9} />
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* OS 同期トグル */}
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

                    {/* キャンバスセクション */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <ZoomIn size={11} />
                            <span>{t.canvas}</span>
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
                    </div>

                    {/* 一般セクション */}
                    <div className="settings-section">
                        <div className="settings-section-heading">
                            <Globe size={11} />
                            <span>{t.general}</span>
                        </div>

                        <div className="settings-field">
                            <div className="settings-field-label">{t.language}</div>
                            <div className="settings-field-desc">{t.languageDesc}</div>                            <div className="settings-lang-toggle">
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
                            {/* OS 同期トグル */}
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

                        {/* 履歴件数 */}
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
                    </div>
                </div>

                {/* ── フッター ── */}
                <div className="settings-modal-footer">
                    <button onClick={onClose}>{t.cancel}</button>
                    <button className="btn-primary" onClick={handleApply}>{t.apply}</button>
                </div>
            </div>
        </div>
    );
};