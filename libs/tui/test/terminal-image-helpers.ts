import { dual } from "effect/Function";

import { Image } from "../src/components/image.ts";
import { overrideEnv } from "../src/env.ts";

export const ENV_KEYS = [
  "TERM",
  "TERM_PROGRAM",
  "TERMINAL_EMULATOR",
  "COLORTERM",
  "TMUX",
  "KITTY_WINDOW_ID",
  "GHOSTTY_RESOURCES_DIR",
  "WEZTERM_PANE",
  "ITERM_SESSION_ID",
  "WT_SESSION",
  "CMUX_WORKSPACE_ID",
  "WARP_SESSION_ID",
  "WARP_TERMINAL_SESSION_UUID",
  "MSA_HYPERLINKS",
  "MSA_IMAGE_PROTOCOL",
  "MSA_TRUE_COLOR",
] as const;

export const withEnv: {
  <T>(overrides: Record<string, string | undefined>, fn: () => T): T;
  <T>(fn: () => T): (overrides: Record<string, string | undefined>) => T;
} = dual(2, <T>(overrides: Record<string, string | undefined>, fn: () => T): T => {
  const restore = overrideEnv({
    ...Object.fromEntries(ENV_KEYS.map((key) => [key, undefined])),
    ...overrides,
  });
  try {
    return fn();
  } finally {
    restore();
  }
});

export const jpeg = Buffer.from("jpeg").toString("base64");

export const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000280000000a", "hex").toString(
  "base64",
);

export const render: {
  (data: string, mimeType: string): string[];
  (mimeType: string): (data: string) => string[];
} = dual(2, (data: string, mimeType: string): string[] =>
  new Image(
    data,
    mimeType,
    { fallbackColor: (value) => value },
    {},
    { widthPx: 20, heightPx: 20 },
  ).render(20),
);
