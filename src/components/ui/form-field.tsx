"use client";

import { Children, cloneElement, isValidElement, useId } from "react";

interface Props {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

/** Native controls a <label htmlFor> can actually point at. */
const CONTROL_TAGS = new Set(["input", "select", "textarea"]);

interface Walk {
  /** Set once we have injected into a control, so only the first one wins. */
  hit: boolean;
  id: string;
  describedBy?: string;
  required?: boolean;
}

/**
 * Walk the element tree and inject the label wiring into the FIRST native form
 * control found, however deep it sits.
 *
 * The previous version only looked at the immediate child: if that child was a
 * single element it cloned the id onto it, otherwise it gave up. That quietly
 * broke every field whose control is wrapped - a password input next to its
 * show/hide button, a select next to a manual-entry fallback - because
 * `Children.count` was still 1 (one wrapper <div>), so it stamped the id onto
 * the DIV and pointed <label htmlFor> at an element that cannot be labelled.
 * The field looked labelled and announced as an unnamed text box.
 *
 * A custom component (IsraeliDateInput, BankSelect) is opaque here - its
 * rendered output is not in `props.children` - so no control is found and we
 * deliberately emit NO htmlFor rather than a pointer at a wrapper. Those
 * components take their own id/aria-label.
 */
function inject(node: React.ReactNode, walk: Walk): React.ReactNode {
  if (walk.hit || !isValidElement(node)) return node;

  const el = node as React.ReactElement<{
    id?: string;
    children?: React.ReactNode;
    "aria-describedby"?: string;
    required?: boolean;
  }>;

  if (typeof el.type === "string" && CONTROL_TAGS.has(el.type)) {
    walk.hit = true;
    const props: Record<string, unknown> = {};
    // Respect an id the caller set; we only fill the gap.
    if (el.props.id == null) props.id = walk.id;
    else walk.id = el.props.id;
    if (walk.describedBy && el.props["aria-describedby"] == null) {
      props["aria-describedby"] = walk.describedBy;
    }
    // `required` was visual-only before this: the asterisk was drawn in the
    // label and nothing reached the control, so a screen reader never
    // announced the field as required and aria-required appeared zero times
    // in the whole codebase.
    if (walk.required && el.props.required == null) {
      props.required = true;
      props["aria-required"] = true;
    }
    return Object.keys(props).length ? cloneElement(el, props) : el;
  }

  const kids = el.props?.children;
  if (kids == null) return node;
  const next = Children.map(kids, (c) => inject(c, walk));
  return walk.hit ? cloneElement(el, {}, next) : node;
}

export function FormField({ label, required, hint, className, children }: Props) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;

  const walk: Walk = {
    hit: false,
    id: generatedId,
    describedBy: hint ? hintId : undefined,
    required,
  };
  const content = inject(children, walk);

  return (
    <div className={className}>
      <label
        htmlFor={walk.hit ? walk.id : undefined}
        className="text-xs font-semibold text-stone-700 mb-1 block"
      >
        {label}{" "}
        {required && (
          // The asterisk is decoration on top of the real `required` attribute
          // injected above, so hide it from assistive tech instead of letting
          // it read out as a bare "star" after the field name.
          <span className="text-rose-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {content}
      {hint && (
        <p id={hintId} className="text-xs text-stone-600 mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
