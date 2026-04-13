/**
 * src/hooks/useTabManager.ts
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Psd } from 'ag-psd';

export interface TabState {
    id: string;
    filePath: string | null;
    fileName: string;
    psd: Psd | null;
    isDirty: boolean;
    isLoading: boolean;
    zoom: number;
    flipX: boolean;
    flipY: boolean;
    closedKeys: string[];
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

    // tabs の最新参照を ref で保持（コールバック内から安全に参照するため）
    const tabsRef = useRef(tabs);
    useEffect(() => { tabsRef.current = tabs; }, [tabs]);

    const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

    const updateTab = useCallback((id: string, patch: Partial<TabState>) => {
        setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    }, []);

    // 最新の tabs から特定タブを取得（コールバック内で使用）
    const getTab = useCallback((id: string): TabState | null => {
        return tabsRef.current.find(t => t.id === id) ?? null;
    }, []);

    const openNewTab = useCallback((overrides?: Partial<TabState>): string => {
        const tab = makeEmptyTab(overrides);
        setTabs(prev => [...prev, tab]);
        setActiveId(tab.id);
        return tab.id;
    }, []);

    const activateExistingTab = useCallback((filePath: string): boolean => {
        const existing = tabsRef.current.find(t => t.filePath === filePath);
        if (existing) {
            setActiveId(existing.id);
            return true;
        }
        return false;
    }, []);

    const closeTab = useCallback((id: string) => {
        setTabs(prev => {
            if (prev.length === 1) {
                const reset: TabState = {
                    ...makeEmptyTab(),
                    id: prev[0].id,
                };
                return [reset];
            }
            const next = prev.filter(t => t.id !== id);
            setActiveId(cur => {
                if (cur !== id) return cur;
                const closedIdx = prev.findIndex(t => t.id === id);
                return next[Math.min(closedIdx, next.length - 1)].id;
            });
            return next;
        });
    }, []);

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

    const saveActiveUiState = useCallback((state: Partial<Pick<TabState, 'zoom' | 'flipX' | 'flipY' | 'closedKeys' | 'scrollLeft' | 'scrollTop'>>) => {
        updateTab(activeId, state);
    }, [activeId, updateTab]);

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
        tabsRef,
        getTab,
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