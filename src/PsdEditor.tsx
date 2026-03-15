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
    ChevronsUpDown
} from 'lucide-react';
import './PsdEditor.css';

interface ToastProps {
    message: string;
    type: 'success' | 'error';
    onClose: () => void;
}

const Toast = ({ message, type, onClose }: ToastProps) => {
    // FIX #7: onClose を依存配列に含めつつ、親側で useCallback 化することで
    // タイマーが毎レンダーでリセットされる問題を防ぐ
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

interface LayerItemProps {
    layer: any;
    path: number[];
    siblings: any[];
    radioEnabled: boolean;
    lockedEnabled: boolean;
    // Set全体ではなく「自分が閉じているか」の boolean のみ受け取る。
    // これにより React.memo が props の浅い比較で正しく動作し、
    // 全展開/全閉じ時に自分の isClosed が変わったノードだけ再レンダーされる。
    isClosed: boolean;
    // 子ノードの isClosed を解決するためのルックアップ関数。
    // Set を渡すと参照が毎回変わって memo が無効化されるため関数形式にする。
    isChildClosed: (childKey: string) => boolean;
    onToggleExpand: (key: string) => void;
    onToggle: (path: number[]) => void;
    onRename: (path: number[], newName: string) => void;
    onRadioSelect: (path: number[], siblings: any[]) => void;
}

const LayerThumbnail = memo(({ canvas, hasChildren }: { canvas?: HTMLCanvasElement; hasChildren: boolean }) => {
    const dataUrl = useMemo(() => {
        if (!canvas) return null;
        try {
            return canvas.toDataURL();
        } catch (e) {
            return null;
        }
    }, [canvas]);

    return (
        <div className="layer-preview-thumbnail">
            {dataUrl ? (
                <img src={dataUrl} alt="" className="layer-thumbnail-img" />
            ) : hasChildren ? (
                <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
            ) : (
                <ImageIcon size={16} className="text-muted" />
            )}
        </div>
    );
});

const LayerItem = memo(({ layer, path, siblings, radioEnabled, lockedEnabled, isClosed, isChildClosed, onToggleExpand, onToggle, onRename, onRadioSelect }: LayerItemProps) => {
    const key = path.join('-');
    const hasChildren = layer.children && layer.children.length > 0;

    const name = layer.name || '';
    const isRadio = radioEnabled && name.startsWith('*');
    const isLocked = lockedEnabled && name.startsWith('!');
    const displayName = (isRadio || isLocked) ? name.slice(1) : name;

    const handleVisibilityClick = useCallback(() => {
        if (isLocked) return;
        if (isRadio) {
            onRadioSelect(path, siblings);
        } else {
            onToggle(path);
        }
    }, [isLocked, isRadio, onRadioSelect, onToggle, path, siblings]);

    const handleExpandClick = useCallback(() => {
        onToggleExpand(key);
    }, [onToggleExpand, key]);

    const handleRename = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const prefix = isRadio ? '*' : isLocked ? '!' : '';
        onRename(path, prefix + e.target.value);
    }, [isRadio, isLocked, onRename, path]);

    return (
        <li className="layer-node">
            <div className={`layer-item ${isLocked ? 'layer-locked' : ''} ${isRadio ? 'layer-radio' : ''}`}>
                {hasChildren ? (
                    <button className="toggle-expand" onClick={handleExpandClick}>
                        {!isClosed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                ) : (
                    <span className="spacer" />
                )}

                {!isLocked && (
                    <div className="visibility-toggle" onClick={handleVisibilityClick} title={isRadio ? 'Select (radio)' : 'Toggle visibility'}>
                        {isRadio ? (
                            <div className={`radio-indicator ${!layer.hidden ? 'active' : ''}`} />
                        ) : !layer.hidden ? (
                            <Eye size={16} className="text-accent" />
                        ) : (
                            <EyeOff size={16} className="text-muted" />
                        )}
                    </div>
                )}
                {isLocked && (
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
            </div>

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
                            />
                        );
                    })}
                </ul>
            )}
        </li>
    );
});

