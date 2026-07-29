import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { MonoLabel } from "./mono";

/** Shared control chrome: square, hairline, amp-yellow focus, no radius. */
const control =
  "w-full border border-hairline-soft bg-void px-3 py-2 font-mono text-[13px] text-bone placeholder:text-slate transition-colors duration-150 hover:border-hairline focus:border-amp focus:outline-none disabled:opacity-40";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
  required,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5">
        <MonoLabel>{label}</MonoLabel>
        {required ? (
          <span className="text-[10px] leading-none text-amp" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-alarm">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] leading-relaxed text-slate">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(control, "resize-y leading-relaxed", className)} {...rest} />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        control,
        "appearance-none bg-[length:10px] bg-[right_0.75rem_center] bg-no-repeat pr-9 uppercase tracking-[0.1em]",
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'><path d='M0 0l5 6 5-6z' fill='%236b7d72'/></svg>\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

/**
 * Switch — a square sliding toggle. Rendered as a real checkbox so it submits
 * with the form and keeps native keyboard behaviour.
 */
export function Switch({
  label,
  hint,
  name,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  name?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-3",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span className="relative mt-0.5 inline-flex h-4 w-8 shrink-0 border border-hairline bg-void transition-colors group-has-checked:border-amp group-has-checked:bg-amp/20">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="peer absolute inset-0 cursor-pointer appearance-none"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-px top-px size-3 bg-slate transition-transform duration-150 ease-[var(--ease-instrument)] peer-checked:translate-x-4 peer-checked:bg-amp"
        />
      </span>
      <span className="flex flex-col gap-1">
        <MonoLabel tone="bone">{label}</MonoLabel>
        {hint ? (
          <span className="text-[12px] leading-relaxed text-slate">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

/** Inline form-level error banner. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="border border-alarm/40 bg-alarm/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-alarm">
      {children}
    </div>
  );
}
