import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailPalette } from "./palette";
import { renderEmailHtml } from "./render";

const css = readFileSync(new URL("../../../styles/minima.css", import.meta.url), "utf8");

/* WCAG relative luminance of a #rrggbb colour. */
function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("email palette", () => {
  it("uses Minima's panel and control radii — the one thing not in the palette", () => {
    const rung = (name: string) => {
      const m = css.match(new RegExp(`--rung-${name}:\\s*([\\d.]+)rem`));
      return m ? `${parseFloat(m[1]!) * 16}px` : undefined;
    };
    expect(emailPalette.radius).toEqual({ panel: rung("panel"), control: rung("control") });
  });

  /* Every text pairing the email renders, in both modes. Email has no
     audit:pages, so the floor is checked here, on the literal colours. */
  for (const mode of ["light", "dark"] as const) {
    const m = emailPalette[mode];
    const pairs: [string, string, string][] = [
      ["headline", m.text, m.card],
      ["intro", m.muted, m.card],
      ["field label", m.subtle, m.card],
      ["field value", m.text, m.card],
      ["footer", m.subtle, m.canvas],
      ["flapping note", m.text, m.tones.degraded.fill],
    ];
    for (const tone of ["down", "up", "degraded", "neutral"] as const) {
      const t = m.tones[tone];
      pairs.push([`${tone} eyebrow`, t.text, m.card]);
      pairs.push([`${tone} button`, t.onSolid, t.solid]);
    }
    for (const [what, fg, bg] of pairs) {
      it(`${mode}: ${what} clears 4.5:1`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("renders the light values inline and the dark values for clients that ask", () => {
    const html = renderEmailHtml({
      event: "monitor.down",
      timestamp: "2026-09-27T09:00:00.000Z",
      monitor: { id: "m1", name: "API", kind: "http", target: "https://api.example.com", url: "https://watch.example.com/monitors/m1" },
    } as Parameters<typeof renderEmailHtml>[0]);
    expect(html).toContain(`background:${emailPalette.light.card}`);
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain(`.wm-card { background:${emailPalette.dark.card} !important;`);
    expect(html).not.toMatch(/#0b0b0d|#131316|#e5484d/); // the old hand-kept palette
  });
});
