"use client";

interface Props {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

export function FormField({ label, required, hint, className, children }: Props) {
  return (
    <div className={className}>
      <label className="text-xs font-semibold text-stone-700 mb-1 block">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-stone-600 mt-1">{hint}</p>}
    </div>
  );
}
