import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readPsd, writePsd, Psd } from 'ag-psd';
import {
    FolderOpen, Save, Layers,
    Image as ImageIcon,
    Monitor, ZoomIn, ZoomOut, Maximize, X, Minus, Square, Download, FlipHorizontal2,
    FlipVertical2, Asterisk, Pin, Replace, ChevronsDownUp,
    ChevronsUpDown, Plus, FolderPlus, Search,
} from 'lucide-react';
import './PsdEditor.css';

import { getLayersAtPath, cacheDataUrls, updateLayerByPath, collectSearchResults, throttle } from './utils/psdUtils';
import { DropTargetInfo } from './types';
import { Toast } from './components/Toast';
import { SearchResultRow } from './components/SearchResultRow';
import { LayerItem } from './components/LayerItem';
import { usePsdHistory } from './hooks/usePsdHistory';
import { useZoomPan } from './hooks/useZoomPan';

const PsdEditor = () => {
    const { psd, setPsd, psdRef, commitPsd, handleUndo, handleRedo, normalizeRadioGroups, toggleRadioLayer } = usePsdHistory(null);

    const [isLoading, setIsLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [radioEnabled, setRadioEnabled] = useState(true);
    const [lockedEnabled, setLockedEnabled] = useState(true);
    const [flipEnabled, setFlipEnabled] = useState(true);
    const [theme, setTheme] = useState<'black' | 'grey' | 'light' | 'white'>('grey');
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [closedKeys, setClosedKeys] = useState<Set<string>>(new Set());
    const [draggingPath, setDraggingPath] = useState<number[] | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTargetInfo | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const layerScrollRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{ path: number[]; startY: number; moved: boolean } | null>(null);

    const drawDirtyRef = useRef(false);
    const drawRafRef = useRef<number | null>(null);

    const { zoom, handleZoom, resetZoom, MARGIN } = useZoomPan(psdRef, scrollRef);

    const appWindow = getCurrentWindow();
    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = () => appWindow.toggleMaximize();
    const handleClose = () => appWindow.close();
    const handleCloseNotification = useCallback(() => setNotification(null), []);

    const handleToggleExpand = useCallback((key: string) => {
        setClosedKeys(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    }, []);

    const collectGroupKeys = useCallback((layers: any[], parentPath: number[] = []): string[] => {
        const keys: string[] = [];
        layers.forEach((layer, idx) => {
            if (layer.children?.length > 0) {
                const path = [...parentPath, idx];
                keys.push(path.join('-'));
                keys.push(...collectGroupKeys(layer.children, path));
            }
        });
        return keys;
    }, []);

    const handleExpandAll = useCallback(() => setClosedKeys(new Set()), []);
    const handleCollapseAll = useCallback(() => {
        if (!psd?.children) return;
        setClosedKeys(new Set(collectGroupKeys(psd.children)));
    }, [psd, collectGroupKeys]);

    const isChildClosed = useCallback((childKey: string) => closedKeys.has(childKey), [closedKeys]);

    const searchResults = useMemo(() => {
        const q = searchQuery.trim();
        if (!q || !psd?.children) return null;
        return collectSearchResults(psd.children, q);
    }, [searchQuery, psd]);

    const showToast = (message: string, type: 'success' | 'error' = 'success') =>
        setNotification({ message, type });

    const handleCopyCanvas = useCallback(async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        try {
            await new Promise<void>((resolve, reject) => {
                canvas.toBlob(async (blob) => {
                    if (!blob) { reject(new Error('toBlob failed')); return; }
                    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); resolve(); }
                    catch (e) { reject(e); }
                }, 'image/png');
            });
            showToast('Copied to clipboard!');
        } catch (err) {
            showToast(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, []);

    const loadPsdFromFilePath = useCallback(async (path: string) => {
        setIsLoading(true);
        try {
            const data = await readFile(path);
            const parsedPsd = readPsd(data, { skipLayerImageData: false, skipCompositeImageData: false });
            if (parsedPsd.children) {
                parsedPsd.children = normalizeRadioGroups(parsedPsd.children);
                cacheDataUrls(parsedPsd.children);
            }
            setPsd(parsedPsd);
        } catch (err) {
            showToast(`Failed to load PSD: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
        setIsLoading(false);
    }, [normalizeRadioGroups, setPsd]);

    useEffect(() => {
        const unlistenPromises = Promise.all([
            listen('tauri://drag-over', () => setIsDragging(true)),
            listen('tauri://drag-drop', (event: any) => {
                setIsDragging(false);
                const paths = event.payload.paths;
                if (paths?.length > 0 && paths[0].toLowerCase().endsWith('.psd')) loadPsdFromFilePath(paths[0]);
            }),
            listen('tauri://drag-leave', () => setIsDragging(false)),
        ]);
        return () => { unlistenPromises.then(us => us.forEach(u => u())); };
    }, [loadPsdFromFilePath]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
            if ((e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); handleRedo(); return; }
            if (e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey)) {
                if (window.getSelection()?.toString().length) return;
                e.preventDefault(); handleCopyCanvas();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleUndo, handleRedo, handleCopyCanvas]);

    const handleOpenFile = async () => {
        try {
            const selected = await open({ multiple: false, filters: [{ name: 'PSD Image', extensions: ['psd'] }] });
            if (selected && typeof selected === 'string') loadPsdFromFilePath(selected);
        } catch (err) { showToast(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    };

    const handleSaveFile = async () => {
        if (!psd) return;
        try {
            const selected = await save({ title: 'Save PSD File', filters: [{ name: 'PSD Image', extensions: ['psd'] }] });
            if (selected) { await writeFile(selected, new Uint8Array(writePsd(psd) as ArrayBuffer)); showToast('File saved successfully!'); }
        } catch (err) { showToast(`Failed to save file: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    };

    const handleExportPng = async () => {
        if (!canvasRef.current || !psd) return;
        try {
            const selected = await save({ title: 'Export as PNG', filters: [{ name: 'PNG Image', extensions: ['png'] }] });
            if (selected) {
                const bin = atob(canvasRef.current.toDataURL('image/png').split(',')[1]);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                await writeFile(selected, arr);
                showToast('PNG exported successfully!');
            }
        } catch (err) { showToast(`Failed to export PNG: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    };

    const toggleLayerVisibility = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        commitPsd(updateLayerByPath(psdRef.current, path, (l) => ({ ...l, hidden: !l.hidden })));
    }, [commitPsd, psdRef]);

    const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const renameSessionRef = useRef(false);

    const renameLayer = useCallback((path: number[], newName: string) => {
        if (!psdRef.current) return;
        const updated = updateLayerByPath(psdRef.current, path, (l) => ({ ...l, name: newName }));
        if (!renameSessionRef.current) { renameSessionRef.current = true; commitPsd(updated); }
        else { if (renameTimerRef.current) clearTimeout(renameTimerRef.current); setPsd(updated); }
        if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
        renameTimerRef.current = setTimeout(() => { renameTimerRef.current = null; renameSessionRef.current = false; }, 600);
    }, [commitPsd, psdRef, setPsd]);

    const handleAddLayer = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Layer', hidden: false }, ...(cur.children || [])] });
    }, [commitPsd, psdRef]);

    const handleAddGroup = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Group', hidden: false, children: [] }, ...(cur.children || [])] });
    }, [commitPsd, psdRef]);

    const handleDeleteLayer = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        const deleteAt = (p: Psd, pathArgs: number[]): Psd => {
            const newPsd = { ...p, children: [...(p.children || [])] };
            let arr = newPsd.children;
            const pathCopy = [...pathArgs];
            const lastIdx = pathCopy.pop()!;
            for (const idx of pathCopy) { arr[idx] = { ...arr[idx], children: [...(arr[idx].children || [])] }; arr = arr[idx].children!; }
            arr.splice(lastIdx, 1);
            return newPsd;
        };
        commitPsd(deleteAt(psdRef.current, path));
    }, [commitPsd, psdRef]);

    const itemRectsRef = useRef<{ el: HTMLElement; rect: DOMRect; path: number[]; isGroup: boolean }[]>([]);

    const cacheItemRects = useCallback(() => {
        const scroll = layerScrollRef.current;
        if (!scroll) return;
        const items = Array.from(scroll.querySelectorAll<HTMLElement>('[data-path]'));
        itemRectsRef.current = items.map(el => ({
            el,
            rect: el.getBoundingClientRect(),
            path: (el.getAttribute('data-path') ?? '').split('-').map(Number),
            isGroup: el.getAttribute('data-group') === 'true',
        }));
    }, []);

    const findDropTargetFromCache = useCallback((clientY: number): DropTargetInfo | null => {
        const items = itemRectsRef.current;
        if (!items.length) return null;
        let best: (DropTargetInfo & { dist: number }) | null = null;
        for (const { rect, path, isGroup } of items) {
            const zone = rect.height * 0.25;
            let position: 'before' | 'after' | 'inside';
            let dist: number;
            if (clientY < rect.top + zone) { position = 'before'; dist = Math.abs(clientY - rect.top); }
            else if (clientY > rect.bottom - zone) { position = 'after'; dist = Math.abs(clientY - rect.bottom); }
            else if (isGroup) { position = 'inside'; dist = Math.abs(clientY - (rect.top + rect.height / 2)); }
            else { position = clientY < rect.top + rect.height / 2 ? 'before' : 'after'; dist = Math.abs(clientY - (rect.top + rect.height / 2)); }
            if (!best || dist < best.dist) best = { path, position, dist };
        }
        return best ? { path: best.path, position: best.position } : null;
    }, []);

    const applyDrop = useCallback((srcPath: number[], dst: DropTargetInfo) => {
        const current = psdRef.current;
        if (!current?.children) return;
        const cloneTree = (layers: any[]): any[] => layers.map(l => ({ ...l, children: l.children ? cloneTree(l.children) : undefined }));
        const newChildren = cloneTree(current.children);
        const srcParentPath = srcPath.slice(0, -1);
        const srcIdx = srcPath[srcPath.length - 1];
        const srcArr = srcParentPath.length === 0 ? newChildren : getLayersAtPath(newChildren, srcParentPath);
        const [srcLayer] = srcArr.splice(srcIdx, 1);
        let dstPath = [...dst.path];
        const dstParentPath = dstPath.slice(0, -1);
        const isSameParent = srcParentPath.join('-') === dstParentPath.join('-');
        if (isSameParent && srcIdx < dstPath[dstPath.length - 1]) dstPath[dstPath.length - 1]--;
        if (dst.position === 'inside') {
            const dstGroup = dstPath.length === 0
                ? { children: newChildren }
                : getLayersAtPath(newChildren, dstPath.slice(0, -1))[dstPath[dstPath.length - 1]] as any;
            if (!dstGroup.children) dstGroup.children = [];
            dstGroup.children.push(srcLayer);
        } else {
            const dstArr = dstParentPath.length === 0 ? newChildren : getLayersAtPath(newChildren, dstParentPath);
            let insertIdx = dstPath[dstPath.length - 1];
            if (dst.position === 'before') insertIdx++;
            dstArr.splice(insertIdx, 0, srcLayer);
        }
        commitPsd({ ...current, children: newChildren });
    }, [commitPsd, psdRef]);

    const handleLayerDragStart = useCallback((e: React.MouseEvent, path: number[]) => {
        e.preventDefault(); e.stopPropagation();
        dragStateRef.current = { path, startY: e.clientY, moved: false };
        setDraggingPath(path);
        cacheItemRects();

        const throttledMove = throttle((ev: MouseEvent) => {
            if (!dragStateRef.current) return;
            const target = findDropTargetFromCache(ev.clientY);
            if (target) {
                const dragKey = dragStateRef.current.path.join('-');
                const targetKey = target.path.join('-');
                if (targetKey !== dragKey && !targetKey.startsWith(dragKey + '-')) { setDropTarget(target); return; }
            }
            setDropTarget(null);
        }, 32);

        const onMouseMove = (ev: MouseEvent) => {
            if (!dragStateRef.current) return;
            if (Math.abs(ev.clientY - dragStateRef.current.startY) > 3) dragStateRef.current.moved = true;
            throttledMove(ev);
        };
        const onMouseUp = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            const state = dragStateRef.current;
            dragStateRef.current = null;
            setDraggingPath(null); setDropTarget(null);
            if (!state?.moved) return;
            const target = findDropTargetFromCache(ev.clientY);
            if (!target) return;
            const dragKey = state.path.join('-');
            const targetKey = target.path.join('-');
            if (targetKey === dragKey || targetKey.startsWith(dragKey + '-')) return;
            applyDrop(state.path, target);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [cacheItemRects, findDropTargetFromCache, applyDrop]);

    const getFlipSuffix = useCallback((): string => {
        if (flipX && flipY) return ':flipxy';
        if (flipX) return ':flipx';
        if (flipY) return ':flipy';
        return '';
    }, [flipX, flipY]);

    const getBaseName = useCallback((name: string): string => name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);
    const hasFlipSuffix = useCallback((name: string): boolean => /(:[Ff]lip(xy|x|y))$/i.test(name), []);

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const currentPsd = psdRef.current;
        if (!canvas || !currentPsd) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = currentPsd.width;
        canvas.height = currentPsd.height;
        ctx.clearRect(0, 0, currentPsd.width, currentPsd.height);

        const currentFlipX = flipX, currentFlipY = flipY;
        const flipSuffix = flipEnabled ? getFlipSuffix() : '';

        ctx.save();
        if (currentFlipX && currentFlipY) { ctx.translate(currentPsd.width, currentPsd.height); ctx.scale(-1, -1); }
        else if (currentFlipX) { ctx.translate(currentPsd.width, 0); ctx.scale(-1, 1); }
        else if (currentFlipY) { ctx.translate(0, currentPsd.height); ctx.scale(1, -1); }

        const buildFlipVariantMap = (layers: any[]) => {
            const map = new Map<string, any>();
            if (!flipSuffix) return map;
            for (const l of layers) {
                const lowerName = (l.name || '').toLowerCase();
                if (lowerName.endsWith(flipSuffix.toLowerCase())) map.set(getBaseName(l.name || '').toLowerCase(), l);
            }
            return map;
        };
        const drawLayers = (layers: any[]) => {
            const flipVariantMap = buildFlipVariantMap(layers);
            for (const layer of layers) {
                if (layer.hidden) continue;
                const name = layer.name || '';
                if (hasFlipSuffix(name)) continue;
                const effectiveLayer = flipVariantMap.get(name.toLowerCase()) ?? layer;
                if (effectiveLayer.children) drawLayers(effectiveLayer.children);
                else if (effectiveLayer.canvas) ctx.drawImage(effectiveLayer.canvas, effectiveLayer.left || 0, effectiveLayer.top || 0);
            }
        };

        if (currentPsd.children && currentPsd.children.length > 0) drawLayers(currentPsd.children as any[]);
        else if (currentPsd.canvas) ctx.drawImage(currentPsd.canvas, 0, 0);
        ctx.restore();

        drawDirtyRef.current = false;
    }, [flipX, flipY, flipEnabled, getFlipSuffix, getBaseName, hasFlipSuffix, psdRef]);

    useEffect(() => {
        if (!psd) return;
        drawDirtyRef.current = true;
        if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = requestAnimationFrame(() => { drawCanvas(); drawRafRef.current = null; });
        return () => { if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current); };
    }, [psd, flipX, flipY, flipEnabled, drawCanvas]);

    return (
        <div className={`psd-editor theme-${theme} ${isDragging ? 'is-dragging' : ''}`}>
            <div className="custom-title-bar" data-tauri-drag-region onMouseDown={(e) => { if (e.button === 0) appWindow.startDragging(); }}>
                <div className="title-bar-brand" data-tauri-drag-region>
                    <ImageIcon size={14} /><span>PSD STUDIO</span>
                </div>
                <div className="window-controls">
                    <button onClick={handleMinimize} onMouseDown={(e) => e.stopPropagation()} className="control-btn mini" title="Minimize"><Minus size={14} /></button>
                    <button onClick={handleMaximize} onMouseDown={(e) => e.stopPropagation()} className="control-btn max" title="Maximize/Restore"><Square size={12} /></button>
                    <button onClick={handleClose} onMouseDown={(e) => e.stopPropagation()} className="control-btn close" title="Close"><X size={14} /></button>
                </div>
            </div>

            <header className="editor-header">
                <div className="brand"><Layers size={20} className="text-accent" /><h1>Workspace</h1></div>
                <div className="theme-switcher">
                    {(['black', 'grey', 'light', 'white'] as const).map((t) => (
                        <button key={t} className={`theme-btn ${theme === t ? 'active' : ''}`} onClick={() => setTheme(t)} title={`${t.charAt(0).toUpperCase() + t.slice(1)} Theme`}>
                            <div className={`swatch theme-${t}`} />
                        </button>
                    ))}
                </div>
                {psd && (
                    <div className="zoom-controls">
                        <button onClick={() => setFlipX(v => !v)} className={flipX ? 'btn-active' : ''} title="Flip Horizontal"><FlipHorizontal2 size={16} /></button>
                        <button onClick={() => setFlipY(v => !v)} className={flipY ? 'btn-active' : ''} title="Flip Vertical"><FlipVertical2 size={16} /></button>
                        <div className="zoom-sep" />
                        <button onClick={() => handleZoom(-0.1)} title="Zoom Out"><ZoomOut size={16} /></button>
                        <span className="zoom-value" onClick={resetZoom} title="Reset Zoom">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => handleZoom(0.1)} title="Zoom In"><ZoomIn size={16} /></button>
                        <button onClick={resetZoom} title="Reset View"><Maximize size={16} /></button>
                    </div>
                )}
                <div className="btn-group">
                    <button onClick={handleOpenFile}><FolderOpen size={18} /><span>Open</span></button>
                    {psd && (<>
                        <button onClick={handleExportPng} className="btn-secondary"><Download size={18} /><span>PNG</span></button>
                        <button onClick={handleSaveFile} className="btn-primary"><Save size={18} /><span>Save PSD</span></button>
                    </>)}
                </div>
            </header>

            <div className="editor-main">
                <aside className="layer-panel">
                    <div className="panel-header">
                        <h2>Layers</h2>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {psd && !searchResults && (<>
                                <button className="toggle-expand" onClick={handleAddLayer} title="Add layer"><Plus size={14} /></button>
                                <button className="toggle-expand" onClick={handleAddGroup} title="Add group"><FolderPlus size={14} /></button>
                                <div style={{ width: 1, height: 14, background: 'var(--line-mid)', margin: '0 2px' }} />
                            </>)}
                            {!searchResults && (<>
                                <button className="toggle-expand" onClick={handleExpandAll} title="Expand all groups"><ChevronsUpDown size={14} /></button>
                                <button className="toggle-expand" onClick={handleCollapseAll} title="Collapse all groups"><ChevronsDownUp size={14} /></button>
                            </>)}
                        </div>
                    </div>

                    {psd && (
                        <div className="layer-search-bar">
                            <Search size={12} className="layer-search-icon" />
                            <input
                                ref={searchInputRef} type="text" className="layer-search-input"
                                placeholder="Search layers..." value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
                            />
                            {searchQuery && (
                                <button className="layer-search-clear" onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }} title="Clear search">
                                    <X size={11} />
                                </button>
                            )}
                        </div>
                    )}

                    {!searchResults && (
                        <div className="layer-mode-bar">
                            <button className={`mode-toggle ${radioEnabled ? 'active' : ''}`} onClick={() => setRadioEnabled(v => !v)} title="Radio group mode"><Asterisk size={13} /><span>Radio</span></button>
                            <button className={`mode-toggle ${lockedEnabled ? 'active' : ''}`} onClick={() => setLockedEnabled(v => !v)} title="Locked visibility mode"><Pin size={13} /><span>Fixed</span></button>
                            <button className={`mode-toggle ${flipEnabled ? 'active' : ''}`} onClick={() => setFlipEnabled(v => !v)} title="Flip variant mode"><Replace size={13} /><span>Flip</span></button>
                        </div>
                    )}

                    <div className="layer-scroll" ref={layerScrollRef}>
                        {psd && psd.children ? (
                            searchResults ? (
                                searchResults.length > 0 ? (
                                    <div className="search-results-list">
                                        {searchResults.map((result) => (
                                            <SearchResultRow key={result.path.join('-')} result={result} onToggle={toggleLayerVisibility} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="empty-state"><p>No layers found</p></div>
                                )
                            ) : (
                                <ul className="layer-list">
                                    {[...psd.children].reverse().map((layer, index, array) => {
                                        const originalIndex = array.length - 1 - index;
                                        if (flipEnabled && hasFlipSuffix(layer.name || '')) return null;
                                        return (
                                            <LayerItem
                                                key={originalIndex} layer={layer} path={[originalIndex]}
                                                siblings={psd.children!} radioEnabled={radioEnabled}
                                                lockedEnabled={lockedEnabled} flipEnabled={flipEnabled}
                                                isClosed={closedKeys.has(String(originalIndex))} isChildClosed={isChildClosed}
                                                onToggleExpand={handleToggleExpand} onToggle={toggleLayerVisibility}
                                                onRename={renameLayer} onRadioSelect={toggleRadioLayer}
                                                onDelete={handleDeleteLayer} onDragStart={handleLayerDragStart}
                                                draggingPath={draggingPath} dropTarget={dropTarget}
                                                hasFlipSuffix={hasFlipSuffix}
                                            />
                                        );
                                    })}
                                </ul>
                            )
                        ) : (
                            <div className="empty-state">
                                <p>{isLoading ? 'Analyzing workspace...' : 'Drop a PSD file here'}</p>
                            </div>
                        )}
                    </div>
                </aside>

                <div
                    className="preview-panel"
                    ref={scrollRef}
                    style={{
                        overflow: 'scroll',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                    } as React.CSSProperties}
                >
                    {psd ? (
                        <div className="preview-scroll-inner" style={{
                            width: psd.width * zoom + MARGIN * 2,
                            height: psd.height * zoom + MARGIN * 2,
                            position: 'relative',
                            minWidth: '100%',
                            minHeight: '100%',
                        }}>
                            <div
                                className="canvas-container"
                                style={{
                                    position: 'absolute',
                                    left: MARGIN,
                                    top: MARGIN,
                                    width: psd.width,
                                    height: psd.height,
                                    transform: `scale(${zoom})`,
                                    transformOrigin: 'top left',
                                }}
                            >
                                <canvas ref={canvasRef} />
                            </div>
                        </div>
                    ) : (
                        <div className="placeholder" style={{ position: 'absolute', inset: 0 }}>
                            <Monitor className="placeholder-icon" />
                            <p>Drag and drop or import a PSD file to start</p>
                        </div>
                    )}
                </div>
            </div>

            {isDragging && (
                <div className="drag-overlay">
                    <div className="drag-message">
                        <div className="overlay-icon-ring"><Download size={48} /></div>
                        <div className="overlay-text"><h3>Ready to Import</h3><p>Release to open your PSD masterpiece</p></div>
                    </div>
                </div>
            )}

            {notification && <Toast message={notification.message} type={notification.type} onClose={handleCloseNotification} />}
        </div>
    );
};

export default PsdEditor;