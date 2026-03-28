import { useState, useEffect } from 'react';

export interface AppSettings {
    theme: 'black' | 'grey' | 'light' | 'white';
    defaultZoom: number;
    language: 'ja' | 'en';
    syncThemeWithOS: boolean;
    syncLangWithOS: boolean;
    maxRecentFiles: number;
    scrollAction: 'zoom' | 'pan';
}

// OS のカラースキームからテーマを決定: dark → grey、light → white
export function detectOSTheme(): AppSettings['theme'] {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'grey' : 'white';
}

// OS の言語設定から言語を決定
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
};

const STORAGE_KEY = 'psd-studio-settings';

export function useSettings() {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const saved: AppSettings = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
            // OS 同期フラグが有効なら起動時にOS値で上書き
            if (saved.syncThemeWithOS) saved.theme = detectOSTheme();
            if (saved.syncLangWithOS)  saved.language = detectOSLang();
            return saved;
        } catch {
            return DEFAULTS;
        }
    });

    // OS のカラースキーム変化をリアルタイムで反映
    useEffect(() => {
        if (!settings.syncThemeWithOS) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            setSettings(prev => ({ ...prev, theme: detectOSTheme() }));
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [settings.syncThemeWithOS]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSettings = (patch: Partial<AppSettings>) => {
        setSettings(prev => {
            const next = { ...prev, ...patch };
            // 同期 ON に切り替えた瞬間に即反映
            if (patch.syncThemeWithOS) next.theme = detectOSTheme();
            if (patch.syncLangWithOS)  next.language = detectOSLang();
            return next;
        });
    };

    return { settings, updateSettings };
}