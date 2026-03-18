import { useState } from 'react';
import { X, Monitor, ZoomIn, Globe, Check } from 'lucide-react';
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
        theme: 'テーマ',
        themeDesc: 'エディターの配色テーマを選択します',
        canvas: 'キャンバス',
        defaultZoom: 'デフォルトズーム',
        defaultZoomDesc: 'ファイルを開いた時の初期倍率',
        general: '一般',
        language: '言語',
        languageDesc: 'UIの表示言語',
        cancel: 'キャンセル',
        apply: '適用',
        themes: {
            black: 'ブラック',
            grey: 'グレー',
            light: 'ライト',
            white: 'ホワイト',
        },
    },
    en: {
        title: 'Settings',
        appearance: 'Appearance',
        theme: 'Theme',
        themeDesc: 'Choose the editor color scheme',
        canvas: 'Canvas',
        defaultZoom: 'Default Zoom',
        defaultZoomDesc: 'Initial zoom level when opening a file',
        general: 'General',
        language: 'Language',
        languageDesc: 'UI display language',
        cancel: 'Cancel',
        apply: 'Apply',
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
    const [local, setLocal] = useState<AppSettings>({ ...settings });
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
                                            className={`settings-theme-card ${isActive ? 'active' : ''}`}
                                            onClick={() => patch({ theme: th })}
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
                            <div className="settings-field-desc">{t.languageDesc}</div>
                            <div className="settings-lang-toggle">
                                {(['ja', 'en'] as const).map(lang => (
                                    <button
                                        key={lang}
                                        className={`settings-lang-btn ${local.language === lang ? 'active' : ''}`}
                                        onClick={() => patch({ language: lang })}
                                    >
                                        {lang === 'ja' ? '日本語' : 'English'}
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