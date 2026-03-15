import React, { memo, useCallback } from 'react';
import { Eye, EyeOff, ChevronDown, ChevronRight, Trash2, GripVertical } from 'lucide-react';
import { DropTargetInfo } from '../types';
import { LayerThumbnail } from './LayerThumbnail';

interface LayerItemProps {
    layer: any;
    path: number[];
    siblings: any[];
    radioEnabled: boolean;
    lockedEnabled: boolean;
    flipEnabled: boolean;
    isClosed: boolean;
    isChildClosed: (k: string) => boolean;
    onToggleExpand: (key: string) => void;
    onToggle: (path: number[]) => void;
    onRename: (path: number[], newName: string) => void;
    onRadioSelect: (path: number[], siblings: any[]) => void;
    onDelete: (path: number[]) => void;
    onDragStart: (e: React.MouseEvent, path: number[]) => void;
    draggingPath: number[] | null;
    dropTarget: DropTargetInfo | null;
    hasFlipSuffix: (name: string) => boolean;
}

export const LayerItem = memo(({
    layer, path, siblings, radioEnabled, lockedEnabled, flipEnabled,
    isClosed, isChildClosed, onToggleExpand, onToggle, onRename, onRadioSelect,
    onDelete, onDragStart, draggingPath, dropTarget, hasFlipSuffix,
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
        e.stopPropagation(); onDelete(path);
    }, [onDelete, path]);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        (document.activeElement as HTMLElement)?.blur();
        onDragStart(e, path);
    }, [onDragStart, path]);

    return (
        <li className="layer-node">
            {isDropBefore && <div className="drop-indicator" />}
            <div
                className={['layer-item', isLocked ? 'layer-locked' : '', isRadio ? 'layer-radio' : '',
                    isDraggingThis ? 'layer-dragging' : '', isDropInside ? 'layer-drop-inside' : ''].filter(Boolean).join(' ')}
                data-path={key}
                data-group={hasChildren ? 'true' : 'false'}
                onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if ((e.target as HTMLElement).tagName !== 'INPUT') (document.activeElement as HTMLElement)?.blur(); }}
            >
                <span className="drag-handle" onMouseDown={handleDragStart} title="Drag to reorder"><GripVertical size={12} /></span>
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
                <LayerThumbnail dataUrl={layer._dataUrl} hasChildren={hasChildren} />
                <input
                    type="text" className="layer-name-input"
                    value={displayName} onChange={handleRename}
                    placeholder={hasChildren ? 'New Group' : 'New Layer'}
                />
                <button
                    className="layer-delete-btn" onClick={handleDelete} title="Delete layer"
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); (document.activeElement as HTMLElement)?.blur(); }}
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
                        if (flipEnabled && hasFlipSuffix(child.name || '')) return null;
                        return (
                            <LayerItem
                                key={childKey} layer={child} path={childPath} siblings={layer.children}
                                radioEnabled={radioEnabled} lockedEnabled={lockedEnabled} flipEnabled={flipEnabled}
                                isClosed={isChildClosed(childKey)} isChildClosed={isChildClosed}
                                onToggleExpand={onToggleExpand} onToggle={onToggle} onRename={onRename}
                                onRadioSelect={onRadioSelect} onDelete={onDelete} onDragStart={onDragStart}
                                draggingPath={draggingPath} dropTarget={dropTarget} hasFlipSuffix={hasFlipSuffix}
                            />
                        );
                    })}
                </ul>
            )}
        </li>
    );
}, (prev, next) =>
    prev.layer === next.layer &&
    prev.isClosed === next.isClosed &&
    prev.radioEnabled === next.radioEnabled &&
    prev.lockedEnabled === next.lockedEnabled &&
    prev.flipEnabled === next.flipEnabled &&
    prev.draggingPath === next.draggingPath &&
    prev.dropTarget === next.dropTarget
);
