import React from 'react';
import { X } from 'lucide-react';

interface FavoriteModalProps {
    favoriteDialog: { mode: 'create' | 'rename'; id?: string; value: string };
    closeFavoriteDialog: () => void;
    confirmFavoriteDialog: () => void;
    favoriteInputRef: React.RefObject<HTMLInputElement | null>;
    setFavoriteDialog: React.Dispatch<React.SetStateAction<{ mode: 'create' | 'rename'; id?: string; value: string } | null>>;
    L: any;
}

export const FavoriteModal: React.FC<FavoriteModalProps> = ({
    favoriteDialog, closeFavoriteDialog, confirmFavoriteDialog, favoriteInputRef, setFavoriteDialog, L
}) => {
    return (
        <div className="favorite-modal-overlay" onClick={closeFavoriteDialog} role="dialog" aria-modal="true" aria-labelledby="fav-modal-title">
            <div className="favorite-modal" onClick={e => e.stopPropagation()}>
                <div className="favorite-modal-header">
                    <span className="favorite-modal-title" id="fav-modal-title">
                        {favoriteDialog.mode === 'create' ? L.saveState : L.renameState}
                    </span>
                    <button 
                        className="favorite-modal-close" 
                        onClick={closeFavoriteDialog}
                        aria-label="Close dialog"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className="favorite-modal-body">
                    <div className="favorite-modal-label">
                        {favoriteDialog.mode === 'create' ? L.promptName : L.promptRename}
                    </div>
                    <input
                        ref={favoriteInputRef}
                        className="favorite-input"
                        value={favoriteDialog.value}
                        onChange={(e) => setFavoriteDialog(prev => prev ? { ...prev, value: e.target.value } : prev)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); confirmFavoriteDialog(); }
                            if (e.key === 'Escape') { e.preventDefault(); closeFavoriteDialog(); }
                        }}
                        aria-label="Favorite name"
                        autoFocus
                    />
                </div>
                <div className="favorite-modal-footer">
                    <button onClick={closeFavoriteDialog}>{L.cancel}</button>
                    <button 
                        className="btn-primary" 
                        onClick={confirmFavoriteDialog}
                        aria-label="Confirm"
                    >
                        {L.ok}
                    </button>
                </div>
            </div>
        </div>
    );
};
