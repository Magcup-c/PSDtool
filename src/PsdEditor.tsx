import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readPsd, writePsd, Psd } from 'ag-psd';
import {
    FolderOpen,
    Save,
    Layers,
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    Image as ImageIcon,
    Folder as FolderIcon,
    Monitor,
    ZoomIn,
    ZoomOut,
    Maximize,
    X,
    Minus,
    Square,
    CheckCircle2,
    AlertCircle,
    Download,
    FlipHorizontal2,
    FlipVertical2,
    Asterisk,
    Pin,
    Replace,
    ChevronsDownUp,
    ChevronsUpDown,
    Plus,
    FolderPlus,
    Trash2,
    GripVertical,
    Search,
} from 'lucide-react';
import './PsdEditor.css';

// ─────────────────────────────────────────────────
// ユーティリティ: 親パスから子レイヤー配列を取得
// ─────────────────────────────────────────────────
function getLayersAtPath(children: any[], parentPath: number[]): any[] {
    let current = children;
    for (const idx of parentPath) {
        current = current[idx].children;
    }
    return current;
}

// ─────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────
interface ToastProps {
    message: string;
    type: 'success' | 'error';
    onClose: () => void;
}

const Toast = ({ message, type, onClose }: ToastProps) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);
    return (
        <div className={`toast-notification ${type}`}>
            {type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{message}</span>
            <button onClick={onClose} className="toast-close"><X size={14} /></button>
        </div>
    );
};

// ─────────────────────────────────────────────────
// DropTarget 型
// ─────────────────────────────────────────────────
interface DropTargetInfo {
    path: number[];
    position: 'before' | 'after' | 'inside';
}

// ─────────────────────────────────────────────────
// 検索: ツリーを再帰的に走査してマッチ結果を収集
// ─────────────────────────────────────────────────
interface SearchResult {
    layer: any;
    path: number[];
    // 表示名（プレフィックス除去済み）
    displayName: string;
    // マッチ箇所の開始・終了インデックス
    matchStart: number;
    matchEnd: number;
}

function collectSearchResults(
    layers: any[],
    query: string,
    parentPath: number[] = [],
): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    layers.forEach((layer, idx) => {
        const rawName = layer.name || '';
        // *・! プレフィックスを除いた表示名で検索
        const displayName = rawName.startsWith('*') || rawName.startsWith('!')
            ? rawName.slice(1)
            : rawName;
        const lowerDisplay = displayName.toLowerCase();
        const matchStart = lowerDisplay.indexOf(lowerQuery);

        if (matchStart !== -1) {
            results.push({
                layer,
                path: [...parentPath, idx],
                displayName,
                matchStart,
                matchEnd: matchStart + lowerQuery.length,
            });
        }

        // グループは再帰的に検索
        if (layer.children?.length) {
            results.push(...collectSearchResults(layer.children, query, [...parentPath, idx]));
        }
    });

    return results;
}

// ─────────────────────────────────────────────────
// 検索結果の1行
// ─────────────────────────────────────────────────
interface SearchResultRowProps {
    result: SearchResult;
    onToggle: (path: number[]) => void;
}

const SearchResultRow = memo(({ result, onToggle }: SearchResultRowProps) => {
    const { layer, path, displayName, matchStart, matchEnd } = result;
    const hasChildren = !!(layer.children?.length);
    const depth = path.length - 1;

    // マッチ箇所を <mark> でハイライト
    const highlighted = (
        <span>
            {displayName.slice(0, matchStart)}
            <mark className="search-highlight">{displayName.slice(matchStart, matchEnd)}</mark>
            {displayName.slice(matchEnd)}
        </span>
    );

    return (
        <div
            className="layer-item search-result-row"
            style={{ paddingLeft: 8 + depth * 12 }}
        >
            {/* 深さのヒント */}
            {depth > 0 && (
                <span className="search-depth-hint" title={`depth ${depth}`}>
                    {'›'.repeat(depth)}
                </span>
            )}

            {/* 表示/非表示トグル */}
            <div
                className="visibility-toggle"
                onClick={() => onToggle(path)}
                title="Toggle visibility"
            >
                {!layer.hidden
                    ? <Eye size={16} className="text-accent" />
                    : <EyeOff size={16} className="text-muted" />
                }
            </div>

            {/* サムネイル */}
            <div className="layer-preview-thumbnail">
                {hasChildren
                    ? <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
                    : layer.canvas
                        ? <img src={(() => { try { return layer.canvas.toDataURL(); } catch { return ''; } })()} alt="" className="layer-thumbnail-img" />
                        : <ImageIcon size={16} className="text-muted" />
                }
            </div>

            {/* ハイライト付きレイヤー名 */}
            <span className="search-result-name">{highlighted}</span>
        </div>
    );
});

