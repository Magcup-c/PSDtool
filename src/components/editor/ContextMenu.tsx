import React from 'react';
import { Translations } from '../../constants/translations';
import { AppSettings } from '../../hooks/useSettings';

interface ContextMenuProps {
    x: number;
    y: number;
    hasPsd: boolean;
    canUndo: boolean;
    canRedo: boolean;
    isFullscreen: boolean;
    theme: AppSettings['theme'];
    themeHover: boolean;
    setThemeHover: (hover: boolean) => void;
    updateTheme: (theme: AppSettings['theme']) => void;
    handleCopyCanvas: () => void;
    fitToScreen: () => void;
    centerPsd: () => void;
    handleZoom: (amount: number) => void;
    setZoomTo: (zoom: number) => void;
    handleUndo: () => void;
    handleRedo: () => void;
    handleToggleFullscreen: () => void;
    closeContextMenu: () => void;
    L: Translations;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
    x,
    y,
    hasPsd,
    canUndo,
    canRedo,
    isFullscreen,
    theme,
    themeHover,
    setThemeHover,
    updateTheme,
    handleCopyCanvas,
    fitToScreen,
    centerPsd,
    handleZoom,
    setZoomTo,
    handleUndo,
    handleRedo,
    handleToggleFullscreen,
    closeContextMenu,
    L,
}) => {
    return (
        <div
            className="context-menu"
            style={{ left: x, top: y }}
            onMouseDown={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
            onMouseLeave={() => setThemeHover(false)}
            role="menu"
        >
            <button
                className="context-menu-item"
                disabled={!hasPsd}
                onClick={() => { handleCopyCanvas(); closeContextMenu(); }}
            >
                {L.copyToClipboard}
            </button>
            <div className="context-menu-sep" />
            <button
                className="context-menu-item"
                disabled={!hasPsd}
                onClick={() => { fitToScreen(); closeContextMenu(); }}
            >
                {L.fitToScreen}
            </button>
            <button
                className="context-menu-item"
                disabled={!hasPsd}
                onClick={() => { centerPsd(); closeContextMenu(); }}
            >
                {L.centerView}
            </button>
            <button
                className="context-menu-item"
                disabled={!hasPsd}
                onClick={() => { handleZoom(0.1); closeContextMenu(); }}
            >
                {L.zoomIn}
            </button>
            <button
                className="context-menu-item"
                disabled={!hasPsd}
                onClick={() => { handleZoom(-0.1); closeContextMenu(); }}
            >
                {L.zoomOut}
            </button>
            <button
                className="context-menu-item"
                disabled={!hasPsd}
                onClick={() => { setZoomTo(1); closeContextMenu(); }}
            >
                {L.zoom100}
            </button>
            <div className="context-menu-sep" />
            <button
                className="context-menu-item"
                disabled={!hasPsd || !canUndo}
                onClick={() => { handleUndo(); closeContextMenu(); }}
            >
                {L.undo}
            </button>
            <button
                className="context-menu-item"
                disabled={!hasPsd || !canRedo}
                onClick={() => { handleRedo(); closeContextMenu(); }}
            >
                {L.redo}
            </button>
            <button
                className="context-menu-item"
                onClick={() => { handleToggleFullscreen(); closeContextMenu(); }}
            >
                {isFullscreen ? L.exitFullscreen : L.enterFullscreen}
            </button>
            <div className="context-menu-sep" />
            <div
                className="context-menu-group"
                onMouseEnter={() => setThemeHover(true)}
                onMouseLeave={() => setThemeHover(false)}
            >
                <button className="context-menu-item" type="button">
                    <span>{L.theme}</span>
                    <span className="context-menu-arrow">›</span>
                </button>
                {themeHover && (
                    <div className="context-menu-submenu">
                        {([
                            { key: 'black', label: L.themeBlack },
                            { key: 'grey', label: L.themeGrey },
                            { key: 'light', label: L.themeLight },
                            { key: 'white', label: L.themeWhite },
                        ] as { key: AppSettings['theme']; label: string }[]).map(th => (
                            <button
                                key={th.key}
                                className={`context-menu-item ${theme === th.key ? 'active' : ''}`}
                                onClick={() => { updateTheme(th.key); closeContextMenu(); }}
                            >
                                <span className={`context-menu-dot ${theme === th.key ? 'active' : ''}`} />
                                <span>{th.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
