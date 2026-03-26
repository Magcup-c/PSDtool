import { useState, useRef, useCallback, useEffect } from 'react';
import { Psd } from 'ag-psd';
import { updateLayerByPath } from '../utils/psdUtils';

export function usePsdHistory(initialPsd: Psd | null) {
    const [psd, setPsd] = useState<Psd | null>(initialPsd);
    const undoStack = useRef<Psd[]>([]);
    const redoStack = useRef<Psd[]>([]);
    const psdRef = useRef<Psd | null>(null);

    useEffect(() => {
        psdRef.current = psd;
    }, [psd]);

    const MAX_UNDO = 50;

    const commitPsd = useCallback((next: Psd) => {
        const current = psdRef.current;
        if (!current) return;
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), current];
        redoStack.current = [];
        setPsd(next);
    }, []);

    const pushSnapshot = useCallback((snapshot: Psd) => {
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), snapshot];
        redoStack.current = [];
    }, []);

    const handleUndo = useCallback(() => {
        if (!undoStack.current.length) return;
        const current = psdRef.current;
        if (current) redoStack.current = [...redoStack.current, current];
        setPsd(undoStack.current.pop()!);
    }, []);

    const handleRedo = useCallback(() => {
        if (!redoStack.current.length) return;
        const current = psdRef.current;
        if (current) undoStack.current = [...undoStack.current, current];
        setPsd(redoStack.current.pop()!);
    }, []);

    const normalizeRadioGroups = useCallback((layers: any[]): any[] => {
        const processed = layers.map((layer) =>
            layer.children?.length > 0 ? { ...layer, children: normalizeRadioGroups(layer.children) } : layer
        );
        const radioIndices = processed.map((l, i) => ({ l, i }))
            .filter(({ l }) => (l.name || '').startsWith('*')).map(({ i }) => i);
        if (radioIndices.length < 2) return processed;
        const visibleIdx = radioIndices.find((i) => !processed[i].hidden) ?? radioIndices[0];
        const normalized = [...processed];
        radioIndices.forEach((i) => { normalized[i] = { ...normalized[i], hidden: i !== visibleIdx }; });
        return normalized;
    }, []);

    // [FIX] Bug #3: toggleRadioLayer の修正
    //
    // 旧実装の問題点:
    //   1. siblings（LayerItem から渡された配列）を使わず、psdRef から再取得していたため
    //      親グループ内のラジオレイヤーが正しく特定できないケースがあった。
    //   2. 同じグループ内の * レイヤーをすべて非表示にしてから選択したレイヤーだけ
    //      表示する処理が、updateLayerByPath を複数回呼ぶループで行われていたが、
    //      各呼び出しが独立した psd スナップショットを返すため最後の1回しか効かなかった。
    //
    // 修正:
    //   - siblings を直接参照してラジオグループを特定する。
    //   - immutable に一括で更新してから commitPsd を1回だけ呼ぶ。
    const toggleRadioLayer = useCallback((path: number[], siblings: any[]) => {
        if (!psdRef.current) return;
        const selectedIdx = path[path.length - 1];
        const parentPath = path.slice(0, -1);

        // 同じ親を持つ * レイヤーのインデックスをすべて収集
        const radioIndices = siblings
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => (s.name || '').startsWith('*'))
            .map(({ i }) => i);

        if (radioIndices.length === 0) return;

        // ラジオグループ全体を一括更新（複数の updateLayerByPath を連鎖させる）
        let currentPsd = psdRef.current;
        for (const idx of radioIndices) {
            const shouldHide = idx !== selectedIdx;
            // すでに目的の状態なら更新不要（不要な再レンダリング防止）
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

    const resetHistory = useCallback((next: Psd | null) => {
        undoStack.current = [];
        redoStack.current = [];
        setPsd(next);
        psdRef.current = next;
    }, []);

    return {
        psd,
        setPsd,
        psdRef,
        commitPsd,
        pushSnapshot,
        handleUndo,
        handleRedo,
        normalizeRadioGroups,
        toggleRadioLayer,
        resetHistory,
    };
}