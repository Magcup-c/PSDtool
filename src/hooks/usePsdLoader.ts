/**
 * src/hooks/usePsdLoader.ts
 */

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
    loadPsd: (buffer: ArrayBuffer) => Promise<any>;
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
    const loadCountRef    = useRef(0);
    const isFirstLoadRef  = useRef(true);

    const loadPsdFromFilePath = useCallback(async (filePath: string, tabId?: string) => {
        if (tabManager.activateExistingTab(filePath)) return;

        const targetId = tabId ?? tabManager.openNewTab({
            filePath,
            fileName: filePath.replace(/\\/g, '/').split('/').pop() ?? filePath,
            isLoading: true,
        });
        tabManager.updateTab(targetId, { isLoading: true });

        const g = (loadGenByTabRef.current.get(targetId) ?? 0) + 1;
        loadGenByTabRef.current.set(targetId, g);
        loadCountRef.current += 1;
        setIsLoading(true);
        isFirstLoadRef.current = true;

        const tabStillTargeted = () => loadGenByTabRef.current.get(targetId) === g;

        try {
            let data: { buffer: ArrayBuffer };
            try {
                data = await readFile(filePath);
            } catch (readErr) {
                throw new Error(
                    `Cannot read file "${filePath}": ${readErr instanceof Error ? readErr.message : String(readErr)}`
                );
            }

            if (!tabStillTargeted()) return;

            if (!data.buffer || data.buffer.byteLength === 0) {
                throw new Error(`File "${filePath}" is empty`);
            }

            const result = await loadPsd(data.buffer);

            if (!tabStillTargeted()) return;
            if (!result?.psd) {
                throw new Error('Worker returned an invalid PSD result');
            }

            const rawPsd = result.psd as unknown as PsdRoot;
            const nextPsd = result.layers.length > 0
                ? attachThumbs(rawPsd, result.layers)
                : rawPsd;

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
                const msg = err instanceof Error ? err.message : String(err);
                showToast(`${L.loadFailed}: ${msg}`, 'error');
                // 失敗したタブを閉じる（空タブが残らないように）
                tabManager.closeTab(targetId);
            }
        } finally {
            if (loadGenByTabRef.current.get(targetId) === g) {
                loadGenByTabRef.current.delete(targetId);
            }
            loadCountRef.current -= 1;
            if (loadCountRef.current <= 0) {
                loadCountRef.current = 0;
                setIsLoading(false);
            }
        }
    }, [loadPsd, resetHistory, addRecentFile, showToast, L, tabManager,
        setIsLoading, setCurrentFilePath, activeIdRef, tabsRef]);

    const openPsdUnified = useCallback((filePath: string) => {
        const activeTab = tabsRef.current.find((t: any) => t.id === activeIdRef.current);
        const canReuseActive = !!activeTab
            && !activeTab.isLoading
            && !activeTab.filePath
            && !activeTab.psd;
        loadPsdFromFilePath(filePath, canReuseActive ? activeTab.id : undefined);
    }, [loadPsdFromFilePath, tabsRef, activeIdRef]);

    // 起動時引数からPSDを開く
    useEffect(() => {
        const checkArgs = async () => {
            try {
                const args: string[] = await invoke('get_launch_args');
                const psdFile = args.slice(1).find((x) => x.toLowerCase().endsWith('.psd'));
                if (psdFile) openPsdUnified(psdFile);
            } catch (e) {
                console.error('Failed to get launch args:', e);
            }
        };
        checkArgs();
    }, [openPsdUnified]);

    // シングルインスタンス: 別プロセスからファイルを受信
    useEffect(() => {
        const p = listen<string[]>('open-file', (event) => {
            const psdFile = event.payload.slice(1).find((x) => x.toLowerCase().endsWith('.psd'));
            if (psdFile) openPsdUnified(psdFile);
            getCurrentWindow().setFocus();
        });
        return () => { p.then((u) => u()); };
    }, [openPsdUnified]);

    // ドラッグ&ドロップ
    useEffect(() => {
        const p = Promise.all([
            listen('tauri://drag-over',  () => setIsDragging(true)),
            listen('tauri://drag-drop',  (event: any) => {
                setIsDragging(false);
                const paths = event.payload?.paths;
                if (Array.isArray(paths) && paths.length > 0) {
                    const psd = paths.find((p: string) => p.toLowerCase().endsWith('.psd'));
                    if (psd) openPsdUnified(psd);
                }
            }),
            listen('tauri://drag-leave', () => setIsDragging(false)),
        ]);
        return () => { p.then((us) => us.forEach((u) => u())); };
    }, [openPsdUnified, setIsDragging]);

    return {
        loadPsdFromFilePath,
        openPsdUnified,
        isFirstLoadRef,
    };
};