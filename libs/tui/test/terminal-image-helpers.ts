import { Image } from "../src/components/image.ts";

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

export function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

export const jpeg = Buffer.from("jpeg").toString("base64");

export const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000280000000a", "hex").toString(
  "base64",
);

export const render = (data: string, mimeType: string) =>
  new Image(
    data,
    mimeType,
    { fallbackColor: (value) => value },
    {},
    { widthPx: 20, heightPx: 20 },
  ).render(20);
