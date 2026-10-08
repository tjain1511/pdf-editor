import { useEditor } from '../editor/store';
import { Icon } from './Icons';

export function Notice() {
  const notice = useEditor((s) => s.notice);
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.kind}`} role="status" aria-live="polite">
      {notice.kind === 'error' ? <Icon name="warning" size={16} /> : <Icon name="check" size={16} />}
      <span>{notice.message}</span>
    </div>
  );
}

export function LoadingOverlay() {
  const status = useEditor((s) => s.status);
  const progress = useEditor((s) => s.loadProgress);
  const exporting = useEditor((s) => s.exporting);
  if (status !== 'loading' && !exporting) return null;
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="spinner" />
        <span>{exporting ? 'Building your PDF…' : progress > 0 && progress < 1 ? `Opening… ${Math.round(progress * 100)}%` : 'Opening PDF…'}</span>
      </div>
    </div>
  );
}
