/**
 * The notification-email palette, resolved from Minima.
 *
 * Emails cannot read a CSS variable — clients strip them, and the standalone
 * server does not ship styles/minima.css anyway — so the colours an email uses
 * are literal hex. Hand-keeping them is how an email drifts from the app. This
 * reads the installed theme instead: the light blocks for light mode, the dark
 * blocks over them for dark, every var() chain followed to a literal.
 *
 *   pnpm tsx scripts/email-palette.mts      writes src/lib/notify/palette.ts
 *
 * Re-run after re-adding the theme from the registry. src/lib/notify/palette
 * .test.ts fails if the committed palette no longer matches the theme.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The event tones an email can wear, and the Minima hue behind each. */
export const TONES = { down: "red", up: "green", degraded: "amber", neutral: "gray" } as const;

type Vars = Record<string, string>;
export type Tone = { text: string; mark: string; solid: string; onSolid: string; fill: string; border: string };
export type Mode = { canvas: string; card: string; border: string; text: string; muted: string; subtle: string; tones: Record<keyof typeof TONES, Tone> };
export type EmailPalette = { light: Mode; dark: Mode; radius: { panel: string; control: string } };

function collect(css: string, test: (selector: string) => boolean): Vars {
  const vars: Vars = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? "").trim().split("\n").pop()?.trim() ?? "";
    if (!test(selector)) continue;
    for (const d of (m[2] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]!] = d[2]!.trim();
  }
  return vars;
}

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function oklchToHex(value: string): string {
  const m = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(?:\s+([\d.]+))?/);
  if (!m) throw new Error(`not an oklch literal: ${value}`);
  const L = m[2] ? Number(m[1]) / 100 : Number(m[1]);
  const C = Number(m[3]);
  const h = (Number(m[4] ?? 0) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return (
    "#" +
    [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
    ]
      .map((c: number) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Build the palette from the text of styles/minima.css. */
export function buildEmailPalette(css: string): EmailPalette {
  const light = collect(css, (s) => /^(:root)+(\[data-theme="minima"\])?$/.test(s));
  const dark = { ...light, ...collect(css, (s) => /^(:root)*(\[data-theme="minima"\])?\.dark$/.test(s)) };

  const resolver = (vars: Vars) => {
    const resolve = (name: string, seen = new Set<string>()): string => {
      if (seen.has(name)) throw new Error(`cycle at ${name}`);
      seen.add(name);
      const v = vars[name];
      if (v === undefined) throw new Error(`styles/minima.css — ${name} is not declared`);
      const ref = v.match(/^var\((--[\w-]+)(?:,[^)]*)?\)$/);
      return ref ? resolve(ref[1]!, seen) : v;
    };
    return resolve;
  };

  const mode = (vars: Vars): Mode => {
    const r = resolver(vars);
    const hex = (name: string) => oklchToHex(r(name));
    const tones = {} as Record<keyof typeof TONES, Tone>;
    for (const [tone, hue] of Object.entries(TONES) as [keyof typeof TONES, string][]) {
      tones[tone] = {
        text: hex(`--${hue}-text`),
        mark: hex(`--${hue}-mark`),
        solid: hex(`--${hue}-solid`),
        onSolid: hex(`--${hue}-on-solid`),
        fill: hex(`--${hue}-fill`),
        border: hex(`--${hue}-border`),
      };
    }
    return {
      canvas: hex("--background"),
      card: hex("--card"),
      // Opaque on purpose: Minima's --border is translucent, and a translucent
      // border in an email depends on a client compositing it correctly.
      border: hex("--gray-border"),
      text: hex("--foreground"),
      muted: hex("--muted-foreground"),
      subtle: hex("--subtle-foreground"),
      tones,
    };
  };

  const px = (name: string) => `${parseFloat(resolver(light)(name)) * 16}px`;
  return {
    light: mode(light),
    dark: mode(dark),
    radius: { panel: px("--rung-panel"), control: px("--rung-control") },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = readFileSync(new URL("../styles/minima.css", import.meta.url), "utf8");
  const palette = buildEmailPalette(css);
  writeFileSync(
    new URL("../src/lib/notify/palette.ts", import.meta.url),
    `/**
 * GENERATED from styles/minima.css — do not edit. Run
 * \`pnpm tsx scripts/email-palette.mts\` after re-adding the theme.
 *
 * Minima's colours as literal hex, for notification emails, which cannot read
 * CSS variables. palette.test.ts fails if this falls behind the theme.
 */
export const emailPalette = ${JSON.stringify(palette, null, 2)} as const;
`,
  );
  console.log("wrote src/lib/notify/palette.ts");
}
