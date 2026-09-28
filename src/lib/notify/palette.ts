/**
 * GENERATED from styles/minima.css — do not edit. Run
 * `pnpm tsx scripts/email-palette.mts` after re-adding the theme.
 *
 * Minima's colours as literal hex, for notification emails, which cannot read
 * CSS variables. palette.test.ts fails if this falls behind the theme.
 */
export const emailPalette = {
  "light": {
    "canvas": "#f8f8f8",
    "card": "#fdfdfd",
    "border": "#dbdbdb",
    "text": "#121212",
    "muted": "#525252",
    "subtle": "#626262",
    "tones": {
      "down": {
        "text": "#d50000",
        "mark": "#d50000",
        "solid": "#da0000",
        "onSolid": "#ffffff",
        "fill": "#ffeae7",
        "border": "#ffc7c1"
      },
      "up": {
        "text": "#007f00",
        "mark": "#007f00",
        "solid": "#00bb2f",
        "onSolid": "#121212",
        "fill": "#e0f7e4",
        "border": "#adebb9"
      },
      "degraded": {
        "text": "#914f00",
        "mark": "#914f00",
        "solid": "#f69b00",
        "onSolid": "#121212",
        "fill": "#fdeed7",
        "border": "#f9d39a"
      },
      "neutral": {
        "text": "#525252",
        "mark": "#525252",
        "solid": "#8c8c8c",
        "onSolid": "#121212",
        "fill": "#f0f0f0",
        "border": "#dbdbdb"
      }
    }
  },
  "dark": {
    "canvas": "#0a0a0a",
    "card": "#131313",
    "border": "#343434",
    "text": "#f2f2f2",
    "muted": "#b4b4b4",
    "subtle": "#9e9e9e",
    "tones": {
      "down": {
        "text": "#ff5458",
        "mark": "#e20003",
        "solid": "#e20003",
        "onSolid": "#ffffff",
        "fill": "#321816",
        "border": "#6a201f"
      },
      "up": {
        "text": "#00e636",
        "mark": "#00b82d",
        "solid": "#00b82d",
        "onSolid": "#121212",
        "fill": "#17241a",
        "border": "#1c4828"
      },
      "degraded": {
        "text": "#ff9a00",
        "mark": "#e68d00",
        "solid": "#e68d00",
        "onSolid": "#121212",
        "fill": "#252018",
        "border": "#4b3a1f"
      },
      "neutral": {
        "text": "#b4b4b4",
        "mark": "#808080",
        "solid": "#808080",
        "onSolid": "#121212",
        "fill": "#1c1c1c",
        "border": "#343434"
      }
    }
  },
  "radius": {
    "panel": "12px",
    "control": "10px"
  }
} as const;