const PsdEditor = () => {
    const [psd, setPsd] = useState<Psd | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [radioEnabled, setRadioEnabled] = useState(true);
    const [lockedEnabled, setLockedEnabled] = useState(true);
    const [flipEnabled, setFlipEnabled] = useState(true);
    const [theme, setTheme] = useState<'black' | 'grey' | 'light' | 'white'>('grey');
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    // 「閉じているグループのキー集合」。キーは path.join('-')。
    // 含まれていれば閉じ、含まれていなければ展開（デフォルト展開）。
    const [closedKeys, setClosedKeys] = useState<Set<string>>(new Set());
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewRef = useRef<HTMLElement>(null);
    // アンドゥ履歴スタック。psd の過去スナップショットを積む。
    // state にすると履歴変更自体が再レンダーを呼ぶため ref で管理する。
    const undoStack = useRef<Psd[]>([]);
    const redoStack = useRef<Psd[]>([]);
    // 常に最新の psd を保持する ref（キーボードハンドラの stale closure 対策）
    const psdRef = useRef<Psd | null>(null);

    const appWindow = getCurrentWindow();

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = () => appWindow.toggleMaximize();
    const handleClose = () => appWindow.close();

    // FIX #7: useCallback で安定した参照にし Toast のタイマーリセットを防ぐ
    const handleCloseNotification = useCallback(() => {
        setNotification(null);
    }, []);

    // 個別トグル
    const handleToggleExpand = useCallback((key: string) => {
        setClosedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    // ツリーに存在する全グループキーを収集する
    const collectGroupKeys = useCallback((layers: any[], parentPath: number[] = []): string[] => {
        const keys: string[] = [];
        layers.forEach((layer, idx) => {
            if (layer.children && layer.children.length > 0) {
                const path = [...parentPath, idx];
                keys.push(path.join('-'));
                keys.push(...collectGroupKeys(layer.children, path));
            }
        });
        return keys;
    }, []);

    const handleExpandAll = useCallback(() => {
        setClosedKeys(new Set()); // 全キーを削除 = 全展開
    }, []);

    const handleCollapseAll = useCallback(() => {
        if (!psd?.children) return;
        setClosedKeys(new Set(collectGroupKeys(psd.children)));
    }, [psd, collectGroupKeys]);

    // closedKeys の Set を直接渡すと参照が毎回変わり memo が無効化されるため、
    // useCallback で安定した関数参照にしてルックアップを提供する。
    // closedKeys が変わったときだけ新しい関数が生成される。
    const isChildClosed = useCallback((childKey: string) => {
        return closedKeys.has(childKey);
    }, [closedKeys]);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ message, type });
    };

    // psdRef を常に最新の psd と同期させる
    useEffect(() => { psdRef.current = psd; }, [psd]);

    const MAX_UNDO = 50;

    // psd を更新しつつ現在値をアンドゥスタックに積む。
    // ロード時など履歴に積みたくない場合は直接 setPsd を使う。
    const commitPsd = useCallback((next: Psd) => {
        const current = psdRef.current;
        if (!current) return;
        undoStack.current = [
            ...undoStack.current.slice(-(MAX_UNDO - 1)),
            current,
        ];
        // 新しい操作をしたらリドゥ履歴は無効化する
        redoStack.current = [];
        setPsd(next);
    }, []);

    const handleUndo = useCallback(() => {
        if (undoStack.current.length === 0) return;
        const current = psdRef.current;
        if (current) redoStack.current = [...redoStack.current, current];
        const prev = undoStack.current.pop()!;
        setPsd(prev);
    }, []);

    const handleRedo = useCallback(() => {
        if (redoStack.current.length === 0) return;
        const current = psdRef.current;
        if (current) undoStack.current = [...undoStack.current, current];
        const next = redoStack.current.pop()!;
        setPsd(next);
    }, []);

    const handleCopyCanvas = useCallback(async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        try {
            await new Promise<void>((resolve, reject) => {
                canvas.toBlob(async (blob) => {
                    if (!blob) { reject(new Error('toBlob failed')); return; }
                    try {
                        await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                        ]);
                        resolve();
                    } catch (e) { reject(e); }
                }, 'image/png');
            });
            showToast('Copied to clipboard!');
        } catch (err) {
            showToast(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, []);

    // ロード時に * プレフィックスのラジオグループを正規化する。
    // 各兄弟レイヤー配列を走査し、* レイヤーが複数ある場合は
    // 「表示中の最初の1枚だけ残して残りを hidden にする」。
    // 全て hidden の場合は先頭を強制表示する。
    const normalizeRadioGroups = useCallback((layers: any[]): any[] => {
        // まず子を再帰処理
        const processed = layers.map((layer) => {
            if (layer.children && layer.children.length > 0) {
                return { ...layer, children: normalizeRadioGroups(layer.children) };
            }
            return layer;
        });

        // この階層の * レイヤー群を正規化
        const radioIndices = processed
            .map((l, i) => ({ l, i }))
            .filter(({ l }) => (l.name || '').startsWith('*'))
            .map(({ i }) => i);

        if (radioIndices.length < 2) return processed; // 1枚以下なら不要

        // 表示中の最初の1枚を選択インデックスとする。全て hidden なら先頭を選ぶ。
        const visibleIdx = radioIndices.find((i) => !processed[i].hidden) ?? radioIndices[0];

        const normalized = [...processed];
        radioIndices.forEach((i) => {
            normalized[i] = { ...normalized[i], hidden: i !== visibleIdx };
        });

        return normalized;
    }, []);

    // FIX #2: loadPsdFromFilePath を useCallback でメモ化し、
    // useEffect の依存配列に正しく含められるようにする（stale closure 対策）
    const loadPsdFromFilePath = useCallback(async (path: string) => {
        setIsLoading(true);
        try {
            const data = await readFile(path);
            const parsedPsd = readPsd(data, {
                skipLayerImageData: false,
                skipCompositeImageData: false
            });
            // ロード直後にラジオグループの初期状態を正規化する
            if (parsedPsd.children) {
                parsedPsd.children = normalizeRadioGroups(parsedPsd.children);
            }
            setPsd(parsedPsd);
            setZoom(1);
        } catch (err) {
            console.error('Failed to load PSD:', err);
            showToast(`Failed to load PSD: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
        setIsLoading(false);
    }, [normalizeRadioGroups]); // setIsLoading / setPsd / setZoom は安定した参照のため依存不要

    // FIX #2: loadPsdFromFilePath を依存配列に追加
    useEffect(() => {
        const unlistenPromises = Promise.all([
            listen('tauri://drag-over', () => {
                setIsDragging(true);
            }),
            listen('tauri://drag-drop', (event: any) => {
                setIsDragging(false);
                const paths = event.payload.paths;
                if (paths && paths.length > 0) {
                    const filePath = paths[0];
                    if (filePath.toLowerCase().endsWith('.psd')) {
                        loadPsdFromFilePath(filePath);
                    }
                }
            }),
            listen('tauri://drag-leave', () => {
                setIsDragging(false);
            })
        ]);

        return () => {
            unlistenPromises.then((unlisteners) => {
                unlisteners.forEach((unlisten) => unlisten());
            });
        };
    }, [loadPsdFromFilePath]); // FIX #2

    useEffect(() => {
        const preview = previewRef.current;
        if (!preview) return;

        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();

            // ── ズーム倍率を計算 ──
            const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            const factor = 1 - raw * 0.002;

            setZoom(prev => {
                const next = Math.min(5, Math.max(0.1,
                    Math.round(prev * factor * 100) / 100
                ));
                if (next === prev) return prev;

                // ── カーソル位置を固定点にしてスクロール補正 ──
                // preview 左上からのカーソル座標
                const rect = preview.getBoundingClientRect();
                const cx = e.clientX - rect.left;
                const cy = e.clientY - rect.top;

                // ズーム前のコンテンツ上の座標
                const contentX = (preview.scrollLeft + cx) / prev;
                const contentY = (preview.scrollTop + cy) / prev;

                // ズーム後に同じコンテンツ座標がカーソル位置に来るようスクロール調整
                // requestAnimationFrame で DOM 更新後に実行
                requestAnimationFrame(() => {
                    preview.scrollLeft = contentX * next - cx;
                    preview.scrollTop = contentY * next - cy;
                });

                return next;
            });
        };

        preview.addEventListener('wheel', handleWheel, { passive: false });
        return () => preview.removeEventListener('wheel', handleWheel);
    }, []);

    // Ctrl+Z（アンドゥ）/ Ctrl+Shift+Z・Ctrl+Y（リドゥ）/ Ctrl+C（クリップボードコピー）
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
                return;
            }

            if (
                (e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) ||
                (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)
            ) {
                e.preventDefault();
                handleRedo();
                return;
            }

            if (e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey)) {
                const sel = window.getSelection();
                if (sel && sel.toString().length > 0) return;
                e.preventDefault();
                handleCopyCanvas();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleUndo, handleRedo, handleCopyCanvas]);

    const handleOpenFile = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'PSD Image',
                    extensions: ['psd']
                }]
            });

            if (selected && typeof selected === 'string') {
                loadPsdFromFilePath(selected);
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
            showToast(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    const handleSaveFile = async () => {
        if (!psd) return;
        try {
            const selected = await save({
                title: 'Save PSD File',
                filters: [{
                    name: 'PSD Image',
                    extensions: ['psd']
                }]
            });

            if (selected) {
                const psdBuffer = writePsd(psd);
                await writeFile(selected, new Uint8Array(psdBuffer));
                showToast('File saved successfully!');
            }
        } catch (err) {
            console.error('Critical failure during save:', err);
            showToast(`Failed to save file: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    const handleExportPng = async () => {
        if (!canvasRef.current || !psd) return;
        try {
            const selected = await save({
                title: 'Export as PNG',
                filters: [{
                    name: 'PNG Image',
                    extensions: ['png']
                }]
            });

            if (selected) {
                const canvas = canvasRef.current;
                const dataUrl = canvas.toDataURL('image/png');
                const base64Data = dataUrl.split(',')[1];
                const binaryData = atob(base64Data);
                const array = new Uint8Array(binaryData.length);
                for (let i = 0; i < binaryData.length; i++) {
                    array[i] = binaryData.charCodeAt(i);
                }
                await writeFile(selected, array);
                showToast('PNG exported successfully!');
            }
        } catch (err) {
            console.error('Failed to export PNG:', err);
            showToast(`Failed to export PNG: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    const handleZoom = (delta: number) => {
        setZoom(prev => Math.max(0.1, Math.min(5, prev + delta)));
    };

    const resetZoom = () => setZoom(1);

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
        const updated = updateLayerByPath(psd, path, (layer) => ({ ...layer, hidden: !layer.hidden }));
        commitPsd(updated);
    };

    // リネームは1文字ごとに commitPsd すると履歴が溢れるため、
    // 連続入力の最初の1打鍵時に「変更前」スナップショットを積み、
    // 600ms 入力が止まったらタイマーをリセットして次の編集を別エントリにする。
    const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const renameBaseRef = useRef<Psd | null>(null); // 連続入力前のスナップショット
    const renameLayer = (path: number[], newName: string) => {
        if (!psd) return;
        const updated = updateLayerByPath(psd, path, (layer) => ({ ...layer, name: newName }));

        if (!renameTimerRef.current) {
            // 連続入力の先頭: 変更前を履歴に積み、リドゥ履歴は無効化
            renameBaseRef.current = psd;
            undoStack.current = [
                ...undoStack.current.slice(-(MAX_UNDO - 1)),
                psd,
            ];
            redoStack.current = [];
        } else {
            clearTimeout(renameTimerRef.current);
        }

        setPsd(updated);

        // 600ms 無入力で連続入力セッション終了
        renameTimerRef.current = setTimeout(() => {
            renameTimerRef.current = null;
            renameBaseRef.current = null;
        }, 600);
    };

    // FIX #3 & #6: selectedIdx は path の末尾（グローバルツリー上のインデックス）。
    // siblings は LayerItem から渡ってくる「元の（非リバース）children 配列」。
    // siblings[idx] の idx も同じくグローバルインデックスなので対応は正しい。
    // ただし旧コードでは LayerItem 内で reverse 後のインデックスを path に入れて
    // いたためズレが生じていた。FIX #6 の修正で originalIndex が正しくなったことで
    // こちらも正しく動作する。
    const toggleRadioLayer = (path: number[], siblings: any[]) => {
        if (!psd) return;
        const selectedIdx = path[path.length - 1];
        const parentPath = path.slice(0, -1);

        let currentPsd = psd;

        siblings.forEach((sibling: any, idx: number) => {
            const name = sibling.name || '';
            if (!name.startsWith('*')) return;

            const sibPath = [...parentPath, idx];
            const shouldHide = idx !== selectedIdx;

            if (sibling.hidden !== shouldHide) {
                currentPsd = updateLayerByPath(currentPsd, sibPath, (l) => ({ ...l, hidden: shouldHide }));
            }
        });

        if (currentPsd !== psd) {
            commitPsd(currentPsd);
        }
    };

    const getFlipSuffix = (): string => {
        if (flipX && flipY) return ':flipxy';
        if (flipX) return ':flipx';
        if (flipY) return ':flipy';
        return '';
    };

    const getBaseName = (name: string): string =>
        name.replace(/(:[Ff]lip(xy|x|y))$/i, '');

    const hasFlipSuffix = (name: string): boolean =>
        /(:[Ff]lip(xy|x|y))$/i.test(name);

    useEffect(() => {
        if (psd && canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                canvas.width = psd.width;
                canvas.height = psd.height;
                ctx.clearRect(0, 0, psd.width, psd.height);

                const flipSuffix = flipEnabled ? getFlipSuffix() : '';

                ctx.save();
                if (flipX && flipY) {
                    ctx.translate(psd.width, psd.height);
                    ctx.scale(-1, -1);
                } else if (flipX) {
                    ctx.translate(psd.width, 0);
                    ctx.scale(-1, 1);
                } else if (flipY) {
                    ctx.translate(0, psd.height);
                    ctx.scale(1, -1);
                }

                // FIX #4 & #5: buildFlipVariantMap をヘルパー関数として切り出し、
                // 各レイヤーグループ（再帰レベル）ごとに正しいマップを構築する。
                // また大文字小文字の正規化を toLowerCase() で統一し、
                // hasFlipSuffix の /i フラグと整合させる。
                const buildFlipVariantMap = (layers: any[]): Map<string, any> => {
                    const map = new Map<string, any>();
                    if (!flipSuffix) return map;
                    for (const l of layers) {
                        const lowerName = (l.name || '').toLowerCase();
                        // FIX #4: toLowerCase() で正規化した名前に対して
                        // 小文字の flipSuffix で endsWith する（大文字バリアント対応）
                        if (lowerName.endsWith(flipSuffix.toLowerCase())) {
                            const base = getBaseName(l.name || '');
                            map.set(base.toLowerCase(), l);
                        }
                    }
                    return map;
                };

                // FIX #5: 再帰呼び出し時に各グループのレイヤー配列から
                // 新しい flipVariantMap を構築して渡す
                const drawLayers = (layers: any[]) => {
                    const flipVariantMap = buildFlipVariantMap(layers);

                    for (const layer of layers) {
                        if (layer.hidden) continue;

                        const name = layer.name || '';
                        // flip バリアントレイヤー自体は通常描画パスからスキップ
                        if (hasFlipSuffix(name)) continue;

                        const effectiveLayer = flipVariantMap.get(name.toLowerCase()) ?? layer;

                        if (effectiveLayer.children) {
                            // FIX #5: 子レイヤー配列に対して再帰（新しいマップが構築される）
                            drawLayers(effectiveLayer.children);
                        } else if (effectiveLayer.canvas) {
                            ctx.drawImage(effectiveLayer.canvas, effectiveLayer.left || 0, effectiveLayer.top || 0);
                        }
                    }
                };

                if (psd.children && psd.children.length > 0) {
                    drawLayers(psd.children);
                } else if (psd.canvas) {
                    ctx.drawImage(psd.canvas, 0, 0);
                }

                ctx.restore();
            }
        }
    }, [psd, flipX, flipY, flipEnabled]);

    // PSD 読み込み直後（zoom リセット後）にキャンバスをプレビュー中央へスクロールする
    const prevPsdRef = useRef<Psd | null>(null);
    useEffect(() => {
        // psd が新しくロードされたとき（前回と異なるオブジェクト）のみ実行
        if (!psd || psd === prevPsdRef.current) return;
        prevPsdRef.current = psd;

        const preview = previewRef.current;
        if (!preview) return;

        // DOM に反映されてからスクロール量を計算する
        requestAnimationFrame(() => {
            const cw = psd.width * zoom;   // canvas の実表示サイズ
            const ch = psd.height * zoom;
            const pw = preview.clientWidth;
            const ph = preview.clientHeight;
            // コンテンツ全体（padding 込み）の中央にキャンバス中心が来るように
            preview.scrollLeft = Math.max(0, (cw - pw) / 2);
            preview.scrollTop = Math.max(0, (ch - ph) / 2);
        });
    }, [psd, zoom]);

    return (
        <div className={`psd-editor theme-${theme} ${isDragging ? 'is-dragging' : ''}`}>
            <div
                className="custom-title-bar"
                data-tauri-drag-region
                onMouseDown={(e) => {
                    if (e.button === 0) {
                        appWindow.startDragging();
                    }
                }}
            >
                <div className="title-bar-brand" data-tauri-drag-region>
                    <ImageIcon size={14} />
                    <span>PSD STUDIO</span>
                </div>
                <div className="window-controls">
                    <button onClick={handleMinimize} onMouseDown={(e) => e.stopPropagation()} className="control-btn mini" title="Minimize"><Minus size={14} /></button>
                    <button onClick={handleMaximize} onMouseDown={(e) => e.stopPropagation()} className="control-btn max" title="Maximize/Restore"><Square size={12} /></button>
                    <button onClick={handleClose} onMouseDown={(e) => e.stopPropagation()} className="control-btn close" title="Close"><X size={14} /></button>
                </div>
            </div>

            <header className="editor-header">
                <div className="brand">
                    <Layers size={20} className="text-accent" />
                    <h1>Workspace</h1>
                </div>

                <div className="theme-switcher">
                    {(['black', 'grey', 'light', 'white'] as const).map((t) => (
                        <button
                            key={t}
                            className={`theme-btn ${theme === t ? 'active' : ''}`}
                            onClick={() => setTheme(t)}
                            title={`${t.charAt(0).toUpperCase() + t.slice(1)} Theme`}
                        >
                            <div className={`swatch theme-${t}`} />
                        </button>
                    ))}
                </div>

                {psd && (
                    <div className="zoom-controls">
                        <button
                            onClick={() => setFlipX(v => !v)}
                            className={flipX ? 'btn-active' : ''}
                            title="Flip Horizontal"
                        >
                            <FlipHorizontal2 size={16} />
                        </button>
                        <button
                            onClick={() => setFlipY(v => !v)}
                            className={flipY ? 'btn-active' : ''}
                            title="Flip Vertical"
                        >
                            <FlipVertical2 size={16} />
                        </button>
                        <div className="zoom-sep" />
                        <button onClick={() => handleZoom(-0.1)} title="Zoom Out">
                            <ZoomOut size={16} />
                        </button>
                        <span className="zoom-value" onClick={resetZoom} title="Reset Zoom">
                            {Math.round(zoom * 100)}%
                        </span>
                        <button onClick={() => handleZoom(0.1)} title="Zoom In">
                            <ZoomIn size={16} />
                        </button>
                        <button onClick={resetZoom} title="Reset View">
                            <Maximize size={16} />
                        </button>
                    </div>
                )}

                <div className="btn-group">
                    <button onClick={handleOpenFile}>
                        <FolderOpen size={18} />
                        <span>Open</span>
                    </button>
                    {psd && (
                        <>
                            <button onClick={handleExportPng} className="btn-secondary">
                                <Download size={18} />
                                <span>PNG</span>
                            </button>
                            <button onClick={handleSaveFile} className="btn-primary">
                                <Save size={18} />
                                <span>Save PSD</span>
                            </button>
                        </>
                    )}
                </div>
            </header>

            <div className="editor-main">
                <aside className="layer-panel">
                    <div className="panel-header">
                        <h2>Layers</h2>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                                className="toggle-expand"
                                onClick={handleExpandAll}
                                title="Expand all groups"
                            >
                                <ChevronsUpDown size={14} />
                            </button>
                            <button
                                className="toggle-expand"
                                onClick={handleCollapseAll}
                                title="Collapse all groups"
                            >
                                <ChevronsDownUp size={14} />
                            </button>
                        </div>
                    </div>
                    <div className="layer-mode-bar">
                        <button
                            className={`mode-toggle ${radioEnabled ? 'active' : ''}`}
                            onClick={() => setRadioEnabled(v => !v)}
                            title="Radio group mode: layer names starting with '*' become mutually exclusive"
                        >
                            <Asterisk size={13} />
                            <span>Radio</span>
                        </button>
                        <button
                            className={`mode-toggle ${lockedEnabled ? 'active' : ''}`}
                            onClick={() => setLockedEnabled(v => !v)}
                            title="Locked visibility mode: layer names starting with '!' cannot be hidden"
                        >
                            <Pin size={13} />
                            <span>Fixed</span>
                        </button>
                        <button
                            className={`mode-toggle ${flipEnabled ? 'active' : ''}`}
                            onClick={() => setFlipEnabled(v => !v)}
                            title="Flip variant mode: layers ending with ':flipx/:flipy/:flipxy' swap on flip"
                        >
                            <Replace size={13} />
                            <span>Flip</span>
                        </button>
                    </div>
                    <div className="layer-scroll">
                        {psd && psd.children ? (
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
                                        />
                                    );
                                })}
                            </ul>
                        ) : (
                            <div className="empty-state">
                                <p>{isLoading ? 'Analyzing workspace...' : 'Drop a PSD file here'}</p>
                            </div>
                        )}
                    </div>
                </aside>

                <section className="preview-panel" ref={previewRef as React.RefObject<HTMLElement>}>
                    <div className="viewport-area">
                        {psd ? (
                            <div
                                className="zoom-container"
                                style={{
                                    width: psd.width * zoom,
                                    height: psd.height * zoom,
                                }}
                            >
                                <div
                                    className="canvas-container"
                                    style={{
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
                    </div>
                </section>
            </div>

            {isDragging && (
                <div className="drag-overlay">
                    <div className="drag-message">
                        <div className="overlay-icon-ring">
                            <Download size={48} />
                        </div>
                        <div className="overlay-text">
                            <h3>Ready to Import</h3>
                            <p>Release to open your PSD masterpiece</p>
                        </div>
                    </div>
                </div>
            )}

            {/* FIX #7: onClose に安定した useCallback 参照を渡す */}
            {notification && (
                <Toast
                    message={notification.message}
                    type={notification.type}
                    onClose={handleCloseNotification}
                />
            )}
        </div>
    );
};

export default PsdEditor;