import { useLayoutEffect, useRef } from 'react';
import { PsdRoot } from '../types';
import { TabState } from './useTabManager';

interface UseTabSyncProps {
    activeId: string;
    tabs: TabState[];
    updateTab: (id: string, state: Partial<TabState>) => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    zoom: number;
    flipX: boolean;
    flipY: boolean;
    closedKeys: Set<string>;
    resetHistory: (psd: PsdRoot | null) => void;
    setCurrentFilePath: (path: string | null) => void;
    setFlipX: (v: boolean) => void;
    setFlipY: (v: boolean) => void;
    setClosedKeys: (keys: Set<string>) => void;
    setSearchQuery: (q: string) => void;
    setZoomInputActive: (a: boolean) => void;
    setZoomTo: (z: number) => void;
    isFirstLoadRef: React.MutableRefObject<boolean>;
    layerDragCleanup: () => void;
    favoriteDragCleanupRef: React.MutableRefObject<(() => void) | null>;
    setFavoriteDrop: (v: any) => void;
    renameSessionRef: React.MutableRefObject<boolean>;
    renameTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export const useTabSync = ({
    activeId, tabs, updateTab, scrollRef, zoom, flipX, flipY, closedKeys,
    resetHistory, setCurrentFilePath, setFlipX, setFlipY, setClosedKeys,
    setSearchQuery, setZoomInputActive, setZoomTo, isFirstLoadRef,
    layerDragCleanup, favoriteDragCleanupRef, setFavoriteDrop,
    renameSessionRef, renameTimerRef
}: UseTabSyncProps) => {
    const prevActiveIdRef = useRef<string>(activeId);
    const outgoingUiRef = useRef({ zoom, flipX, flipY, closedKeys: Array.from(closedKeys) });

    // ✅ tabs を ref で保持することで、useLayoutEffect の依存配列から除外し
    //    updateTab 呼び出しによる tabs 変化で effect が再実行されるのを防ぐ
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

    outgoingUiRef.current = { zoom, flipX, flipY, closedKeys: Array.from(closedKeys) };

    useLayoutEffect(() => {
        const prevId = prevActiveIdRef.current;
        if (prevId === activeId) return;

        // 退出するタブのUI状態を保存
        const { zoom: z, flipX: fx, flipY: fy, closedKeys: ck } = outgoingUiRef.current;
        updateTab(prevId, {
            zoom: z, flipX: fx, flipY: fy, closedKeys: ck,
            scrollLeft: scrollRef.current?.scrollLeft ?? 0,
            scrollTop:  scrollRef.current?.scrollTop  ?? 0,
        });

        prevActiveIdRef.current = activeId;

        // ✅ tabsRef.current を使うことで依存配列に tabs を入れずに最新値を参照
        const nextTab = tabsRef.current.find(t => t.id === activeId);
        if (!nextTab) return;

        // ドラッグ中状態をリセット
        layerDragCleanup();
        if (favoriteDragCleanupRef.current) {
            favoriteDragCleanupRef.current();
            favoriteDragCleanupRef.current = null;
            setFavoriteDrop(null);
        }

        // リネームセッションをリセット
        renameSessionRef.current = false;
        if (renameTimerRef.current) {
            clearTimeout(renameTimerRef.current);
            renameTimerRef.current = null;
        }

        // 次のタブの状態を復元
        resetHistory(nextTab.psd ?? null);
        setCurrentFilePath(nextTab.filePath);
        setFlipX(nextTab.flipX);
        setFlipY(nextTab.flipY);
        setClosedKeys(new Set(nextTab.closedKeys));

        setSearchQuery('');
        setZoomInputActive(false);

        // isFirstLoadRef を true にしてから zoom をセット
        // → useEditorLifecycle の centering effect が次の psd 変化で発火する
        isFirstLoadRef.current = true;
        setZoomTo(nextTab.zoom);

        const el = scrollRef.current;
        if (el) {
            el.scrollLeft = nextTab.scrollLeft;
            el.scrollTop  = nextTab.scrollTop;
        }
    // ✅ tabs を依存配列から除外（tabsRef.current で参照）
    }, [
        activeId, updateTab, resetHistory, setZoomTo, layerDragCleanup,
        favoriteDragCleanupRef, setFavoriteDrop, renameSessionRef, renameTimerRef,
        isFirstLoadRef, setFlipX, setFlipY, scrollRef, setCurrentFilePath,
        setClosedKeys, setSearchQuery, setZoomInputActive,
    ]);
};