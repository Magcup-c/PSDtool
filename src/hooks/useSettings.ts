import { useState, useEffect } from 'react';

export interface AppSettings {
    theme: 'black' | 'grey' | 'light' | 'white';
    defaultZoom: number;
    language: 'ja' | 'en';
}

const DEFAULTS: AppSettings = {
    theme: 'grey',
    defaultZoom: 1,
    language: 'ja',
};

const STORAGE_KEY = 'psd-studio-settings';

export function useSettings() {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
        } catch {
            return DEFAULTS;
        }
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSettings = (patch: Partial<AppSettings>) =>
        setSettings(prev => ({ ...prev, ...patch }));

    return { settings, updateSettings };
}