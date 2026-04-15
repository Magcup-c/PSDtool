import { useState, useCallback } from 'react';

const STORAGE_KEY = 'psd-studio-recent-files';

export interface RecentFile {
    path: string;
    name: string;       // ファイル名のみ（表示用）
    openedAt: number;   // timestamp
}

function loadRecent(): RecentFile[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveRecent(files: RecentFile[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    } catch (e) {
        console.warn('Failed to persist recent files:', e);
    }
}

function basename(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

export function useRecentFiles(maxCount: number) {
    const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecent());

    const addRecentFile = useCallback((path: string) => {
        setRecentFiles(prev => {
            // 同じパスがあれば先頭に移動、なければ追加
            const filtered = prev.filter(f => f.path !== path);
            const next = [
                { path, name: basename(path), openedAt: Date.now() },
                ...filtered,
            ].slice(0, maxCount);
            saveRecent(next);
            return next;
        });
    }, [maxCount]);

    const clearRecentFiles = useCallback(() => {
        setRecentFiles([]);
        saveRecent([]);
    }, []);

    return { recentFiles, addRecentFile, clearRecentFiles };
}
