/**
 * src/hooks/useSettings.ts  (updated)
 *
 * 変更点:
 *   - exportFormat: 'png' | 'jpeg' | 'webp' | 'svg' を追加
 *   - exportQuality: JPEG/WebP の品質 (0–1) を追加
 */

import { useState, useEffect } from 'react';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

export interface AppSettings {
    theme: 'black' | 'grey' | 'light' | 'white';
    defaultZoom: number;
    language: 'ja' | 'en';
    syncThemeWithOS: boolean;
    syncLangWithOS: boolean;
    maxRecentFiles: number;
    scrollAction: 'zoom' | 'pan';
    // 書き出し設定
    exportFormat: ExportFormat;
    exportQuality: number;   // 0.1 – 1.0 (JPEG / WebP)
}

export function detectOSTheme(): AppSettings['theme'] {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'grey' : 'white';
}

export function detectOSLang(): AppSettings['language'] {
    return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

const DEFAULTS: AppSettings = {
    theme: 'grey',
    defaultZoom: 1,
    language: 'ja',
    syncThemeWithOS: false,
    syncLangWithOS: false,
    maxRecentFiles: 10,
    scrollAction: 'pan',
    exportFormat: 'png',
    exportQuality: 0.92,
};

const STORAGE_KEY = 'psd-studio-settings';

export function useSettings() {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const saved: AppSettings = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
            if (saved.syncThemeWithOS) saved.theme = detectOSTheme();
            if (saved.syncLangWithOS)  saved.language = detectOSLang();
            return saved;
        } catch {
            return DEFAULTS;
        }
    });

    useEffect(() => {
        if (!settings.syncThemeWithOS) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => setSettings(prev => ({ ...prev, theme: detectOSTheme() }));
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [settings.syncThemeWithOS]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSettings = (patch: Partial<AppSettings>) => {
        setSettings(prev => {
            const next = { ...prev, ...patch };
            if (patch.syncThemeWithOS) next.theme = detectOSTheme();
            if (patch.syncLangWithOS)  next.language = detectOSLang();
            return next;
        });
    };

    return { settings, updateSettings };
}