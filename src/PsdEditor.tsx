/**
 * src/PsdEditor.tsx
 */

import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import './PsdEditor.scss';

import { usePsdHistory } from './hooks/usePsdHistory';
import { usePsdWorker } from './hooks/usePsdWorker';
import { useZoomPan } from './hooks/useZoomPan';
import { useSettings } from './hooks/useSettings';
import { useRecentFiles } from './hooks/useRecentFiles';
import { useLayerFavorites } from './hooks/useLayerFavorites';
import { useTabManager } from './hooks/useTabManager';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useLayerDragDrop } from './hooks/useLayerDragDrop';
import { usePsdExport, ExportFormat } from './hooks/usePsdExport';

import { usePsdEditorUI } from './hooks/usePsdEditorUI';
import { usePsdLoader } from './hooks/usePsdLoader';
import { useEditorCanvas } from './hooks/useEditorCanvas';
import { useLayerActions } from './hooks/useLayerActions';
import { useFavoriteActions } from './hooks/useFavoriteActions';

import { useZoomInput } from './hooks/useZoomInput';
import { useLayerUIState } from './hooks/useLayerUIState';
import { useTabSync } from './hooks/useTabSync';
import { useFileActions } from './hooks/useFileActions';
import { useEditorLifecycle } from './hooks/useEditorLifecycle';

import { getTranslations } from './constants/translations';
import { EditorHeader } from './components/editor/EditorHeader';
import { LayerPanel } from './components/editor/LayerPanel';
import { PreviewArea } from './components/editor/PreviewArea';
import { FavoriteModal } from './components/editor/FavoriteModal';
import { SettingsModal } from './components/SettingsModal';
import { Toast } from './components/Toast';
import { TabBar } from './components/TabBar';
import { ConfirmModal } from './components/ConfirmModal';
import { ContextMenu } from './components/editor/ContextMenu';
import { DragOverlay } from './components/editor/DragOverlay';
import type { PsdRoot } from './types';
import { formatFavoriteTime } from './utils/editorUtils';

