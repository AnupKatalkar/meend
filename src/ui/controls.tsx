import { useId, useState } from "react";
import type { ReactNode } from "react";

/** Shared form primitives. Every one renders a real, labelled, focusable
 *  control -- no div-with-onclick anywhere, so keyboard reach is free. */

/**
 * The "i" beside a setting's label.
 *
 * A disclosure rather than a hover tooltip: hover tooltips are unreachable by
 * keyboard and invisible on touch, and this panel is meant to be usable while
 * you are playing with both hands in the air. Clicking toggles the text and
 * leaves it open until dismissed.
 */
function InfoButton({
  label,
  open,
  onToggle,
  controls,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      // The bare glyph means nothing to a screen reader on its own.
      aria-label={`What does "${label}" do?`}
      title={`What does "${label}" do?`}
      className={[
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold leading-none transition-colors",
        open
          ? "border-[var(--color-neon)] bg-[var(--color-neon)]/20 text-[var(--color-neon)]"
          : "border-[var(--color-edge)] text-[var(--color-muted)] hover:border-[var(--color-neon)]/60 hover:text-[var(--color-text)]",
      ].join(" ")}
    >
      i
    </button>
  );
}

function InfoText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className="rounded-md border border-[var(--color-neon)]/25 bg-[var(--color-neon)]/5 px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-muted)]"
    >
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  info,
  group = false,
  children,
}: {
  label: string;
  /** Short status text, always visible. For dynamic things worth seeing. */
  hint?: string;
  /** Explanation revealed by the "i" button. For anything a newcomer needs. */
  info?: string;
  /**
   * True when the control is a radiogroup rather than a single form element.
   * A `<label for>` pointing at a group is dangling, so the label becomes a
   * span and the id is handed over for `aria-labelledby` instead.
   */
  group?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  const infoId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {group ? (
          <span id={id} className="text-xs font-medium tracking-wide text-[var(--color-muted)]">
            {label}
          </span>
        ) : (
          <label htmlFor={id} className="text-xs font-medium tracking-wide text-[var(--color-muted)]">
            {label}
          </label>
        )}
        {info && (
          <InfoButton
            label={label}
            open={open}
            onToggle={() => setOpen((v) => !v)}
            controls={infoId}
          />
        )}
      </div>
      {info && open && <InfoText id={infoId}>{info}</InfoText>}
      {children(id)}
      {hint && <p className="text-[11px] leading-snug text-[var(--color-muted)]/75">{hint}</p>}
    </div>
  );
}

export function Select<T extends string | number>({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  const isNumeric = typeof value === "number";
  return (
    <select
      id={id}
      value={String(value)}
      onChange={(e) => onChange((isNumeric ? Number(e.target.value) : e.target.value) as T)}
      className="w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-soft)] px-3 py-2 text-sm text-[var(--color-text)]"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--color-muted)]">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  info,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  info?: string;
}) {
  const id = useId();
  const infoId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-sm text-[var(--color-text)]">
            {label}
          </label>
          {info && (
            <InfoButton
              label={label}
              open={open}
              onToggle={() => setOpen((v) => !v)}
              controls={infoId}
            />
          )}
        </div>
        {info && open && <InfoText id={infoId}>{info}</InfoText>}
        {hint && <p className="text-[11px] leading-snug text-[var(--color-muted)]/75">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          "mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors",
          checked
            ? "border-[var(--color-neon)] bg-[var(--color-neon)]/30"
            : "border-[var(--color-edge)] bg-[var(--color-ink-soft)]",
        ].join(" ")}
      >
        <span
          className={[
            "block h-4.5 w-4.5 rounded-full bg-[var(--color-text)] transition-transform",
            checked ? "translate-x-5.5" : "translate-x-0.5",
          ].join(" ")}
          style={{ height: "1.125rem", width: "1.125rem" }}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  labelledBy,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  label: string;
  /** Id of a visible label. Takes precedence over `label`, so the group is
   *  not announced twice when it already sits under a Field heading. */
  labelledBy?: string;
}) {
  return (
    <div
      role="radiogroup"
      {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": label })}
      className="grid gap-1 rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-soft)] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={[
            "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-[var(--color-neon)]/20 text-[var(--color-neon)]"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary:
      "bg-[var(--color-neon)] text-[#04121a] hover:brightness-110 font-semibold",
    secondary:
      "border border-[var(--color-edge)] bg-[var(--color-panel)] text-[var(--color-text)] hover:border-[var(--color-neon)]/60",
    ghost: "text-[var(--color-muted)] hover:text-[var(--color-text)]",
    danger: "border border-[#ff6b6b]/50 text-[#ff9d9d] hover:bg-[#ff6b6b]/10",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
      {children}
    </h3>
  );
}
