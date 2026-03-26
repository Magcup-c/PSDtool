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
}

type FavoriteStore = Record<string, LayerFavorite[]>;

const STORAGE_KEY = 'psd-studio-layer-favorites-v1';
const MAX_FAVORITES = 30;

function loadStore(): FavoriteStore {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveStore(store: FavoriteStore) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getKey(fileKey: string | null): string {
    return fileKey || '__unsaved__';
}

function makeId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useLayerFavorites(fileKey: string | null) {
    const key = getKey(fileKey);
    const [favorites, setFavorites] = useState<LayerFavorite[]>(() => {
        const store = loadStore();
        return store[key] ?? [];
    });

    useEffect(() => {
        const store = loadStore();
        setFavorites(store[key] ?? []);
    }, [key]);

    const saveFavorite = useCallback((
        name: string,
        state: LayerStateNode[],
        closedKeys: string[],
        extra?: Pick<LayerFavorite, 'zoom' | 'flipX' | 'flipY' | 'radioEnabled' | 'lockedEnabled' | 'flipEnabled'>,
    ) => {
        const entry: LayerFavorite = {
            id: makeId(),
            name,
            createdAt: Date.now(),
            state,
            closedKeys,
            ...extra,
        };
        setFavorites(prev => {
            const next = [entry, ...prev].slice(0, MAX_FAVORITES);
            const store = loadStore();
            store[key] = next;
            saveStore(store);
            return next;
        });
    }, [key]);

    const updateFavoriteName = useCallback((id: string, name: string) => {
        setFavorites(prev => {
            const next = prev.map(f => (f.id === id ? { ...f, name } : f));
            const store = loadStore();
            store[key] = next;
            saveStore(store);
            return next;
        });
    }, [key]);

    const moveFavorite = useCallback((id: string, dir: 'up' | 'down') => {
        setFavorites(prev => {
            const idx = prev.findIndex(f => f.id === id);
            if (idx === -1) return prev;
            const next = [...prev];
            const target = dir === 'up' ? idx - 1 : idx + 1;
            if (target < 0 || target >= next.length) return prev;
            const temp = next[idx];
            next[idx] = next[target];
            next[target] = temp;
            const store = loadStore();
            store[key] = next;
            saveStore(store);
            return next;
        });
    }, [key]);

    const moveFavoriteTo = useCallback((id: string, toIndex: number) => {
        setFavorites(prev => {
            const from = prev.findIndex(f => f.id === id);
            if (from === -1) return prev;
            const clamped = Math.max(0, Math.min(prev.length - 1, toIndex));
            if (from === clamped) return prev;
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(clamped, 0, item);
            const store = loadStore();
            store[key] = next;
            saveStore(store);
            return next;
        });
    }, [key]);

    const deleteFavorite = useCallback((id: string) => {
        setFavorites(prev => {
            const next = prev.filter(f => f.id !== id);
            const store = loadStore();
            store[key] = next;
            saveStore(store);
            return next;
        });
    }, [key]);

    return { favorites, saveFavorite, deleteFavorite, updateFavoriteName, moveFavorite, moveFavoriteTo };
}
