import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writePsd } from 'ag-psd';
import { invoke } from '@tauri-apps/api/core';
import './PsdEditor.css';
import { Image as ImageIcon } from 'lucide-react';

import { attachThumbs, updateLayerByPath, collectSearchResults, throttle } from './utils/psdUtils';
import { Toast } from './components/Toast';
import { SettingsModal } from './components/SettingsModal';
import { usePsdHistory } from './hooks/usePsdHistory';
import { usePsdWorker } from './hooks/usePsdWorker';
import { useZoomPan } from './hooks/useZoomPan';
import { useSettings } from './hooks/useSettings';
import { useRecentFiles } from './hooks/useRecentFiles';
import { useLayerFavorites, LayerFavorite } from './hooks/useLayerFavorites';

// Simplified imports for sub-components
import { EditorHeader } from './components/editor/EditorHeader';
import { LayerPanel } from './components/editor/LayerPanel';
import { PreviewArea } from './components/editor/PreviewArea';
import { FavoriteModal } from './components/editor/FavoriteModal';

function captureLayerState(layers: any[]): any[] {
    return layers.map(layer => ({
        hidden: !!layer.hidden,
        children: layer.children?.length ? captureLayerState(layer.children) : undefined,
    }));
}

function applyLayerState(layers: any[], state: any[] | undefined): any[] {
    return layers.map((layer, idx) => {
        const node = state?.[idx];
        const isLocked = (layer.name || '').startsWith('!');
        const next: any = { ...layer };
        if (node && typeof node.hidden === 'boolean' && !isLocked) {
            next.hidden = node.hidden;
        }
        if (layer.children?.length) {
            next.children = applyLayerState(layer.children, node?.children);
        }
        return next;
    });
}

function formatFavoriteTime(ts: number, lang: 'ja' | 'en') {
    try {
        return new Date(ts).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        });
    } catch { return ''; }
}

