import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

interface ToastProps {
    message: string;
    type: 'success' | 'error';
    onClose: () => void;
}

export const Toast = ({ message, type, onClose }: ToastProps) => {
    useEffect(() => {
        const t = setTimeout(onClose, 5000);
        return () => clearTimeout(t);
    }, [onClose]);

    return (
        <div className={`toast-notification ${type}`}>
            <span className="toast-icon" style={{ flexShrink: 0 }}>
                {type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            </span>
            <span className="toast-message">{message}</span>
            <button onClick={onClose} className="toast-close" style={{ flexShrink: 0 }}>
                <X size={14} />
            </button>
        </div>
    );
};