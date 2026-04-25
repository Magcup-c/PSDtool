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

    const MAX_UNDO = 50;

    // undoスタックから取り除かれたpsd専用のbitmapだけを管理する。
    // 現在のpsd・タブのpsdのbitmapはここでは絶対にcloseしない。
    // タブのpsdはタブマネージャが所有権を持つため。
    const orphanedBitmapsRef = useRef<Set<ImageBitmap>>(new Set());

    // undoスタックから溢れて捨てられたpsdのbitmapだけをclose対象に追加する
    const scheduleOrphanClose = useCallback((droppedPsd: PsdRoot) => {
        collectBitmaps(droppedPsd).forEach(b => orphanedBitmapsRef.current.add(b));
    }, []);

    // orphanedBitmapsRef の中で、現在のpsd・undoStack・redoStackに
    // 含まれていないものだけをcloseする
    const flushOrphanedBitmaps = useCallback(() => {
        if (orphanedBitmapsRef.current.size === 0) return;

        // 現在使用中のbitmapを収集
        const inUse = new Set<ImageBitmap>();
        collectBitmaps(psdRef.current).forEach(b => inUse.add(b));
        undoStack.current.forEach(p => collectBitmaps(p).forEach(b => inUse.add(b)));
        redoStack.current.forEach(p => collectBitmaps(p).forEach(b => inUse.add(b)));

        const toClose: ImageBitmap[] = [];
        orphanedBitmapsRef.current.forEach(b => {
            if (!inUse.has(b)) toClose.push(b);
        });

        if (toClose.length > 0) {
            closeBitmaps(toClose);
            toClose.forEach(b => orphanedBitmapsRef.current.delete(b));
        }
    }, []);

    useEffect(() => {
        return () => {
            // アンマウント時はorphanedBitmapsだけclose
            // タブのpsdはタブマネージャ側でcloseする責任がある
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

    const commitPsd = useCallback((nextPsd: PsdRoot) => {
        const current = psdRef.current;
        if (!current) {
            psdRef.current = nextPsd;
            setPsd(nextPsd);
            syncHistoryState();
            return;
        }

        // undoStackが上限を超える場合、溢れたpsdのbitmapをorphan登録
        if (undoStack.current.length >= MAX_UNDO) {
            const dropped = undoStack.current[0];
            scheduleOrphanClose(dropped);
        }

        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), current];

        // redoStackをクリアする際、redoStackのpsdのbitmapもorphan登録
        redoStack.current.forEach(p => scheduleOrphanClose(p));
        redoStack.current = [];

        psdRef.current = nextPsd;
        setPsd(nextPsd);
        syncHistoryState();
    }, [syncHistoryState, scheduleOrphanClose]);

    const pushSnapshot = useCallback((forcePsd?: PsdRoot) => {
        const snapshot = forcePsd || psdRef.current;
        if (!snapshot) return;

        if (undoStack.current.length >= MAX_UNDO) {
            const dropped = undoStack.current[0];
            scheduleOrphanClose(dropped);
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

    // resetHistory: タブ切り替え時に外部からpsdをセットする。
    // undoStack・redoStackをクリアするが、bitmapはcloseしない。
    // タブのpsdのbitmapはタブマネージャが所有するため、
    // ここでcloseする権限はない。
    const resetHistory = useCallback((next: PsdRoot | null) => {
        // undoStack・redoStackを捨てる際、bitmapをorphan登録してclose対象にする
        // ただしnextのbitmapと重複している場合はcloseしてはいけないので
        // flushOrphanedBitmaps内のinUse判定に任せる
        undoStack.current.forEach(p => scheduleOrphanClose(p));
        redoStack.current.forEach(p => scheduleOrphanClose(p));

        undoStack.current = [];
        redoStack.current = [];
        psdRef.current = next;
        setPsd(next);

        // flushOrphanedBitmaps は psdRef.current（= next）のbitmapを inUse に含めてから
        // closeするため、next のbitmapが誤ってcloseされることはない
        syncHistoryState();
    }, [syncHistoryState, scheduleOrphanClose]);

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