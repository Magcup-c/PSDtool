import { useState, useRef, useCallback, useEffect } from 'react';
import { updateLayerByPath, collectBitmaps, closeBitmaps } from '../utils/psdUtils';
import { PsdLayerNode, PsdRoot } from '../types';

export function usePsdHistory(initialPsd: PsdRoot | null) {
    const [psd, setPsd] = useState<PsdRoot | null>(initialPsd);
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const undoStack = useRef<PsdRoot[]>([]);
    const redoStack = useRef<PsdRoot[]>([]);
    const psdRef = useRef<PsdRoot | null>(null);

    psdRef.current = psd;

    const activeBitmapsRef = useRef<Set<ImageBitmap>>(new Set());

    const MAX_UNDO = 50;

    // resetHistory で渡された外部psdのbitmapをcloseから守るためのセット。
    // タブのpsdはタブマネージャが所有権を持つので、ここではcloseしてはいけない。
    const protectedPsdRef = useRef<Set<PsdRoot>>(new Set());

    const cleanupResources = useCallback(() => {
        const currentInUse = new Set<ImageBitmap>();

        // 現在の psd
        collectBitmaps(psdRef.current).forEach(b => currentInUse.add(b));

        // undo/redo スタック
        undoStack.current.forEach(item => {
            collectBitmaps(item).forEach(b => currentInUse.add(b));
        });
        redoStack.current.forEach(item => {
            collectBitmaps(item).forEach(b => currentInUse.add(b));
        });

        // 保護されたpsd（タブマネージャが所有するpsd）のbitmapはcloseしない
        protectedPsdRef.current.forEach(protectedPsd => {
            collectBitmaps(protectedPsd).forEach(b => currentInUse.add(b));
        });

        const toClose: ImageBitmap[] = [];
        activeBitmapsRef.current.forEach(b => {
            if (!currentInUse.has(b)) toClose.push(b);
        });

        if (toClose.length > 0) {
            closeBitmaps(toClose);
        }
        activeBitmapsRef.current = currentInUse;
    }, []);

    useEffect(() => {
        return () => {
            closeBitmaps(activeBitmapsRef.current);
            activeBitmapsRef.current.clear();
        };
    }, []);

    const syncHistoryState = useCallback(() => {
        setHistoryState({
            canUndo: undoStack.current.length > 0,
            canRedo: redoStack.current.length > 0,
        });
        cleanupResources();
    }, [cleanupResources]);

    const commitPsd = useCallback((nextLevelPsd: PsdRoot) => {
        const current = psdRef.current;
        if (!current) {
            psdRef.current = nextLevelPsd;
            setPsd(nextLevelPsd);
            syncHistoryState();
            return;
        }
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), current];
        redoStack.current = [];
        psdRef.current = nextLevelPsd;
        setPsd(nextLevelPsd);
        syncHistoryState();
    }, [syncHistoryState]);

    const pushSnapshot = useCallback((forcePsd?: PsdRoot) => {
        const snapshot = forcePsd || psdRef.current;
        if (!snapshot) return;
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), snapshot];
        redoStack.current = [];
        syncHistoryState();
    }, [syncHistoryState]);

    const handleUndo = useCallback(() => {
        if (!undoStack.current.length) return;
        const current = psdRef.current;
        if (current) redoStack.current = [...redoStack.current, current];
        const prev = undoStack.current.pop()!;
        psdRef.current = prev;
        setPsd(prev);
        syncHistoryState();
    }, [syncHistoryState]);

    const handleRedo = useCallback(() => {
        if (!redoStack.current.length) return;
        const current = psdRef.current;
        if (current) undoStack.current = [...undoStack.current, current];
        const next = redoStack.current.pop()!;
        psdRef.current = next;
        setPsd(next);
        syncHistoryState();
    }, [syncHistoryState]);

    const toggleRadioLayer = useCallback((path: number[], siblings: PsdLayerNode[]) => {
        if (!psdRef.current) return;
        const selectedIdx = path[path.length - 1];
        const parentPath = path.slice(0, -1);

        const radioIndices = siblings
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => (s.name || '').startsWith('*'))
            .map(({ i }) => i);

        if (radioIndices.length === 0) return;

        let currentPsd = psdRef.current;
        for (const idx of radioIndices) {
            const shouldHide = idx !== selectedIdx;
            if (siblings[idx].hidden === shouldHide) continue;
            currentPsd = updateLayerByPath(
                currentPsd,
                [...parentPath, idx],
                (l) => ({ ...l, hidden: shouldHide }),
            );
        }

        if (currentPsd !== psdRef.current) {
            commitPsd(currentPsd);
        }
    }, [commitPsd]);

    // resetHistory: タブ切り替え時などに外部からpsdをセットする。
    // 渡されたpsdのbitmapはタブマネージャが所有しているため、
    // cleanupResources でcloseしてはいけない。protectedPsdRef で保護する。
    const resetHistory = useCallback((next: PsdRoot | null) => {
        // 新しいpsdを保護リストに追加（cleanupResourcesがcloseしないよう守る）
        protectedPsdRef.current.clear();
        if (next) {
            protectedPsdRef.current.add(next);
        }

        undoStack.current = [];
        redoStack.current = [];
        psdRef.current = next;
        setPsd(next);

        // cleanupResources は protectedPsdRef を参照するので
        // next の bitmap は close されない
        syncHistoryState();
    }, [syncHistoryState]);

    return {
        psd,
        setPsd,
        psdRef,
        canUndo: historyState.canUndo,
        canRedo: historyState.canRedo,
        commitPsd,
        pushSnapshot,
        handleUndo,
        handleRedo,
        toggleRadioLayer,
        resetHistory,
    };
}