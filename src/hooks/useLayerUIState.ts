import { useState, useRef, useCallback, useMemo } from 'react';
import { PsdRoot, PsdLayerNode } from '../types';
import { collectSearchResults } from '../utils/psdUtils';

export const useLayerUIState = (psd: PsdRoot | null) => {
    const [closedKeys, setClosedKeys] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    const handleToggleExpand = useCallback((key: string) => {
        setClosedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const searchResults = useMemo(() => {
        const q = searchQuery.trim();
        if (!q || !psd?.children) return null;
        return collectSearchResults(psd.children, q);
    }, [searchQuery, psd]);

    const handleExpandAll = useCallback(() => setClosedKeys(new Set()), []);

    const handleCollapseAll = useCallback(() => {
        if (!psd?.children) return;
        const keys: string[] = [];
        const collect = (layers: PsdLayerNode[], parentPath: number[] = []) => {
            layers.forEach((layer, idx) => {
                if (layer.children && layer.children.length > 0) {
                    const path = [...parentPath, idx];
                    keys.push(path.join('-'));
                    collect(layer.children, path);
                }
            });
        };
        collect(psd.children);
        setClosedKeys(new Set(keys));
    }, [psd]);

    return {
        closedKeys,
        setClosedKeys,
        searchQuery,
        setSearchQuery,
        searchInputRef,
        handleToggleExpand,
        handleExpandAll,
        handleCollapseAll,
        searchResults,
    };
};
