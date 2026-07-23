/**
 * src/hooks/useTabManager.ts
 * [FIX] closeTab のレースコンディション修正:
 *       setActiveId を setTabs の外に分離し、tabsRef から安全に参照する
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { PsdRoot } from '../types';

export interface TabState {
    id: string;
    filePath: string | null;
    fileName: string;
    psd: PsdRoot | null;
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

    const tabsRef = useRef(tabs);
    useEffect(() => { tabsRef.current = tabs; }, [tabs]);

    const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

    const updateTab = useCallback((id: string, patch: Partial<TabState>) => {
        setTabs(prev => {
            const idx = prev.findIndex(t => t.id === id);
            if (idx === -1) return prev;
            const current = prev[idx];
            let changed = false;
            for (const key in patch) {
                if ((current as any)[key] !== (patch as any)[key]) { changed = true; break; }
            }
            if (!changed) return prev;
            const next = [...prev];
            next[idx] = { ...current, ...patch };
            return next;
        });
    }, []);

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

    // [FIX] setActiveId を setTabs の外に出してレースコンディションを解消。
    // setTabs と setActiveId は同じバッチで処理されるが、
    // setActiveId のコールバックは tabsRef（最新値）を参照するため安全。
    const closeTab = useCallback((id: string) => {
        setTabs(prev => {
            if (prev.length === 1) {
                // タブが1枚だけの場合はリセット（閉じずに空にする）
                return [{ ...makeEmptyTab(), id: prev[0].id }];
            }
            return prev.filter(t => t.id !== id);
        });

        setActiveId(cur => {
            if (cur !== id) return cur;
            const prev = tabsRef.current;
            // 1枚の場合は同じIDのまま（makeEmptyTab で id を引き継ぐため）
            if (prev.length === 1) return prev[0].id;
            const next = prev.filter(t => t.id !== id);
            const closedIdx = prev.findIndex(t => t.id === id);
            return next[Math.min(closedIdx, next.length - 1)].id;
        });
    }, []);

    const setActivePsd = useCallback((psd: PsdRoot | null, filePath?: string | null) => {
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