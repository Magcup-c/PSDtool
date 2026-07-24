/**
 * src/hooks/usePsdLoader.ts
 *
 * 修正点:
 *   - エラー時の closeTab を「複数タブのときのみ」に変更。
 *     1枚のときは空タブのままにしてユーザーが再操作できる状態を保つ。
 *   - closeTab 呼び出し前に loadGenByTabRef から targetId を明示削除し、
 *     finally での二重削除と世代混在を防ぐ。
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

        /** 現在も同じ世代でこのタブへのロードが有効かを確認 */
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

            // ★ 実データを持つはずのレイヤーが1つもビットマップ化できなかった場合は
            //    ファイル破損等の可能性が高いため、読み込み失敗として扱う。
            //    既存のcatchブロックに任せることで、タブを閉じる/空に戻す処理も統一される。
            const diag = (result as any).diag as
                { totalLeaf: number; eligible: number; rendered: number; failed: number } | undefined;
            if (diag && diag.totalLeaf > 0 && diag.rendered === 0) {
                throw new Error(L.layerRenderFailed as string);
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

                // 世代を明示削除してから closeTab を呼ぶ。
                // これにより finally での削除と二重にならず、
                // closeTab 後に同じ targetId で別ロードが始まっても世代が混在しない。
                loadGenByTabRef.current.delete(targetId);

                // 複数タブがある場合のみ失敗タブを閉じる。
                // 1枚しかない場合は空タブのままにしてユーザーが再操作できる状態を保つ。
                const currentTabs = tabsRef.current;
                if (currentTabs.length > 1) {
                    tabManager.closeTab(targetId);
                } else {
                    // 1枚のとき: ローディング表示だけ解除して空タブに戻す
                    tabManager.updateTab(targetId, {
                        isLoading: false,
                        psd: null,
                        filePath: null,
                        fileName: 'Untitled',
                        isDirty: false,
                    });
                }
            }
        } finally {
            // 世代が残っている場合のみ削除（エラー時は catch 内で削除済みなので冪等）
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