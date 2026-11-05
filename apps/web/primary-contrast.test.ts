import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("primary controls use white labels and the same AA fill in both themes", () => {
  const theme = readFileSync(new URL("./styles/theme.css", import.meta.url), "utf8");
  assert.equal((theme.match(/--color-primary-fill:/g) ?? []).length, 1);
  assert.equal((theme.match(/--color-primary-ink:/g) ?? []).length, 1);
  assert.match(theme, /--color-primary-fill: var\(--color-accent-700\)/);
  assert.match(theme, /--color-primary-ink: var\(--color-white\)/);
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const colour = /--color-accent-700: oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(css);
  assert(colour);
  const lightness = Number(colour[1]) / 100;
  const chroma = Number(colour[2]);
  const hue = Number(colour[3]) * Math.PI / 180;
  const a = chroma * Math.cos(hue), b = chroma * Math.sin(hue);
  const l = (lightness + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (lightness - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (lightness - .0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621*l - 3.3077115913*m + .2309699292*s,
    -1.2684380046*l + 2.6097574011*m - .3413193965*s,
    -.0041960863*l - .7034186147*m + 1.707614701*s,
  ].map(value => Math.max(0, Math.min(1, value)));
  const luminance = .2126*rgb[0] + .7152*rgb[1] + .0722*rgb[2];
  assert.ok(1.05 / (luminance + .05) >= 4.5);
  assert.match(css, /primary-action[^}]*background: var\(--color-primary-fill\);[^}]*color: var\(--color-primary-ink\)/);
  assert.match(css, /composer-send[^}]*background: var\(--color-primary-fill\);[^}]*color: var\(--color-primary-ink\)/);
});
