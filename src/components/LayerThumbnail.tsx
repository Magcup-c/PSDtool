import { memo } from 'react';
import { Image as ImageIcon, Folder as FolderIcon } from 'lucide-react';

interface LayerThumbnailProps {
    dataUrl?: string | null;
    hasChildren: boolean;
}

export const LayerThumbnail = memo(({ dataUrl, hasChildren }: LayerThumbnailProps) => (
    <div className="layer-preview-thumbnail">
        {dataUrl
            ? <img src={dataUrl} alt="" className="layer-thumbnail-img" />
            : hasChildren
                ? <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
                : <ImageIcon size={16} className="text-muted" />
        }
    </div>
));
