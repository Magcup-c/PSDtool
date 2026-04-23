import { useLayoutEffect, useEffect, useRef } from 'react';
import { PsdRoot } from '../types';
import { TabState } from './useTabManager';

interface UseTabSyncProps {
    activeId: string;
    tabs: TabState[];
    updateTab: (id: string, state: Partial<TabState>) => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    canvasContainerRef: React.RefObject<HTMLDivElement | null>;
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
    applyZoom: (z: number) => void;
    isFirstLoadRef: React.MutableRefObject<boolean>;
    layerDragCleanup: () => void;
    favoriteDragCleanupRef: React.MutableRefObject<(() => void) | null>;
    setFavoriteDrop: (v: any) => void;
    renameSessionRef: React.MutableRefObject<boolean>;
    renameTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
    psd: PsdRoot | null;
    drawCanvas: (psd?: PsdRoot | null) => void;
}

export const useTabSync = ({
    activeId, tabs, updateTab, scrollRef, zoom, flipX, flipY, closedKeys,
    resetHistory, setCurrentFilePath, setFlipX, setFlipY, setClosedKeys,
    setSearchQuery, setZoomInputActive, applyZoom, isFirstLoadRef,
    layerDragCleanup, favoriteDragCleanupRef, setFavoriteDrop,
    renameSessionRef, renameTimerRef, psd, drawCanvas,
}: UseTabSyncProps) => {
    const prevActiveIdRef = useRef<string>(activeId);
    const outgoingUiRef = useRef({ zoom, flipX, flipY, closedKeys: Array.from(closedKeys) });

    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

    // タブ切り替え後に復元すべき情報を保持する
    // switchGeneration でどの切り替えに対応する pending かを追跡する
    const pendingRestoreRef = useRef<{
        zoom: number;
        scrollLeft: number;
        scrollTop: number;
        psd: PsdRoot | null;
        generation: number;
    } | null>(null);
    const switchGenerationRef = useRef(0);

    // 常に最新の ui 値を保持
    outgoingUiRef.current = { zoom, flipX, flipY, closedKeys: Array.from(closedKeys) };

    // ── タブ切り替え検出 ──────────────────────────────────────────────────────
    useLayoutEffect(() => {
        const prevId = prevActiveIdRef.current;
        if (prevId === activeId) return;

        // 退出タブの UI 状態を保存
        const { zoom: z, flipX: fx, flipY: fy, closedKeys: ck } = outgoingUiRef.current;
        updateTab(prevId, {
            zoom: z, flipX: fx, flipY: fy, closedKeys: ck,
            scrollLeft: scrollRef.current?.scrollLeft ?? 0,
            scrollTop:  scrollRef.current?.scrollTop  ?? 0,
        });

        prevActiveIdRef.current = activeId;

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

        // psd・flip・closedKeys などを即時復元
        resetHistory(nextTab.psd ?? null);
        setCurrentFilePath(nextTab.filePath);
        setFlipX(nextTab.flipX);
        setFlipY(nextTab.flipY);
        setClosedKeys(new Set(nextTab.closedKeys));
        setSearchQuery('');
        setZoomInputActive(false);
        isFirstLoadRef.current = true;

        // generation をインクリメントして pending を記録
        const gen = ++switchGenerationRef.current;
        pendingRestoreRef.current = {
            zoom: nextTab.zoom,
            scrollLeft: nextTab.scrollLeft,
            scrollTop:  nextTab.scrollTop,
            psd: nextTab.psd ?? null,
            generation: gen,
        };
    }, [
        activeId, updateTab, resetHistory, layerDragCleanup,
        favoriteDragCleanupRef, setFavoriteDrop, renameSessionRef, renameTimerRef,
        isFirstLoadRef, setFlipX, setFlipY, scrollRef, setCurrentFilePath,
        setClosedKeys, setSearchQuery, setZoomInputActive,
    ]);

    // ── psd state が React に反映された後で zoom/scroll/描画を適用 ─────────────
    useEffect(() => {
        const pending = pendingRestoreRef.current;
        if (!pending) return;

        // resetHistory で設定した psd と現在の React state の psd が
        // 参照レベルで一致するまで待つ。
        // ただし、両方が null の場合（空タブへの切り替え）は即時実行する。
        const bothNull = psd === null && pending.psd === null;
        if (!bothNull && psd !== pending.psd) return;

        // 対応する generation か確認（連続切り替え時に古い pending が残らないよう）
        if (pending.generation !== switchGenerationRef.current) {
            pendingRestoreRef.current = null;
            return;
        }

        pendingRestoreRef.current = null;

        requestAnimationFrame(() => {
            applyZoom(pending.zoom);

            const el = scrollRef.current;
            if (el) {
                el.scrollLeft = pending.scrollLeft;
                el.scrollTop  = pending.scrollTop;
            }

            // キャンバスを強制再描画（psd がある場合）
            if (pending.psd) {
                drawCanvas(pending.psd);
            }
        });
    }, [psd, applyZoom, scrollRef, drawCanvas]);
};