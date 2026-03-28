/**
 * src/PsdEditor.tsx  (updated)
 *
 * 変更点:
 *   1. useTabManager でマルチタブ管理
 *   2. TabBar コンポーネントを EditorHeader 下に追加
 *   3. タブ切り替え時にスクロール・ズーム・フリップ状態を復元
 *   4. 書き出し形式（JPEG/WebP/SVG）に対応した handleExport
 *   5. SettingsModal に onPreview（テーマ即時プレビュー）を渡す
 */

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
import { moveLayer } from './utils/psdTreeOps';
import { Toast } from './components/Toast';
import { SettingsModal } from './components/SettingsModal';
import { TabBar } from './components/TabBar';
import { usePsdHistory } from './hooks/usePsdHistory';
import { usePsdWorker } from './hooks/usePsdWorker';
import { useZoomPan } from './hooks/useZoomPan';
import { useSettings, type AppSettings } from './hooks/useSettings';
import { useRecentFiles } from './hooks/useRecentFiles';
import { useLayerFavorites, LayerFavorite } from './hooks/useLayerFavorites';
import { useTabManager } from './hooks/useTabManager';

import { EditorHeader } from './components/editor/EditorHeader';
import { LayerPanel } from './components/editor/LayerPanel';
import { PreviewArea } from './components/editor/PreviewArea';
import { FavoriteModal } from './components/editor/FavoriteModal';

// ─── layer state helpers ────────────────────────────────────────────────────

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
        if (node && typeof node.hidden === 'boolean' && !isLocked) next.hidden = node.hidden;
        if (layer.children?.length) next.children = applyLayerState(layer.children, node?.children);
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

// ─── Canvas export helpers ──────────────────────────────────────────────────

type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

function canvasToSvgDataUrl(canvas: HTMLCanvasElement): string {
    const dataUrl = canvas.toDataURL('image/png');
    const w = canvas.width;
    const h = canvas.height;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<image href="${dataUrl}" width="${w}" height="${h}"/>` +
        `</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

async function exportCanvas(
    canvas: HTMLCanvasElement,
    format: ExportFormat,
    quality: number,
): Promise<Uint8Array> {
    if (format === 'svg') {
        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">` +
            `<image href="${canvas.toDataURL('image/png')}" width="${canvas.width}" height="${canvas.height}"/>` +
            `</svg>`;
        return new TextEncoder().encode(svgStr);
    }
    const mimeMap: Record<ExportFormat, string> = {
        png:  'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        svg:  'image/png', // unreachable
    };
    return new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) { reject(new Error('toBlob failed')); return; }
            blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab))).catch(reject);
        }, mimeMap[format], format === 'png' ? undefined : quality);
    });
}

// ─── Main Component ──────────────────────────────────────────────────────────

