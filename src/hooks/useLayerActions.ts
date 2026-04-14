import { useCallback, useRef, useEffect } from 'react';
import { updateLayerByPath } from '../utils/psdUtils';
import { PsdRoot } from '../types';

interface UseLayerActionsProps {
    psdRef: React.MutableRefObject<PsdRoot | null>;
    commitPsd: (psd: PsdRoot) => void;
    pushSnapshot: (psd: PsdRoot) => void;
    setPsd: (psd: PsdRoot) => void;
    markDirty: () => void;
}

export const useLayerActions = ({
    psdRef,
    commitPsd,
    pushSnapshot,
    setPsd,
    markDirty,
}: UseLayerActionsProps) => {
    const renameSessionRef = useRef(false);
    const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const toggleLayerVisibility = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        commitPsd(updateLayerByPath(psdRef.current, path, l => ({ ...l, hidden: !l.hidden })));
        markDirty();
    }, [commitPsd, psdRef, markDirty]);

    const renameLayer = useCallback((path: number[], newName: string) => {
        if (!psdRef.current) return;
        const updated = updateLayerByPath(psdRef.current, path, l => ({ ...l, name: newName }));
        if (!renameSessionRef.current) {
            renameSessionRef.current = true;
            pushSnapshot(psdRef.current);
        }
        psdRef.current = updated;
        setPsd(updated);
        markDirty();
        if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
        renameTimerRef.current = setTimeout(() => {
            renameTimerRef.current = null;
            renameSessionRef.current = false;
        }, 600);
    }, [psdRef, setPsd, pushSnapshot, markDirty]);

    const handleAddLayer = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Layer', hidden: false }, ...(cur.children || [])] });
        markDirty();
    }, [commitPsd, psdRef, markDirty]);

    const handleAddGroup = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Group', hidden: false, children: [] }, ...(cur.children || [])] });
        markDirty();
    }, [commitPsd, psdRef, markDirty]);

    const handleDeleteLayer = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        const deleteAt = (p: PsdRoot, pathArgs: number[]): PsdRoot => {
            const newPsd = { ...p, children: [...(p.children || [])] };
            let arr = newPsd.children;
            const pathCopy = [...pathArgs];
            const lastIdx = pathCopy.pop()!;
            for (const idx of pathCopy) {
                arr[idx] = { ...arr[idx], children: [...(arr[idx].children || [])] };
                arr = arr[idx].children!;
            }
            arr.splice(lastIdx, 1);
            return newPsd;
        };
        commitPsd(deleteAt(psdRef.current, path));
        markDirty();
    }, [commitPsd, psdRef, markDirty]);

    useEffect(() => {
        return () => {
            if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
        };
    }, []);

    return {
        toggleLayerVisibility,
        renameLayer,
        handleAddLayer,
        handleAddGroup,
        handleDeleteLayer,
        renameSessionRef,
        renameTimerRef,
    };
};
