import { useState, useRef, useCallback, useEffect } from 'react';
import { updateLayerByPath, collectBitmaps, closeBitmaps, getLayersAtPath } from '../utils/psdUtils';
import { PsdLayerNode, PsdRoot } from '../types';

export function usePsdHistory(
    initialPsd: PsdRoot | null,
    getOtherTabsPsds?: () => (PsdRoot | null)[],
    onPsdChange?: (psd: PsdRoot | null) => void, // 追加: psdが変わるたびに同期呼び出し内で必ず呼ばれる
) {
    const [psd, setPsdState] = useState<PsdRoot | null>(initialPsd);
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const undoStack = useRef<PsdRoot[]>([]);
    const redoStack = useRef<PsdRoot[]>([]);
    const psdRef = useRef<PsdRoot | null>(null);

    psdRef.current = psd;

    const MAX_UNDO = 50;

    const orphanedBitmapsRef = useRef<Set<ImageBitmap>>(new Set());

    const scheduleOrphanClose = useCallback((droppedPsd: PsdRoot) => {
        collectBitmaps(droppedPsd).forEach(b => orphanedBitmapsRef.current.add(b));
    }, []);

    const flushOrphanedBitmaps = useCallback(() => {
        if (orphanedBitmapsRef.current.size === 0) return;

        const inUse = new Set<ImageBitmap>();
        collectBitmaps(psdRef.current).forEach(b => inUse.add(b));
        undoStack.current.forEach(p => collectBitmaps(p).forEach(b => inUse.add(b)));
        redoStack.current.forEach(p => collectBitmaps(p).forEach(b => inUse.add(b)));
        if (getOtherTabsPsds) {
            getOtherTabsPsds().forEach(p => collectBitmaps(p).forEach(b => inUse.add(b)));
        }

        const toClose: ImageBitmap[] = [];
        orphanedBitmapsRef.current.forEach(b => { if (!inUse.has(b)) toClose.push(b); });
        if (toClose.length > 0) {
            closeBitmaps(toClose);
            toClose.forEach(b => orphanedBitmapsRef.current.delete(b));
        }
    }, [getOtherTabsPsds]);

    useEffect(() => {
        return () => {
            closeBitmaps(orphanedBitmapsRef.current);
            orphanedBitmapsRef.current.clear();
        };
    }, []);

    const syncHistoryState = useCallback(() => {
        setHistoryState({
            canUndo: undoStack.current.length > 0,
            canRedo: redoStack.current.length > 0,
        });
        flushOrphanedBitmaps();
    }, [flushOrphanedBitmaps]);

    // 内部で psd を確定させる唯一の経路。
    // ここで onPsdChange を「同じ呼び出し内」で必ず実行することで、
    // 「psdが変わったのにタブへの書き戻しがまだ済んでいない」という
    // 非同期な空白時間を作らないようにする（高速タブ切替との競合を根絶）。
    const applyPsd = useCallback((next: PsdRoot | null) => {
        psdRef.current = next;
        setPsdState(next);
        onPsdChange?.(next);
    }, [onPsdChange]);

    const commitPsd = useCallback((nextPsd: PsdRoot) => {
        const current = psdRef.current;
        if (!current) {
            applyPsd(nextPsd);
            syncHistoryState();
            return;
        }

        if (undoStack.current.length >= MAX_UNDO) {
            scheduleOrphanClose(undoStack.current[0]);
        }
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), current];

        redoStack.current.forEach(p => scheduleOrphanClose(p));
        redoStack.current = [];

        applyPsd(nextPsd);
        syncHistoryState();
    }, [syncHistoryState, scheduleOrphanClose, applyPsd]);

    const pushSnapshot = useCallback((forcePsd?: PsdRoot) => {
        const snapshot = forcePsd || psdRef.current;
        if (!snapshot) return;

        if (undoStack.current.length >= MAX_UNDO) {
            scheduleOrphanClose(undoStack.current[0]);
        }
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), snapshot];

        redoStack.current.forEach(p => scheduleOrphanClose(p));
        redoStack.current = [];

        syncHistoryState();
    }, [syncHistoryState, scheduleOrphanClose]);

    const handleUndo = useCallback(() => {
        if (!undoStack.current.length) return;
        const current = psdRef.current;
        if (current) redoStack.current = [...redoStack.current, current];
        const prev = undoStack.current.pop()!;
        applyPsd(prev);
        syncHistoryState();
    }, [syncHistoryState, applyPsd]);

    const handleRedo = useCallback(() => {
        if (!redoStack.current.length) return;
        const current = psdRef.current;
        if (current) undoStack.current = [...undoStack.current, current];
        const next = redoStack.current.pop()!;
        applyPsd(next);
        syncHistoryState();
    }, [syncHistoryState, applyPsd]);

    const toggleRadioLayer = useCallback((path: number[], _siblings?: PsdLayerNode[]) => {
        if (!psdRef.current) return;
        const selectedIdx = path[path.length - 1];
        const parentPath = path.slice(0, -1);

        const actualSiblings = getLayersAtPath(psdRef.current.children ?? [], parentPath);
        const radioIndices = actualSiblings
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => (s.name || '').startsWith('*'))
            .map(({ i }) => i);
        if (radioIndices.length === 0) return;

        let currentPsd = psdRef.current;
        for (const idx of radioIndices) {
            const shouldHide = idx !== selectedIdx;
            if (actualSiblings[idx].hidden === shouldHide) continue;
            currentPsd = updateLayerByPath(currentPsd, [...parentPath, idx], (l) => ({ ...l, hidden: shouldHide }));
        }
        if (currentPsd !== psdRef.current) commitPsd(currentPsd);
    }, [commitPsd]);

    // タブ切り替え時に「タブが保持しているpsd」を読み込む専用経路。
    // ここでも applyPsd を通すことで onPsdChange が呼ばれるが、
    // next は元々そのタブの tab.psd と同一参照なので updateTab 側の
    // 変更なし判定によって実質的に無害な no-op になる。
    const resetHistory = useCallback((next: PsdRoot | null) => {
        undoStack.current.forEach(p => scheduleOrphanClose(p));
        redoStack.current.forEach(p => scheduleOrphanClose(p));
        undoStack.current = [];
        redoStack.current = [];
        applyPsd(next);
        syncHistoryState();
    }, [syncHistoryState, scheduleOrphanClose, applyPsd]);

    return {
        psd,
        setPsd: applyPsd, // 外部からの直接setPsdも同じ同期経路を通す
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