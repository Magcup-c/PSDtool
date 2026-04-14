import { useMemo, useLayoutEffect, useState, useRef, useCallback } from 'react';
import {
    Plus, FolderPlus, ChevronsUpDown, ChevronsDownUp, Star, Search, X,
    Asterisk, Pin, Replace, GripVertical, Pencil, Trash2,
    Upload, Download, Image as ImageIcon,
} from 'lucide-react';
import { SearchResultRow } from '../SearchResultRow';
import { VirtualLayerList, flattenLayers } from '../../VirtualLayerList';
import { DropTargetInfo, SearchResult, PsdRoot, PsdLayerNode, LocaleStrings } from '../../types';
import { LayerFavorite, exportFavoritesToJson, importFavoritesFromJson } from '../../hooks/useLayerFavorites';

interface LayerPanelProps {
    width: number;
    psd: PsdRoot | null;
    isLoading: boolean;
    searchResults: SearchResult[] | null;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    radioEnabled: boolean;
    setRadioEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    lockedEnabled: boolean;
    setLockedEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    flipEnabled: boolean;
    setFlipEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    closedKeys: Set<string>;
    handleToggleExpand: (key: string) => void;
    toggleLayerVisibility: (path: number[]) => void;
    renameLayer: (path: number[], name: string) => void;
    toggleRadioLayer: (path: number[], siblings: PsdLayerNode[]) => void;
    handleDeleteLayer: (path: number[]) => void;
    handleLayerDragStart: (e: React.MouseEvent, path: number[]) => void;
    draggingPath: number[] | null;
    dropTarget: DropTargetInfo | null;
    hasFlipSuffix: (name: string) => boolean;
    handleExpandAll: () => void;
    handleCollapseAll: () => void;
    handleAddLayer: () => void;
    handleAddGroup: () => void;
    favorites: LayerFavorite[];
    openCreateFavorite: () => void;
    handleApplyFavorite: (fav: LayerFavorite) => void;
    openRenameFavorite: (fav: LayerFavorite) => void;
    deleteFavorite: (id: string) => void;
    handleFavoriteDragStart: (e: React.MouseEvent, id: string) => void;
    favoriteDrop: { id: string; position: 'before' | 'after' } | null;
    favoriteListRef: React.RefObject<HTMLUListElement | null>;
    layerScrollRef: React.RefObject<HTMLDivElement | null>;
    formatFavoriteTime: (ts: number, lang: 'ja' | 'en') => string;
    lang: 'ja' | 'en';
    L: LocaleStrings;
    // 追加
    importFavorites: (incoming: LayerFavorite[], mode: 'merge' | 'replace') => void;
    onExportFavoriteImage: (fav: LayerFavorite) => void;
    onExportAllFavoriteImages: () => void;
    currentFilePath: string | null;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
    width, psd, isLoading, searchResults, searchQuery, setSearchQuery, searchInputRef,
    radioEnabled, setRadioEnabled, lockedEnabled, setLockedEnabled, flipEnabled, setFlipEnabled,
    closedKeys, handleToggleExpand, toggleLayerVisibility, renameLayer, toggleRadioLayer,
    handleDeleteLayer, handleLayerDragStart, draggingPath, dropTarget, hasFlipSuffix,
    handleExpandAll, handleCollapseAll, handleAddLayer, handleAddGroup,
    favorites, openCreateFavorite, handleApplyFavorite, openRenameFavorite, deleteFavorite,
    handleFavoriteDragStart, favoriteDrop, favoriteListRef, layerScrollRef,
    formatFavoriteTime, lang, L,
    importFavorites, onExportFavoriteImage, onExportAllFavoriteImages, currentFilePath,
}) => {
    const layerResizeRef = useRef<HTMLDivElement>(null);
    const [layerListHeight, setLayerListHeight] = useState(400);
    const importInputRef = useRef<HTMLInputElement>(null);
    const dropZoneRef = useRef<HTMLDivElement>(null);
    const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
    const [isDragOver, setIsDragOver] = useState(false);

    useLayoutEffect(() => {
        const el = layerResizeRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setLayerListHeight(Math.max(0, el.clientHeight)));
        ro.observe(el);
        setLayerListHeight(Math.max(0, el.clientHeight));
        return () => ro.disconnect();
    }, []);

    const flatLayers = useMemo(() => {
        if (!psd?.children?.length) return [];
        return flattenLayers(psd.children, closedKeys, flipEnabled, hasFlipSuffix);
    }, [psd, closedKeys, flipEnabled, hasFlipSuffix]);

    // ── JSON export ──────────────────────────────────────────────────────────
    const handleExportJson = useCallback(() => {
        if (favorites.length === 0) return;
        const stem = currentFilePath
            ? currentFilePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.psd$/i, '') ?? 'favorites'
            : 'favorites';
        exportFavoritesToJson(favorites, `${stem}_favorites.json`);
    }, [favorites, currentFilePath]);

    // ── JSON import (ファイル選択) ────────────────────────────────────────────
    const handleImportClick = useCallback(() => {
        importInputRef.current?.click();
    }, []);

    const handleImportFile = useCallback(async (file: File) => {
        try {
            const incoming = await importFavoritesFromJson(file);
            importFavorites(incoming, importMode);
        } catch (err) {
            alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [importFavorites, importMode]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleImportFile(file);
        e.target.value = '';
    }, [handleImportFile]);

    // ── JSON import (ドラッグ&ドロップ) ──────────────────────────────────────
    const handleDragOver = useCallback((e: React.DragEvent) => {
        const hasJson = Array.from(e.dataTransfer.items).some(
            item => item.kind === 'file' && (item.type === 'application/json' || item.type === '')
        );
        if (!hasJson) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const file = Array.from(e.dataTransfer.files).find(f =>
            f.name.endsWith('.json') || f.type === 'application/json'
        );
        if (file) handleImportFile(file);
    }, [handleImportFile]);

    const favToolTip = lang === 'ja'
        ? { exportJson: 'JSONで書き出し', importJson: 'JSONから読み込み', exportImg: 'すべてPNGで書き出し' }
        : { exportJson: 'Export as JSON', importJson: 'Import from JSON', exportImg: 'Export all as PNG' };

    return (
        <div
            className="layer-panel"
            style={{ width, minWidth: width }}
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* JSON ファイル選択用 hidden input */}
            <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleInputChange}
            />

            {/* ドラッグ&ドロップ オーバーレイ */}
            {isDragOver && (
                <div className="favorites-drop-overlay">
                    <div className="favorites-drop-message">
                        <Upload size={24} />
                        <span>{lang === 'ja' ? 'JSONをドロップして読み込み' : 'Drop JSON to import'}</span>
                    </div>
                </div>
            )}

            <div className="panel-header">
                <h2>{L.layers}</h2>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {psd && !searchResults && (
                        <>
                            <button className="toggle-expand" onClick={handleAddLayer} title={L.addLayer} aria-label="Add new layer">
                                <Plus size={14} />
                            </button>
                            <button className="toggle-expand" onClick={handleAddGroup} title={L.addGroup} aria-label="Add new group">
                                <FolderPlus size={14} />
                            </button>
                            <div style={{ width: 1, height: 14, background: 'var(--line-mid)', margin: '0 2px' }} />
                        </>
                    )}
                    {!searchResults && (
                        <>
                            <button className="toggle-expand" onClick={handleExpandAll} title={L.expandAll} aria-label="Expand all groups">
                                <ChevronsUpDown size={14} />
                            </button>
                            <button className="toggle-expand" onClick={handleCollapseAll} title={L.collapseAll} aria-label="Collapse all groups">
                                <ChevronsDownUp size={14} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {psd && (
                <div className="favorites-panel">
                    {/* ── お気に入りヘッダー ── */}
                    <div className="favorites-header">
                        <span className="favorites-title">{L.favorites}</span>
                        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            {/* 全件PNG書き出し */}
                            {favorites.length > 0 && (
                                <button
                                    className="favorite-add"
                                    onClick={onExportAllFavoriteImages}
                                    title={favToolTip.exportImg}
                                    aria-label="Export all favorites as PNG"
                                >
                                    <ImageIcon size={12} />
                                </button>
                            )}
                            {/* JSON 書き出し */}
                            {favorites.length > 0 && (
                                <button
                                    className="favorite-add"
                                    onClick={handleExportJson}
                                    title={favToolTip.exportJson}
                                    aria-label="Export favorites as JSON"
                                >
                                    <Download size={12} />
                                </button>
                            )}
                            {/* JSON 読み込み */}
                            <button
                                className="favorite-add"
                                onClick={handleImportClick}
                                title={favToolTip.importJson}
                                aria-label="Import favorites from JSON"
                            >
                                <Upload size={12} />
                            </button>
                            {/* merge / replace トグル — import ボタンの横に小さく表示 */}
                            <button
                                className={`favorite-add ${importMode === 'replace' ? 'btn-active' : ''}`}
                                onClick={() => setImportMode(m => m === 'merge' ? 'replace' : 'merge')}
                                title={lang === 'ja'
                                    ? `読み込みモード: ${importMode === 'merge' ? 'マージ' : '上書き'}（クリックで切替）`
                                    : `Import mode: ${importMode} (click to toggle)`}
                                style={{ fontSize: 9, fontFamily: 'var(--font-mono, monospace)', minWidth: 28, padding: '2px 4px' }}
                                aria-label="Toggle import mode"
                            >
                                {importMode === 'merge' ? '+M' : '=R'}
                            </button>
                            {/* 新規保存 */}
                            <button
                                className="favorite-add"
                                onClick={openCreateFavorite}
                                title={L.saveState}
                                aria-label="Save current visibility state as favorite"
                            >
                                <Star size={12} />
                            </button>
                        </div>
                    </div>

                    {favorites.length === 0 ? (
                        <div className="favorites-empty">{L.noFavorites}</div>
                    ) : (
                        <ul className="favorites-list" ref={favoriteListRef}>
                            {favorites.map((fav) => {
                                const isDrop       = favoriteDrop?.id === fav.id;
                                const isDropBefore = isDrop && favoriteDrop?.position === 'before';
                                const isDropAfter  = isDrop && favoriteDrop?.position === 'after';
                                return (
                                    <li key={fav.id} className={`favorite-row ${isDrop ? 'drop-target' : ''}`}>
                                        {isDropBefore && <div className="favorite-drop-line" />}
                                        <button
                                            className="favorite-item"
                                            onClick={() => handleApplyFavorite(fav)}
                                            title={L.applyState}
                                            data-favorite-id={fav.id}
                                            aria-label={`Apply favorite: ${fav.name}`}
                                        >
                                            <span
                                                className="favorite-drag"
                                                title={L.dragHandle}
                                                onMouseDown={(e) => handleFavoriteDragStart(e, fav.id)}
                                                aria-label="Drag to reorder"
                                                role="presentation"
                                            >
                                                <GripVertical size={12} />
                                            </span>

                                            {/* PNG プレビューサムネイル（あれば表示） */}
                                            {fav.previewDataUrl ? (
                                                <img
                                                    src={fav.previewDataUrl}
                                                    alt=""
                                                    className="favorite-preview-thumb"
                                                    aria-hidden="true"
                                                />
                                            ) : (
                                                <Star size={11} className="favorite-icon" />
                                            )}

                                            <span className="favorite-name" data-full={fav.name} title={fav.name}>
                                                {fav.name}
                                            </span>
                                            <span className="favorite-time">{formatFavoriteTime(fav.createdAt, lang)}</span>
                                        </button>

                                        <div className="favorite-actions">
                                            {/* 1件PNG書き出し */}
                                            <button
                                                className="favorite-action"
                                                onClick={() => onExportFavoriteImage(fav)}
                                                title={lang === 'ja' ? 'PNGで書き出し' : 'Export as PNG'}
                                                aria-label={`Export ${fav.name} as PNG`}
                                            >
                                                <ImageIcon size={11} />
                                            </button>
                                            <button
                                                className="favorite-action"
                                                onClick={() => openRenameFavorite(fav)}
                                                title={L.renameState}
                                                aria-label={`Rename favorite: ${fav.name}`}
                                            >
                                                <Pencil size={11} />
                                            </button>
                                            <button
                                                className="favorite-delete"
                                                onClick={() => deleteFavorite(fav.id)}
                                                title={L.deleteState}
                                                aria-label={`Delete favorite: ${fav.name}`}
                                            >
                                                <Trash2 size={11} />
                                            </button>
                                        </div>
                                        {isDropAfter && <div className="favorite-drop-line" />}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {psd && (
                <div className="layer-search-bar">
                    <Search size={12} className="layer-search-icon" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        className="layer-search-input"
                        placeholder={L.searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
                        aria-label="Search layers by name"
                    />
                    {searchQuery && (
                        <button
                            className="layer-search-clear"
                            onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                            title="Clear search"
                            aria-label="Clear search query"
                        >
                            <X size={11} />
                        </button>
                    )}
                </div>
            )}

            {!searchResults && (
                <div className="layer-mode-bar">
                    <button className={`mode-toggle ${radioEnabled ? 'active' : ''}`} onClick={() => setRadioEnabled(v => !v)} title="Radio group mode" aria-label="Toggle radio group mode">
                        <Asterisk size={13} /><span>{L.radio}</span>
                    </button>
                    <button className={`mode-toggle ${lockedEnabled ? 'active' : ''}`} onClick={() => setLockedEnabled(v => !v)} title="Locked visibility mode" aria-label="Toggle locked visibility mode">
                        <Pin size={13} /><span>{L.fixed}</span>
                    </button>
                    <button className={`mode-toggle ${flipEnabled ? 'active' : ''}`} onClick={() => setFlipEnabled(v => !v)} title="Flip variant mode" aria-label="Toggle flip variant mode">
                        <Replace size={13} /><span>{L.flip}</span>
                    </button>
                </div>
            )}

            <div ref={layerResizeRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {isLoading ? (
                    <div className="layer-scroll layer-loading">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="layer-shimmer-row" style={{ animationDelay: `${i * 60}ms` }}>
                                <div className="shimmer-icon" />
                                <div className="shimmer-icon" />
                                <div className="shimmer-thumb" />
                                <div className="shimmer-text" style={{ width: `${50 + (i * 37) % 35}%` }} />
                            </div>
                        ))}
                    </div>
                ) : psd && psd.children ? (
                    searchResults ? (
                        searchResults.length > 0 ? (
                            <div className="layer-scroll search-results-list" role="list">
                                {searchResults.map((result) => (
                                    <SearchResultRow key={result.path.join('-')} result={result} onToggle={toggleLayerVisibility} />
                                ))}
                            </div>
                        ) : (
                            <div className="layer-scroll empty-state"><p>{L.noLayers}</p></div>
                        )
                    ) : (
                        <VirtualLayerList
                            ref={layerScrollRef}
                            height={layerListHeight}
                            flatLayers={flatLayers}
                            radioEnabled={radioEnabled}
                            lockedEnabled={lockedEnabled}
                            onToggle={toggleLayerVisibility}
                            onRename={renameLayer}
                            onRadioSelect={toggleRadioLayer}
                            onToggleExpand={handleToggleExpand}
                            onDelete={handleDeleteLayer}
                            onDragStart={handleLayerDragStart}
                            draggingPath={draggingPath}
                            dropTarget={dropTarget}
                        />
                    )
                ) : (
                    <div className="layer-scroll empty-state"><p>{L.dropPsd}</p></div>
                )}
            </div>
        </div>
    );
};