import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { PhysicalSize } from '@tauri-apps/api/dpi';
import { AppSettings } from './useSettings';

export const usePsdEditorUI = (updateSettings: (settings: Partial<AppSettings>) => void) => {
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const isResizingRef = useRef(false);
    const resizeCleanupRef = useRef<(() => void) | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const appWindow = getCurrentWindow();

    // F11で全画面にする直前に最大化状態だったかを覚えておく
    // （全画面終了時に元の最大化状態へ復元するため）
    const wasMaximizedBeforeFullscreenRef = useRef(false);

    const [showSettings, setShowSettings] = useState(false);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [themeHover, setThemeHover] = useState(false);

    useLayoutEffect(() => {
        appWindow.show().catch(() => {});
    }, [appWindow]);

    const nudgeRepaint = useCallback(async () => {
        try {
            const size = await appWindow.innerSize();
            const bump = async (dx: number, dy: number) => {
                await appWindow.setSize(new PhysicalSize(size.width + dx, size.height + dy));
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => requestAnimationFrame(r));
                await appWindow.setSize(new PhysicalSize(size.width, size.height));
            };
            await bump(8, 0);
        } catch {
            // ignore
        }
    }, [appWindow]);

    // [FIX] 最大化 → フルスクリーン時に、元タスクバー領域が
    // 再描画されず黒/水色/白のまま残る WebView2 の不具合を回避する。
    // 一度ウィンドウを通常状態に戻してからフルスクリーンにする。
    const handleToggleFullscreen = useCallback(async () => {
        const next = !isFullscreen;

        if (next) {
            try {
                const wasMaximized = await appWindow.isMaximized();
                wasMaximizedBeforeFullscreenRef.current = wasMaximized;
                if (wasMaximized) {
                    await appWindow.unmaximize();
                    await new Promise(r => requestAnimationFrame(r));
                    await new Promise(r => requestAnimationFrame(r));
                }
            } catch {
                // 取得・復元に失敗しても致命的ではないため続行
            }
        }

        await appWindow.setFullscreen(next);
        setIsFullscreen(next);

        if (!next && wasMaximizedBeforeFullscreenRef.current) {
            // 全画面終了時、元が最大化だったなら最大化状態に戻す
            try { await appWindow.maximize(); } catch { /* ignore */ }
            wasMaximizedBeforeFullscreenRef.current = false;
        }

        setTimeout(() => { nudgeRepaint(); }, 100);
        setTimeout(() => { nudgeRepaint(); }, 400);
        setTimeout(() => { nudgeRepaint(); }, 900);
    }, [appWindow, isFullscreen, nudgeRepaint]);

    // [FIX] タイトルバーのドラッグ領域をダブルクリック/ドラッグして
    // ネイティブに「ウィンドウ化」された場合、Tauri内部の isFullscreen
    // フラグが true のまま取り残されることがある。
    // ウィンドウの実サイズとモニターサイズを比較する「ジオメトリ判定」を
    // 併用し、食い違っていれば setFullscreen(false) を明示的に呼んで
    // 内部フラグを実状態に強制同期する。
    const detectFullscreenByGeometry = useCallback(async (): Promise<boolean | null> => {
        try {
            const [size, monitor] = await Promise.all([
                appWindow.outerSize(),
                currentMonitor(),   // ← appWindow.currentMonitor() ではなく単体関数として呼ぶ
            ]);
            if (!monitor) return null;
            return size.width >= monitor.size.width && size.height >= monitor.size.height;
        } catch {
            return null;
        }
    }, [appWindow]);

    useEffect(() => {
        let unlisten: (() => void) | null = null;

        const syncFullscreenState = async () => {
            try {
                const [tauriFlag, geometryFullscreen] = await Promise.all([
                    appWindow.isFullscreen(),
                    detectFullscreenByGeometry(),
                ]);
                const actual = geometryFullscreen ?? tauriFlag;

                // Tauri内部フラグと実ジオメトリが食い違う場合は強制同期
                if (tauriFlag && !actual) {
                    await appWindow.setFullscreen(false);
                    wasMaximizedBeforeFullscreenRef.current = false;
                }

                setIsFullscreen(prev => (prev !== actual ? actual : prev));
                setTimeout(() => { nudgeRepaint(); }, 100);
                setTimeout(() => { nudgeRepaint(); }, 400);
                setTimeout(() => { nudgeRepaint(); }, 900);
            } catch {
                // ignore
            }
        };

        const setup = async () => {
            unlisten = await appWindow.onResized(() => {
                syncFullscreenState();
                setTimeout(syncFullscreenState, 150);
            });
        };
        setup();

        return () => { unlisten?.(); };
    }, [appWindow, nudgeRepaint, detectFullscreenByGeometry]);


    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') =>
        setNotification({ message, type }), []);

    const handleCloseNotification = useCallback(() => setNotification(null), []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        const onMouseMove = (ev: MouseEvent) => {
            if (!isResizingRef.current) return;
            setSidebarWidth(Math.max(200, Math.min(600, ev.clientX)));
        };
        const onMouseUp = () => {
            if (resizeCleanupRef.current) {
                resizeCleanupRef.current();
                resizeCleanupRef.current = null;
            }
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        resizeCleanupRef.current = () => {
            isResizingRef.current = false;
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    const handlePreviewTheme = useCallback((theme: AppSettings['theme']) => {
        updateSettings({ theme });
    }, [updateSettings]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"]')) return;
        e.preventDefault();
        const MENU_W = 220;
        const MENU_H = 360;
        const x = Math.max(8, Math.min(e.clientX, window.innerWidth - MENU_W - 8));
        const y = Math.max(8, Math.min(e.clientY, window.innerHeight - MENU_H - 8));
        setContextMenu({ x, y });
    }, []);

    useEffect(() => {
        if (!contextMenu) return;
        const onMouseDown = () => setContextMenu(null);
        const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setContextMenu(null); };
        window.addEventListener('mousedown', onMouseDown);
        window.addEventListener('scroll', onMouseDown, true);
        window.addEventListener('blur', onMouseDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('scroll', onMouseDown, true);
            window.removeEventListener('blur', onMouseDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [contextMenu]);

    useEffect(() => {
        if (!contextMenu) setThemeHover(false);
    }, [contextMenu]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (resizeCleanupRef.current) resizeCleanupRef.current();
        };
    }, []);

    return {
        sidebarWidth,
        handleResizerMouseDown,
        isFullscreen,
        handleToggleFullscreen,
        showSettings,
        setShowSettings,
        notification,
        showToast,
        handleCloseNotification,
        contextMenu,
        setContextMenu,
        closeContextMenu,
        handleContextMenu,
        themeHover,
        setThemeHover,
        handlePreviewTheme,
    };
};
