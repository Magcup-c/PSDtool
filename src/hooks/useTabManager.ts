/**
 * src/hooks/useTabManager.ts
 *
 * 複数PSDファイルのタブ管理フック。
 * 各タブは独立した psd / 履歴スタック / UI状態を保持する。
 */

import { useState, useCallback } from 'react';
import { Psd } from 'ag-psd';

export interface TabState {
    id: string;
    filePath: string | null;
    fileName: string;
    psd: Psd | null;
    isDirty: boolean;       // 未保存変更あり
    isLoading: boolean;
    // UI状態（タブ切り替え時に復元）
    zoom: number;
    flipX: boolean;
    flipY: boolean;
    closedKeys: string[];   // Set は JSON 非対応なので配列で保持
    scrollLeft: number;
    scrollTop: number;
}

function makeId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function baseName(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

export function makeEmptyTab(overrides?: Partial<TabState>): TabState {
    return {
        id: makeId(),
        filePath: null,
        fileName: 'Untitled',
        psd: null,
        isDirty: false,
        isLoading: false,
        zoom: 1,
        flipX: false,
        flipY: false,
        closedKeys: [],
        scrollLeft: 0,
        scrollTop: 0,
        ...overrides,
    };
}

export function useTabManager() {
    const [tabs, setTabs] = useState<TabState[]>([makeEmptyTab()]);
    const [activeId, setActiveId] = useState<string>(tabs[0].id);

    // 現在アクティブなタブ
    const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

    // --- 内部ヘルパー ---
    const updateTab = useCallback((id: string, patch: Partial<TabState>) => {
        setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    }, []);

    // --- 公開API ---

    /** 新しいタブを末尾に追加してアクティブにする */
    const openNewTab = useCallback((overrides?: Partial<TabState>): string => {
        const tab = makeEmptyTab(overrides);
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
        return tab.id;
    }, []);

    /** 指定パスを既存タブで開いているか検索し、あればアクティブ化して true を返す */
    const activateExistingTab = useCallback((filePath: string): boolean => {
        const existing = tabs.find(t => t.filePath === filePath);
        if (existing) {
            setActiveId(existing.id);
            return true;
        }
        return false;
    }, [tabs]);

    /** タブを閉じる。最後の1枚は Untitled タブに置き換える */
    const closeTab = useCallback((id: string) => {
        setTabs(prev => {
            if (prev.length === 1) {
                // 最後の1枚は空タブに置き換え。id を新規にして activeId が変わるようにする
                // （同一 id のままだと PsdEditor のタブ同期が走らず前タブの PSD が残る）
                const reset = makeEmptyTab();
                setActiveId(reset.id);
                return [reset];
            }
            const next = prev.filter(t => t.id !== id);
            // 閉じたタブがアクティブだった場合、隣のタブに移動
            setActiveId(cur => {
                if (cur !== id) return cur;
                const closedIdx = prev.findIndex(t => t.id === id);
                return next[Math.min(closedIdx, next.length - 1)].id;
            });
            return next;
        });
    }, []);

    /** アクティブタブの PSD/状態を更新 */
    const setActivePsd = useCallback((psd: Psd | null, filePath?: string | null) => {
        setTabs(prev => prev.map(t => {
            if (t.id !== activeId) return t;
            return {
                ...t,
                psd,
                filePath: filePath !== undefined ? filePath : t.filePath,
                fileName: filePath ? baseName(filePath) : t.fileName,
                isDirty: false,
                isLoading: false,
            };
        }));
    }, [activeId]);

    const setActiveLoading = useCallback((isLoading: boolean) => {
        updateTab(activeId, { isLoading });
    }, [activeId, updateTab]);

    const markDirty = useCallback((id?: string) => {
        updateTab(id ?? activeId, { isDirty: true });
    }, [activeId, updateTab]);

    /** スクロール/ズーム/フリップをアクティブタブに保存 */
    const saveActiveUiState = useCallback((state: Partial<Pick<TabState, 'zoom' | 'flipX' | 'flipY' | 'closedKeys' | 'scrollLeft' | 'scrollTop'>>) => {
        updateTab(activeId, state);
    }, [activeId, updateTab]);

    /** タブの順序を入れ替え（ドラッグ&ドロップ用） */
    const reorderTabs = useCallback((fromId: string, toId: string) => {
        setTabs(prev => {
            const from = prev.findIndex(t => t.id === fromId);
            const to   = prev.findIndex(t => t.id === toId);
            if (from === -1 || to === -1 || from === to) return prev;
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            return next;
        });
    }, []);

    return {
        tabs,
        activeId,
        activeTab,
        setActiveId,
        openNewTab,
        activateExistingTab,
        closeTab,
        setActivePsd,
        setActiveLoading,
        markDirty,
        saveActiveUiState,
        reorderTabs,
        updateTab,
    };
}