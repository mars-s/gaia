/* global document, getComputedStyle, Node, innerWidth, innerHeight, CSS */
export async function auditPage(state, surface) {
  const failures = [],
    contrast = [],
    touchExemptions = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility === "visible" &&
      s.display !== "none" &&
      s.clipPath !== "inset(50%)" &&
      Number(s.opacity) !== 0 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth
    );
  };
  const elements = [...document.querySelectorAll("body *")].filter(visible);
  const identify = (el) =>
    el.id
      ? "#" + el.id
      : el.tagName.toLowerCase() + "." + [...el.classList].join(".");
  const colourCache = new Map(),
    context = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
  const rgba = (text) => {
    if (colourCache.has(text)) return colourCache.get(text);
    if (!context || !CSS.supports("color", text))
      throw Error("Unsupported computed colour: " + text);
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = text;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data,
      value = [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
    colourCache.set(text, value);
    return value;
  };
  const blend = (ink, background) =>
    ink
      .slice(0, 3)
      .map((value, index) => value * ink[3] + background[index] * (1 - ink[3]));
  const luminance = (rgb) =>
    rgb
      .slice(0, 3)
      .map((value) => {
        value /= 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (total, value, index) =>
          total + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const rules = globalThis.axe
    .getRules()
    .map((rule) => rule.ruleId)
    .filter(
      (id) =>
        [
          "color-contrast",
          "button-name",
          "label",
          "link-name",
          "target-size",
        ].includes(id) || id.startsWith("aria-"),
    );
  const axe = await globalThis.axe.run(document, {
    runOnly: { type: "rule", values: rules },
  });
  const obscured = new Set(
    axe.incomplete
      .filter((rule) => rule.id === "color-contrast")
      .flatMap((rule) =>
        rule.nodes
          .filter((node) =>
            node.any.some(
              (check) => check.data?.messageKey === "elmPartiallyObscured",
            ),
          )
          .map((node) =>
            node.target.length === 1 && typeof node.target[0] === "string"
              ? document.querySelector(node.target[0])
              : null,
          ),
      ),
  );
  const contrastNode = (el) => {
    const target = identify(el),
      style = getComputedStyle(el),
      ancestors = [];
    if (obscured.has(el))
      return {
        target,
        skipped:
          "Axe reports partly obscured text. Another painted layer changes the foreground or backdrop, so ancestor-only colour composition cannot measure it.",
      };
    if (!visible(el))
      return {
        target,
        skipped: "Outside the shot or hidden, so no visible text to measure.",
      };
    if (el.closest(':disabled,[aria-disabled="true"]'))
      return {
        target,
        skipped: "Inactive control text is exempt under WCAG 1.4.3.",
      };
    for (let cursor = el; cursor; cursor = cursor.parentElement) {
      const s = getComputedStyle(cursor);
      // These painted node types need pixel-aware analysis. Report each exemption, never silently pass it.
      if (s.backgroundImage !== "none")
        return {
          target,
          skipped:
            "Text over an image or gradient cannot be reduced to one solid background; axe still runs on this node.",
        };
      for (const pseudo of ["::before", "::after"]) {
        const p = getComputedStyle(cursor, pseudo);
        if (
          !["none", "normal"].includes(p.content) &&
          (p.backgroundImage !== "none" || rgba(p.backgroundColor)[3] > 0)
        )
          return {
            target,
            skipped:
              "A painted pseudo-element can overlap this text; its background geometry is not represented by ancestor fills. Axe still runs on this node.",
          };
      }
      if (Number(s.opacity) !== 1)
        return {
          target,
          skipped:
            "Opacity applies to a composited group, not a foreground colour. Its complete layer must be measured separately; axe still runs on this node.",
        };
      ancestors.unshift(rgba(s.backgroundColor));
    }
    let background = [255, 255, 255];
    for (const colour of ancestors) background = blend(colour, background);
    const foreground = blend(rgba(style.color), background),
      a = luminance(foreground),
      b = luminance(background);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 4.5)
      failures.push(
        `Text contrast ${ratio.toFixed(2)}:1 below 4.5:1 at ${target}`,
      );
    return { target, ratio, foreground, background };
  };
  if (
    elements.filter((el) =>
      el.matches('[data-ui="action"][data-variant="primary"]'),
    ).length > 1
  )
    failures.push("More than one primary action in the shot");
  if (innerWidth === 320 && document.documentElement.scrollWidth !== 320)
    failures.push("Page overflow at 320 px");
  for (const el of elements) {
    const s = getComputedStyle(el),
      r = el.getBoundingClientRect();
    const hasText = [...el.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );
    if (
      hasText &&
      el.scrollWidth > el.clientWidth &&
      ["hidden", "clip"].includes(s.overflowX) &&
      !el.hasAttribute("data-truncate")
    )
      failures.push("Clipped text without data-truncate at " + identify(el));
    if (hasText) contrast.push(contrastNode(el));
    const fill = rgba(s.backgroundColor);
    if (
      document.documentElement.classList.contains("dark") &&
      r.width > 40 &&
      r.height > 40 &&
      fill[3] === 1 &&
      luminance(fill) > 0.8
    )
      failures.push("Light box in dark theme at " + identify(el));
  }
  for (const el of document.querySelectorAll(
    "[aria-controls],[aria-labelledby]",
  ))
    for (const attribute of ["aria-controls", "aria-labelledby"])
      for (const id of (el.getAttribute(attribute) ?? "")
        .split(/\s+/)
        .filter(Boolean))
        if (!document.getElementById(id))
          failures.push(`Missing ${attribute} target ${id}`);
  if (innerWidth === 320)
    for (const el of elements.filter(
      (el) =>
        el.matches('button,[role="button"],input:not([type="hidden"])') &&
        !el.matches(':disabled,[aria-disabled="true"]'),
    )) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) {
        if (
          getComputedStyle(el).display.startsWith("inline") &&
          !["flex", "grid", "inline-flex", "inline-grid"].includes(
            getComputedStyle(el.parentElement).display,
          ) &&
          [...el.parentNode.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          )
        ) {
          touchExemptions.push({
            target: identify(el),
            reason: "WCAG 2.5.8 inline target within a sentence.",
          });
          continue;
        }
        // Include a real pseudo-element hit area, not just the glyph's layout box.
        const cx = r.left + r.width / 2,
          cy = r.top + r.height / 2;
        const expanded = [-11.5, 11.5].every((dx) =>
          [-11.5, 11.5].every((dy) => {
            const hit = document.elementFromPoint(cx + dx, cy + dy);
            return hit === el || (hit && el.contains(hit));
          }),
        );
        if (!expanded)
          failures.push("Touch target below 24 px at " + identify(el));
      }
    }
  if (state) {
    const marker = {
      empty: '[data-ui="empty-state"]',
      loading: '[data-ui="loading"]',
      error: '[data-ui="notice"][data-tone="danger"]',
    }[state];
    const roots = [
      ...document.querySelectorAll('[data-preview-surface="' + surface + '"]'),
    ];
    if (
      !marker ||
      !roots.some(
        (root) =>
          (root.matches(marker) && visible(root)) ||
          [...root.querySelectorAll(marker)].some(visible),
      )
    )
      failures.push(
        "Missing required state " + marker + " for surface " + surface,
      );
  }

  for (const violation of axe.violations)
    for (const node of violation.nodes)
      failures.push(
        `axe ${violation.id}: ${node.target.join(" ")}: ${node.failureSummary}`,
      );
  const incomplete = [];
  for (const rule of axe.incomplete)
    for (const node of rule.nodes) {
      if (
        rule.id !== "color-contrast" ||
        node.target.length !== 1 ||
        typeof node.target[0] !== "string"
      ) {
        failures.push(`Unresolved axe ${rule.id}: ${node.target}`);
        continue;
      }
      const el = document.querySelector(node.target[0]);
      if (!el) {
        failures.push("Unresolved contrast target: " + node.target[0]);
        continue;
      }
      incomplete.push(contrastNode(el));
    }
  return {
    failures,
    contrast,
    incomplete,
    touchExemptions,
    axeViolations: axe.violations.length,
  };
}
