import type { ReactElement, SVGProps } from 'react';

type IconName =
  | 'cursor' | 'text' | 'edit-text' | 'pen' | 'highlighter' | 'square' | 'circle' | 'line' | 'arrow'
  | 'image' | 'signature' | 'checkbox' | 'cover' | 'undo' | 'redo' | 'zoom-in' | 'zoom-out' | 'search'
  | 'sidebar' | 'download' | 'upload' | 'close' | 'trash' | 'copy' | 'rotate-left' | 'rotate-right'
  | 'plus' | 'more' | 'chevron-down' | 'chevron-up' | 'bold' | 'italic' | 'underline' | 'strikethrough'
  | 'align-left' | 'align-center' | 'align-right' | 'front' | 'back' | 'check' | 'file' | 'lock'
  | 'shapes' | 'extract' | 'duplicate' | 'fit-width' | 'fit-page' | 'warning' | 'eraser' | 'drag'
  | 'rotate' | 'sun' | 'moon';

const paths: Record<IconName, ReactElement> = {
  cursor: <path d="M5 3l14 8-6.5 1.5L10 19 5 3z" />,
  text: <><path d="M4 6V4h16v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>,
  'edit-text': <><path d="M4 6V4h12v2" /><path d="M10 4v14" /><path d="M8 18h4" /><path d="M20 10l-6 6-2 .5.5-2 6-6 1.5 1.5z" /></>,
  pen: <><path d="M3 21s3-1 5-3L19 7a2.1 2.1 0 0 0-3-3L5 15c-2 2-2 6-2 6z" /><path d="M14 6l3 3" /></>,
  highlighter: <><path d="M9 11l-6 6v3h9l3-3" /><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>,
  square: <rect x="4" y="4" width="16" height="16" rx="1.5" />,
  circle: <circle cx="12" cy="12" r="8.5" />,
  line: <path d="M5 19L19 5" />,
  arrow: <><path d="M5 19L19 5" /><path d="M10 5h9v9" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-9 9" /></>,
  signature: <><path d="M3 17c3-6 5-9 6-9s0 8 2 8 3-6 4-6 1 4 3 4 3-2 3-2" /><path d="M3 21h18" /></>,
  checkbox: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 12l3 3 5-6" /></>,
  cover: <><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3 9l6 6M3 15l12-12M9 19l12-12M15 19l6-6" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>,
  'zoom-in': <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></>,
  'zoom-out': <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  download: <><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" /></>,
  upload: <><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M4 21h16" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  'rotate-left': <><path d="M3 4v6h6" /><path d="M3.5 14a9 9 0 1 0 2-9.4L3 10" /></>,
  'rotate-right': <><path d="M21 4v6h-6" /><path d="M20.5 14a9 9 0 1 1-2-9.4L21 10" /></>,
  rotate: <><path d="M21 4v6h-6" /><path d="M20.5 14a9 9 0 1 1-2-9.4L21 10" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /></>,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  bold: <><path d="M7 4h6a4 4 0 0 1 0 8H7z" /><path d="M7 12h7a4 4 0 0 1 0 8H7z" /></>,
  italic: <><path d="M19 4h-9M14 20H5M15 4L9 20" /></>,
  underline: <><path d="M6 4v6a6 6 0 0 0 12 0V4" /><path d="M4 20h16" /></>,
  strikethrough: <><path d="M16 4H9a3 3 0 0 0-2.8 4" /><path d="M14 12a4 4 0 0 1 1.3 7.8A4 4 0 0 1 8 18" /><path d="M4 12h16" /></>,
  'align-left': <path d="M4 6h16M4 12h10M4 18h14" />,
  'align-center': <path d="M4 6h16M7 12h10M5 18h14" />,
  'align-right': <path d="M4 6h16M10 12h10M6 18h14" />,
  front: <><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M4 16V5a1 1 0 0 1 1-1h11" /></>,
  back: <><rect x="4" y="4" width="12" height="12" rx="1.5" /><path d="M20 8v11a1 1 0 0 1-1 1H8" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  shapes: <><rect x="3" y="12" width="9" height="9" rx="1" /><circle cx="16.5" cy="7.5" r="4.5" /></>,
  extract: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 11v6M9 14l3 3 3-3" /></>,
  duplicate: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 4H6a2 2 0 0 0-2 2v10" /><path d="M14 11v6M11 14h6" /></>,
  'fit-width': <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 12h10M9 9l-3 3 3 3M15 9l3 3-3 3" /></>,
  'fit-page': <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 8h8v8H8z" /></>,
  warning: <><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 18h.01" /></>,
  eraser: <><path d="M7 21l-4-4 11-11 6 6-9 9z" /><path d="M5 11l8 8" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  drag: <><circle cx="9" cy="6" r="1.2" fill="currentColor" /><circle cx="15" cy="6" r="1.2" fill="currentColor" /><circle cx="9" cy="12" r="1.2" fill="currentColor" /><circle cx="15" cy="12" r="1.2" fill="currentColor" /><circle cx="9" cy="18" r="1.2" fill="currentColor" /><circle cx="15" cy="18" r="1.2" fill="currentColor" /></>,
};

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

export type { IconName };
