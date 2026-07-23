import { memo } from 'react';
import { Eye, EyeOff, Folder as FolderIcon, Image as ImageIcon } from 'lucide-react';
import { SearchResult, PsdLayerNode } from '../types';

interface SearchResultRowProps {
    result: SearchResult;
    onToggle: (path: number[]) => void;
    onRadioSelect: (path: number[], siblings?: PsdLayerNode[]) => void;
    radioEnabled: boolean;
    lockedEnabled: boolean;
}

export const SearchResultRow = memo(({
    result, onToggle, onRadioSelect, radioEnabled, lockedEnabled,
}: SearchResultRowProps) => {
    const { layer, path, displayName, matchStart, matchEnd } = result;
    const hasChildren = !!(layer.children?.length);
    const depth = path.length - 1;

    const rawName = layer.name || '';
    const isRadio = radioEnabled && rawName.startsWith('*');
    const isLocked = lockedEnabled && rawName.startsWith('!');

    const handleClick = () => {
        if (isLocked) return;
        if (isRadio) onRadioSelect(path);
        else onToggle(path);
    };

    const highlighted = (
        <span>
            {displayName.slice(0, matchStart)}
            <mark className="search-highlight">{displayName.slice(matchStart, matchEnd)}</mark>
            {displayName.slice(matchEnd)}
        </span>
    );
    return (
        <div className="layer-item search-result-row" style={{ paddingLeft: 8 + depth * 12 }}>
            {depth > 0 && <span className="search-depth-hint" title={`depth ${depth}`}>{'›'.repeat(depth)}</span>}
            {!isLocked ? (
                <div className="visibility-toggle" onClick={handleClick} title={isRadio ? 'Select (radio)' : 'Toggle visibility'}>
                    {isRadio
                        ? <div className={`radio-indicator ${!layer.hidden ? 'active' : ''}`} />
                        : !layer.hidden
                            ? <Eye size={16} className="text-accent" />
                            : <EyeOff size={16} className="text-muted" />
                    }
                </div>
            ) : (
                <span className="visibility-locked" title="Visibility locked">
                    <Eye size={16} className="text-accent" style={{ opacity: 0.4 }} />
                </span>
            )}
            <div className="layer-preview-thumbnail">
                {hasChildren
                    ? <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
                    : layer._dataUrl
                        ? <img src={layer._dataUrl} alt="" className="layer-thumbnail-img" />
                        : <ImageIcon size={16} className="text-muted" />
                }
            </div>
            <span className="search-result-name">{highlighted}</span>
        </div>
    );
});