const PsdEditor = () => {
    const { 
        psd, setPsd, psdRef, commitPsd, pushSnapshot, handleUndo, handleRedo, 
        normalizeRadioGroups, toggleRadioLayer, resetHistory 
    } = usePsdHistory(null);
    const { loadPsd } = usePsdWorker();
    const { settings, updateSettings } = useSettings();
    const [showSettings, setShowSettings] = useState(false);
    const { recentFiles, addRecentFile, clearRecentFiles } = useRecentFiles(settings.maxRecentFiles ?? 10);
    const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
    const { favorites, saveFavorite, deleteFavorite, updateFavoriteName, moveFavoriteTo } = useLayerFavorites(currentFilePath);
    const [favoriteDialog, setFavoriteDialog] = useState<{ mode: 'create' | 'rename'; id?: string; value: string } | null>(null);
    const favoriteInputRef = useRef<HTMLInputElement>(null);
    const favoriteListRef = useRef<HTMLUListElement>(null);
    const favoriteRectsRef = useRef<{ id: string; rect: DOMRect }[]>([]);
    const [favoriteDrop, setFavoriteDrop] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const isResizingRef = useRef(false);
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [radioEnabled, setRadioEnabled] = useState(true);
    const [lockedEnabled, setLockedEnabled] = useState(true);
    const [flipEnabled, setFlipEnabled] = useState(true);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [closedKeys, setClosedKeys] = useState<Set<string>>(new Set());
    const [draggingPath, setDraggingPath] = useState<number[] | null>(null);
    const [dropTarget, setDropTarget] = useState<any | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const layerScrollRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{ path: number[]; startY: number; moved: boolean } | null>(null);
    const favoriteDragStateRef = useRef<{ id: string; startY: number; moved: boolean } | null>(null);

    const drawDirtyRef = useRef(false);
    const drawRafRef = useRef<number | null>(null);

    const { zoom, handleZoom, setZoomTo, resetZoom, centerPsd, SCROLL_AREA } = useZoomPan(psdRef, scrollRef, canvasContainerRef);

    const isFirstLoadRef = useRef(true);
    useEffect(() => {
        if (!psd) return;
        if (!isFirstLoadRef.current) return;
        isFirstLoadRef.current = false;
        const el = scrollRef.current;
        if (!el) return;
        let attempts = 0;
        const tryCenter = () => {
            attempts++;
            if (el.clientWidth > 0 && el.clientHeight > 0) { centerPsd(); return; }
            if (attempts < 10) requestAnimationFrame(tryCenter);
        };
        requestAnimationFrame(tryCenter);
    }, [psd, centerPsd]);

    const appWindow = getCurrentWindow();
    const handleCloseNotification = useCallback(() => setNotification(null), []);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const handleToggleFullscreen = useCallback(async () => {
        const next = !isFullscreen; await appWindow.setFullscreen(next); setIsFullscreen(next);
    }, [appWindow, isFullscreen]);

    const [zoomInputActive, setZoomInputActive] = useState(false);
    const [zoomInputValue, setZoomInputValue] = useState('');
    const zoomInputRef = useRef<HTMLInputElement>(null);

    const handleZoomInputFocus = useCallback(() => {
        setZoomInputValue(String(Math.round(zoom * 100))); setZoomInputActive(true);
        setTimeout(() => zoomInputRef.current?.select(), 0);
    }, [zoom]);

    const handleZoomInputCommit = useCallback(() => {
        setZoomInputActive(false);
        const parsed = parseInt(zoomInputValue, 10);
        if (!isNaN(parsed) && parsed > 0) setZoomTo(Math.min(500, Math.max(10, parsed)) / 100);
    }, [zoomInputValue, setZoomTo]);

    const handleToggleExpand = useCallback((key: string) => {
        setClosedKeys(prev => {
            const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next;
        });
    }, []);

    const collectGroupKeys = useCallback((layers: any[], parentPath: number[] = []): string[] => {
        const keys: string[] = [];
        layers.forEach((layer, idx) => {
            if (layer.children?.length > 0) {
                const path = [...parentPath, idx]; keys.push(path.join('-'));
                keys.push(...collectGroupKeys(layer.children, path));
            }
        });
        return keys;
    }, []);

    const handleExpandAll = useCallback(() => setClosedKeys(new Set()), []);
    const handleCollapseAll = useCallback(() => {
        if (!psd?.children) return; setClosedKeys(new Set(collectGroupKeys(psd.children)));
    }, [psd, collectGroupKeys]);

    const searchResults = useMemo(() => {
        const q = searchQuery.trim(); if (!q || !psd?.children) return null;
        return collectSearchResults(psd.children, q);
    }, [searchQuery, psd]);

    const lang = settings.language;
    const L = useMemo(() => ({
        open: lang === 'ja' ? '開く' : 'Open',
        png: 'PNG',
        savePsd: lang === 'ja' ? '保存' : 'Save PSD',
        workspace: lang === 'ja' ? 'Studio' : 'Studio',
        layers: lang === 'ja' ? 'Layers' : 'Layers',
        addLayer: lang === 'ja' ? 'レイヤー追加' : 'Add layer',
        addGroup: lang === 'ja' ? 'グループ追加' : 'Add group',
        expandAll: lang === 'ja' ? '全展開' : 'Expand all',
        collapseAll: lang === 'ja' ? '全折りたたみ' : 'Collapse all',
        searchPlaceholder: lang === 'ja' ? 'レイヤーを検索' : 'Search layers...',
        radio: 'Radio', fixed: lang === 'ja' ? 'Fixed' : 'Fixed', flip: 'Flip',
        dropPsd: lang === 'ja' ? 'PSDをドロップ' : 'Drop a PSD file here',
        noLayers: lang === 'ja' ? '見つかりません' : 'No layers found',
        loading: lang === 'ja' ? '読み込み中…' : 'Analyzing workspace…',
        dragDrop: lang === 'ja' ? 'PSDファイルをドロップ' : 'Drop PSD file here',
        dragRelease: lang === 'ja' ? 'ここでドロップして開く' : 'Release to open',
        settings: lang === 'ja' ? '設定' : 'Settings',
        favorites: lang === 'ja' ? 'お気に入り' : 'Favorites',
        saveState: lang === 'ja' ? '状態を保存' : 'Save State',
        noFavorites: lang === 'ja' ? '未登録' : 'No favorites yet',
        applyState: lang === 'ja' ? 'この状態を適用' : 'Apply this state',
        deleteState: lang === 'ja' ? '削除' : 'Delete',
        promptName: lang === 'ja' ? 'お気に入り名を入力してください' : 'Enter a name for this favorite',
        renameState: lang === 'ja' ? '名前を変更' : 'Rename',
        promptRename: lang === 'ja' ? '新しい名前を入力してください' : 'Enter a new name',
        moveUp: lang === 'ja' ? '上へ' : 'Move up',
        moveDown: lang === 'ja' ? '下へ' : 'Move down',
        dragHandle: lang === 'ja' ? 'ドラッグで並べ替え' : 'Drag to reorder',
        saved: lang === 'ja' ? 'お気に入りを保存しました' : 'Favorite saved',
        applied: lang === 'ja' ? 'お気に入りを適用しました' : 'Favorite applied',
        cancel: lang === 'ja' ? 'キャンセル' : 'Cancel',
        ok: 'OK',
        copied: lang === 'ja' ? 'クリップボードにコピーしました' : 'Copied to clipboard!',
        copyFailed: lang === 'ja' ? 'コピーに失敗しました' : 'Copy failed',
        loadFailed: lang === 'ja' ? '読み込みに失敗しました' : 'Failed to load PSD',
        openFailed: lang === 'ja' ? 'ファイルを開けませんでした' : 'Failed to open file',
        saveSuccess: lang === 'ja' ? '保存しました' : 'File saved successfully!',
        saveFailed: lang === 'ja' ? '保存に失敗しました' : 'Failed to save file',
        exportSuccess: lang === 'ja' ? 'エクスポートが完了しました' : 'PNG exported successfully!',
        exportFailed: lang === 'ja' ? 'エクスポートに失敗しました' : 'Failed to export PNG',
    }), [lang]);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') =>
        setNotification({ message, type }), []);

    const handleCopyCanvas = useCallback(async () => {
        const canvas = canvasRef.current; if (!canvas) return;
        try {
            await new Promise<void>((resolve, reject) => {
                canvas.toBlob(async (blob) => {
                    if (!blob) { reject(new Error('toBlob failed')); return; }
                    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); resolve(); }
                    catch (e) { reject(e); }
                }, 'image/png');
            }); showToast(L.copied);
        } catch (err) { showToast(`${L.copyFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    }, [showToast, L]);

    const loadPsdFromFilePath = useCallback(async (path: string) => {
        setIsLoading(true); isFirstLoadRef.current = true;
        try {
            const data = await readFile(path);
            const result = await loadPsd(data.buffer);
            const nextPsd = result.layers.length > 0 ? attachThumbs(result.psd, result.layers) : result.psd;
            resetHistory(nextPsd);
            addRecentFile(path); setCurrentFilePath(path);
        } catch (err) { showToast(`${L.loadFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
        setIsLoading(false);
    }, [loadPsd, resetHistory, addRecentFile, showToast, L]);

    useEffect(() => {
        const checkArgs = async () => {
            try {
                const args: string[] = await invoke('get_launch_args');
                const psdFile = args.slice(1).find(x => x.toLowerCase().endsWith('.psd'));
                if (psdFile) loadPsdFromFilePath(psdFile);
            } catch (e) { console.error('Failed to get launch args', e); }
        };
        checkArgs();
    }, [loadPsdFromFilePath]);

    useEffect(() => {
        const unlistenPromise = listen<string[]>('open-file', (event) => {
            const psdFile = event.payload.slice(1).find(x => x.toLowerCase().endsWith('.psd'));
            if (psdFile) loadPsdFromFilePath(psdFile);
            getCurrentWindow().setFocus();
        });
        return () => { unlistenPromise.then(u => u()); };
    }, [loadPsdFromFilePath]);

    useEffect(() => {
        const unlistenPromises = Promise.all([
            listen('tauri://drag-over', () => setIsDragging(true)),
            listen('tauri://drag-drop', (event: any) => {
                setIsDragging(false); const paths = event.payload.paths;
                if (paths?.length > 0 && paths[0].toLowerCase().endsWith('.psd')) loadPsdFromFilePath(paths[0]);
            }),
            listen('tauri://drag-leave', () => setIsDragging(false)),
        ]);
        return () => { unlistenPromises.then(us => us.forEach(u => u())); };
    }, [loadPsdFromFilePath]);

    const handleOpenFile = useCallback(async () => {
        try {
            const selected = await open({ multiple: false, filters: [{ name: 'PSD Image', extensions: ['psd'] }] });
            if (selected && typeof selected === 'string') loadPsdFromFilePath(selected);
        } catch (err) { showToast(`${L.openFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    }, [loadPsdFromFilePath, showToast, L]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
            if ((e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); handleRedo(); return; }
            if (e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey)) {
                if (window.getSelection()?.toString().length) return; e.preventDefault(); handleCopyCanvas();
            }
            if (e.key === 'F11') { e.preventDefault(); handleToggleFullscreen(); return; }
            if (e.key.toLowerCase() === 'o' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleOpenFile(); return; }
            if (e.key === ',' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setShowSettings(true); return; }
            
            // Zoom shortcuts
            if ((e.key === '+' || e.key === ';' || e.key === '=') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleZoom(0.1); return; }
            if (e.key === '-' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleZoom(-0.1); return; }
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); centerPsd(); return; }
        };
        window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleUndo, handleRedo, handleCopyCanvas, handleOpenFile, handleToggleFullscreen, handleZoom, centerPsd]);

    const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        const onMouseMove = (moveEvent: MouseEvent) => {
            if (!isResizingRef.current) return;
            const newWidth = Math.max(200, Math.min(600, moveEvent.clientX));
            setSidebarWidth(newWidth);
        };
        const onMouseUp = () => {
            isResizingRef.current = false;
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, []);

    const handleSaveFile = async () => {
        if (!psd) return;
        try {
            const selected = await save({ title: lang === 'ja' ? 'PSDファイルを保存' : 'Save PSD File', filters: [{ name: 'PSD Image', extensions: ['psd'] }] });
            if (selected) { await writeFile(selected, new Uint8Array(writePsd(psd) as ArrayBuffer)); showToast(L.saveSuccess); }
        } catch (err) { showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    };

    const handleExportPng = async () => {
        if (!canvasRef.current || !psd) return;
        try {
            const selected = await save({ title: 'Export as PNG', filters: [{ name: 'PNG Image', extensions: ['png'] }] });
            if (selected) {
                await new Promise<void>((resolve, reject) => {
                    canvasRef.current!.toBlob(async (blob) => {
                        if (!blob) { reject(new Error('toBlob failed')); return; }
                        try { const arrayBuffer = await blob.arrayBuffer(); await writeFile(selected, new Uint8Array(arrayBuffer)); resolve(); }
                        catch (e) { reject(e); }
                    }, 'image/png');
                }); showToast(L.exportSuccess);
            }
        } catch (err) { showToast(`${L.exportFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    };

    const toggleLayerVisibility = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        commitPsd(updateLayerByPath(psdRef.current, path, (l) => ({ ...l, hidden: !l.hidden })));
    }, [commitPsd, psdRef]);

    const renameSessionRef = useRef(false); const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const renameLayer = useCallback((path: number[], newName: string) => {
        if (!psdRef.current) return;
        const updated = updateLayerByPath(psdRef.current, path, (l) => ({ ...l, name: newName }));
        if (!renameSessionRef.current) { renameSessionRef.current = true; pushSnapshot(psdRef.current); }
        setPsd(updated); if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
        renameTimerRef.current = setTimeout(() => { renameTimerRef.current = null; renameSessionRef.current = false; }, 600);
    }, [psdRef, setPsd, pushSnapshot]);

    const handleAddLayer = useCallback(() => {
        if (!psdRef.current) return; const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Layer', hidden: false }, ...(cur.children || [])] });
    }, [commitPsd, psdRef]);

    const handleAddGroup = useCallback(() => {
        if (!psdRef.current) return; const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Group', hidden: false, children: [] }, ...(cur.children || [])] });
    }, [commitPsd, psdRef]);

    const handleDeleteLayer = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        const deleteAt = (p: any, pathArgs: number[]): any => {
            const newPsd = { ...p, children: [...(p.children || [])] }; let arr = newPsd.children;
            const pathCopy = [...pathArgs]; const lastIdx = pathCopy.pop()!;
            for (const idx of pathCopy) { arr[idx] = { ...arr[idx], children: [...(arr[idx].children || [])] }; arr = arr[idx].children!; }
            arr.splice(lastIdx, 1); return newPsd;
        }; commitPsd(deleteAt(psdRef.current, path));
    }, [commitPsd, psdRef]);

    const itemRectsRef = useRef<{ rect: DOMRect; path: number[]; isGroup: boolean }[]>([]);
    const cacheItemRects = useCallback(() => {
        const scroll = layerScrollRef.current; if (!scroll) return;
        const items = Array.from(scroll.querySelectorAll<HTMLElement>('[data-path]'));
        itemRectsRef.current = items.map(el => ({
            rect: el.getBoundingClientRect(),
            path: (el.getAttribute('data-path') ?? '').split('-').map(Number),
            isGroup: el.getAttribute('data-group') === 'true',
        }));
    }, []);

    const findDropTargetFromCache = useCallback((clientY: number) => {
        const items = itemRectsRef.current; if (!items.length) return null;
        let best: any = null;
        for (const { rect, path, isGroup } of items) {
            const zone = rect.height * 0.25; let position: any, dist: number;
            if (clientY < rect.top + zone) { position = 'before'; dist = Math.abs(clientY - rect.top); }
            else if (clientY > rect.bottom - zone) { position = 'after'; dist = Math.abs(clientY - rect.bottom); }
            else if (isGroup) { position = 'inside'; dist = Math.abs(clientY - (rect.top + rect.height / 2)); }
            else { position = clientY < rect.top + rect.height / 2 ? 'before' : 'after'; dist = Math.abs(clientY - (rect.top + rect.height / 2)); }
            if (!best || dist < best.dist) best = { path, position, dist };
        }
        return best ? { path: best.path, position: best.position } : null;
    }, []);

    const handleLayerDragStart = useCallback((e: React.MouseEvent, path: number[]) => {
        e.preventDefault(); e.stopPropagation();
        dragStateRef.current = { path, startY: e.clientY, moved: false };
        setDraggingPath(path); cacheItemRects();
        const throttledMove = throttle((ev: MouseEvent) => {
            if (!dragStateRef.current) return; const target = findDropTargetFromCache(ev.clientY);
            if (target) {
                const dragKey = dragStateRef.current.path.join('-'); const targetKey = target.path.join('-');
                if (targetKey !== dragKey && !targetKey.startsWith(dragKey + '-')) { setDropTarget(target); return; }
            } setDropTarget(null);
        }, 32);
        const onMouseMove = (ev: MouseEvent) => {
            if (!dragStateRef.current) return;
            if (Math.abs(ev.clientY - dragStateRef.current.startY) > 3) dragStateRef.current.moved = true; throttledMove(ev);
        };
        const onMouseUp = (ev: MouseEvent) => {
            const state = dragStateRef.current; dragStateRef.current = null;
            setDraggingPath(null); setDropTarget(null);
            window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp);
            if (!state?.moved) return; const target = findDropTargetFromCache(ev.clientY);
            if (!target) return;
            const dragKey = state.path.join('-'); const targetKey = target.path.join('-');
            if (targetKey === dragKey || targetKey.startsWith(dragKey + '-')) return;
            // applyDrop inline
            const current = psdRef.current; if (!current?.children) return;
            const cloneTree = (layers: any[]): any[] => layers.map(l => ({ ...l, children: l.children ? cloneTree(l.children) : undefined }));
            const newChildren = cloneTree(current.children);
            const [srcLayer] = (state.path.slice(0, -1).length === 0 ? newChildren : (function(c, p){let r=c;for(const i of p)r=r[i].children;return r;})(newChildren, state.path.slice(0, -1))).splice(state.path[state.path.length-1], 1);
            let dstPath = [...target.path]; const dstParentPath = dstPath.slice(0, -1);
            if (state.path.slice(0, -1).join('-') === dstParentPath.join('-') && state.path[state.path.length-1] < dstPath[dstPath.length-1]) dstPath[dstPath.length-1]--;
            if (target.position === 'inside') {
                const dstGroup = dstPath.length === 0 ? { children: newChildren } : (function(c, p){let r=c;for(const i of p)r=r[i].children;return r;})(newChildren, dstPath.slice(0, -1))[dstPath[dstPath.length-1]] as any;
                if (!dstGroup.children) dstGroup.children = []; dstGroup.children.push(srcLayer);
            } else {
                const dstArr = dstParentPath.length === 0 ? newChildren : (function(c, p){let r=c;for(const i of p)r=r[i].children;return r;})(newChildren, dstParentPath);
                let idx = dstPath[dstPath.length-1]; if (target.position === 'after') idx++; dstArr.splice(idx, 0, srcLayer);
            }
            commitPsd({ ...current, children: newChildren });
        };
        window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp);
    }, [cacheItemRects, findDropTargetFromCache, psdRef, commitPsd]);

    const getFlipSuffix = useCallback(() => {
        if (flipX && flipY) return ':flipxy'; if (flipX) return ':flipx'; if (flipY) return ':flipy'; return '';
    }, [flipX, flipY]);
    const hasFlipSuffix = useCallback((name: string) => /(:[Ff]lip(xy|x|y))$/i.test(name), []);
    const getBaseName = useCallback((name: string) => name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current; const currentPsd = psdRef.current; if (!canvas || !currentPsd) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        canvas.width = currentPsd.width; canvas.height = currentPsd.height;
        ctx.clearRect(0, 0, currentPsd.width, currentPsd.height);
        const flipSuffix = flipEnabled ? getFlipSuffix() : '';
        ctx.save();
        if (flipX && flipY) { ctx.translate(currentPsd.width, currentPsd.height); ctx.scale(-1, -1); }
        else if (flipX) { ctx.translate(currentPsd.width, 0); ctx.scale(-1, 1); }
        else if (flipY) { ctx.translate(0, currentPsd.height); ctx.scale(1, -1); }
        const drawLayers = (layers: any[]) => {
            const flipMap = new Map();
            if (flipEnabled && flipSuffix) { for (const l of layers) if ((l.name || '').toLowerCase().endsWith(flipSuffix.toLowerCase())) flipMap.set(getBaseName(l.name || '').toLowerCase(), l); }
            for (const layer of layers) {
                if (layer.hidden) continue; const name = layer.name || '';
                if (flipEnabled && hasFlipSuffix(name) && getFlipSuffix() && name.toLowerCase().endsWith(getFlipSuffix().toLowerCase())) continue;
                const effectiveLayer = flipMap.get(name.toLowerCase()) ?? layer;
                if (effectiveLayer.children) drawLayers(effectiveLayer.children);
                else if (effectiveLayer._bitmap) ctx.drawImage(effectiveLayer._bitmap, effectiveLayer.left || 0, effectiveLayer.top || 0);
                else if (effectiveLayer.canvas) ctx.drawImage(effectiveLayer.canvas, effectiveLayer.left || 0, effectiveLayer.top || 0);
            }
        };
        if (currentPsd.children) drawLayers(currentPsd.children);
        else if ((currentPsd as any)._bitmap) ctx.drawImage((currentPsd as any)._bitmap, 0, 0);
        ctx.restore(); drawDirtyRef.current = false;
    }, [flipX, flipY, flipEnabled, getFlipSuffix, getBaseName, hasFlipSuffix, psdRef]);

    useEffect(() => {
        if (!psd) return; drawDirtyRef.current = true; if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = requestAnimationFrame(() => { drawCanvas(); drawRafRef.current = null; });
        return () => { if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current); };
    }, [psd, flipX, flipY, flipEnabled, drawCanvas]);

    const handleApplyFavorite = useCallback((fav: LayerFavorite) => {
        if (!psdRef.current) return; const current = psdRef.current;
        const nextChildren = current.children ? applyLayerState(current.children, fav.state) : current.children;
        commitPsd({ ...current, children: nextChildren }); setClosedKeys(new Set(fav.closedKeys ?? []));
        if (fav.zoom) setZoomTo(fav.zoom); if (typeof fav.flipX === 'boolean') setFlipX(fav.flipX);
        if (typeof fav.flipY === 'boolean') setFlipY(fav.flipY); if (typeof fav.radioEnabled === 'boolean') setRadioEnabled(fav.radioEnabled);
        if (typeof fav.lockedEnabled === 'boolean') setLockedEnabled(fav.lockedEnabled); if (typeof fav.flipEnabled === 'boolean') setFlipEnabled(fav.flipEnabled);
        showToast(L.applied);
    }, [commitPsd, psdRef, showToast, L, setZoomTo]);

    const openCreateFavorite = useCallback(() => {
        if (!psdRef.current?.children) return;
        setFavoriteDialog({ mode: 'create', value: `${L.favorites} ${favorites.length + 1}` });
    }, [favorites.length, L, psdRef]);

    const confirmFavoriteDialog = useCallback(() => {
        if (!favoriteDialog) return; const name = favoriteDialog.value.trim(); if (!name) return;
        if (favoriteDialog.mode === 'create') {
            if (!psdRef.current?.children) return;
            saveFavorite(name, captureLayerState(psdRef.current.children), Array.from(closedKeys), {
                zoom, flipX, flipY, radioEnabled, lockedEnabled, flipEnabled,
            }); showToast(L.saved);
        } else if (favoriteDialog.mode === 'rename' && favoriteDialog.id) updateFavoriteName(favoriteDialog.id, name);
        setFavoriteDialog(null);
    }, [favoriteDialog, psdRef, saveFavorite, closedKeys, zoom, flipX, flipY, radioEnabled, lockedEnabled, flipEnabled, showToast, L, updateFavoriteName]);

    const cacheFavoriteRects = useCallback(() => {
        const root = favoriteListRef.current; if (!root) return;
        const items = Array.from(root.querySelectorAll<HTMLElement>('[data-favorite-id]'));
        favoriteRectsRef.current = items.map(el => ({ id: el.getAttribute('data-favorite-id') || '', rect: el.getBoundingClientRect() })).filter(x => x.id);
    }, []);

    const findFavoriteDropTarget = useCallback((clientY: number) => {
        const items = favoriteRectsRef.current; if (!items.length) return null;
        let best: any = null;
        for (const { id, rect } of items) {
            const mid = rect.top + rect.height / 2; const position = clientY < mid ? 'before' : 'after'; const dist = Math.abs(clientY - mid);
            if (!best || dist < best.dist) best = { id, position, dist };
        } return best ? { id: best.id, position: best.position } : null;
    }, []);

    const handleFavoriteDragStart = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault(); e.stopPropagation(); favoriteDragStateRef.current = { id, startY: e.clientY, moved: false }; cacheFavoriteRects();
        const onMouseMove = (ev: MouseEvent) => {
            if (!favoriteDragStateRef.current) return; if (Math.abs(ev.clientY - favoriteDragStateRef.current.startY) > 3) favoriteDragStateRef.current.moved = true;
            const target = findFavoriteDropTarget(ev.clientY); setFavoriteDrop(target?.id !== favoriteDragStateRef.current.id ? target : null);
        };
        const onMouseUp = (ev: MouseEvent) => {
            const state = favoriteDragStateRef.current; favoriteDragStateRef.current = null;
            const target = findFavoriteDropTarget(ev.clientY); setFavoriteDrop(null);
            window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp);
            if (!state?.moved || !target || target.id === state.id) return;
            const from = favorites.findIndex(f => f.id === state.id); let to = favorites.findIndex(f => f.id === target.id);
            if (from === -1 || to === -1) return; if (target.position === 'after') to++; if (from < to) to--; moveFavoriteTo(state.id, to);
        };
        window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp);
    }, [cacheFavoriteRects, findFavoriteDropTarget, favorites, moveFavoriteTo]);

    return (
        <div className={`psd-editor theme-${settings.theme} ${isDragging ? 'is-dragging' : ''}`}>
            <EditorHeader 
                psd={psd} recentFiles={recentFiles} handleOpenFile={handleOpenFile} 
                loadPsdFromFilePath={loadPsdFromFilePath} clearRecentFiles={clearRecentFiles} 
                language={settings.language} flipX={flipX} setFlipX={setFlipX} flipY={flipY} setFlipY={setFlipY} 
                handleZoom={handleZoom} zoomInputActive={zoomInputActive} zoomInputRef={zoomInputRef} 
                zoomInputValue={zoomInputValue} setZoomInputValue={setZoomInputValue} 
                handleZoomInputCommit={handleZoomInputCommit} handleZoomInputFocus={handleZoomInputFocus} 
                zoom={zoom} resetZoom={resetZoom} handleToggleFullscreen={handleToggleFullscreen} 
                isFullscreen={isFullscreen} setShowSettings={setShowSettings} 
                handleExportPng={handleExportPng} handleSaveFile={handleSaveFile} 
                setZoomInputActive={setZoomInputActive} L={L}
            />

            <div className="editor-main">
                <LayerPanel 
                    width={sidebarWidth}
                    psd={psd} isLoading={isLoading} searchResults={searchResults} searchQuery={searchQuery} 
                    setSearchQuery={setSearchQuery} searchInputRef={searchInputRef} 
                    radioEnabled={radioEnabled} setRadioEnabled={setRadioEnabled} 
                    lockedEnabled={lockedEnabled} setLockedEnabled={setLockedEnabled} 
                    flipEnabled={flipEnabled} setFlipEnabled={setFlipEnabled} 
                    closedKeys={closedKeys} handleToggleExpand={handleToggleExpand} 
                    toggleLayerVisibility={toggleLayerVisibility} renameLayer={renameLayer} 
                    toggleRadioLayer={toggleRadioLayer} handleDeleteLayer={handleDeleteLayer} 
                    handleLayerDragStart={handleLayerDragStart} draggingPath={draggingPath} 
                    dropTarget={dropTarget} hasFlipSuffix={hasFlipSuffix} 
                    handleExpandAll={handleExpandAll} handleCollapseAll={handleCollapseAll} 
                    handleAddLayer={handleAddLayer} handleAddGroup={handleAddGroup} 
                    favorites={favorites} openCreateFavorite={openCreateFavorite} 
                    handleApplyFavorite={handleApplyFavorite} openRenameFavorite={(f) => setFavoriteDialog({ mode: 'rename', id: f.id, value: f.name })} 
                    deleteFavorite={deleteFavorite} handleFavoriteDragStart={handleFavoriteDragStart} 
                    favoriteDrop={favoriteDrop} favoriteListRef={favoriteListRef} 
                    layerScrollRef={layerScrollRef} formatFavoriteTime={formatFavoriteTime} 
                    lang={settings.language} L={L}
                />

                <div className="sidebar-resizer" onMouseDown={handleResizerMouseDown} />

                <PreviewArea 
                    psd={psd} isLoading={isLoading} scrollRef={scrollRef} 
                    canvasContainerRef={canvasContainerRef} canvasRef={canvasRef} 
                    SCROLL_AREA={SCROLL_AREA} L={L}
                />
            </div>

            {isDragging && (
                <div className="drag-overlay">
                    <div className="drag-message">
                        <div className="overlay-icon-ring"><ImageIcon size={48} /></div>
                        <div className="overlay-text"><h3>{L.dragDrop}</h3><p>{L.dragRelease}</p></div>
                    </div>
                </div>
            )}

            {showSettings && <SettingsModal settings={settings} onUpdate={updateSettings} onClose={() => setShowSettings(false)} />}
            {notification && <Toast message={notification.message} type={notification.type} onClose={handleCloseNotification} />}
            {favoriteDialog && (
                <FavoriteModal 
                    favoriteDialog={favoriteDialog} closeFavoriteDialog={() => setFavoriteDialog(null)} 
                    confirmFavoriteDialog={confirmFavoriteDialog} favoriteInputRef={favoriteInputRef} 
                    setFavoriteDialog={setFavoriteDialog} L={L}
                />
            )}
        </div>
    );
};

export default PsdEditor;
