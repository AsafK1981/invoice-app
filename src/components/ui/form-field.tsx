"use client";

import { Children, cloneElement, isValidElement, useId } from "react";

interface Props {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

export function FormField({ label, required, hint, className, children }: Props) {
  const generatedId = useId();

  // Associate the <label> with its control so clicking the label focuses
  // the input and screen readers pair them. When children is a single
  // element without its own id, clone it with our generated id (respect
  // an existing id); otherwise fall back to a plain label with no htmlFor
  // so nothing breaks for multi-element / non-element children.
  let htmlFor: string | undefined;
  let content = children;

  if (isValidElement(children) && Children.count(children) === 1) {
    const childProps = children.props as { id?: string };
    const id = childProps.id ?? generatedId;
    htmlFor = id;
    if (childProps.id == null) {
      content = cloneElement(children as React.ReactElement<{ id?: string }>, { id });
    }
  }

  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-stone-700 mb-1 block">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {content}
      {hint && <p className="text-xs text-stone-600 mt-1">{hint}</p>}
    </div>
  );
}
