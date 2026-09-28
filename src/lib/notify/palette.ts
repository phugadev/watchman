import minima from "../../../styles/minima-palette.json";

/**
 * Minima's colours for notification emails, which cannot read CSS variables.
 *
 * Everything comes from styles/minima-palette.json — Minima's own palette
 * item, every colour resolved to hex for both modes, generated from the same
 * build as the theme and checked against it. Re-add it with the theme and the
 * emails follow; there is nothing here to regenerate.
 */
type Mode = typeof minima.light;

/** The event tones an email can wear, and the Minima hue behind each. */
export const TONES = { down: "red", up: "green", degraded: "amber", neutral: "gray" } as const;
type ToneName = keyof typeof TONES;

function mode(m: Mode) {
  const tone = (hue: (typeof TONES)[ToneName]) => ({
    text: m[`${hue}-text`],
    mark: m[`${hue}-mark`],
    solid: m[`${hue}-solid`],
    onSolid: m[`${hue}-on-solid`],
    fill: m[`${hue}-fill`],
    border: m[`${hue}-border`],
  });
  return {
    canvas: m["background"],
    card: m["card"],
    // Opaque on purpose: Minima's --border is translucent, and a translucent
    // border in an email depends on a client compositing it correctly.
    border: m["gray-border"],
    text: m["foreground"],
    muted: m["muted-foreground"],
    subtle: m["subtle-foreground"],
    tones: Object.fromEntries(
      (Object.keys(TONES) as ToneName[]).map((t) => [t, tone(TONES[t])]),
    ) as Record<ToneName, ReturnType<typeof tone>>,
  };
}

export const emailPalette = {
  light: mode(minima.light),
  dark: mode(minima.dark),
  /* Minima's panel and control rungs. Radii are not colours, so they are not
     in the palette; palette.test.ts holds these to styles/minima.css. */
  radius: { panel: "12px", control: "10px" },
} as const;
