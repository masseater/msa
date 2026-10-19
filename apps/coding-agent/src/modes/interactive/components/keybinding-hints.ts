import { getKeybindings, type Keybinding, type KeyId } from "@msa/tui";
import { dual } from "effect/Function";

import { theme } from "../theme/theme.ts";

export interface KeyTextFormatOptions {
  capitalize?: boolean;
}

function formatKeyPart(part: string, options: KeyTextFormatOptions): string {
  const displayPart =
    process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part;
  return options.capitalize === true
    ? displayPart.charAt(0).toUpperCase() + displayPart.slice(1)
    : displayPart;
}

export const formatKeyText: {
  (options?: KeyTextFormatOptions): (key: string) => string;
  (key: string, options?: KeyTextFormatOptions): string;
} = dual(
  (args) => typeof args[0] === "string",
  (key: string, options: KeyTextFormatOptions = {}): string =>
    key
      .split("/")
      .map((k) =>
        k
          .split("+")
          .map((part) => formatKeyPart(part, options))
          .join("+"),
      )
      .join("/"),
);

function formatKeys(keys: KeyId[], options: KeyTextFormatOptions = {}): string {
  if (keys.length === 0) return "";
  return formatKeyText(keys.join("/"), options);
}

export function keyText(keybinding: Keybinding): string {
  return formatKeys(getKeybindings().getKeys(keybinding));
}

export function keyDisplayText(keybinding: Keybinding): string {
  return formatKeys(getKeybindings().getKeys(keybinding), { capitalize: true });
}

export const keyHint: {
  (description: string): (keybinding: Keybinding) => string;
  (keybinding: Keybinding, description: string): string;
} = dual(
  2,
  (keybinding: Keybinding, description: string): string =>
    theme.fg("dim", keyText(keybinding)) + theme.fg("muted", ` ${description}`),
);

export function expandHint(summary: string): string {
  return `${theme.fg("muted", `${summary} (`)}${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
}

export const rawKeyHint: {
  (description: string): (key: string) => string;
  (key: string, description: string): string;
} = dual(
  2,
  (key: string, description: string): string =>
    theme.fg("dim", formatKeyText(key)) + theme.fg("muted", ` ${description}`),
);
