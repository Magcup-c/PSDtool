import { useMemo, useLayoutEffect, useState, useRef } from 'react';
import {
    Plus, FolderPlus, ChevronsUpDown, ChevronsDownUp, Star, Search, X,
    Asterisk, Pin, Replace, GripVertical, Pencil, Trash2,
} from 'lucide-react';
import { SearchResultRow } from '../SearchResultRow';
import { VirtualLayerList, flattenLayers } from '../../VirtualLayerList';
import { DropTargetInfo, SearchResult } from '../../types';
import { LayerFavorite } from '../../hooks/useLayerFavorites';
import { Psd } from 'ag-psd';

interface LayerPanelProps {
    width: number;
    psd: Psd | null;
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
    toggleRadioLayer: (path: number[], siblings: any[]) => void;
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
    L: any;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
    width, psd, isLoading, searchResults, searchQuery, setSearchQuery, searchInputRef,
    radioEnabled, setRadioEnabled, lockedEnabled, setLockedEnabled, flipEnabled, setFlipEnabled,
    closedKeys, handleToggleExpand, toggleLayerVisibility, renameLayer, toggleRadioLayer,
    handleDeleteLayer, handleLayerDragStart, draggingPath, dropTarget, hasFlipSuffix,
    handleExpandAll, handleCollapseAll, handleAddLayer, handleAddGroup,
    favorites, openCreateFavorite, handleApplyFavorite, openRenameFavorite, deleteFavorite,
    handleFavoriteDragStart, favoriteDrop, favoriteListRef, layerScrollRef,
    formatFavoriteTime, lang, L
}) => {
    const layerResizeRef = useRef<HTMLDivElement>(null);
    const [layerListHeight, setLayerListHeight] = useState(400);

    useLayoutEffect(() => {
        const el = layerResizeRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            setLayerListHeight(Math.max(0, el.clientHeight));
        });
        ro.observe(el);
        setLayerListHeight(Math.max(0, el.clientHeight));
        return () => ro.disconnect();
    }, []);

    const flatLayers = useMemo(() => {
        if (!psd?.children?.length) return [];
        return flattenLayers(psd.children, closedKeys, flipEnabled, hasFlipSuffix);
    }, [psd, closedKeys, flipEnabled, hasFlipSuffix]);

    return (
        <div className="layer-panel" style={{ width, minWidth: width }}>
            <div className="panel-header">
                <h2>{L.layers}</h2>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {psd && !searchResults && (
                        <>
                            <button 
                                className="toggle-expand" 
                                onClick={handleAddLayer} 
                                title={L.addLayer}
                                aria-label="Add new layer"
                            >
                                <Plus size={14} />
                            </button>
                            <button 
                                className="toggle-expand" 
                                onClick={handleAddGroup} 
                                title={L.addGroup}
                                aria-label="Add new group"
                            >
                                <FolderPlus size={14} />
                            </button>
                            <div style={{ width: 1, height: 14, background: 'var(--line-mid)', margin: '0 2px' }} />
                        </>
                    )}
                    {!searchResults && (
                        <>
                            <button 
                                className="toggle-expand" 
                                onClick={handleExpandAll} 
                                title={L.expandAll}
                                aria-label="Expand all groups"
                            >
                                <ChevronsUpDown size={14} />
                            </button>
                            <button 
                                className="toggle-expand" 
                                onClick={handleCollapseAll} 
                                title={L.collapseAll}
                                aria-label="Collapse all groups"
                            >
                                <ChevronsDownUp size={14} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {psd && (
                <div className="favorites-panel">
                    <div className="favorites-header">
                        <span className="favorites-title">{L.favorites}</span>
                        <button 
                            className="favorite-add" 
                            onClick={openCreateFavorite} 
                            title={L.saveState}
                            aria-label="Save current visibility state as favorite"
                        >
                            <Star size={12} />
                        </button>
                    </div>
                    {favorites.length === 0 ? (
                        <div className="favorites-empty">{L.noFavorites}</div>
                    ) : (
                        <ul className="favorites-list" ref={favoriteListRef}>
                            {favorites.map((fav) => {
                                const isDrop = favoriteDrop?.id === fav.id;
                                const isDropBefore = isDrop && favoriteDrop?.position === 'before';
                                const isDropAfter = isDrop && favoriteDrop?.position === 'after';
                                return (
                                    <li
                                        key={fav.id}
                                        className={`favorite-row ${isDrop ? 'drop-target' : ''}`}
                                    >
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
                                            <Star size={11} className="favorite-icon" />
                                            <span className="favorite-name" data-full={fav.name} title={fav.name}>{fav.name}</span>
                                            <span className="favorite-time">{formatFavoriteTime(fav.createdAt, lang)}</span>
                                        </button>
                                        <div className="favorite-actions">
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
                    <button 
                        className={`mode-toggle ${radioEnabled ? 'active' : ''}`} 
                        onClick={() => setRadioEnabled(v => !v)} 
                        title="Radio group mode"
                        aria-label="Toggle radio group mode"
                    >
                        <Asterisk size={13} />
                        <span>{L.radio}</span>
                    </button>
                    <button 
                        className={`mode-toggle ${lockedEnabled ? 'active' : ''}`} 
                        onClick={() => setLockedEnabled(v => !v)} 
                        title="Locked visibility mode"
                        aria-label="Toggle locked visibility mode"
                    >
                        <Pin size={13} />
                        <span>{L.fixed}</span>
                    </button>
                    <button 
                        className={`mode-toggle ${flipEnabled ? 'active' : ''}`} 
                        onClick={() => setFlipEnabled(v => !v)} 
                        title="Flip variant mode"
                        aria-label="Toggle flip variant mode"
                    >
                        <Replace size={13} />
                        <span>{L.flip}</span>
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