const PsdEditor = () => {
    const {
        psd, setPsd, psdRef, commitPsd, pushSnapshot, handleUndo, handleRedo,
        normalizeRadioGroups, toggleRadioLayer, resetHistory,
    } = usePsdHistory(null);

    const { loadPsd } = usePsdWorker();
    const { settings, updateSettings } = useSettings();
    const [showSettings, setShowSettings] = useState(false);
    const { recentFiles, addRecentFile, clearRecentFiles } = useRecentFiles(settings.maxRecentFiles ?? 10);

    // ── タブ管理 ──
    const tabManager = useTabManager();
    const { tabs, activeId, activeTab } = tabManager;

    const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
    const { favorites, saveFavorite, deleteFavorite, updateFavoriteName, moveFavoriteTo } = useLayerFavorites(currentFilePath);
    const [favoriteDialog, setFavoriteDialog] = useState<{ mode: 'create' | 'rename'; id?: string; value: string } | null>(null);
    const favoriteInputRef = useRef<HTMLInputElement>(null);
    const favoriteListRef  = useRef<HTMLUListElement>(null);
    const favoriteRectsRef = useRef<{ id: string; rect: DOMRect }[]>([]);
    const [favoriteDrop, setFavoriteDrop] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

    const [isLoading, setIsLoading]   = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const isResizingRef = useRef(false);
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [radioEnabled, setRadioEnabled]   = useState(true);
    const [lockedEnabled, setLockedEnabled] = useState(true);
    const [flipEnabled, setFlipEnabled]     = useState(true);
    const [notification, setNotification]   = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [closedKeys, setClosedKeys] = useState<Set<string>>(new Set());
    const [draggingPath, setDraggingPath] = useState<number[] | null>(null);
    const [dropTarget, setDropTarget]     = useState<any | null>(null);
    const [searchQuery, setSearchQuery]   = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    const canvasRef          = useRef<HTMLCanvasElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const layerScrollRef     = useRef<HTMLDivElement>(null);
    const scrollRef          = useRef<HTMLDivElement>(null);
    const dragStateRef       = useRef<{ path: number[]; startY: number; moved: boolean } | null>(null);
    const favoriteDragStateRef = useRef<{ id: string; startY: number; moved: boolean } | null>(null);
    const drawDirtyRef = useRef(false);
    const drawRafRef   = useRef<number | null>(null);

    const { zoom, handleZoom, setZoomTo, resetZoom, centerPsd, SCROLL_AREA } =
        useZoomPan(psdRef, scrollRef, canvasContainerRef, settings.scrollAction ?? 'pan');

    // ── ファイルを開く共通ロジック ──────────────────────────────────────────

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
        const next = !isFullscreen;
        await appWindow.setFullscreen(next);
        setIsFullscreen(next);
    }, [appWindow, isFullscreen]);

    const [zoomInputActive, setZoomInputActive] = useState(false);
    const [zoomInputValue, setZoomInputValue]   = useState('');
    const zoomInputRef = useRef<HTMLInputElement>(null);

    const handleZoomInputFocus = useCallback(() => {
        setZoomInputValue(String(Math.round(zoom * 100)));
        setZoomInputActive(true);
        setTimeout(() => zoomInputRef.current?.select(), 0);
    }, [zoom]);

    const handleZoomInputCommit = useCallback(() => {
        setZoomInputActive(false);
        const parsed = parseInt(zoomInputValue, 10);
        if (!isNaN(parsed) && parsed > 0) setZoomTo(Math.min(500, Math.max(10, parsed)) / 100);
    }, [zoomInputValue, setZoomTo]);

    const handleToggleExpand = useCallback((key: string) => {
        setClosedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
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

    const handleExpandAll   = useCallback(() => setClosedKeys(new Set()), []);
    const handleCollapseAll = useCallback(() => {
        if (!psd?.children) return;
        setClosedKeys(new Set(collectGroupKeys(psd.children)));
    }, [psd, collectGroupKeys]);

    const searchResults = useMemo(() => {
        const q = searchQuery.trim();
        if (!q || !psd?.children) return null;
        return collectSearchResults(psd.children, q);
    }, [searchQuery, psd]);

    const lang = settings.language;
    const L = useMemo(() => ({
        open: lang === 'ja' ? '開く' : 'Open',
        png: 'PNG',
        savePsd: lang === 'ja' ? '保存' : 'Save PSD',
        workspace: 'Studio',
        layers: 'Layers',
        addLayer: lang === 'ja' ? 'レイヤー追加' : 'Add layer',
        addGroup: lang === 'ja' ? 'グループ追加' : 'Add group',
        expandAll: lang === 'ja' ? '全展開' : 'Expand all',
        collapseAll: lang === 'ja' ? '全折りたたみ' : 'Collapse all',
        searchPlaceholder: lang === 'ja' ? 'レイヤーを検索' : 'Search layers...',
        radio: 'Radio', fixed: 'Fixed', flip: 'Flip',
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
        exportSuccess: lang === 'ja' ? 'エクスポートが完了しました' : 'Exported successfully!',
        exportFailed: lang === 'ja' ? 'エクスポートに失敗しました' : 'Failed to export',
        // タブ
        newTab: lang === 'ja' ? '新しいタブ' : 'New tab',
        closeTab: lang === 'ja' ? 'タブを閉じる' : 'Close tab',
    }), [lang]);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') =>
        setNotification({ message, type }), []);

    // ── タブ切り替え時の状態保存 / 復元 ────────────────────────────────────

    const prevActiveIdRef = useRef<string>(activeId);

    useEffect(() => {
        const prevId = prevActiveIdRef.current;
        if (prevId === activeId) return;
        prevActiveIdRef.current = activeId;

        // 旧タブ: 現在の状態を保存
        tabManager.saveActiveUiState({
            zoom,
            flipX,
            flipY,
            closedKeys: Array.from(closedKeys),
            scrollLeft: scrollRef.current?.scrollLeft ?? 0,
            scrollTop:  scrollRef.current?.scrollTop ?? 0,
        });

        // 新タブ: 状態を復元
        const nextTab = tabs.find(t => t.id === activeId);
        if (!nextTab) return;

        resetHistory(nextTab.psd);
        setCurrentFilePath(nextTab.filePath);
        setFlipX(nextTab.flipX);
        setFlipY(nextTab.flipY);
        setClosedKeys(new Set(nextTab.closedKeys));
        isFirstLoadRef.current = true; // 新タブは中央に配置

        // ズーム・スクロール復元は次のフレームで
        requestAnimationFrame(() => {
            setZoomTo(nextTab.zoom);
            if (scrollRef.current) {
                scrollRef.current.scrollLeft = nextTab.scrollLeft;
                scrollRef.current.scrollTop  = nextTab.scrollTop;
            }
        });
    }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── PSD 読み込み ───────────────────────────────────────────────────────

    const loadPsdFromFilePath = useCallback(async (filePath: string, tabId?: string) => {
        // 既に同じファイルが開かれているタブがあればそちらをアクティブ
        if (tabManager.activateExistingTab(filePath)) return;

        // tabId が指定されていれば既存タブに上書き、なければ新規タブ
        const targetId = tabId ?? tabManager.openNewTab({ filePath, fileName: filePath.replace(/\\/g, '/').split('/').pop() ?? filePath, isLoading: true });
        tabManager.updateTab(targetId, { isLoading: true });

        setIsLoading(true);
        isFirstLoadRef.current = true;

        try {
            const data = await readFile(filePath);
            const result = await loadPsd(data.buffer);
            const nextPsd = result.layers.length > 0 ? attachThumbs(result.psd, result.layers) : result.psd;

            // アクティブタブが対象タブなら直接 resetHistory
            if (tabManager.activeId === targetId) {
                resetHistory(nextPsd);
            }

            tabManager.updateTab(targetId, {
                psd: nextPsd,
                filePath,
                fileName: filePath.replace(/\\/g, '/').split('/').pop() ?? filePath,
                isLoading: false,
                isDirty: false,
            });
            addRecentFile(filePath);
            if (tabManager.activeId === targetId) {
                setCurrentFilePath(filePath);
            }
        } catch (err) {
            showToast(`${L.loadFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
            tabManager.updateTab(targetId, { isLoading: false });
        }
        setIsLoading(false);
    }, [loadPsd, resetHistory, addRecentFile, showToast, L, tabManager]);

    // ── タブ新規作成 ────────────────────────────────────────────────────────

    const handleNewTab = useCallback(() => {
        tabManager.openNewTab();
        resetHistory(null);
        setCurrentFilePath(null);
        setFlipX(false); setFlipY(false);
        setClosedKeys(new Set());
    }, [tabManager, resetHistory]);

    // ── タブ閉じる ──────────────────────────────────────────────────────────

    const handleCloseTab = useCallback((id: string) => {
        tabManager.closeTab(id);
    }, [tabManager]);

    // ── タブ アクティブ切り替え ─────────────────────────────────────────────

    const handleActivateTab = useCallback((id: string) => {
        tabManager.setActiveId(id);
    }, [tabManager]);

    // ── 起動引数・イベント受信 ─────────────────────────────────────────────

    useEffect(() => {
        const checkArgs = async () => {
            try {
                const args: string[] = await invoke('get_launch_args');
                const psdFile = args.slice(1).find(x => x.toLowerCase().endsWith('.psd'));
                if (psdFile) loadPsdFromFilePath(psdFile, activeId);
            } catch (e) { console.error('Failed to get launch args', e); }
        };
        checkArgs();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
                setIsDragging(false);
                const paths = event.payload.paths;
                if (paths?.length > 0 && paths[0].toLowerCase().endsWith('.psd'))
                    loadPsdFromFilePath(paths[0]);
            }),
            listen('tauri://drag-leave', () => setIsDragging(false)),
        ]);
        return () => { unlistenPromises.then(us => us.forEach(u => u())); };
    }, [loadPsdFromFilePath]);

    const handleOpenFile = useCallback(async () => {
        try {
            const selected = await open({ multiple: false, filters: [{ name: 'PSD Image', extensions: ['psd'] }] });
            if (selected && typeof selected === 'string') {
                // 現在のタブが空なら上書き、そうでなければ新規タブ
                const useCurrentTab = !psd && !isLoading;
                loadPsdFromFilePath(selected, useCurrentTab ? activeId : undefined);
            }
        } catch (err) { showToast(`${L.openFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    }, [loadPsdFromFilePath, showToast, L, psd, isLoading, activeId]);

    // ── キーボードショートカット ────────────────────────────────────────────

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
            if ((e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) ||
                (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); handleRedo(); return; }
            if (e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey)) {
                if (window.getSelection()?.toString().length) return;
                e.preventDefault(); handleCopyCanvas();
            }
            if (e.key === 'F11') { e.preventDefault(); handleToggleFullscreen(); return; }
            if (e.key.toLowerCase() === 'o' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleOpenFile(); return; }
            if (e.key === ',' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setShowSettings(true); return; }
            // Zoom
            if ((e.key === '+' || e.key === ';' || e.key === '=') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleZoom(0.1); return; }
            if (e.key === '-' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleZoom(-0.1); return; }
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); centerPsd(); return; }
            // タブ切り替え Ctrl+Tab / Ctrl+Shift+Tab
            if (e.key === 'Tab' && e.ctrlKey) {
                e.preventDefault();
                const idx = tabs.findIndex(t => t.id === activeId);
                const next = e.shiftKey
                    ? (idx - 1 + tabs.length) % tabs.length
                    : (idx + 1) % tabs.length;
                handleActivateTab(tabs[next].id);
            }
            // Ctrl+W でタブを閉じる
            if (e.key.toLowerCase() === 'w' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault(); handleCloseTab(activeId);
            }
            // Ctrl+T で新しいタブ
            if (e.key.toLowerCase() === 't' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault(); handleNewTab();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleUndo, handleRedo, handleOpenFile, handleToggleFullscreen, handleZoom, centerPsd,
        tabs, activeId, handleActivateTab, handleCloseTab, handleNewTab]);

    // ── サイドバーリサイズ ──────────────────────────────────────────────────

    const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        const onMouseMove = (ev: MouseEvent) => {
            if (!isResizingRef.current) return;
            setSidebarWidth(Math.max(200, Math.min(600, ev.clientX)));
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

    // ── 保存 ────────────────────────────────────────────────────────────────

    const handleSaveFile = async () => {
        if (!psd) return;
        try {
            const selected = await save({
                title: lang === 'ja' ? 'PSDファイルを保存' : 'Save PSD File',
                filters: [{ name: 'PSD Image', extensions: ['psd'] }],
            });
            if (selected) {
                await writeFile(selected, new Uint8Array(writePsd(psd) as ArrayBuffer));
                tabManager.updateTab(activeId, { isDirty: false, filePath: selected, fileName: selected.replace(/\\/g, '/').split('/').pop() ?? selected });
                showToast(L.saveSuccess);
            }
        } catch (err) { showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    };

    // ── 書き出し（マルチフォーマット対応） ─────────────────────────────────

    const handleExportPng = async () => {
        if (!canvasRef.current || !psd) return;
        const fmt = (settings.exportFormat ?? 'png') as ExportFormat;
        const quality = settings.exportQuality ?? 0.92;

        const extMap: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', svg: 'svg' };
        const nameMap: Record<ExportFormat, string> = { png: 'PNG Image', jpeg: 'JPEG Image', webp: 'WebP Image', svg: 'SVG File' };

        try {
            const selected = await save({
                title: `Export as ${fmt.toUpperCase()}`,
                filters: [{ name: nameMap[fmt], extensions: [extMap[fmt]] }],
            });
            if (selected) {
                const bytes = await exportCanvas(canvasRef.current, fmt, quality);
                await writeFile(selected, bytes);
                showToast(L.exportSuccess);
            }
        } catch (err) { showToast(`${L.exportFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    };

    // ── クリップボードコピー ────────────────────────────────────────────────

    const handleCopyCanvas = useCallback(async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        try {
            await new Promise<void>((resolve, reject) => {
                canvas.toBlob(async blob => {
                    if (!blob) { reject(new Error('toBlob failed')); return; }
                    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); resolve(); }
                    catch (e) { reject(e); }
                }, 'image/png');
            });
            showToast(L.copied);
        } catch (err) { showToast(`${L.copyFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    }, [showToast, L]);

    // ── レイヤー操作 ────────────────────────────────────────────────────────

    const toggleLayerVisibility = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        commitPsd(updateLayerByPath(psdRef.current, path, l => ({ ...l, hidden: !l.hidden })));
        tabManager.markDirty();
    }, [commitPsd, psdRef, tabManager]);

    const renameSessionRef = useRef(false);
    const renameTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
    const renameLayer = useCallback((path: number[], newName: string) => {
        if (!psdRef.current) return;
        const updated = updateLayerByPath(psdRef.current, path, l => ({ ...l, name: newName }));
        if (!renameSessionRef.current) { renameSessionRef.current = true; pushSnapshot(psdRef.current); }
        setPsd(updated);
        tabManager.markDirty();
        if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
        renameTimerRef.current = setTimeout(() => { renameTimerRef.current = null; renameSessionRef.current = false; }, 600);
    }, [psdRef, setPsd, pushSnapshot, tabManager]);

    const handleAddLayer = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Layer', hidden: false }, ...(cur.children || [])] });
        tabManager.markDirty();
    }, [commitPsd, psdRef, tabManager]);

    const handleAddGroup = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Group', hidden: false, children: [] }, ...(cur.children || [])] });
        tabManager.markDirty();
    }, [commitPsd, psdRef, tabManager]);

    const handleDeleteLayer = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        const deleteAt = (p: any, pathArgs: number[]): any => {
            const newPsd = { ...p, children: [...(p.children || [])] };
            let arr = newPsd.children;
            const pathCopy = [...pathArgs];
            const lastIdx = pathCopy.pop()!;
            for (const idx of pathCopy) { arr[idx] = { ...arr[idx], children: [...(arr[idx].children || [])] }; arr = arr[idx].children!; }
            arr.splice(lastIdx, 1);
            return newPsd;
        };
        commitPsd(deleteAt(psdRef.current, path));
        tabManager.markDirty();
    }, [commitPsd, psdRef, tabManager]);

    // ── ドラッグ&ドロップ (レイヤー並び替え) ─────────────────────────────────

    const itemRectsRef  = useRef<{ rect: DOMRect; path: number[]; isGroup: boolean }[]>([]);
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
            const zone = rect.height * 0.25;
            let position: any, dist: number;
            if (clientY < rect.top + zone)           { position = 'before'; dist = Math.abs(clientY - rect.top); }
            else if (clientY > rect.bottom - zone)   { position = 'after';  dist = Math.abs(clientY - rect.bottom); }
            else if (isGroup)                        { position = 'inside'; dist = Math.abs(clientY - (rect.top + rect.height / 2)); }
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
            if (!dragStateRef.current) return;
            const target = findDropTargetFromCache(ev.clientY);
            if (target) {
                const dragKey   = dragStateRef.current.path.join('-');
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
            const state = dragStateRef.current; dragStateRef.current = null;
            setDraggingPath(null); setDropTarget(null);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (!state?.moved) return;
            const target = findDropTargetFromCache(ev.clientY);
            if (!target) return;
            const dragKey   = state.path.join('-');
            const targetKey = target.path.join('-');
            if (targetKey === dragKey || targetKey.startsWith(dragKey + '-')) return;
            const nextPsd = moveLayer(psdRef.current, state.path, target.path, target.position);
            if (nextPsd) { commitPsd(nextPsd); tabManager.markDirty(); }
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [cacheItemRects, findDropTargetFromCache, psdRef, commitPsd, tabManager]);

    // ── フリップ関連 ────────────────────────────────────────────────────────

    const getFlipSuffix  = useCallback(() => {
        if (flipX && flipY) return ':flipxy'; if (flipX) return ':flipx'; if (flipY) return ':flipy'; return '';
    }, [flipX, flipY]);
    const hasFlipSuffix  = useCallback((name: string) => /(:[Ff]lip(xy|x|y))$/i.test(name), []);
    const getBaseName    = useCallback((name: string) => name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);

    // ── Canvas 描画 ─────────────────────────────────────────────────────────

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const currentPsd = psdRef.current;
        if (!canvas || !currentPsd) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        canvas.width = currentPsd.width; canvas.height = currentPsd.height;
        ctx.clearRect(0, 0, currentPsd.width, currentPsd.height);
        const flipSuffix = flipEnabled ? getFlipSuffix() : '';
        ctx.save();
        if (flipX && flipY) { ctx.translate(currentPsd.width, currentPsd.height); ctx.scale(-1, -1); }
        else if (flipX)     { ctx.translate(currentPsd.width, 0);                  ctx.scale(-1, 1); }
        else if (flipY)     { ctx.translate(0, currentPsd.height);                 ctx.scale(1, -1); }
        const drawLayers = (layers: any[]) => {
            const flipMap = new Map();
            if (flipEnabled && flipSuffix) {
                for (const l of layers) if ((l.name || '').toLowerCase().endsWith(flipSuffix.toLowerCase()))
                    flipMap.set(getBaseName(l.name || '').toLowerCase(), l);
            }
            for (const layer of layers) {
                if (layer.hidden) continue;
                const name = layer.name || '';
                if (flipEnabled && hasFlipSuffix(name) && getFlipSuffix() && name.toLowerCase().endsWith(getFlipSuffix().toLowerCase())) continue;
                const effectiveLayer = flipMap.get(name.toLowerCase()) ?? layer;
                if (effectiveLayer.children) drawLayers(effectiveLayer.children);
                else if (effectiveLayer._bitmap) ctx.drawImage(effectiveLayer._bitmap, effectiveLayer.left || 0, effectiveLayer.top || 0);
                else if (effectiveLayer.canvas)  ctx.drawImage(effectiveLayer.canvas,  effectiveLayer.left || 0, effectiveLayer.top || 0);
            }
        };
        if (currentPsd.children) drawLayers(currentPsd.children);
        else if ((currentPsd as any)._bitmap) ctx.drawImage((currentPsd as any)._bitmap, 0, 0);
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

    // ── お気に入り ──────────────────────────────────────────────────────────

    const handleApplyFavorite = useCallback((fav: LayerFavorite) => {
        if (!psdRef.current) return;
        const current = psdRef.current;
        const nextChildren = current.children ? applyLayerState(current.children, fav.state) : current.children;
        commitPsd({ ...current, children: nextChildren });
        setClosedKeys(new Set(fav.closedKeys ?? []));
        if (fav.zoom)                           setZoomTo(fav.zoom);
        if (typeof fav.flipX === 'boolean')     setFlipX(fav.flipX);
        if (typeof fav.flipY === 'boolean')     setFlipY(fav.flipY);
        if (typeof fav.radioEnabled === 'boolean')  setRadioEnabled(fav.radioEnabled);
        if (typeof fav.lockedEnabled === 'boolean') setLockedEnabled(fav.lockedEnabled);
        if (typeof fav.flipEnabled === 'boolean')   setFlipEnabled(fav.flipEnabled);
        showToast(L.applied);
    }, [commitPsd, psdRef, showToast, L, setZoomTo]);

    const openCreateFavorite = useCallback(() => {
        if (!psdRef.current?.children) return;
        setFavoriteDialog({ mode: 'create', value: `${L.favorites} ${favorites.length + 1}` });
    }, [favorites.length, L, psdRef]);

    const confirmFavoriteDialog = useCallback(() => {
        if (!favoriteDialog) return;
        const name = favoriteDialog.value.trim(); if (!name) return;
        if (favoriteDialog.mode === 'create') {
            if (!psdRef.current?.children) return;
            saveFavorite(name, captureLayerState(psdRef.current.children), Array.from(closedKeys), {
                zoom, flipX, flipY, radioEnabled, lockedEnabled, flipEnabled,
            });
            showToast(L.saved);
        } else if (favoriteDialog.mode === 'rename' && favoriteDialog.id) {
            updateFavoriteName(favoriteDialog.id, name);
        }
        setFavoriteDialog(null);
    }, [favoriteDialog, psdRef, saveFavorite, closedKeys, zoom, flipX, flipY, radioEnabled, lockedEnabled, flipEnabled, showToast, L, updateFavoriteName]);

    const cacheFavoriteRects  = useCallback(() => {
        const root = favoriteListRef.current; if (!root) return;
        const items = Array.from(root.querySelectorAll<HTMLElement>('[data-favorite-id]'));
        favoriteRectsRef.current = items.map(el => ({ id: el.getAttribute('data-favorite-id') || '', rect: el.getBoundingClientRect() })).filter(x => x.id);
    }, []);

    const findFavoriteDropTarget = useCallback((clientY: number) => {
        const items = favoriteRectsRef.current; if (!items.length) return null;
        let best: any = null;
        for (const { id, rect } of items) {
            const mid = rect.top + rect.height / 2;
            const position = clientY < mid ? 'before' : 'after';
            const dist = Math.abs(clientY - mid);
            if (!best || dist < best.dist) best = { id, position, dist };
        }
        return best ? { id: best.id, position: best.position } : null;
    }, []);

    const handleFavoriteDragStart = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault(); e.stopPropagation();
        favoriteDragStateRef.current = { id, startY: e.clientY, moved: false };
        cacheFavoriteRects();
        const onMouseMove = (ev: MouseEvent) => {
            if (!favoriteDragStateRef.current) return;
            if (Math.abs(ev.clientY - favoriteDragStateRef.current.startY) > 3) favoriteDragStateRef.current.moved = true;
            const target = findFavoriteDropTarget(ev.clientY);
            setFavoriteDrop(target?.id !== favoriteDragStateRef.current.id ? target : null);
        };
        const onMouseUp = (ev: MouseEvent) => {
            const state = favoriteDragStateRef.current; favoriteDragStateRef.current = null;
            const target = findFavoriteDropTarget(ev.clientY);
            setFavoriteDrop(null);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (!state?.moved || !target || target.id === state.id) return;
            const from = favorites.findIndex(f => f.id === state.id);
            let to = favorites.findIndex(f => f.id === target.id);
            if (from === -1 || to === -1) return;
            if (target.position === 'after') to++;
            if (from < to) to--;
            moveFavoriteTo(state.id, to);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [cacheFavoriteRects, findFavoriteDropTarget, favorites, moveFavoriteTo]);

    // ── テーマ即時プレビュー ────────────────────────────────────────────────

    const handlePreviewTheme = useCallback((theme: AppSettings['theme']) => {
        updateSettings({ theme });
    }, [updateSettings]);

    // ── Render ──────────────────────────────────────────────────────────────

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

            {/* ── タブバー ── */}
            <TabBar
                tabs={tabs}
                activeId={activeId}
                onActivate={handleActivateTab}
                onClose={handleCloseTab}
                onNewTab={handleNewTab}
                onReorder={tabManager.reorderTabs}
                language={settings.language}
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
                    handleApplyFavorite={handleApplyFavorite}
                    openRenameFavorite={f => setFavoriteDialog({ mode: 'rename', id: f.id, value: f.name })}
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

            {showSettings && (
                <SettingsModal
                    settings={settings}
                    onUpdate={updateSettings}
                    onClose={() => setShowSettings(false)}
                    onPreview={handlePreviewTheme}
                />
            )}

            {notification && (
                <Toast message={notification.message} type={notification.type} onClose={handleCloseNotification} />
            )}

            {favoriteDialog && (
                <FavoriteModal
                    favoriteDialog={favoriteDialog}
                    closeFavoriteDialog={() => setFavoriteDialog(null)}
                    confirmFavoriteDialog={confirmFavoriteDialog}
                    favoriteInputRef={favoriteInputRef}
                    setFavoriteDialog={setFavoriteDialog}
                    L={L}
                />
            )}
        </div>
    );
};

export default PsdEditor;