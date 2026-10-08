import { useEditor } from '../editor/store';
import { Icon } from './Icons';

export function EmptyState({ onOpen, dragging }: { onOpen: () => void; dragging: boolean }) {
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  return (
    <div className={`empty${dragging ? ' is-dragging' : ''}`}>
      <div className="empty-card">
        <div className="empty-icon">
          <Icon name="file" size={44} />
        </div>
        <h1>Edit PDFs in your browser</h1>
        <p className="empty-lead">
          Add text, images, drawings, highlights, shapes and signatures (drawn or from a photo), rearrange pages, then download the result.
          Everything runs on your device. Your files are never uploaded.
        </p>
        <button type="button" className="btn-primary btn-large" onClick={onOpen} autoFocus>
          <Icon name="upload" size={18} /> Open a PDF
        </button>
        <p className="empty-drop">or drop a PDF anywhere on this page</p>
        {status === 'error' && error && (
          <p className="form-error">
            <Icon name="warning" size={14} /> {error}
          </p>
        )}
        <ul className="empty-features">
          <li><Icon name="lock" size={14} /> 100% private, works offline</li>
          <li><Icon name="text" size={14} /> Add and replace text</li>
          <li><Icon name="image" size={14} /> Images &amp; signatures</li>
          <li><Icon name="highlighter" size={14} /> Highlight &amp; annotate</li>
          <li><Icon name="duplicate" size={14} /> Reorder, rotate, delete pages</li>
          <li><Icon name="download" size={14} /> No watermark, no sign-up</li>
        </ul>
      </div>
    </div>
  );
}
