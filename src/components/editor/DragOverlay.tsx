import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Translations } from '../../constants/translations';

interface DragOverlayProps {
    L: Translations;
}

export const DragOverlay: React.FC<DragOverlayProps> = ({ L }) => {
    return (
        <div className="drag-overlay">
            <div className="drag-message">
                <div className="overlay-icon-ring"><ImageIcon size={48} /></div>
                <div className="overlay-text">
                    <h3>{L.dragDrop}</h3>
                    <p>{L.dragRelease}</p>
                </div>
            </div>
        </div>
    );
};
