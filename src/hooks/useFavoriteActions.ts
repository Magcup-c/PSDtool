import { useState, useCallback, useRef, useEffect } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { applyLayerState, captureLayerState } from '../utils/editorUtils';
import { renderPsdToBytes } from '../hooks/usePsdExport';
import { LayerFavorite } from './useLayerFavorites';
import { Translations } from '../constants/translations';
import { PsdRoot } from '../types';

interface UseFavoriteActionsProps {
    psdRef: React.MutableRefObject<PsdRoot | null>;
    commitPsd: (psd: PsdRoot) => void;
    setClosedKeys: (keys: Set<string>) => void;
    setZoomTo: (zoom: number) => void;
    setFlipX: (flip: boolean) => void;
    setFlipY: (flip: boolean) => void;
    setRadioEnabled: (enabled: boolean) => void;
    setLockedEnabled: (enabled: boolean) => void;
    setFlipEnabled: (enabled: boolean) => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
    L: Translations;
    favorites: LayerFavorite[];
    saveFavorite: (name: string, state: any, closedKeys: string[], ui: any) => void;
    updateFavoriteName: (id: string, name: string) => void;
    moveFavoriteTo: (id: string, to: number) => void;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    lang: 'ja' | 'en';
}

export const useFavoriteActions = ({
    psdRef,
    commitPsd,
    setClosedKeys,
    setZoomTo,
    setFlipX,
    setFlipY,
    setRadioEnabled,
    setLockedEnabled,
    setFlipEnabled,
    showToast,
    L,
    favorites,
    saveFavorite,
    updateFavoriteName,
    moveFavoriteTo,
    canvasRef,
    lang,
}: UseFavoriteActionsProps) => {
    const [favoriteDialog, setFavoriteDialog] = useState<{
        mode: 'create' | 'rename'; id?: string; value: string
    } | null>(null);
    const [favoriteDrop, setFavoriteDrop] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

    const favoriteListRef = useRef<HTMLUListElement>(null);
    const favoriteRectsRef = useRef<{ id: string; rect: DOMRect }[]>([]);
    const favoriteDragStateRef = useRef<{ id: string; startY: number; moved: boolean } | null>(null);
    const favoriteDragCleanupRef = useRef<(() => void) | null>(null);

    const handleApplyFavorite = useCallback((fav: LayerFavorite) => {
        if (!psdRef.current) return;
        const current = psdRef.current;
        const nextChildren = current.children
            ? applyLayerState(current.children, fav.state)
            : current.children;
        commitPsd({ ...current, children: nextChildren });
        setClosedKeys(new Set(fav.closedKeys ?? []));
        if (fav.zoom) setZoomTo(fav.zoom);
        if (typeof fav.flipX === 'boolean') setFlipX(fav.flipX);
        if (typeof fav.flipY === 'boolean') setFlipY(fav.flipY);
        if (typeof fav.radioEnabled === 'boolean') setRadioEnabled(fav.radioEnabled);
        if (typeof fav.lockedEnabled === 'boolean') setLockedEnabled(fav.lockedEnabled);
        if (typeof fav.flipEnabled === 'boolean') setFlipEnabled(fav.flipEnabled);
        showToast(L.applied);
    }, [commitPsd, psdRef, showToast, L, setZoomTo, setClosedKeys, setFlipX, setFlipY, setRadioEnabled, setLockedEnabled, setFlipEnabled]);

    const handleExportFavoriteImage = useCallback(async (fav: LayerFavorite) => {
        if (!psdRef.current) return;
        const current = psdRef.current;
        const tmpChildren = current.children
            ? applyLayerState(current.children, fav.state)
            : current.children;
        const tmpPsd = { ...current, children: tmpChildren };

        try {
            const bytes = await renderPsdToBytes(tmpPsd);
            const safeName = fav.name.replace(/[\\/:*?"<>|]/g, '_');
            const selected = await save({
                title: lang === 'ja' ? `「${fav.name}」をPNGで書き出し` : `Export "${fav.name}" as PNG`,
                defaultPath: `${safeName}.png`,
                filters: [{ name: 'PNG Image', extensions: ['png'] }],
            });
            if (selected) {
                await writeFile(selected, bytes);
                showToast(L.exportSuccess);
            }
        } catch (err) {
            showToast(`${L.exportFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, [psdRef, showToast, L, lang]);

    const handleExportAllFavoriteImages = useCallback(async () => {
        if (!psdRef.current || favorites.length === 0) return;
        try {
            const dir = await open({ directory: true, title: lang === 'ja' ? '出力フォルダを選択' : 'Select output folder' });
            if (!dir || typeof dir !== 'string') return;

            let done = 0;
            for (const fav of favorites) {
                const current = psdRef.current!;
                const tmpChildren = current.children
                    ? applyLayerState(current.children, fav.state)
                    : current.children;
                const tmpPsd = { ...current, children: tmpChildren };
                const bytes = await renderPsdToBytes(tmpPsd);
                const safeName = fav.name.replace(/[\\/:*?"<>|]/g, '_');
                await writeFile(`${dir}/${safeName}.png`, bytes);
                done++;
            }
            showToast(L.exportAllFavDone(done));
        } catch (err) {
            showToast(`${L.exportFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, [psdRef, favorites, showToast, L, lang]);

    const openCreateFavorite = useCallback((closedKeys: string[], ui: any) => {
        if (!psdRef.current?.children) return;
        setFavoriteDialog({ mode: 'create', value: `${L.favorites} ${favorites.length + 1}` });
        // We'll handle the actual saving in confirmFavoriteDialog but we need to pass current UI state
    }, [favorites.length, L, psdRef]);

    const cacheFavoriteRects = useCallback(() => {
        const root = favoriteListRef.current; if (!root) return;
        const items = Array.from(root.querySelectorAll<HTMLElement>('[data-favorite-id]'));
        favoriteRectsRef.current = items
            .map(el => ({ id: el.getAttribute('data-favorite-id') || '', rect: el.getBoundingClientRect() }))
            .filter(x => x.id);
    }, []);

    const findFavoriteDropTarget = useCallback((clientY: number) => {
        const items = favoriteRectsRef.current; if (!items.length) return null;
        let best: { id: string; position: 'before' | 'after'; dist: number } | null = null;
        for (const { id, rect } of items) {
            const mid = rect.top + rect.height / 2;
            const position = clientY < mid ? 'before' : 'after';
            const dist = Math.abs(clientY - mid);
            if (!best || dist < best.dist) best = { id, position, dist };
        }
        return best ? { id: best.id, position: best.position } : null;
    }, []);

    const handleFavoriteDragStart = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault(); e.stopPropagation();
        favoriteDragStateRef.current = { id, startY: e.clientY, moved: false };
        cacheFavoriteRects();
        const onMouseMove = (ev: MouseEvent) => {
            if (!favoriteDragStateRef.current) return;
            if (Math.abs(ev.clientY - favoriteDragStateRef.current.startY) > 3) favoriteDragStateRef.current.moved = true;
            const target = findFavoriteDropTarget(ev.clientY);
            setFavoriteDrop(target?.id !== favoriteDragStateRef.current.id ? target : null);
        };
        const onMouseUp = (ev: MouseEvent) => {
            const state = favoriteDragStateRef.current; favoriteDragStateRef.current = null;
            const target = findFavoriteDropTarget(ev.clientY);
            setFavoriteDrop(null);
            if (favoriteDragCleanupRef.current) { favoriteDragCleanupRef.current(); favoriteDragCleanupRef.current = null; }
            if (!state?.moved || !target || target.id === state.id) return;
            const from = favorites.findIndex(f => f.id === state.id);
            let to = favorites.findIndex(f => f.id === target.id);
            if (from === -1 || to === -1) return;
            if (target.position === 'after') to++;
            if (from < to) to--;
            moveFavoriteTo(state.id, to);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        favoriteDragCleanupRef.current = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [cacheFavoriteRects, findFavoriteDropTarget, favorites, moveFavoriteTo]);

    useEffect(() => {
        return () => {
            if (favoriteDragCleanupRef.current) favoriteDragCleanupRef.current();
        };
    }, []);

    const confirmFavoriteDialog = useCallback((closedKeys: string[], ui: any) => {
        if (!favoriteDialog) return;
        const name = favoriteDialog.value.trim(); if (!name) return;

        if (favoriteDialog.mode === 'create') {
            if (!psdRef.current?.children) return;

            const previewDataUrl = (() => {
                const src = canvasRef.current;
                if (!src) return undefined;
                const SIZE = 64;
                const tmp = document.createElement('canvas');
                const { width: sw, height: sh } = src;
                const scale = Math.min(SIZE / sw, SIZE / sh, 1);
                tmp.width = Math.max(1, Math.round(sw * scale));
                tmp.height = Math.max(1, Math.round(sh * scale));
                const ctx = tmp.getContext('2d');
                if (!ctx) return undefined;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(src, 0, 0, tmp.width, tmp.height);
                return tmp.toDataURL('image/png');
            })();

            saveFavorite(
                name,
                captureLayerState(psdRef.current.children),
                closedKeys,
                { ...ui, previewDataUrl },
            );
            showToast(L.saved);
        } else if (favoriteDialog.mode === 'rename' && favoriteDialog.id) {
            updateFavoriteName(favoriteDialog.id, name);
        }
        setFavoriteDialog(null);
    }, [favoriteDialog, psdRef, saveFavorite, showToast, L, updateFavoriteName, canvasRef]);

    return {
        favoriteDialog,
        setFavoriteDialog,
        favoriteDrop,
        setFavoriteDrop,
        favoriteListRef,
        handleApplyFavorite,
        handleExportFavoriteImage,
        handleExportAllFavoriteImages,
        openCreateFavorite,
        confirmFavoriteDialog,
        handleFavoriteDragStart,
        favoriteDragCleanupRef,
    };
};
