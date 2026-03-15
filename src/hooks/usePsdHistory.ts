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

    const toggleRadioLayer = useCallback((path: number[], siblings: any[]) => {
        if (!psdRef.current) return;
        const selectedIdx = path[path.length - 1];
        const parentPath = path.slice(0, -1);
        let currentPsd = psdRef.current;
        siblings.forEach((sibling: any, idx: number) => {
            if (!(sibling.name || '').startsWith('*')) return;
            const shouldHide = idx !== selectedIdx;
            if (sibling.hidden !== shouldHide)
                currentPsd = updateLayerByPath(currentPsd, [...parentPath, idx], (l) => ({ ...l, hidden: shouldHide }));
        });
        if (currentPsd !== psdRef.current) commitPsd(currentPsd);
    }, [commitPsd]);

    return {
        psd,
        setPsd,
        psdRef,
        commitPsd,
        handleUndo,
        handleRedo,
        normalizeRadioGroups,
        toggleRadioLayer,
    };
}
