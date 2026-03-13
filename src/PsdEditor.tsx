import { useState, useRef, useEffect, useMemo } from 'react';
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
    Replace
} from 'lucide-react';
import './PsdEditor.css';

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

interface LayerItemProps {
    layer: any;
    path: number[];
    siblings: any[];
    radioEnabled: boolean;
    lockedEnabled: boolean;
    onToggle: (path: number[]) => void;
    onRename: (path: number[], newName: string) => void;
    onRadioSelect: (path: number[], siblings: any[]) => void;
}

const LayerThumbnail = ({ canvas, hasChildren }: { canvas?: HTMLCanvasElement; hasChildren: boolean }) => {
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
                <img
                    src={dataUrl}
                    alt=""
                    className="layer-thumbnail-img"
                />
            ) : hasChildren ? (
                <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
            ) : (
                <ImageIcon size={16} className="text-muted" />
            )}
        </div>
    );
};

const LayerItem = ({ layer, path, siblings, radioEnabled, lockedEnabled, onToggle, onRename, onRadioSelect }: LayerItemProps) => {
    const [isOpen, setIsOpen] = useState(true);
    const hasChildren = layer.children && layer.children.length > 0;

    const name = layer.name || '';
    const isRadio = radioEnabled && name.startsWith('*');
    const isLocked = lockedEnabled && name.startsWith('!');
    // Display name strips the prefix character if mode is active
    const displayName = (isRadio || isLocked) ? name.slice(1) : name;

    const handleVisibilityClick = () => {
        if (isLocked) return;
        if (isRadio) {
            onRadioSelect(path, siblings);
        } else {
            onToggle(path);
        }
    };

    return (
        <li className="layer-node">
            <div className={`layer-item ${isLocked ? 'layer-locked' : ''} ${isRadio ? 'layer-radio' : ''}`}>
                {hasChildren ? (
                    <button
                        className="toggle-expand"
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
                    onChange={(e) => {
                        // Only prepend the prefix if it was hidden from the view
                        const prefix = isRadio ? '*' : isLocked ? '!' : '';
                        onRename(path, prefix + e.target.value);
                    }}
                    placeholder={hasChildren ? 'New Group' : 'New Layer'}
                />
            </div>

            {hasChildren && isOpen && (
                <ul className="sub-layers">
                    {[...(layer.children || [])].reverse().map((child: any, i: number, array: any[]) => {
                        const originalIndex = array.length - 1 - i;
                        const childPath = [...path, originalIndex];
                        return (
                            <LayerItem
                                key={`${path.join('-')}-${originalIndex}`}
                                layer={child}
                                path={childPath}
                                siblings={layer.children}
                                radioEnabled={radioEnabled}
                                lockedEnabled={lockedEnabled}
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
};

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
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewRef = useRef<HTMLElement>(null);

    const appWindow = getCurrentWindow();

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = () => appWindow.toggleMaximize();
    const handleClose = () => appWindow.close();

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ message, type });
    };

    // Native Tauri drag and drop listener
    useEffect(() => {
        const unlistenPromises = Promise.all([
            listen('tauri://drag-over', () => {
                setIsDragging(true);
            }),
            listen('tauri://drag-drop', (event: any) => {
                setIsDragging(false);
                const paths = event.payload.paths;
                if (paths && paths.length > 0) {
                    const path = paths[0];
                    if (path.toLowerCase().endsWith('.psd')) {
                        loadPsdFromFilePath(path);
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
    }, []);

    // Native wheel zoom listener to prevent browser default pinch-to-zoom
    useEffect(() => {
        const preview = previewRef.current;
        if (!preview) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                setZoom(prev => Math.max(0.1, Math.min(5, prev + delta)));
            }
        };

        preview.addEventListener('wheel', handleWheel, { passive: false });
        return () => preview.removeEventListener('wheel', handleWheel);
    }, []);

    const loadPsdFromFilePath = async (path: string) => {
        setIsLoading(true);
        try {
            const data = await readFile(path);
            const parsedPsd = readPsd(data, {
                skipLayerImageData: false,
                skipCompositeImageData: false
            });
            setPsd(parsedPsd);
            setZoom(1);
        } catch (err) {
            console.error('Failed to load PSD:', err);
            showToast(`Failed to load PSD: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
        setIsLoading(false);
    };

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
            console.log('Opening save dialog...');
            const selected = await save({
                title: 'Save PSD File',
                filters: [{
                    name: 'PSD Image',
                    extensions: ['psd']
                }]
            });

            if (selected) {
                console.log('Writing PSD data to buffer...');
                const psdBuffer = writePsd(psd);
                console.log('Writing buffer to file...', selected);
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
        setPsd(updated);
    };

    const renameLayer = (path: number[], newName: string) => {
        if (!psd) return;
        const updated = updateLayerByPath(psd, path, (layer) => ({ ...layer, name: newName }));
        setPsd(updated);
    };

    // Radio group: show clicked layer, hide all other '*' siblings
    const toggleRadioLayer = (path: number[], siblings: any[]) => {
        if (!psd) return;
        const selectedIdx = path[path.length - 1];
        const parentPath = path.slice(0, -1);

        // We need to apply multiple updates to the same PSD object
        // updateLayerByPath handles cloning, but doing it in a loop is inefficient
        // and can cause performance issues with deep trees.
        let currentPsd = psd;

        siblings.forEach((sibling: any, idx: number) => {
            const name = sibling.name || '';
            if (!name.startsWith('*')) return;

            const sibPath = [...parentPath, idx];
            const shouldHide = idx !== selectedIdx;

            // Only update if state actually changes
            if (sibling.hidden !== shouldHide) {
                currentPsd = updateLayerByPath(currentPsd, sibPath, (l) => ({ ...l, hidden: shouldHide }));
            }
        });

        if (currentPsd !== psd) {
            setPsd(currentPsd);
        }
    };

    // Returns the active flip suffix string based on current flip state
    const getFlipSuffix = (): string => {
        if (flipX && flipY) return ':flipxy';
        if (flipX) return ':flipx';
        if (flipY) return ':flipy';
        return '';
    };

    // Returns the base name (strips any :flip* suffix, match xy before x/y)
    const getBaseName = (name: string): string =>
        name.replace(/(:[Ff]lip(xy|x|y))$/i, '');

    // Check if a name ends with a flip suffix
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

                // Apply flip transform to the canvas context directly
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

                // ag-psd layers are stored Bottom-to-Top in the array (index 0 is the bottom layer).
                const drawLayers = (layers: any[]) => {
                    // Build a lookup: baseName -> flip-variant layer (if exists and matches current flip)
                    const flipVariantMap = new Map<string, any>();
                    if (flipSuffix) {
                        for (const l of layers) {
                            const n = (l.name || '').toLowerCase();
                            if (n.endsWith(flipSuffix)) {
                                const base = getBaseName(l.name || '');
                                flipVariantMap.set(base.toLowerCase(), l);
                            }
                        }
                    }

                    for (const layer of layers) {
                        if (layer.hidden) continue;

                        const name = layer.name || '';
                        // Skip flip-variant layers from normal rendering pass
                        if (hasFlipSuffix(name)) continue;

                        // Use the flip variant if available, otherwise use the base layer
                        const effectiveLayer = flipVariantMap.get(name.toLowerCase()) ?? layer;

                        if (effectiveLayer.children) {
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

    return (
        <div className={`psd-editor theme-${theme} ${isDragging ? 'is-dragging' : ''}`}>
            <div
                className="custom-title-bar"
                data-tauri-drag-region
                onMouseDown={(e) => {
                    // Start dragging on left-click only
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
                        <Layers size={16} className="text-muted" />
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
                                    // Hide flip-variant layers from the layer list only when flipEnabled
                                    if (flipEnabled && hasFlipSuffix(layer.name || '')) return null;
                                    return (
                                        <LayerItem
                                            key={originalIndex}
                                            layer={layer}
                                            path={[originalIndex]}
                                            siblings={psd.children!}
                                            radioEnabled={radioEnabled}
                                            lockedEnabled={lockedEnabled}
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

                <section className="preview-panel" ref={previewRef}>
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
                                        transformOrigin: '0 0',
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

            {notification && (
                <Toast
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
                />
            )}

            {/* Hidden canvas for saving if needed, but we use layer canvases */}
        </div>
    );
};

export default PsdEditor;