// ─────────────────────────────────────────────────
// LayerItem
// ─────────────────────────────────────────────────
interface LayerItemProps {
    layer: any;
    path: number[];
    siblings: any[];
    radioEnabled: boolean;
    lockedEnabled: boolean;
    isClosed: boolean;
    isChildClosed: (childKey: string) => boolean;
    onToggleExpand: (key: string) => void;
    onToggle: (path: number[]) => void;
    onRename: (path: number[], newName: string) => void;
    onRadioSelect: (path: number[], siblings: any[]) => void;
    onDelete: (path: number[]) => void;
    onDragStart: (e: React.MouseEvent, path: number[]) => void;
    draggingPath: number[] | null;
    dropTarget: DropTargetInfo | null;
}

const LayerThumbnail = memo(({ canvas, hasChildren }: { canvas?: HTMLCanvasElement; hasChildren: boolean }) => {
    const dataUrl = useMemo(() => {
        if (!canvas) return null;
        try { return canvas.toDataURL(); } catch { return null; }
    }, [canvas]);
    return (
        <div className="layer-preview-thumbnail">
            {dataUrl
                ? <img src={dataUrl} alt="" className="layer-thumbnail-img" />
                : hasChildren
                    ? <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
                    : <ImageIcon size={16} className="text-muted" />
            }
        </div>
    );
});

const LayerItem = memo(({
    layer, path, siblings, radioEnabled, lockedEnabled,
    isClosed, isChildClosed, onToggleExpand, onToggle, onRename, onRadioSelect,
    onDelete, onDragStart, draggingPath, dropTarget,
}: LayerItemProps) => {
    const key = path.join('-');
    const hasChildren = !!(layer.children?.length);
    const name = layer.name || '';
    const isRadio = radioEnabled && name.startsWith('*');
    const isLocked = lockedEnabled && name.startsWith('!');
    const displayName = (isRadio || isLocked) ? name.slice(1) : name;

    const isDraggingThis = draggingPath?.join('-') === key;
    const isDropBefore = dropTarget?.path.join('-') === key && dropTarget.position === 'before';
    const isDropAfter = dropTarget?.path.join('-') === key && dropTarget.position === 'after';
    const isDropInside = dropTarget?.path.join('-') === key && dropTarget.position === 'inside';

    const handleVisibilityClick = useCallback(() => {
        if (isLocked) return;
        if (isRadio) onRadioSelect(path, siblings); else onToggle(path);
    }, [isLocked, isRadio, onRadioSelect, onToggle, path, siblings]);

    const handleExpandClick = useCallback(() => onToggleExpand(key), [onToggleExpand, key]);

    const handleRename = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const prefix = isRadio ? '*' : isLocked ? '!' : '';
        onRename(path, prefix + e.target.value);
    }, [isRadio, isLocked, onRename, path]);

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(path);
    }, [onDelete, path]);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        // preventDefault でブラウザのフォーカス移動が抑制されるため、
        // 手動で現在フォーカス中の input を blur させる
        (document.activeElement as HTMLElement)?.blur();
        onDragStart(e, path);
    }, [onDragStart, path]);

    return (
        <li className="layer-node">
            {isDropBefore && <div className="drop-indicator" />}
            <div
                className={[
                    'layer-item',
                    isLocked ? 'layer-locked' : '',
                    isRadio ? 'layer-radio' : '',
                    isDraggingThis ? 'layer-dragging' : '',
                    isDropInside ? 'layer-drop-inside' : '',
                ].filter(Boolean).join(' ')}
                data-path={key}
                data-group={hasChildren ? 'true' : 'false'}
                onMouseDown={(e) => {
                    // input 以外の場所をクリックしたときフォーカスを外す
                    if ((e.target as HTMLElement).tagName !== 'INPUT') {
                        (document.activeElement as HTMLElement)?.blur();
                    }
                }}
            >
                {/* ドラッグハンドル */}
                <span className="drag-handle" onMouseDown={handleDragStart} title="Drag to reorder">
                    <GripVertical size={12} />
                </span>

                {hasChildren
                    ? <button className="toggle-expand" onClick={handleExpandClick}>{!isClosed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    : <span className="spacer" />
                }

                {!isLocked ? (
                    <div className="visibility-toggle" onClick={handleVisibilityClick} title={isRadio ? 'Select (radio)' : 'Toggle visibility'}>
                        {isRadio
                            ? <div className={`radio-indicator ${!layer.hidden ? 'active' : ''}`} />
                            : !layer.hidden ? <Eye size={16} className="text-accent" /> : <EyeOff size={16} className="text-muted" />
                        }
                    </div>
                ) : (
                    <span className="visibility-locked" title="Visibility locked">
                        <Eye size={16} className="text-accent" style={{ opacity: 0.4 }} />
                    </span>
                )}

                <LayerThumbnail canvas={layer.canvas} hasChildren={hasChildren} />

                <input
                    type="text"
                    className="layer-name-input"
                    value={displayName}
                    onChange={handleRename}
                    placeholder={hasChildren ? 'New Group' : 'New Layer'}
                />

                {/* 削除ボタン（ホバーで表示、CSS で制御） */}
                <button
                    className="layer-delete-btn"
                    onClick={handleDelete}
                    title="Delete layer"
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        (document.activeElement as HTMLElement)?.blur();
                    }}
                >
                    <Trash2 size={12} />
                </button>
            </div>
            {isDropAfter && <div className="drop-indicator" />}

            {hasChildren && !isClosed && (
                <ul className="sub-layers">
                    {[...(layer.children || [])].reverse().map((child: any, i: number) => {
                        const originalIndex = (layer.children.length - 1) - i;
                        const childPath = [...path, originalIndex];
                        const childKey = childPath.join('-');
                        return (
                            <LayerItem
                                key={childKey}
                                layer={child}
                                path={childPath}
                                siblings={layer.children}
                                radioEnabled={radioEnabled}
                                lockedEnabled={lockedEnabled}
                                isClosed={isChildClosed(childKey)}
                                isChildClosed={isChildClosed}
                                onToggleExpand={onToggleExpand}
                                onToggle={onToggle}
                                onRename={onRename}
                                onRadioSelect={onRadioSelect}
                                onDelete={onDelete}
                                onDragStart={onDragStart}
                                draggingPath={draggingPath}
                                dropTarget={dropTarget}
                            />
                        );
                    })}
                </ul>
            )}
        </li>
    );
});

