/**
 * Editor document model.
 *
 * All element coordinates are in PDF points (1/72 inch) in the *visual* page
 * space: origin at the top-left of the page as displayed (after any rotation),
 * y growing downwards. Export converts these into PDF user space.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';
export type TextAlign = 'left' | 'center' | 'right';

interface ElementBase extends Rect {
  id: string;
  /** Clockwise rotation in degrees around the element centre. */
  rotation: number;
  /** 0..1 */
  opacity: number;
}

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  fontFamily: FontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  color: string;
  /** Multiplier of font size. */
  lineHeight: number;
  /** Optional solid background behind the text (used when replacing existing text). */
  background: string | null;
  /** Horizontal glyph scaling (1 = normal). Used to match the width of replaced text. */
  hScale: number;
  /** When true the box grows with its content instead of wrapping (used for replaced lines). */
  autoWidth: boolean;
  /** Key of a document font to draw with (see pdf/embeddedFonts.ts); null for standard fonts. */
  embeddedFont: string | null;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  assetId: string;
}

export interface PathElement extends ElementBase {
  type: 'path';
  /** One or more strokes, each a flat list [x0, y0, x1, y1, ...] normalised to 0..1 within the bounding box. */
  strokes: number[][];
  strokeColor: string;
  strokeWidth: number;
  kind: 'ink' | 'signature';
}

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  strokeColor: string | null;
  strokeWidth: number;
  fillColor: string | null;
}

export interface LineElement extends ElementBase {
  type: 'line';
  /** Endpoints as fractions (0 or 1) of the bounding box. */
  start: Point;
  end: Point;
  strokeColor: string;
  strokeWidth: number;
  arrowEnd: boolean;
  arrowStart: boolean;
}

export type MarkupKind = 'highlight' | 'underline' | 'strikethrough';

export interface MarkupElement extends ElementBase {
  type: 'markup';
  kind: MarkupKind;
  color: string;
  /** Absolute rects on the page (one per text line). */
  rects: Rect[];
}

/** Opaque box used to cover/redact existing page content. */
export interface CoverElement extends ElementBase {
  type: 'cover';
  color: string;
}

export interface CheckboxElement extends ElementBase {
  type: 'checkbox';
  checked: boolean;
  style: 'check' | 'cross' | 'radio';
  color: string;
}

export type EditorElement =
  | TextElement
  | ImageElement
  | PathElement
  | ShapeElement
  | LineElement
  | MarkupElement
  | CoverElement
  | CheckboxElement;

export type ElementType = EditorElement['type'];

export interface PageSourceRef {
  sourceId: string;
  /** Zero-based page index in the source PDF. */
  pageIndex: number;
}

/** Original text-showing operators blanked out of a page's content stream. */
export interface TextRemoval {
  id: string;
  ops: { ordinal: number; adjust: number }[];
}

export interface EditorPage {
  id: string;
  /** null for blank pages created in the editor. */
  source: PageSourceRef | null;
  /** /Rotate value of the source page. */
  baseRotation: number;
  /** Additional rotation applied by the user (multiple of 90). */
  rotation: number;
  /** CropBox of the source page in user space: [x0, y0, x1, y1]. */
  view: [number, number, number, number];
  elements: EditorElement[];
  removals: TextRemoval[];
}

export type Tool =
  | 'select'
  | 'text'
  | 'edit-text'
  | 'draw'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'cover'
  | 'checkbox';

export interface ToolSettings {
  strokeColor: string;
  strokeWidth: number;
  fillColor: string | null;
  highlightColor: string;
  textColor: string;
  fontFamily: FontFamily;
  fontSize: number;
  coverColor: string;
}

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

export interface SearchMatch {
  pageIndex: number;
  rects: Rect[];
  excerpt: string;
}

export interface SearchState {
  open: boolean;
  query: string;
  matches: SearchMatch[];
  current: number;
  searching: boolean;
}

export type LoadStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface EditorState {
  status: LoadStatus;
  loadProgress: number;
  error: string | null;
  fileName: string;
  /** True once the user has renamed the document; exports then use the name as-is. */
  renamed: boolean;
  pages: EditorPage[];
  selectedIds: string[];
  editingId: string | null;
  currentPage: number;
  tool: Tool;
  toolSettings: ToolSettings;
  zoomMode: ZoomMode;
  zoom: number;
  containerSize: { width: number; height: number };
  sidebarOpen: boolean;
  search: SearchState;
  undoStack: EditorPage[][];
  redoStack: EditorPage[][];
  clipboard: EditorElement[];
  exporting: boolean;
  /** Transient UI notice. */
  notice: { id: number; message: string; kind: 'info' | 'error' } | null;
  /** Set when the original file cannot be re-written and export must be flattened. */
  flattenOnExport: boolean;
}
