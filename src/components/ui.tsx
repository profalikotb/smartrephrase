"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "cta" | "ghost" | "soft" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[var(--shadow)] disabled:opacity-45",
  cta: "bg-cta text-white font-semibold hover:brightness-110 active:scale-[0.98] disabled:opacity-50",
  ghost: "text-ink hover:bg-surface-2 active:bg-line/60 disabled:opacity-40",
  soft: "bg-accent-soft text-accent hover:brightness-[0.97] dark:hover:brightness-110 disabled:opacity-45",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-45",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode; compact?: boolean; iconOnly?: boolean; /** Label visible from `sm` up; icon-only (label kept for screen readers) on phones. */ collapseLabel?: boolean }>(
  function Button({ variant = "ghost", icon, compact, iconOnly, collapseLabel, className = "", children, type = "button", ...rest }, ref) {
    const size = iconOnly ? "h-9 w-9 justify-center" : compact ? `h-8 px-2.5 text-[13px] ${collapseLabel ? "max-sm:h-9 max-sm:w-9 max-sm:justify-center max-sm:px-0" : ""}` : "h-10 px-3.5 text-sm";
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex shrink-0 select-none items-center gap-1.5 rounded-lg font-medium transition-[background,filter,opacity] duration-150 disabled:cursor-not-allowed ${size} ${VARIANTS[variant]} ${className}`}
        {...rest}
      >
        {icon}
        {iconOnly ? <span className="sr-only">{children}</span> : collapseLabel ? <span className="max-sm:sr-only">{children}</span> : children}
      </button>
    );
  },
);

export function Select<T extends string>({ label, value, onChange, options, id, className = "" }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; id: string; className?: string }) {
  return (
    <label htmlFor={id} className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="h-9 w-full min-w-0 appearance-none rounded-lg border border-line bg-surface ps-3 pe-8 text-sm text-ink transition-colors hover:border-muted/50 focus-visible:border-accent"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ label, value, onChange, options, name }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar flex min-w-0 gap-0.5 overflow-x-auto rounded-xl border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            name={name}
            onClick={() => onChange(o.value)}
            className={`tap h-8 shrink-0 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium transition-colors ${active ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={`flex items-start justify-between gap-4 py-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-10 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform [inset-inline-start:2px] peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
      </span>
    </label>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "info" | "success" | "source" }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border-line",
    accent: "bg-accent-soft text-accent border-transparent",
    info: "bg-info-soft text-info border-transparent",
    success: "bg-success-soft text-success border-transparent",
    source: "bg-source-soft text-source border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
  };
  return <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11.5px] font-medium ${tones[tone]}`}>{children}</span>;
}

/** Tap-friendly single-choice chips — used in the mobile settings sheet instead of dropdowns. */
export function ChipGroup<T extends string>({ label, value, onChange, options, name }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              name={name}
              onClick={() => onChange(o.value)}
              className={`tap h-9 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors ${active ? "border-transparent bg-brand text-white shadow-sm" : "border-line bg-surface text-ink hover:border-accent/50 hover:bg-accent-soft"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
