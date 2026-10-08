import { useMemo } from 'react';
import {
  effectiveZoom,
  openSearch,
  redo,
  setTool,
  setZoom,
  setZoomMode,
  toggleSidebar,
  undo,
  zoomBy,
  exportDocument,
  closeSearch,
} from '../editor/actions';
import { useEditor } from '../editor/store';
import type { Tool } from '../editor/types';
import { modKey } from '../editor/interaction';
import { toggleTheme, useTheme } from '../editor/theme';
import { Icon, type IconName } from './Icons';
import { Divider, Menu, MenuItem, ToolButton } from './controls';
import { DocumentName } from './DocumentName';

const SHAPE_TOOLS: { tool: Tool; icon: IconName; label: string; shortcut: string }[] = [
  { tool: 'rect', icon: 'square', label: 'Rectangle', shortcut: 'R' },
  { tool: 'ellipse', icon: 'circle', label: 'Ellipse', shortcut: 'O' },
  { tool: 'line', icon: 'line', label: 'Line', shortcut: 'L' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow', shortcut: 'A' },
];

export function Toolbar({
  onOpen,
  onInsertImage,
  onSignature,
}: {
  onOpen: () => void;
  onInsertImage: () => void;
  onSignature: () => void;
}) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.undoStack.length > 0);
  const canRedo = useEditor((s) => s.redoStack.length > 0);
  const zoom = useEditor((s) => effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize));
  const zoomMode = useEditor((s) => s.zoomMode);
  const sidebarOpen = useEditor((s) => s.sidebarOpen);
  const searchOpen = useEditor((s) => s.search.open);
  const exporting = useEditor((s) => s.exporting);
  const hasDoc = useEditor((s) => s.status === 'ready' && s.pages.length > 0);
  const theme = useTheme();

  const activeShape = useMemo(() => SHAPE_TOOLS.find((s) => s.tool === tool) ?? SHAPE_TOOLS[0], [tool]);
  const shapeActive = SHAPE_TOOLS.some((s) => s.tool === tool);

  return (
    <header className="toolbar" role="toolbar" aria-label="Editor toolbar">
      <div className="toolbar-group toolbar-brand">
        <ToolButton icon="sidebar" label="Toggle page sidebar" active={sidebarOpen} onClick={toggleSidebar} shortcut={`${modKey}+\\`} />
        <button type="button" className="brand" onClick={onOpen} title="Open a PDF" aria-label="Open a PDF">
          <Icon name="file" size={18} />
          {!hasDoc && <span className="brand-name">PDF Editor</span>}
        </button>
        {hasDoc && <DocumentName />}
      </div>

      <div className="toolbar-group toolbar-tools">
        <ToolButton icon="cursor" label="Select" shortcut="V" active={tool === 'select'} onClick={() => setTool('select')} disabled={!hasDoc} />
        <ToolButton icon="text" label="Add text" shortcut="T" active={tool === 'text'} onClick={() => setTool('text')} disabled={!hasDoc} />
        <ToolButton icon="edit-text" label="Edit existing text" shortcut="E" active={tool === 'edit-text'} onClick={() => setTool('edit-text')} disabled={!hasDoc} />
        <Divider />
        <ToolButton icon="pen" label="Draw" shortcut="P" active={tool === 'draw'} onClick={() => setTool('draw')} disabled={!hasDoc} />
        <ToolButton icon="highlighter" label="Highlight" shortcut="H" active={tool === 'highlight'} onClick={() => setTool('highlight')} disabled={!hasDoc} />
        <Menu
          trigger={(open) => (
            <ToolButton icon={activeShape.icon} label="Shapes" active={shapeActive || open} disabled={!hasDoc} className="has-caret">
              <Icon name="chevron-down" size={10} className="caret" />
            </ToolButton>
          )}
        >
          {(close) => (
            <>
              {SHAPE_TOOLS.map((s) => (
                <MenuItem key={s.tool} icon={s.icon} label={s.label} shortcut={s.shortcut} active={tool === s.tool} onClick={() => { setTool(s.tool); close(); }} />
              ))}
            </>
          )}
        </Menu>
        <Divider />
        <ToolButton icon="image" label="Insert image" shortcut="I" onClick={onInsertImage} disabled={!hasDoc} />
        <ToolButton icon="signature" label="Add signature" shortcut="S" onClick={onSignature} disabled={!hasDoc} />
        <ToolButton icon="checkbox" label="Checkbox" shortcut="K" active={tool === 'checkbox'} onClick={() => setTool('checkbox')} disabled={!hasDoc} />
        <ToolButton icon="cover" label="Cover / redact area" shortcut="X" active={tool === 'cover'} onClick={() => setTool('cover')} disabled={!hasDoc} />
      </div>

      <div className="toolbar-group toolbar-right">
        <ToolButton icon="undo" label="Undo" shortcut={`${modKey}+Z`} onClick={undo} disabled={!canUndo} />
        <ToolButton icon="redo" label="Redo" shortcut={`${modKey}+Shift+Z`} onClick={redo} disabled={!canRedo} />
        <Divider />
        <ToolButton icon="zoom-out" label="Zoom out" shortcut={`${modKey}+-`} onClick={() => zoomBy(-1, zoom)} disabled={!hasDoc} />
        <Menu
          align="right"
          trigger={() => (
            <button type="button" className="zoom-label" title="Zoom" disabled={!hasDoc}>
              {Math.round(zoom * 100)}%
              <Icon name="chevron-down" size={12} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon="fit-width" label="Fit width" shortcut={`${modKey}+0`} active={zoomMode === 'fit-width'} onClick={() => { setZoomMode('fit-width'); close(); }} />
              <MenuItem icon="fit-page" label="Fit page" shortcut={`${modKey}+9`} active={zoomMode === 'fit-page'} onClick={() => { setZoomMode('fit-page'); close(); }} />
              <div className="menu-sep" />
              {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => (
                <MenuItem key={z} label={`${z * 100}%`} active={zoomMode === 'custom' && Math.abs(zoom - z) < 0.001} onClick={() => { setZoom(z); close(); }} />
              ))}
            </>
          )}
        </Menu>
        <ToolButton icon="zoom-in" label="Zoom in" shortcut={`${modKey}+=`} onClick={() => zoomBy(1, zoom)} disabled={!hasDoc} />
        <Divider />
        <ToolButton icon="search" label="Search text" shortcut={`${modKey}+F`} active={searchOpen} onClick={() => (searchOpen ? closeSearch() : openSearch())} disabled={!hasDoc} />
        <ToolButton icon="upload" label="Open PDF" shortcut={`${modKey}+O`} onClick={onOpen} />
        <ToolButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme} />
        <button type="button" className="btn-primary" onClick={() => exportDocument()} disabled={!hasDoc || exporting} title={`Download edited PDF (${modKey}+S)`}>
          <Icon name="download" size={16} />
          <span>{exporting ? 'Exporting…' : 'Download'}</span>
        </button>
      </div>
    </header>
  );
}
