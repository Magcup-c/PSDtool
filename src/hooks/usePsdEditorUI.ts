import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalSize } from '@tauri-apps/api/dpi';
import { AppSettings } from './useSettings';

export const usePsdEditorUI = (updateSettings: (settings: Partial<AppSettings>) => void) => {
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const isResizingRef = useRef(false);
    const resizeCleanupRef = useRef<(() => void) | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const appWindow = getCurrentWindow();

    const [showSettings, setShowSettings] = useState(false);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [themeHover, setThemeHover] = useState(false);

    // Tauri側では初期表示を隠しているため、ReactのDOMが構築された直後に表示する。
    // Rustの setup() で先に表示すると、フロントエンドの読み込み中の白い画面が見える。
    useLayoutEffect(() => {
        appWindow.show().catch(() => {
            // 表示に失敗しても、アプリの初期化自体は継続する
        });
    }, [appWindow]);

    // [FIX] Windows(WebView2)でフルスクリーン切替直後に、新しく見えるようになった
    // 領域が再描画されず黒や単色のまま残るバグへの対処。
    // ウィンドウサイズを実際に1pxだけ変化させることで、
    // WebView2に強制的に再描画(invalidate)させる。
    const nudgeRepaint = useCallback(async () => {
        try {
            const size = await appWindow.innerSize();
            await appWindow.setSize(new PhysicalSize(size.width + 1, size.height));
            requestAnimationFrame(() => {
                appWindow.setSize(new PhysicalSize(size.width, size.height)).catch(() => {});
            });
        } catch {
            // 取得・設定に失敗しても致命的ではないので無視
        }
    }, [appWindow]);

    const handleToggleFullscreen = useCallback(async () => {
        const next = !isFullscreen;
        await appWindow.setFullscreen(next);
        setIsFullscreen(next);
        // フルスクリーン化・解除の直後、少し遅らせてから再描画を強制する
        setTimeout(() => { nudgeRepaint(); }, 60);
    }, [appWindow, isFullscreen, nudgeRepaint]);

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
