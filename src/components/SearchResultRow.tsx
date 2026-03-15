import { memo } from 'react';
import { Eye, EyeOff, Folder as FolderIcon, Image as ImageIcon } from 'lucide-react';
import { SearchResult } from '../types';

interface SearchResultRowProps {
    result: SearchResult;
    onToggle: (path: number[]) => void;
}

export const SearchResultRow = memo(({ result, onToggle }: SearchResultRowProps) => {
    const { layer, path, displayName, matchStart, matchEnd } = result;
    const hasChildren = !!(layer.children?.length);
    const depth = path.length - 1;
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
            <div className="visibility-toggle" onClick={() => onToggle(path)} title="Toggle visibility">
                {!layer.hidden ? <Eye size={16} className="text-accent" /> : <EyeOff size={16} className="text-muted" />}
            </div>
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