// ─────────────────────────────────────────────────
// PsdEditor
// ─────────────────────────────────────────────────
const PsdEditor = () => {
    const [psd, setPsd] = useState<Psd | null>(null);
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

    // ドラッグ関連 state
    const [draggingPath, setDraggingPath] = useState<number[] | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTargetInfo | null>(null);

    // 検索
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewRef = useRef<HTMLElement>(null);
    const layerScrollRef = useRef<HTMLDivElement>(null);
    const undoStack = useRef<Psd[]>([]);
    const redoStack = useRef<Psd[]>([]);
    const psdRef = useRef<Psd | null>(null);
    // ドラッグ中の状態を ref で管理（mousemove クロージャから参照するため）
    const dragStateRef = useRef<{ path: number[]; startY: number; moved: boolean } | null>(null);

    const appWindow = getCurrentWindow();
    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = () => appWindow.toggleMaximize();
    const handleClose = () => appWindow.close();

    const handleCloseNotification = useCallback(() => setNotification(null), []);

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

    const handleExpandAll = useCallback(() => setClosedKeys(new Set()), []);
    const handleCollapseAll = useCallback(() => {
        if (!psd?.children) return;
        setClosedKeys(new Set(collectGroupKeys(psd.children)));
    }, [psd, collectGroupKeys]);

    const isChildClosed = useCallback((childKey: string) => closedKeys.has(childKey), [closedKeys]);

    // 検索結果（クエリが空なら null = 通常ツリー表示）
    const searchResults = useMemo(() => {
        const q = searchQuery.trim();
        if (!q || !psd?.children) return null;
        return collectSearchResults(psd.children, q);
    }, [searchQuery, psd]);

    const showToast = (message: string, type: 'success' | 'error' = 'success') =>
        setNotification({ message, type });

    useEffect(() => { psdRef.current = psd; }, [psd]);

    const MAX_UNDO = 50;

    const commitPsd = useCallback((next: Psd) => {
        const current = psdRef.current;
        if (!current) return;
        undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), current];
        redoStack.current = [];
        setPsd(next);
    }, []);

    const handleUndo = useCallback(() => {
        if (!undoStack.current.length) return;
        const current = psdRef.current;
        if (current) redoStack.current = [...redoStack.current, current];
        setPsd(undoStack.current.pop()!);
    }, []);

    const handleRedo = useCallback(() => {
        if (!redoStack.current.length) return;
        const current = psdRef.current;
        if (current) undoStack.current = [...undoStack.current, current];
        setPsd(redoStack.current.pop()!);
    }, []);

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

    const normalizeRadioGroups = useCallback((layers: any[]): any[] => {
        const processed = layers.map((layer) =>
            layer.children?.length > 0
                ? { ...layer, children: normalizeRadioGroups(layer.children) }
                : layer
        );
        const radioIndices = processed.map((l, i) => ({ l, i }))
            .filter(({ l }) => (l.name || '').startsWith('*')).map(({ i }) => i);
        if (radioIndices.length < 2) return processed;
        const visibleIdx = radioIndices.find((i) => !processed[i].hidden) ?? radioIndices[0];
        const normalized = [...processed];
        radioIndices.forEach((i) => { normalized[i] = { ...normalized[i], hidden: i !== visibleIdx }; });
        return normalized;
    }, []);

    const loadPsdFromFilePath = useCallback(async (path: string) => {
        setIsLoading(true);
        try {
            const data = await readFile(path);
            const parsedPsd = readPsd(data, { skipLayerImageData: false, skipCompositeImageData: false });
            if (parsedPsd.children) parsedPsd.children = normalizeRadioGroups(parsedPsd.children);
            setPsd(parsedPsd);
            setZoom(1);
            centerOnLoadRef.current = true;
        } catch (err) {
            showToast(`Failed to load PSD: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
        setIsLoading(false);
    }, [normalizeRadioGroups]);

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

    // ズーム値のみ state で管理。パン位置はスクロールコンテナの scrollLeft/scrollTop で管理。
    const [zoom, setZoom] = useState(1);
    const centerOnLoadRef = useRef(false);
    const prevPsdSizeRef = useRef<{ w: number; h: number } | null>(null);

    // キャンバス周囲の余白 (px)。この余白があることでキャンバス外側にもスクロールできる。
    const SCROLL_PADDING = 200;

    // ロード時・PSDサイズ変更時にセンタリングフラグを立てる
    useEffect(() => {
        if (!psd) return;
        const size = { w: psd.width, h: psd.height };
        if (!prevPsdSizeRef.current || prevPsdSizeRef.current.w !== size.w || prevPsdSizeRef.current.h !== size.h) {
            prevPsdSizeRef.current = size;
            centerOnLoadRef.current = true;
        }
    }, [psd]);

    // センタリング: スクロール位置をキャンバス中央に合わせる
    useEffect(() => {
        if (!centerOnLoadRef.current || !psd) return;
        centerOnLoadRef.current = false;
        const preview = previewRef.current;
        if (!preview) return;
        requestAnimationFrame(() => {
            const scaledW = psd.width * zoom;
            const scaledH = psd.height * zoom;
            const totalW = scaledW + SCROLL_PADDING * 2;
            const totalH = scaledH + SCROLL_PADDING * 2;
            preview.scrollLeft = (totalW - preview.clientWidth) / 2;
            preview.scrollTop = (totalH - preview.clientHeight) / 2;
        });
    }, [psd, zoom]);

    // ドラッグパン: mousemove で scrollLeft/scrollTop を更新
    useEffect(() => {
        const preview = previewRef.current;
        if (!preview) return;
        let dragging = false, lastX = 0, lastY = 0;
        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 && e.button !== 1) return;
            dragging = true; lastX = e.clientX; lastY = e.clientY;
            preview.style.cursor = 'grabbing'; e.preventDefault();
        };
        const onMouseMove = (e: MouseEvent) => {
            if (!dragging) return;
            preview.scrollLeft -= e.clientX - lastX;
            preview.scrollTop -= e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
        };
        const onMouseUp = () => { dragging = false; preview.style.cursor = ''; };
        preview.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            preview.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    // Ctrl+ホイールでズーム。カーソル下のキャンバス座標を固定点にスクロール補正。
    useEffect(() => {
        const preview = previewRef.current;
        if (!preview) return;
        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            if (!psd) return;
            const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            const factor = 1 - raw * 0.002;
            const rect = preview.getBoundingClientRect();
            // カーソルのビューポート内座標
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            setZoom(prev => {
                const next = Math.min(5, Math.max(0.1, Math.round(prev * factor * 100) / 100));
                if (next === prev) return prev;
                // カーソル下のコンテンツ座標（スクロール込み）
                const contentX = cx + preview.scrollLeft;
                const contentY = cy + preview.scrollTop;
                // ズーム前後でコンテンツ座標が同じ画面位置に来るようスクロールを補正
                const scale = next / prev;
                requestAnimationFrame(() => {
                    preview.scrollLeft = contentX * scale - cx;
                    preview.scrollTop = contentY * scale - cy;
                });
                return next;
            });
        };
        preview.addEventListener('wheel', handleWheel, { passive: false });
        return () => preview.removeEventListener('wheel', handleWheel);
    }, [psd]);

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
        } catch (err) {
            showToast(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    const handleSaveFile = async () => {
        if (!psd) return;
        try {
            const selected = await save({ title: 'Save PSD File', filters: [{ name: 'PSD Image', extensions: ['psd'] }] });
            if (selected) {
                await writeFile(selected, new Uint8Array(writePsd(psd) as ArrayBuffer));
                showToast('File saved successfully!');
            }
        } catch (err) {
            showToast(`Failed to save file: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
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
        } catch (err) {
            showToast(`Failed to export PNG: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    const handleZoom = (delta: number) => {
        const preview = previewRef.current;
        setZoom(prev => {
            const next = Math.max(0.1, Math.min(5, Math.round((prev + delta) * 100) / 100));
            if (!preview || !psd) return next;
            // プレビュー中央を固定点にスクロール補正
            const cx = preview.clientWidth / 2;
            const cy = preview.clientHeight / 2;
            const contentX = cx + preview.scrollLeft;
            const contentY = cy + preview.scrollTop;
            const scale = next / prev;
            requestAnimationFrame(() => {
                preview.scrollLeft = contentX * scale - cx;
                preview.scrollTop = contentY * scale - cy;
            });
            return next;
        });
    };

    const resetZoom = () => {
        const preview = previewRef.current;
        if (!preview || !psd) { setZoom(1); return; }
        setZoom(1);
        // zoom=1 でセンタリング
        requestAnimationFrame(() => {
            const totalW = psd.width + SCROLL_PADDING * 2;
            const totalH = psd.height + SCROLL_PADDING * 2;
            preview.scrollLeft = (totalW - preview.clientWidth) / 2;
            preview.scrollTop = (totalH - preview.clientHeight) / 2;
        });
    };

    // ─────────────────────────────────────────────────
    // ツリー操作ユーティリティ
    // ─────────────────────────────────────────────────
    const updateLayerByPath = (psd: Psd, path: number[], update: (layer: any) => any): Psd => {
        const newPsd = { ...psd };
        if (!newPsd.children) return newPsd;
        newPsd.children = [...newPsd.children];
        let current = newPsd.children;
        const pathCopy = [...path];
        const lastIdx = pathCopy.pop();
        if (lastIdx === undefined) return newPsd;
        for (const idx of pathCopy) {
            current[idx] = { ...current[idx], children: [...(current[idx].children || [])] };
            current = current[idx].children!;
        }
        current[lastIdx] = update(current[lastIdx]);
        return newPsd;
    };

    const toggleLayerVisibility = (path: number[]) => {
        if (!psd) return;
        commitPsd(updateLayerByPath(psd, path, (l) => ({ ...l, hidden: !l.hidden })));
    };

    const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const renameSessionRef = useRef(false);

    const renameLayer = useCallback((path: number[], newName: string) => {
        if (!psdRef.current) return;
        const updated = updateLayerByPath(psdRef.current, path, (l) => ({ ...l, name: newName }));
        if (!renameSessionRef.current) {
            renameSessionRef.current = true;
            commitPsd(updated);
        } else {
            if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
            setPsd(updated);
        }
        if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
        renameTimerRef.current = setTimeout(() => { renameTimerRef.current = null; renameSessionRef.current = false; }, 600);
    }, [commitPsd]);

    const toggleRadioLayer = (path: number[], siblings: any[]) => {
        if (!psd) return;
        const selectedIdx = path[path.length - 1];
        const parentPath = path.slice(0, -1);
        let currentPsd = psd;
        siblings.forEach((sibling: any, idx: number) => {
            if (!(sibling.name || '').startsWith('*')) return;
            const shouldHide = idx !== selectedIdx;
            if (sibling.hidden !== shouldHide)
                currentPsd = updateLayerByPath(currentPsd, [...parentPath, idx], (l) => ({ ...l, hidden: shouldHide }));
        });
        if (currentPsd !== psd) commitPsd(currentPsd);
    };

    // ─────────────────────────────────────────────────
    // レイヤー追加
    // ─────────────────────────────────────────────────
    const handleAddLayer = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Layer', hidden: false }, ...(cur.children || [])] });
    }, [commitPsd]);

    const handleAddGroup = useCallback(() => {
        if (!psdRef.current) return;
        const cur = psdRef.current;
        commitPsd({ ...cur, children: [{ name: 'New Group', hidden: false, children: [] }, ...(cur.children || [])] });
    }, [commitPsd]);

    // ─────────────────────────────────────────────────
    // レイヤー削除
    // ─────────────────────────────────────────────────
    const handleDeleteLayer = useCallback((path: number[]) => {
        if (!psdRef.current) return;
        const cur = psdRef.current;

        const deleteAt = (psd: Psd, path: number[]): Psd => {
            const newPsd = { ...psd, children: [...(psd.children || [])] };
            let arr = newPsd.children;
            const pathCopy = [...path];
            const lastIdx = pathCopy.pop()!;
            for (const idx of pathCopy) {
                arr[idx] = { ...arr[idx], children: [...(arr[idx].children || [])] };
                arr = arr[idx].children!;
            }
            arr.splice(lastIdx, 1);
            return newPsd;
        };

        commitPsd(deleteAt(cur, path));
    }, [commitPsd]);

    // ─────────────────────────────────────────────────
    // ドラッグ＆ドロップ並び替え
    // ─────────────────────────────────────────────────

    /**
     * スクロールコンテナ内の data-path 付き要素をスキャンして
     * マウス座標に最も近いドロップターゲットを返す
     */
    const findDropTarget = useCallback((clientY: number): DropTargetInfo | null => {
        const scroll = layerScrollRef.current;
        if (!scroll) return null;
        const items = Array.from(scroll.querySelectorAll<HTMLElement>('[data-path]'));
        if (!items.length) return null;

        let best: (DropTargetInfo & { dist: number }) | null = null;

        for (const el of items) {
            const rect = el.getBoundingClientRect();
            const pathStr = el.getAttribute('data-path') ?? '';
            const path = pathStr.split('-').map(Number);
            const isGroup = el.getAttribute('data-group') === 'true';
            const zone = rect.height * 0.25;

            let position: 'before' | 'after' | 'inside';
            let dist: number;

            if (clientY < rect.top + zone) {
                position = 'before'; dist = Math.abs(clientY - rect.top);
            } else if (clientY > rect.bottom - zone) {
                position = 'after'; dist = Math.abs(clientY - rect.bottom);
            } else if (isGroup) {
                position = 'inside'; dist = Math.abs(clientY - (rect.top + rect.height / 2));
            } else {
                position = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                dist = Math.abs(clientY - (rect.top + rect.height / 2));
            }

            if (!best || dist < best.dist) best = { path, position, dist };
        }

        return best ? { path: best.path, position: best.position } : null;
    }, []);

    /**
     * ソース srcPath のレイヤーをドロップターゲット位置に移動する。
     *
     * 【重要】レイヤーリストは children を reverse() して表示しているため
     * 画面上の「上」= 配列の末尾方向（高インデックス）
     * 画面上の「下」= 配列の先頭方向（低インデックス）
     *
     * findDropTarget が返す before/after は画面座標基準なので
     * 配列操作に変換する際は反転が必要:
     *   画面 before（上に挿入）→ 配列 after（insertIdx + 1）
     *   画面 after（下に挿入）  → 配列 before（insertIdx そのまま）
     */
    const applyDrop = useCallback((srcPath: number[], dst: DropTargetInfo) => {
        const current = psdRef.current;
        if (!current?.children) return;

        // ツリーをディープコピー
        const cloneTree = (layers: any[]): any[] =>
            layers.map(l => ({ ...l, children: l.children ? cloneTree(l.children) : undefined }));
        const newChildren = cloneTree(current.children);

        // 1. ソースを取り出す
        const srcParentPath = srcPath.slice(0, -1);
        const srcIdx = srcPath[srcPath.length - 1];
        const srcArr = srcParentPath.length === 0 ? newChildren : getLayersAtPath(newChildren, srcParentPath);
        const [srcLayer] = srcArr.splice(srcIdx, 1);

        // 2. 同一親内のとき、srcIdx の splice によって dstIdx がずれる補正。
        //    srcIdx < dstIdx の場合、splice でその要素が消えるため dstIdx を -1 する。
        let dstPath = [...dst.path];
        const dstParentPath = dstPath.slice(0, -1);
        const isSameParent = srcParentPath.join('-') === dstParentPath.join('-');
        if (isSameParent && srcIdx < dstPath[dstPath.length - 1]) {
            dstPath[dstPath.length - 1]--;
        }

        // 3. 挿入
        if (dst.position === 'inside') {
            // グループの末尾に push（reverse 表示では先頭に見える）
            const dstGroup = dstPath.length === 0
                ? { children: newChildren }
                : getLayersAtPath(newChildren, dstPath.slice(0, -1))[dstPath[dstPath.length - 1]] as any;
            if (!dstGroup.children) dstGroup.children = [];
            dstGroup.children.push(srcLayer);
        } else {
            const dstArr = dstParentPath.length === 0 ? newChildren : getLayersAtPath(newChildren, dstParentPath);
            let insertIdx = dstPath[dstPath.length - 1];
            // 表示 reverse のため before/after を反転
            if (dst.position === 'before') insertIdx++;
            dstArr.splice(insertIdx, 0, srcLayer);
        }

        commitPsd({ ...current, children: newChildren });
    }, [commitPsd]);

    /**
     * ドラッグ開始（LayerItem の GripVertical onMouseDown から呼ばれる）
     */
    const handleLayerDragStart = useCallback((e: React.MouseEvent, path: number[]) => {
        e.preventDefault();
        e.stopPropagation();
        dragStateRef.current = { path, startY: e.clientY, moved: false };
        setDraggingPath(path);

        const onMouseMove = (ev: MouseEvent) => {
            if (!dragStateRef.current) return;
            if (Math.abs(ev.clientY - dragStateRef.current.startY) > 3) dragStateRef.current.moved = true;

            const target = findDropTarget(ev.clientY);
            if (target) {
                const dragKey = dragStateRef.current.path.join('-');
                const targetKey = target.path.join('-');
                // 自身・子孫へのドロップは無効
                if (targetKey !== dragKey && !targetKey.startsWith(dragKey + '-')) {
                    setDropTarget(target);
                    return;
                }
            }
            setDropTarget(null);
        };

        const onMouseUp = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            const state = dragStateRef.current;
            dragStateRef.current = null;
            setDraggingPath(null);
            setDropTarget(null);

            if (!state?.moved) return;

            // mouseup 時点でのドロップターゲットを再計算して適用
            const target = findDropTarget(ev.clientY);
            if (!target) return;
            const dragKey = state.path.join('-');
            const targetKey = target.path.join('-');
            if (targetKey === dragKey || targetKey.startsWith(dragKey + '-')) return;
            applyDrop(state.path, target);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [findDropTarget, applyDrop]);

    // ─────────────────────────────────────────────────
    // flip ヘルパー
    // ─────────────────────────────────────────────────
    const getFlipSuffix = useCallback((): string => {
        if (flipX && flipY) return ':flipxy';
        if (flipX) return ':flipx';
        if (flipY) return ':flipy';
        return '';
    }, [flipX, flipY]);

    const getBaseName = useCallback((name: string): string =>
        name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);

    const hasFlipSuffix = useCallback((name: string): boolean =>
        /(:[Ff]lip(xy|x|y))$/i.test(name), []);

    // ─────────────────────────────────────────────────
    // 描画
    // ─────────────────────────────────────────────────
    useEffect(() => {
        if (!psd || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = psd.width;
        canvas.height = psd.height;
        ctx.clearRect(0, 0, psd.width, psd.height);
        const flipSuffix = flipEnabled ? getFlipSuffix() : '';
        ctx.save();
        if (flipX && flipY) { ctx.translate(psd.width, psd.height); ctx.scale(-1, -1); }
        else if (flipX) { ctx.translate(psd.width, 0); ctx.scale(-1, 1); }
        else if (flipY) { ctx.translate(0, psd.height); ctx.scale(1, -1); }

        const buildFlipVariantMap = (layers: any[]) => {
            const map = new Map<string, any>();
            if (!flipSuffix) return map;
            for (const l of layers) {
                const lowerName = (l.name || '').toLowerCase();
                if (lowerName.endsWith(flipSuffix.toLowerCase()))
                    map.set(getBaseName(l.name || '').toLowerCase(), l);
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
                else if (effectiveLayer.canvas)
                    ctx.drawImage(effectiveLayer.canvas, effectiveLayer.left || 0, effectiveLayer.top || 0);
            }
        };

        if (psd.children && psd.children.length > 0) drawLayers(psd.children);
        else if (psd.canvas) ctx.drawImage(psd.canvas, 0, 0);
        ctx.restore();
    }, [psd, flipX, flipY, flipEnabled, getFlipSuffix, getBaseName, hasFlipSuffix]);

    // ─────────────────────────────────────────────────
    // JSX
    // ─────────────────────────────────────────────────
    return (
        <div className={`psd-editor theme-${theme} ${isDragging ? 'is-dragging' : ''}`}>
            {/* タイトルバー */}
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

            {/* ヘッダー */}
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
                    {/* パネルヘッダー */}
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

                    {/* 検索バー */}
                    {psd && (
                        <div className="layer-search-bar">
                            <Search size={12} className="layer-search-icon" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                className="layer-search-input"
                                placeholder="Search layers..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
                            />
                            {searchQuery && (
                                <button
                                    className="layer-search-clear"
                                    onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                                    title="Clear search"
                                >
                                    <X size={11} />
                                </button>
                            )}
                        </div>
                    )}

                    {/* モードバー（検索中は非表示） */}
                    {!searchResults && (
                        <div className="layer-mode-bar">
                            <button className={`mode-toggle ${radioEnabled ? 'active' : ''}`} onClick={() => setRadioEnabled(v => !v)} title="Radio group mode"><Asterisk size={13} /><span>Radio</span></button>
                            <button className={`mode-toggle ${lockedEnabled ? 'active' : ''}`} onClick={() => setLockedEnabled(v => !v)} title="Locked visibility mode"><Pin size={13} /><span>Fixed</span></button>
                            <button className={`mode-toggle ${flipEnabled ? 'active' : ''}`} onClick={() => setFlipEnabled(v => !v)} title="Flip variant mode"><Replace size={13} /><span>Flip</span></button>
                        </div>
                    )}

                    {/* レイヤーリスト */}
                    <div className="layer-scroll" ref={layerScrollRef}>
                        {psd && psd.children ? (
                            searchResults ? (
                                /* 検索結果フラットリスト */
                                searchResults.length > 0 ? (
                                    <div className="search-results-list">
                                        {searchResults.map((result) => (
                                            <SearchResultRow
                                                key={result.path.join('-')}
                                                result={result}
                                                onToggle={toggleLayerVisibility}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="empty-state">
                                        <p>No layers found</p>
                                    </div>
                                )
                            ) : (
                                /* 通常ツリー表示 */
                                <ul className="layer-list">
                                    {[...psd.children].reverse().map((layer, index, array) => {
                                        const originalIndex = array.length - 1 - index;
                                        if (flipEnabled && hasFlipSuffix(layer.name || '')) return null;
                                        return (
                                            <LayerItem
                                                key={originalIndex}
                                                layer={layer}
                                                path={[originalIndex]}
                                                siblings={psd.children!}
                                                radioEnabled={radioEnabled}
                                                lockedEnabled={lockedEnabled}
                                                isClosed={closedKeys.has(String(originalIndex))}
                                                isChildClosed={isChildClosed}
                                                onToggleExpand={handleToggleExpand}
                                                onToggle={toggleLayerVisibility}
                                                onRename={renameLayer}
                                                onRadioSelect={toggleRadioLayer}
                                                onDelete={handleDeleteLayer}
                                                onDragStart={handleLayerDragStart}
                                                draggingPath={draggingPath}
                                                dropTarget={dropTarget}
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

                <section className="preview-panel" ref={previewRef as React.RefObject<HTMLElement>}>
                    {psd ? (
                        // スクロール wrapper: zoom されたキャンバス + 周囲の余白 SCROLL_PADDING を実サイズで確保
                        <div style={{
                            width: psd.width * zoom + SCROLL_PADDING * 2,
                            height: psd.height * zoom + SCROLL_PADDING * 2,
                            minWidth: '100%',
                            minHeight: '100%',
                            position: 'relative',
                        }}>
                            {/* キャンバスをスクロール wrapper 内中央に配置 */}
                            <div
                                className="canvas-container"
                                style={{
                                    position: 'absolute',
                                    left: SCROLL_PADDING,
                                    top: SCROLL_PADDING,
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
                        <div className="placeholder">
                            <Monitor className="placeholder-icon" />
                            <p>Drag and drop or import a PSD file to start</p>
                        </div>
                    )}
                </section>
            </div>

            {isDragging && (
                <div className="drag-overlay">
                    <div className="drag-message">
                        <div className="overlay-icon-ring"><Download size={48} /></div>
                        <div className="overlay-text">
                            <h3>Ready to Import</h3>
                            <p>Release to open your PSD masterpiece</p>
                        </div>
                    </div>
                </div>
            )}

            {notification && (
                <Toast message={notification.message} type={notification.type} onClose={handleCloseNotification} />
            )}
        </div>
    );
};

export default PsdEditor;