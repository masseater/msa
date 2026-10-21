import { dual } from "effect/Function";

import image from "../src/components/image.ts";
import env from "../src/env.ts";

const { overrideEnv } = env;
const { Image } = image;

const ENV_KEYS = [
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

const withEnv: {
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

const jpeg = Buffer.from("jpeg").toString("base64");

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000280000000a", "hex").toString(
  "base64",
);

const render: {
  (data: string, mimeType: string): string[];
  (mimeType: string): (data: string) => string[];
} = dual(2, (data: string, mimeType: string): string[] =>
  new Image(
    data,
    mimeType,
    { fallbackColor: (value) => value },
    {},
    { heightPx: 20, widthPx: 20 },
  ).render(20),
);

const terminalImageHelpers = {
  ENV_KEYS,
  jpeg,
  png,
  render,
  withEnv,
};

export default terminalImageHelpers;
