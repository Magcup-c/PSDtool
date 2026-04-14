import { useCallback, useEffect, useRef } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { attachThumbs } from '../utils/psdUtils';
import { PsdRoot } from '../types';
import { Translations } from '../constants/translations';

interface UsePsdLoaderProps {
    tabManager: any;
    loadPsd: (buffer: ArrayBuffer, filePath: string) => Promise<any>;
    addRecentFile: (path: string) => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
    L: Translations;
    resetHistory: (psd: any) => void;
    setCurrentFilePath: (path: string | null) => void;
    setIsLoading: (loading: boolean) => void;
    setIsDragging: (dragging: boolean) => void;
    activeIdRef: React.MutableRefObject<string>;
    tabsRef: React.MutableRefObject<any[]>;
}

export const usePsdLoader = ({
    tabManager,
    loadPsd,
    addRecentFile,
    showToast,
    L,
    resetHistory,
    setCurrentFilePath,
    setIsLoading,
    setIsDragging,
    activeIdRef,
    tabsRef,
}: UsePsdLoaderProps) => {
    const loadGenByTabRef = useRef<Map<string, number>>(new Map());
    const loadCountRef = useRef(0);
    const isFirstLoadRef = useRef(true);

    const loadPsdFromFilePath = useCallback(async (filePath: string, tabId?: string) => {
        if (tabManager.activateExistingTab(filePath)) return;

        const targetId = tabId ?? tabManager.openNewTab({
            filePath, fileName: filePath.replace(/\\/g, '/').split('/').pop() ?? filePath, isLoading: true,
        });
        tabManager.updateTab(targetId, { isLoading: true });

        const g = (loadGenByTabRef.current.get(targetId) ?? 0) + 1;
        loadGenByTabRef.current.set(targetId, g);
        loadCountRef.current += 1;
        setIsLoading(true);
        isFirstLoadRef.current = true;

        const tabStillTargeted = () => loadGenByTabRef.current.get(targetId) === g;

        try {
            const data = await readFile(filePath);
            if (!tabStillTargeted()) return;
            const result = await loadPsd(data.buffer, filePath);
            if (!tabStillTargeted()) return;
            const rawPsd = result.psd as unknown as PsdRoot;
            const nextPsd = result.layers.length > 0 ? attachThumbs(rawPsd, result.layers) : rawPsd;
            if (!tabStillTargeted()) return;

            if (activeIdRef.current === targetId) resetHistory(nextPsd);

            tabManager.updateTab(targetId, {
                psd: nextPsd,
                filePath,
                fileName: filePath.replace(/\\/g, '/').split('/').pop() ?? filePath,
                isLoading: false,
                isDirty: false,
            });
            addRecentFile(filePath);
            if (activeIdRef.current === targetId) setCurrentFilePath(filePath);
        } catch (err) {
            if (tabStillTargeted()) {
                showToast(`${L.loadFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
                tabManager.updateTab(targetId, { isLoading: false });
            }
        } finally {
            if (loadGenByTabRef.current.get(targetId) === g) loadGenByTabRef.current.delete(targetId);
            loadCountRef.current -= 1;
            if (loadCountRef.current <= 0) { loadCountRef.current = 0; setIsLoading(false); }
        }
    }, [loadPsd, resetHistory, addRecentFile, showToast, L, tabManager, setIsLoading, setCurrentFilePath, activeIdRef]);

    const openPsdUnified = useCallback((filePath: string) => {
        const activeTab = tabsRef.current.find(t => t.id === activeIdRef.current);
        const canReuseActive = !!activeTab && !activeTab.isLoading && !activeTab.filePath && !activeTab.psd;
        loadPsdFromFilePath(filePath, canReuseActive ? activeTab.id : undefined);
    }, [loadPsdFromFilePath, tabsRef, activeIdRef]);

    useEffect(() => {
        const checkArgs = async () => {
            try {
                const args: string[] = await invoke('get_launch_args');
                const psdFile = args.slice(1).find(x => x.toLowerCase().endsWith('.psd'));
                if (psdFile) openPsdUnified(psdFile);
            } catch (e) { console.error('Failed to get launch args', e); }
        };
        checkArgs();
    }, [openPsdUnified]);

    useEffect(() => {
        const p = listen<string[]>('open-file', (event) => {
            const psdFile = event.payload.slice(1).find(x => x.toLowerCase().endsWith('.psd'));
            if (psdFile) openPsdUnified(psdFile);
            getCurrentWindow().setFocus();
        });
        return () => { p.then(u => u()); };
    }, [openPsdUnified]);

    useEffect(() => {
        const p = Promise.all([
            listen('tauri://drag-over', () => setIsDragging(true)),
            listen('tauri://drag-drop', (event: any) => {
                setIsDragging(false);
                const paths = event.payload.paths;
                if (paths?.length > 0 && paths[0].toLowerCase().endsWith('.psd')) openPsdUnified(paths[0]);
            }),
            listen('tauri://drag-leave', () => setIsDragging(false)),
        ]);
        return () => { p.then(us => us.forEach(u => u())); };
    }, [openPsdUnified, setIsDragging]);

    return {
        loadPsdFromFilePath,
        openPsdUnified,
        isFirstLoadRef,
    };
};
