import { execSync } from "node:child_process";

import type { TerminalColorMode } from "./colors.ts";
import { isEnvSet, readEnv } from "./env.ts";

export type ImageProtocol = "kitty" | "iterm2" | null;

export interface TerminalCapabilities {
  images: ImageProtocol;
  trueColor: boolean;
  hyperlinks: boolean;
}

export interface CellDimensions {
  widthPx: number;
  heightPx: number;
}

let cachedCapabilities: TerminalCapabilities | null = null;
let capabilityOverrides: Partial<TerminalCapabilities> = {};

let cellDimensions: CellDimensions = { widthPx: 9, heightPx: 18 };

export function getCellDimensions(): CellDimensions {
  return cellDimensions;
}

export function setCellDimensions(dims: CellDimensions): void {
  cellDimensions = dims;
}

function probeTmuxHyperlinks(): boolean {
  try {
    const termfeatures = execSync("tmux display-message -p '#{client_termfeatures}'", {
      encoding: "utf8",
      timeout: 250,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return termfeatures
      .split(",")
      .map((feature) => feature.trim())
      .includes("hyperlinks");
  } catch {
    return false;
  }
}

interface TerminalHints {
  termProgram: string;
  terminalEmulator: string;
  term: string;
  hasTrueColorHint: boolean;
  tmuxForwardsHyperlink: () => boolean;
}

type CapabilityRule = readonly [
  (hints: TerminalHints) => boolean,
  (hints: TerminalHints) => TerminalCapabilities,
];

const fullKitty = (): TerminalCapabilities => ({
  images: "kitty",
  trueColor: true,
  hyperlinks: true,
});
const trueColorLinks = (): TerminalCapabilities => ({
  images: null,
  trueColor: true,
  hyperlinks: true,
});
const trueColorOnly = (): TerminalCapabilities => ({
  images: null,
  trueColor: true,
  hyperlinks: false,
});

const CAPABILITY_RULES: readonly CapabilityRule[] = [
  [
    (hints) => isEnvSet("TMUX") || hints.term.startsWith("tmux"),
    (hints) => ({
      images: null,
      trueColor: hints.hasTrueColorHint,
      hyperlinks: hints.tmuxForwardsHyperlink(),
    }),
  ],
  [
    (hints) => hints.term.startsWith("screen"),
    (hints) => ({ images: null, trueColor: hints.hasTrueColorHint, hyperlinks: false }),
  ],
  [
    (hints) => hints.termProgram === "herdr",
    (hints) => ({ images: "kitty", trueColor: hints.hasTrueColorHint, hyperlinks: true }),
  ],
  [(hints) => isEnvSet("KITTY_WINDOW_ID") || hints.termProgram === "kitty", fullKitty],
  [
    (hints) =>
      hints.termProgram === "ghostty" ||
      hints.term.includes("ghostty") ||
      isEnvSet("GHOSTTY_RESOURCES_DIR"),
    fullKitty,
  ],
  [(hints) => isEnvSet("WEZTERM_PANE") || hints.termProgram === "wezterm", fullKitty],
  [
    (hints) =>
      hints.termProgram === "warpterminal" ||
      isEnvSet("WARP_SESSION_ID") ||
      isEnvSet("WARP_TERMINAL_SESSION_UUID"),
    fullKitty,
  ],
  [
    (hints) => isEnvSet("ITERM_SESSION_ID") || hints.termProgram === "iterm.app",
    () => ({ images: "iterm2", trueColor: true, hyperlinks: true }),
  ],
  [() => isEnvSet("WT_SESSION"), trueColorLinks],
  [(hints) => ["alacritty", "vscode", "zed"].includes(hints.termProgram), trueColorLinks],
  [(hints) => hints.terminalEmulator === "jetbrains-jediterm", trueColorOnly],
  [() => process.platform === "win32", trueColorOnly],
];

function detectCapabilitiesFromEnvironment(
  tmuxForwardsHyperlink: () => boolean,
): TerminalCapabilities {
  const term = readEnv("TERM")?.toLowerCase() ?? "";
  const colorTerm = readEnv("COLORTERM")?.toLowerCase() ?? "";
  const hints: TerminalHints = {
    termProgram: readEnv("TERM_PROGRAM")?.toLowerCase() ?? "",
    terminalEmulator: readEnv("TERMINAL_EMULATOR")?.toLowerCase() ?? "",
    term,
    hasTrueColorHint:
      colorTerm === "truecolor" || colorTerm === "24bit" || term.endsWith("-direct"),
    tmuxForwardsHyperlink,
  };
  const rule = CAPABILITY_RULES.find(([matches]) => matches(hints));
  return rule === undefined
    ? { images: null, trueColor: hints.hasTrueColorHint, hyperlinks: false }
    : rule[1](hints);
}

function parseBooleanCapabilityOverride(value: string | undefined): boolean | undefined {
  return value === "1" ? true : value === "0" ? false : undefined;
}

export function detectCapabilities(
  tmuxForwardsHyperlink: () => boolean = probeTmuxHyperlinks,
): TerminalCapabilities {
  const hyperlinks = parseBooleanCapabilityOverride(readEnv("MSA_HYPERLINKS"));
  const detected = detectCapabilitiesFromEnvironment(
    hyperlinks === undefined ? tmuxForwardsHyperlink : () => hyperlinks,
  );
  const imageProtocol = readEnv("MSA_IMAGE_PROTOCOL")?.toLowerCase();
  const images =
    imageProtocol === "kitty" || imageProtocol === "iterm2"
      ? imageProtocol
      : imageProtocol === "none" || imageProtocol === "0"
        ? null
        : undefined;
  const trueColor = parseBooleanCapabilityOverride(readEnv("MSA_TRUE_COLOR"));
  return {
    ...detected,
    ...(images === undefined ? {} : { images }),
    ...(trueColor === undefined ? {} : { trueColor }),
    ...(hyperlinks === undefined ? {} : { hyperlinks }),
  };
}

export function getCapabilities(): TerminalCapabilities {
  if (cachedCapabilities === null) {
    const hyperlinks = capabilityOverrides.hyperlinks;
    cachedCapabilities = {
      ...detectCapabilities(hyperlinks === undefined ? undefined : () => hyperlinks),
      ...capabilityOverrides,
    };
  }
  return cachedCapabilities;
}

export function getTerminalColorMode(
  capabilities: TerminalCapabilities = getCapabilities(),
): TerminalColorMode {
  return capabilities.trueColor ? "truecolor" : "256color";
}

export function resetCapabilitiesCache(): void {
  cachedCapabilities = null;
}

export function setCapabilityOverrides(overrides: Partial<TerminalCapabilities>): void {
  if (
    capabilityOverrides.images === overrides.images &&
    capabilityOverrides.trueColor === overrides.trueColor &&
    capabilityOverrides.hyperlinks === overrides.hyperlinks
  ) {
    return;
  }
  capabilityOverrides = { ...overrides };
  cachedCapabilities = null;
}

export function setCapabilities(caps: TerminalCapabilities): void {
  cachedCapabilities = caps;
}
