import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
    /** 'danger' = red (default for destructive), 'warning' = amber */
    variant?: 'danger' | 'warning';
}

export const ConfirmModal = ({
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    variant = 'warning',
}: ConfirmModalProps) => {
    const cancelBtnRef = useRef<HTMLButtonElement>(null);

    // Focus cancel button on open for safe default
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => cancelBtnRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Keyboard shortcuts
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); onConfirm(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, onCancel, onConfirm]);

    if (!isOpen) return null;

    return (
        <div
            className={`confirm-overlay-v2`}
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title-v2"
        >
            <div
                className={`confirm-modal-v2 confirm-modal-v2--${variant}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Icon */}
                <div className="confirm-modal-v2__icon-wrap">
                    <AlertTriangle size={22} strokeWidth={1.8} />
                </div>

                {/* Header */}
                <div className="confirm-modal-v2__header">
                    <span className="confirm-modal-v2__title" id="confirm-modal-title-v2">
                        {title}
                    </span>
                    <button
                        className="confirm-modal-v2__close"
                        onClick={onCancel}
                        aria-label="Close"
                    >
                        <X size={13} />
                    </button>
                </div>

                {/* Message */}
                <p className="confirm-modal-v2__message">{message}</p>

                {/* Hint */}
                <p className="confirm-modal-v2__hint">
                    Ctrl+Enter で確定 / Esc でキャンセル
                </p>

                {/* Footer */}
                <div className="confirm-modal-v2__footer">
                    <button
                        ref={cancelBtnRef}
                        className="confirm-modal-v2__btn confirm-modal-v2__btn--cancel"
                        type="button"
                        onClick={onCancel}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        className={`confirm-modal-v2__btn confirm-modal-v2__btn--confirm confirm-modal-v2__btn--${variant}`}
                        type="button"
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