const PsdEditor = () => {
    const { settings, updateSettings } = useSettings();

    const { loadPsd } = usePsdWorker();
    const { recentFiles, addRecentFile, clearRecentFiles } = useRecentFiles(settings.maxRecentFiles ?? 10);

    // ↓ tabManager を先に作る
    const tabManager = useTabManager();
    const { tabs, activeId, updateTab, tabsRef } = tabManager;
    const activeIdRef = useRef(activeId);
    activeIdRef.current = activeId;

    // psdが変わるたびに「同じ呼び出し内」でアクティブタブへ書き戻す。
    // activeIdRef は毎レンダーで更新され、この関数自体も同期的に呼ばれるため
    // 高速タブ切替が割り込む余地がない。
    const handlePsdChange = useCallback((next: PsdRoot | null) => {
        updateTab(activeIdRef.current, { psd: next });
    }, [updateTab]);

    const {
        psd, setPsd, psdRef, canUndo, canRedo, commitPsd, pushSnapshot, handleUndo, handleRedo,
        toggleRadioLayer, resetHistory,
    } = usePsdHistory(null, () => tabsRef.current.map(t => t.psd), handlePsdChange);

    const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; confirmLabel: string; cancelLabel: string; variant?: 'danger' | 'warning'; onConfirm: () => void; onCancel: () => void } | null>(null);
    const favoriteInputRef = useRef<HTMLInputElement>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const layerScrollRef = useRef<HTMLDivElement>(null);

    const L = useMemo(() => getTranslations(settings.language), [settings.language]);

    const ui = usePsdEditorUI(updateSettings);
    const { showToast } = ui;

    const { openPsdUnified, isFirstLoadRef } = usePsdLoader({
        tabManager, loadPsd, addRecentFile, showToast, L, resetHistory,
        setCurrentFilePath, setIsLoading, setIsDragging, activeIdRef, tabsRef
    });

    const {
        canvasRef, flipX, setFlipX, flipY, setFlipY, radioEnabled, setRadioEnabled,
        lockedEnabled, setLockedEnabled, flipEnabled, setFlipEnabled,
        drawCanvas, drawRafRef, hasFlipSuffix,
    } = useEditorCanvas(psd, psdRef);

    const { zoom, handleZoom, setZoomTo, resetZoom, centerPsd, fitToScreen, SCROLL_AREA, applyZoom } =
        useZoomPan(psdRef, scrollRef, canvasContainerRef, settings.scrollAction ?? 'pan');

    const {
        zoomInputActive, setZoomInputActive, zoomInputValue, setZoomInputValue,
        zoomInputRef, handleZoomInputFocus, handleZoomInputCommit
    } = useZoomInput(zoom, setZoomTo);

    const {
        toggleLayerVisibility, renameLayer, handleAddLayer, handleAddGroup, handleDeleteLayer,
        renameSessionRef, renameTimerRef
    } = useLayerActions({ psdRef, commitPsd, pushSnapshot, setPsd, markDirty: () => tabManager.markDirty() });

    const {
        closedKeys, setClosedKeys, searchQuery, setSearchQuery, searchInputRef,
        handleToggleExpand, handleExpandAll, handleCollapseAll, searchResults
    } = useLayerUIState(psd);

    const {
        favorites, saveFavorite, deleteFavorite, updateFavoriteName, moveFavoriteTo, importFavorites,
    } = useLayerFavorites(currentFilePath);

    const {
        favoriteDialog, setFavoriteDialog, favoriteDrop, setFavoriteDrop, favoriteListRef,
        handleApplyFavorite, handleExportFavoriteImage, handleExportAllFavoriteImages,
        openCreateFavorite, confirmFavoriteDialog, handleFavoriteDragStart, favoriteDragCleanupRef
    } = useFavoriteActions({
        psdRef, commitPsd, setClosedKeys, setZoomTo, setFlipX, setFlipY,
        setRadioEnabled, setLockedEnabled, setFlipEnabled, showToast, L,
        favorites, saveFavorite, updateFavoriteName, moveFavoriteTo, canvasRef, lang: settings.language
    });

    const { draggingPath, dropTarget, handleLayerDragStart, cleanupDrag: layerDragCleanup } = useLayerDragDrop(
        layerScrollRef, psdRef, commitPsd, () => tabManager.markDirty()
    );

    // useTabSync はタブ切り替え（activeId 変化）の処理だけを担当する。
    // handleCloseTab・handleNewTab とは重複させない。
    useTabSync({
        activeId, tabs, updateTab, scrollRef, canvasContainerRef, zoom, flipX, flipY, closedKeys,
        resetHistory, setCurrentFilePath, setFlipX, setFlipY, setClosedKeys,
        setSearchQuery, setZoomInputActive, applyZoom, isFirstLoadRef,
        layerDragCleanup, favoriteDragCleanupRef, setFavoriteDrop,
        renameSessionRef, renameTimerRef, psd, drawCanvas,
    });

    const { handleOpenFile: handleOpenFileBase, handleCopyCanvas, handleSaveFile } = useFileActions({
        psd, canvasRef, openPsdUnified, showToast, L, activeId, updateTab, language: settings.language
    });

    const confirmUnsavedChanges = useCallback((targetTabId?: string, onDecision?: (confirmed: boolean) => void) => {
        const target = tabsRef.current.find(tab => tab.id === (targetTabId ?? activeIdRef.current));
        if (!target?.isDirty) {
            onDecision?.(true);
            return;
        }

        setConfirmState({
            open: true,
            title: L.unsavedChangesTitle,
            message: L.unsavedChangesMessage,
            confirmLabel: L.discardChanges,
            cancelLabel: L.cancel,
            variant: 'warning',
            onConfirm: () => {
                setConfirmState(null);
                onDecision?.(true);
            },
            onCancel: () => {
                setConfirmState(null);
                onDecision?.(false);
            },
        });
    }, [activeIdRef, L, tabsRef]);

    const handleOpenFile = useCallback(() => {
        return new Promise<void>(resolve => {
            confirmUnsavedChanges(undefined, confirmed => {
                if (!confirmed) {
                    resolve();
                    return;
                }
                handleOpenFileBase().finally(() => resolve());
            });
        });
    }, [confirmUnsavedChanges, handleOpenFileBase]);

    const { handleExportPng } = usePsdExport(canvasRef, psd, settings, showToast, L);

    useEditorLifecycle({
        psd, isFirstLoadRef, scrollRef, centerPsd, drawRafRef, layerDragCleanup
    });

    useKeyboardShortcuts({
        handleUndo, handleRedo, handleCopyCanvas, handleToggleFullscreen: ui.handleToggleFullscreen,
        handleOpenFile, setShowSettings: ui.setShowSettings, handleZoom, centerPsd,
        tabs, activeId, handleActivateTab: tabManager.setActiveId,
        handleCloseTab: id => handleCloseTab(id),
        handleNewTab: () => handleNewTab(),
    });

    const exportButtonLabel = useMemo(() => {
        const m: Record<ExportFormat, string> = { png: 'PNG', jpeg: 'JPG', webp: 'WebP', svg: 'SVG' };
        return m[(settings.exportFormat ?? 'png') as ExportFormat];
    }, [settings.exportFormat]);

    const exportAriaLabel = useMemo(() => {
        return settings.language === 'ja' ? `${exportButtonLabel}で書き出し` : `Export as ${exportButtonLabel}`;
    }, [exportButtonLabel, settings.language]);

    const handleNewTab = useCallback(() => {
        confirmUnsavedChanges(undefined, confirmed => {
            if (!confirmed) return;
            tabManager.openNewTab();
            // useTabSync が activeId 変化を検知して状態を復元するので
            // ここでは openNewTab だけ呼べばよい
        });
    }, [confirmUnsavedChanges, tabManager]);

    // タブを閉じる。
    // 重要：ここでは resetHistory などの state 操作を一切行わない。
    // closeTab → activeId が変わる → useTabSync の useLayoutEffect が発火して
    // すべての状態復元を行う、という一本化した流れにする。
    const handleCloseTab = useCallback((id: string) => {
        confirmUnsavedChanges(id, confirmed => {
            if (!confirmed) return;

            const currentTabs = tabsRef.current;

        if (currentTabs.length === 1) {
            // 最後の1枚: 空タブにリセットして閉じる
            // activeId は変わらないので useTabSync は発火しない。
            // ここで直接リセットする。
            resetHistory(null);
            setCurrentFilePath(null);
            setFlipX(false);
            setFlipY(false);
            setClosedKeys(new Set());
            setSearchQuery('');
            setZoomInputActive(false);
            applyZoom(1);
            const el = scrollRef.current;
            if (el) {
                el.scrollLeft = SCROLL_AREA / 2;
                el.scrollTop = SCROLL_AREA / 2;
            }
        }

            // activeId が変わるので useTabSync の useLayoutEffect が
            // 次のアクティブタブの状態をすべて復元する
            tabManager.closeTab(id);
        });
    }, [
        tabsRef, tabManager, resetHistory,
        setCurrentFilePath, setFlipX, setFlipY, setClosedKeys,
        setSearchQuery, setZoomInputActive, applyZoom, scrollRef, SCROLL_AREA,
    ]);

    useEffect(() => {
        // Web fallback: beforeunload for browser environments
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            const hasUnsavedChanges = tabsRef.current.some(tab => tab.isDirty);
            if (!hasUnsavedChanges) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        // Tauri: intercept the native close button / OS quit
        let unlisten: (() => void) | undefined;
        (async () => {
            try {
                const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
                const appWindow = getCurrentWebviewWindow();
                unlisten = await appWindow.onCloseRequested(async (event) => {
                    const hasUnsavedChanges = tabsRef.current.some(tab => tab.isDirty);
                    if (!hasUnsavedChanges) return; // close proceeds normally

                    event.preventDefault(); // stop the window from closing

                    // Show our custom confirm dialog
                    setConfirmState({
                        open: true,
                        title: L.quitTitle,
                        message: L.quitMessage,
                        confirmLabel: L.quitDiscard,
                        cancelLabel: L.cancel,
                        variant: 'danger',
                        onConfirm: async () => {
                            setConfirmState(null);
                            // Force close without triggering close-requested again
                            await appWindow.destroy();
                        },
                        onCancel: () => {
                            setConfirmState(null);
                        },
                    });
                });
            } catch {
                // Not in Tauri environment, beforeunload handles it
            }
        })();

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            unlisten?.();
        };
    }, [tabsRef, L]);

    return (
        <div
            className={`psd-editor theme-${settings.theme} ${isDragging ? 'is-dragging' : ''}`}
            onContextMenu={ui.handleContextMenu}
        >
            <EditorHeader
                psd={psd} recentFiles={recentFiles} handleOpenFile={handleOpenFile}
                loadPsdFromFilePath={openPsdUnified} clearRecentFiles={clearRecentFiles}
                language={settings.language} flipX={flipX} setFlipX={setFlipX} flipY={flipY} setFlipY={setFlipY}
                handleZoom={handleZoom} zoomInputActive={zoomInputActive} zoomInputRef={zoomInputRef}
                zoomInputValue={zoomInputValue} setZoomInputValue={setZoomInputValue}
                handleZoomInputCommit={handleZoomInputCommit} handleZoomInputFocus={handleZoomInputFocus}
                zoom={zoom} resetZoom={resetZoom} handleToggleFullscreen={ui.handleToggleFullscreen}
                isFullscreen={ui.isFullscreen} setShowSettings={ui.setShowSettings}
                handleExportPng={handleExportPng} handleSaveFile={handleSaveFile}
                setZoomInputActive={setZoomInputActive} L={L}
                currentFilePath={currentFilePath}
                exportButtonLabel={exportButtonLabel}
                exportAriaLabel={exportAriaLabel}
            />

            <TabBar
                tabs={tabs} activeId={activeId}
                onActivate={tabManager.setActiveId} onClose={handleCloseTab}
                onNewTab={handleNewTab} onReorder={tabManager.reorderTabs}
                language={settings.language}
            />

            <div className="editor-main">
                <LayerPanel
                    width={ui.sidebarWidth}
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
                    favorites={favorites}
                    openCreateFavorite={() => openCreateFavorite(
                        Array.from(closedKeys),
                        { zoom, flipX, flipY, radioEnabled, lockedEnabled, flipEnabled }
                    )}
                    handleApplyFavorite={handleApplyFavorite}
                    openRenameFavorite={f => setFavoriteDialog({ mode: 'rename', id: f.id, value: f.name })}
                    deleteFavorite={deleteFavorite} handleFavoriteDragStart={handleFavoriteDragStart}
                    favoriteDrop={favoriteDrop} favoriteListRef={favoriteListRef}
                    layerScrollRef={layerScrollRef} formatFavoriteTime={formatFavoriteTime}
                    lang={settings.language} L={L}
                    importFavorites={importFavorites}
                    onExportFavoriteImage={handleExportFavoriteImage}
                    onExportAllFavoriteImages={handleExportAllFavoriteImages}
                    currentFilePath={currentFilePath}
                    showToast={showToast}
                />

                <div className="sidebar-resizer" onMouseDown={ui.handleResizerMouseDown} />

                <PreviewArea
                    activeTabId={activeId}
                    psd={psd} isLoading={isLoading} scrollRef={scrollRef}
                    canvasContainerRef={canvasContainerRef} canvasRef={canvasRef}
                    SCROLL_AREA={SCROLL_AREA} L={L}
                />
            </div>

            {isDragging && <DragOverlay L={L} />}

            {ui.showSettings && (
                <SettingsModal
                    settings={settings} onUpdate={updateSettings}
                    onClose={() => ui.setShowSettings(false)} onPreview={ui.handlePreviewTheme}
                    onError={msg => showToast(msg, 'error')}
                />
            )}

            {ui.notification && (
                <Toast message={ui.notification.message} type={ui.notification.type} onClose={ui.handleCloseNotification} />
            )}

            {confirmState && (
                <ConfirmModal
                    isOpen={!!confirmState}
                    title={confirmState.title}
                    message={confirmState.message}
                    confirmLabel={confirmState.confirmLabel}
                    cancelLabel={confirmState.cancelLabel}
                    variant={confirmState.variant}
                    onConfirm={confirmState.onConfirm}
                    onCancel={confirmState.onCancel}
                />
            )}

            {favoriteDialog && (
                <FavoriteModal
                    favoriteDialog={favoriteDialog}
                    closeFavoriteDialog={() => setFavoriteDialog(null)}
                    confirmFavoriteDialog={() => confirmFavoriteDialog(
                        Array.from(closedKeys),
                        { zoom, flipX, flipY, radioEnabled, lockedEnabled, flipEnabled }
                    )}
                    favoriteInputRef={favoriteInputRef}
                    setFavoriteDialog={setFavoriteDialog}
                    L={L}
                />
            )}

            {ui.contextMenu && (
                <ContextMenu
                    {...ui.contextMenu}
                    hasPsd={!!psd}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    isFullscreen={ui.isFullscreen}
                    theme={settings.theme}
                    themeHover={ui.themeHover}
                    setThemeHover={ui.setThemeHover}
                    updateTheme={t => updateSettings({ theme: t })}
                    handleCopyCanvas={handleCopyCanvas}
                    fitToScreen={fitToScreen}
                    centerPsd={centerPsd}
                    handleZoom={handleZoom}
                    setZoomTo={setZoomTo}
                    handleUndo={handleUndo}
                    handleRedo={handleRedo}
                    handleToggleFullscreen={ui.handleToggleFullscreen}
                    closeContextMenu={ui.closeContextMenu}
                    L={L}
                />
            )}
        </div>
    );
};

export default PsdEditor;