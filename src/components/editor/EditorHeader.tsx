import React from 'react';
import { 
    Layers, Image as ImageIcon, ZoomIn, ZoomOut, Maximize, Maximize2, Minimize,
    FlipHorizontal2, FlipVertical2, Settings, FolderOpen, Download, Save,
    Minus, Square, X 
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FileMenu } from '../FileMenu';
import { Psd } from 'ag-psd';
import { RecentFile } from '../../hooks/useRecentFiles';

interface EditorHeaderProps {
    psd: Psd | null;
    recentFiles: RecentFile[];
    handleOpenFile: () => void;
    loadPsdFromFilePath: (path: string) => void;
    clearRecentFiles: () => void;
    language: 'ja' | 'en';
    flipX: boolean;
    setFlipX: React.Dispatch<React.SetStateAction<boolean>>;
    flipY: boolean;
    setFlipY: React.Dispatch<React.SetStateAction<boolean>>;
    handleZoom: (delta: number) => void;
    zoomInputActive: boolean;
    zoomInputRef: React.RefObject<HTMLInputElement | null>;
    zoomInputValue: string;
    setZoomInputValue: (val: string) => void;
    handleZoomInputCommit: () => void;
    handleZoomInputFocus: () => void;
    zoom: number;
    resetZoom: () => void;
    handleToggleFullscreen: () => void;
    isFullscreen: boolean;
    setShowSettings: (show: boolean) => void;
    handleExportPng: () => void;
    handleSaveFile: () => void;
    setZoomInputActive: (val: boolean) => void;
    L: any; // Translation object
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
    psd, recentFiles, handleOpenFile, loadPsdFromFilePath, clearRecentFiles, language,
    flipX, setFlipX, flipY, setFlipY, handleZoom, zoomInputActive, zoomInputRef,
    zoomInputValue, setZoomInputValue, handleZoomInputCommit, handleZoomInputFocus,
    zoom, resetZoom, handleToggleFullscreen, isFullscreen, setShowSettings,
    handleExportPng, handleSaveFile, setZoomInputActive, L
}) => {
    const appWindow = getCurrentWindow();

    return (
        <>
            <div className="custom-title-bar" data-tauri-drag-region>
                <div className="title-bar-left">
                    <div className="title-bar-brand">
                        <ImageIcon size={14} /><span>PSD STUDIO</span>
                    </div>
                    <FileMenu
                        recentFiles={recentFiles}
                        onOpen={handleOpenFile}
                        onOpenRecent={loadPsdFromFilePath}
                        onClearRecent={clearRecentFiles}
                        language={language}
                    />
                </div>
                {!isFullscreen && (
                    <div className="window-controls">
                        <button className="control-btn" onClick={() => appWindow.minimize()} aria-label="Minimize">
                            <Minus size={14} />
                        </button>
                        <button className="control-btn" onClick={() => appWindow.toggleMaximize()} aria-label="Maximize">
                            <Square size={12} />
                        </button>
                        <button className="control-btn close" onClick={() => appWindow.close()} aria-label="Close">
                            <X size={14} />
                        </button>
                    </div>
                )}
            </div>

            <header className="editor-header">
                <div className="brand">
                    <Layers size={20} className="text-accent" />
                    <h1>{L.workspace}</h1>
                </div>

                {psd && (
                    <div className="zoom-controls">
                        <button 
                            onClick={() => setFlipX(v => !v)} 
                            className={flipX ? 'btn-active' : ''} 
                            title="Flip Horizontal"
                            aria-label="Flip Horizontal"
                        >
                            <FlipHorizontal2 size={16} />
                        </button>
                        <button 
                            onClick={() => setFlipY(v => !v)} 
                            className={flipY ? 'btn-active' : ''} 
                            title="Flip Vertical"
                            aria-label="Flip Vertical"
                        >
                            <FlipVertical2 size={16} />
                        </button>
                        <div className="zoom-sep" />
                        <button 
                            onClick={() => handleZoom(-0.1)} 
                            title="Zoom Out"
                            aria-label="Zoom Out"
                        >
                            <ZoomOut size={16} />
                        </button>
                        {zoomInputActive ? (
                            <input
                                ref={zoomInputRef}
                                type="text"
                                className="zoom-value zoom-input"
                                value={zoomInputValue}
                                onChange={e => setZoomInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                                onBlur={handleZoomInputCommit}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleZoomInputCommit(); }
                                    if (e.key === 'Escape') { setZoomInputActive(false); }
                                }}
                                autoFocus
                            />
                        ) : (
                            <span 
                                className="zoom-value" 
                                onClick={handleZoomInputFocus} 
                                title="クリックして数値入力"
                                aria-label={`Current zoom: ${Math.round(zoom * 100)}%. Click to enter value.`}
                                role="button"
                            >
                                {Math.round(zoom * 100)}%
                            </span>
                        )}
                        <button 
                            onClick={() => handleZoom(0.1)} 
                            title="Zoom In"
                            aria-label="Zoom In"
                        >
                            <ZoomIn size={16} />
                        </button>
                        <button 
                            onClick={resetZoom} 
                            title="Reset View"
                            aria-label="Reset View"
                        >
                            <Maximize size={16} />
                        </button>
                        <div className="zoom-sep" />
                        <button 
                            onClick={handleToggleFullscreen} 
                            className={isFullscreen ? 'btn-active' : ''} 
                            title="全画面 (F11)"
                            aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                        >
                            {isFullscreen ? <Minimize size={16} /> : <Maximize2 size={16} />}
                        </button>
                    </div>
                )}
                <div className="btn-group" style={{ marginLeft: psd ? undefined : 'auto' }}>
                    <button 
                        onClick={() => setShowSettings(true)} 
                        title={`${L.settings} (Ctrl+,)`} 
                        className="btn-settings"
                        aria-label="Open Settings"
                    >
                        <Settings size={16} />
                    </button>
                    <button 
                        onClick={handleOpenFile}
                        aria-label="Open PSD File"
                    >
                        <FolderOpen size={18} />
                        <span>{L.open}</span>
                    </button>
                    {psd && (
                        <>
                            <button 
                                onClick={handleExportPng} 
                                className="btn-secondary"
                                aria-label="Export as PNG"
                            >
                                <Download size={18} />
                                <span>{L.png}</span>
                            </button>
                            <button 
                                onClick={handleSaveFile} 
                                className="btn-primary"
                                aria-label="Save PSD File"
                            >
                                <Save size={18} />
                                <span>{L.savePsd}</span>
                            </button>
                        </>
                    )}
                </div>
            </header>
        </>
    );
};
