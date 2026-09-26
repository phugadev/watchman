import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { MonoLabel } from "./mono";

/*
 * Form fields. Input is Minima's (components/ui/input.tsx, from the registry).
 * Minima ships no textarea, select or switch, so those three are Watchman's,
 * built from the same tokens as Minima's input so a form reads as one set:
 * control height and radius, the input border, type-field (16px on phones,
 * so iOS does not zoom), and Minima's focus ring.
 */
export { Input } from "./input";

const control =
  "w-full min-w-0 rounded-control-md border border-input bg-transparent px-2.5 py-1 type-field text-foreground transition-colors placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:type-body dark:bg-input/30";

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
    <div className={cn("flex flex-col gap-inset", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5">
        <MonoLabel>{label}</MonoLabel>
        {required ? (
          <span className="type-label-xs text-foreground" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="signal type-label-xs text-red-text">{error}</p>
      ) : hint ? (
        <p className="type-caption text-subtle-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 resize-y py-2", className)} {...rest} />;
}

/** A native select — the platform's own picker on every device — dressed as
    a Minima input, with the chevron drawn in the current text colour so it
    follows the mode. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cn(control, "h-control-md appearance-none pr-9", className)} {...rest}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 10 6"
        className="pointer-events-none absolute right-3 top-1/2 size-2.5 -translate-y-1/2 fill-current text-subtle-foreground"
      >
        <path d="M0 0l5 6 5-6z" />
      </svg>
    </span>
  );
}

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
    <label className={cn("group flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-50")}>
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full border border-input bg-gray-fill transition-colors duration-quick group-has-checked:border-transparent group-has-checked:bg-primary">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="peer absolute inset-0 cursor-pointer appearance-none rounded-full"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0.5 top-0.5 size-3.5 rounded-full bg-background shadow-raised transition-transform duration-quick ease-out peer-checked:translate-x-4"
        />
      </span>
      <span className="flex flex-col gap-1">
        <MonoLabel tone="bone">{label}</MonoLabel>
        {hint ? <span className="type-caption text-subtle-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-control-md border border-red-border bg-red-fill px-3 py-2 type-caption text-red-text">
      {children}
    </div>
  );
}
