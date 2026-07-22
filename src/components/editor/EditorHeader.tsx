import React from 'react';
import { 
    ZoomIn, ZoomOut, Maximize, Maximize2, Minimize,
    FlipHorizontal2, FlipVertical2, Settings, FolderOpen, Download, Save,
    Image as ImageIcon, Minus, Square, X 
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FileMenu } from '../FileMenu';
import { ToolsMenu } from '../ToolsMenu';
import { PsdRoot, LocaleStrings } from '../../types';
import { RecentFile } from '../../hooks/useRecentFiles';

interface EditorHeaderProps {
    psd: PsdRoot | null;
    recentFiles: RecentFile[];
    handleOpenFile: () => void;
    loadPsdFromFilePath: (path: string) => void;
    clearRecentFiles: () => void;
    language: 'ja' | 'en';
    currentFilePath: string | null;
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
    exportButtonLabel: string;
    exportAriaLabel: string;
    L: LocaleStrings;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
    psd, recentFiles, handleOpenFile, loadPsdFromFilePath, clearRecentFiles, language,
    currentFilePath,
    flipX, setFlipX, flipY, setFlipY, handleZoom, zoomInputActive, zoomInputRef,
    zoomInputValue, setZoomInputValue, handleZoomInputCommit, handleZoomInputFocus,
    zoom, resetZoom, handleToggleFullscreen, isFullscreen, setShowSettings,
    handleExportPng, handleSaveFile, setZoomInputActive, exportButtonLabel, exportAriaLabel, L
}) => {
    const appWindow = getCurrentWindow();

    return (
        <div className="unified-title-bar" data-tauri-drag-region>
            {/* ── 左: ブランド + メニュー ── */}
            <div className="titlebar-left">
                <div className="titlebar-brand">
                    <ImageIcon size={13} />
                    <span>psdStudio</span>
                </div>
                <div className="titlebar-divider" />
                <FileMenu
                    recentFiles={recentFiles}
                    onOpen={handleOpenFile}
                    onOpenRecent={loadPsdFromFilePath}
                    onClearRecent={clearRecentFiles}
                    language={language}
                />
                <ToolsMenu
                    currentFilePath={currentFilePath}
                    language={language}
                />
                {!psd && (
                    <>
                        <div className="titlebar-divider" />
                        <button
                            className="titlebar-ghost-btn"
                            onClick={handleOpenFile}
                            aria-label="Open PSD File"
                        >
                            <FolderOpen size={13} />
                            <span>{L.open}</span>
                        </button>
                    </>
                )}
            </div>

            {/* ── 中央: ズーム / 反転ツール（カプセル） ── */}
            <div className="titlebar-center">
                {psd && (
                    <div className="titlebar-tool-capsule">
                        <button
                            onClick={() => setFlipX(v => !v)}
                            className={`capsule-btn ${flipX ? 'active' : ''}`}
                            title="Flip Horizontal"
                            aria-label="Flip Horizontal"
                        >
                            <FlipHorizontal2 size={13} />
                        </button>
                        <button
                            onClick={() => setFlipY(v => !v)}
                            className={`capsule-btn ${flipY ? 'active' : ''}`}
                            title="Flip Vertical"
                            aria-label="Flip Vertical"
                        >
                            <FlipVertical2 size={13} />
                        </button>

                        <div className="capsule-sep" />

                        <button
                            onClick={() => handleZoom(-0.1)}
                            className="capsule-btn"
                            title="Zoom Out"
                            aria-label="Zoom Out"
                        >
                            <ZoomOut size={13} />
                        </button>

                        {zoomInputActive ? (
                            <input
                                ref={zoomInputRef}
                                type="text"
                                className="capsule-zoom-input"
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
                                className="capsule-zoom-value"
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
                            className="capsule-btn"
                            title="Zoom In"
                            aria-label="Zoom In"
                        >
                            <ZoomIn size={13} />
                        </button>
                        <button
                            onClick={resetZoom}
                            className="capsule-btn"
                            title="Reset View"
                            aria-label="Reset View"
                        >
                            <Maximize size={13} />
                        </button>

                        <div className="capsule-sep" />

                        <button
                            onClick={handleToggleFullscreen}
                            className={`capsule-btn ${isFullscreen ? 'active' : ''}`}
                            title="全画面 (F11)"
                            aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                        >
                            {isFullscreen ? <Minimize size={13} /> : <Maximize2 size={13} />}
                        </button>
                    </div>
                )}
            </div>

            {/* ── 右: 設定 / 書き出し / 保存 / ウィンドウ操作 ── */}
            <div className="titlebar-right">
                <button
                    onClick={() => setShowSettings(true)}
                    title={`${L.settings} (Ctrl+,)`}
                    className="titlebar-ghost-btn icon-only"
                    aria-label="Open Settings"
                >
                    <Settings size={14} />
                </button>

                {psd && (
                    <>
                        <button
                            onClick={handleExportPng}
                            className="titlebar-ghost-btn"
                            aria-label={exportAriaLabel}
                        >
                            <Download size={13} />
                            <span>{exportButtonLabel}</span>
                        </button>
                        <button
                            onClick={handleSaveFile}
                            className="titlebar-accent-btn"
                            aria-label="Save PSD File"
                        >
                            <Save size={13} />
                            <span>{L.savePsd}</span>
                        </button>
                    </>
                )}

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
        </div>
    );
};