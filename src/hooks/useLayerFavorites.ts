import { useState, useCallback, useEffect } from 'react';

export interface LayerStateNode {
    hidden?: boolean;
    children?: LayerStateNode[];
}

export interface LayerFavorite {
    id: string;
    name: string;
    createdAt: number;
    state: LayerStateNode[];
    closedKeys: string[];
    zoom?: number;
    flipX?: boolean;
    flipY?: boolean;
    radioEnabled?: boolean;
    lockedEnabled?: boolean;
    flipEnabled?: boolean;
    previewDataUrl?: string;
}

const STORAGE_KEY = 'psd-studio-layer-favorites-v1';
const MAX_FAVORITES = 30;

// ── ストレージ helpers ────────────────────────────────────────────────────────

function loadAll(): Record<string, LayerFavorite[]> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveAll(store: Record<string, LayerFavorite[]>): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function storeKey(fileKey: string | null): string {
    return fileKey || '__unsaved__';
}

function makeId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── JSON export / import helpers ─────────────────────────────────────────────

export function exportFavoritesToJson(favorites: LayerFavorite[], filename?: string): void {
    const blob = new Blob([JSON.stringify(favorites, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename ?? `favorites_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export function importFavoritesFromJson(file: File): Promise<LayerFavorite[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target?.result as string);
                if (!Array.isArray(parsed)) throw new Error('Invalid format: expected an array');
                const valid = parsed.filter(
                    (item): item is LayerFavorite =>
                        typeof item === 'object' &&
                        typeof item.name === 'string' &&
                        Array.isArray(item.state),
                );
                if (valid.length === 0) throw new Error('No valid favorites found in file');
                resolve(valid.map(f => ({ ...f, id: makeId() })));
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function useLayerFavorites(fileKey: string | null) {
    const key = storeKey(fileKey);

    const [favorites, setFavorites] = useState<LayerFavorite[]>(() => {
        return loadAll()[key] ?? [];
    });

    // fileKey が変わったらストレージから読み直す
    useEffect(() => {
        setFavorites(loadAll()[key] ?? []);
    }, [key]);

    /**
     * React state を更新し、その結果を localStorage に永続化する。
     * loadStore() を重ねて呼ばないため state と storage が常に一致する。
     */
    const commit = useCallback((key: string, updater: (prev: LayerFavorite[]) => LayerFavorite[]) => {
        setFavorites(prev => {
            const next = updater(prev);
            const store = loadAll();
            store[key] = next;
            saveAll(store);
            return next;
        });
    }, []);

    const saveFavorite = useCallback((
        name: string,
        state: LayerStateNode[],
        closedKeys: string[],
        extra?: Pick<LayerFavorite, 'zoom' | 'flipX' | 'flipY' | 'radioEnabled' | 'lockedEnabled' | 'flipEnabled' | 'previewDataUrl'>,
    ) => {
        const entry: LayerFavorite = {
            id: makeId(), name, createdAt: Date.now(), state, closedKeys, ...extra,
        };
        commit(key, prev => [entry, ...prev].slice(0, MAX_FAVORITES));
    }, [key, commit]);

    const updateFavoriteName = useCallback((id: string, name: string) => {
        commit(key, prev => prev.map(f => f.id === id ? { ...f, name } : f));
    }, [key, commit]);

    const moveFavorite = useCallback((id: string, dir: 'up' | 'down') => {
        commit(key, prev => {
            const idx = prev.findIndex(f => f.id === id);
            if (idx === -1) return prev;
            const target = dir === 'up' ? idx - 1 : idx + 1;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
        });
    }, [key, commit]);

    const moveFavoriteTo = useCallback((id: string, toIndex: number) => {
        commit(key, prev => {
            const from = prev.findIndex(f => f.id === id);
            if (from === -1) return prev;
            const clamped = Math.max(0, Math.min(prev.length - 1, toIndex));
            if (from === clamped) return prev;
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(clamped, 0, item);
            return next;
        });
    }, [key, commit]);

    const deleteFavorite = useCallback((id: string) => {
        commit(key, prev => prev.filter(f => f.id !== id));
    }, [key, commit]);

    const importFavorites = useCallback((incoming: LayerFavorite[], mode: 'merge' | 'replace' = 'merge') => {
        commit(key, prev => {
            return mode === 'replace'
                ? [...incoming].slice(0, MAX_FAVORITES)
                : [...incoming, ...prev].slice(0, MAX_FAVORITES);
        });
    }, [key, commit]);

    return {
        favorites,
        saveFavorite,
        deleteFavorite,
        updateFavoriteName,
        moveFavorite,
        moveFavoriteTo,
        importFavorites,
    };
}