// FormField is the shared label wrapper for most of the app's form fields, so
// a silent regression here un-labels dozens of inputs at once. That is exactly
// what happened before 2026-09-10: the old implementation only inspected the
// immediate child, and a control wrapped in a <div> (a password input beside
// its show/hide button, a select beside a manual-entry fallback) got the
// generated id stamped onto the DIV. <label htmlFor> then pointed at an element
// that cannot be labelled, so the field looked labelled and announced as an
// unnamed text box.
//
// Rendered with renderToStaticMarkup rather than testing-library: the suite
// runs in a node environment with no jsdom, and react-dom/server needs neither.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormField } from "../src/components/ui/form-field";

// createElement's typing wants `children` inside props when the component's
// Props declares it required, so positional children will not typecheck.
function field(
  props: { label: string; required?: boolean; hint?: string },
  children: React.ReactNode,
) {
  return h(FormField, { ...props, children });
}

/** id that <label for="..."> points at, or null when the attribute is absent. */
function labelTarget(html: string): string | null {
  const m = html.match(/<label[^>]*\bfor="([^"]*)"/);
  return m ? m[1] : null;
}

/** id of the element rendered for `tag`, or null. */
function controlId(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*\\bid="([^"]*)"`));
  return m ? m[1] : null;
}

describe("FormField label association", () => {
  it("points the label at a bare input child", () => {
    const html = renderToStaticMarkup(
      field({ label: "שם הלקוח" }, h("input", { type: "text" })),
    );
    const target = labelTarget(html);
    expect(target).toBeTruthy();
    expect(controlId(html, "input")).toBe(target);
  });

  it("reaches an input nested inside a wrapper div", () => {
    // The regression case: password field next to its show/hide button.
    const html = renderToStaticMarkup(
      field({ label: "סיסמה חדשה" }, h(
          "div",
          { className: "relative" },
          h("button", { type: "button" }, "הצג"),
          h("input", { type: "password" }),
        ),
      ),
    );
    const target = labelTarget(html);
    expect(target).toBeTruthy();
    expect(controlId(html, "input")).toBe(target);
    // and NOT the wrapper
    expect(html).not.toMatch(new RegExp(`<div[^>]*\\bid="${target}"`));
  });

  it("labels the first control when a select and an input are siblings", () => {
    const html = renderToStaticMarkup(
      field({ label: "בגין חשבונית מס מקורית" }, h(
          "div",
          null,
          h("select", null, h("option", null, "בחר")),
          h("input", { type: "text" }),
        ),
      ),
    );
    expect(controlId(html, "select")).toBe(labelTarget(html));
  });

  it("respects an id the caller already set", () => {
    const html = renderToStaticMarkup(
      field({ label: "אימייל" }, h("input", { id: "my-own-id" })),
    );
    expect(labelTarget(html)).toBe("my-own-id");
  });

  it("emits no htmlFor when the child is an opaque custom component", () => {
    // IsraeliDateInput / BankSelect render their control internally, so there
    // is nothing here to point at. A dangling htmlFor would be worse than none.
    const Custom = () => h("input", { type: "date" });
    const html = renderToStaticMarkup(field({ label: "תאריך" }, h(Custom)));
    expect(labelTarget(html)).toBeNull();
  });

  it("puts required on the control, not only the asterisk", () => {
    const html = renderToStaticMarkup(
      field({ label: "שם העסק", required: true }, h("input", {})),
    );
    expect(html).toMatch(/<input[^>]*\brequired\b/);
    expect(html).toMatch(/<input[^>]*aria-required="true"/);
    // the visual asterisk must not be read out as a bare "star"
    expect(html).toMatch(/aria-hidden="true"[^>]*>\s*\*|>\*</);
  });

  it("wires a hint to the control with aria-describedby", () => {
    const html = renderToStaticMarkup(
      field({ label: "מספר עוסק", hint: "9 ספרות" }, h("input", {})),
    );
    const m = html.match(/<input[^>]*aria-describedby="([^"]*)"/);
    expect(m).toBeTruthy();
    expect(html).toMatch(new RegExp(`<p[^>]*\\bid="${m![1]}"`));
  });
});
