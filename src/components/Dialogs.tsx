import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icons';

export function Modal({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={{ width }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="tbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function PasswordDialog({
  fileName,
  incorrect,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  incorrect: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <Modal title="Password required" onClose={onCancel} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
      >
        <p className="modal-text">
          <Icon name="lock" size={16} /> <strong>{fileName}</strong> is protected. Enter its password to open it. The password never leaves your browser.
        </p>
        <input className="text-input" type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Password" placeholder="Password" />
        {incorrect && <p className="form-error">Incorrect password. Try again.</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!value}>Open</button>
        </div>
      </form>
    </Modal>
  );
}

export interface ChoiceOption {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

export function ChoiceDialog({
  title,
  message,
  options,
  onChoose,
}: {
  title: string;
  message: ReactNode;
  options: ChoiceOption[];
  onChoose: (value: string | null) => void;
}) {
  return (
    <Modal title={title} onClose={() => onChoose(null)} width={420}>
      <p className="modal-text">{message}</p>
      <div className="modal-actions">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.primary ? 'btn-primary' : o.danger ? 'btn btn-danger' : 'btn'}
            onClick={() => onChoose(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
