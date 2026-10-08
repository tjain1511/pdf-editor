/** Small reusable form controls used by the toolbar and context bar. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from './Popover';
import { Icon, type IconName } from './Icons';

export function ToolButton({
  icon,
  label,
  active,
  onClick,
  disabled,
  shortcut,
  children,
  className,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  shortcut?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`tbtn${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}

export function ColorSwatch({
  value,
  onChange,
  label,
  allowNone,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  allowNone?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className="swatch-wrap" title={label}>
      <button
        type="button"
        className={`swatch${value ? '' : ' is-none'}`}
        style={value ? { background: value } : undefined}
        aria-label={label}
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="color"
        value={value ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        tabIndex={-1}
      />
      {allowNone && (
        <button
          type="button"
          className={`swatch-none${value ? '' : ' is-active'}`}
          title="No fill"
          aria-label="No fill"
          onClick={() => onChange(null)}
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
  width = 56,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  suffix?: string;
  width?: number;
}) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    else setText(String(round(value)));
  };
  return (
    <label className="numfield" title={label} style={{ width }}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, round(value + step))); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, round(value - step))); }
        }}
      />
      {suffix && <span className="numfield-suffix">{suffix}</span>}
    </label>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span className="select-wrap">
      <select value={value} aria-label={label} title={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} />
    </span>
  );
}

export function Divider() {
  return <span className="tdivider" role="separator" />;
}

/** Popover menu anchored to its trigger; rendered in a portal so it is never clipped. */
export function Menu({
  trigger,
  children,
  align = 'left',
  label = 'Menu',
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    // Hand focus back to the trigger when the menu had it.
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest('.popover')) anchorRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, []);
  return (
    <>
      <div
        className="menu-wrap"
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger(open)}
      </div>
      {open && (
        <Popover anchorRef={anchorRef} align={align} onClose={close} className="menu" label={label}>
          {children(close)}
        </Popover>
      )}
    </>
  );
}

export function MenuItem({
  icon,
  label,
  onClick,
  shortcut,
  active,
  danger,
  disabled,
}: {
  icon?: IconName;
  label: string;
  onClick: () => void;
  shortcut?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className={`menu-item${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={16} />}
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
