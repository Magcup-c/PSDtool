import { useState, useRef, useCallback, useEffect } from 'react';
import { updateLayerByPath } from '../utils/psdUtils';
import { PsdLayerNode, PsdRoot } from '../types';

export function usePsdHistory(initialPsd: PsdRoot | null) {
    const [psd, setPsd] = useState<PsdRoot | null>(initialPsd);
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const undoStack = useRef<PsdRoot[]>([]);
    const redoStack = useRef<PsdRoot[]>([]);
    const psdRef = useRef<PsdRoot | null>(null);

    useEffect(() => {
        psdRef.current = psd;
    }, [psd]);

    const MAX_UNDO = 50;

    const syncHistoryState = useCallback(() => {
        setHistoryState({
            canUndo: undoStack.current.length > 0,
            canRedo: redoStack.current.length > 0,
        });
    }, []);

    const commitPsd = useCallback((nextLevelPsd: PsdRoot) => {
        const current = psdRef.current;
        if (!current) return;
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), current];
        redoStack.current = [];
        // [FIX #3] psdRef を先に更新してから setState することで、
        // commitPsd 連鎖呼び出し時に psdRef が古い値を指すのを防ぐ
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

    const resetHistory = useCallback((next: PsdRoot | null) => {
        undoStack.current = [];
        redoStack.current = [];
        psdRef.current = next;
        setPsd(next);
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
