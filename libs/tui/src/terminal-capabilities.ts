import type colorsTypes from "./colors.types.ts";
import env from "./env.ts";
import type terminalCapabilitiesTypes from "./terminal-capabilities.types.ts";

const { isEnvSet, readEnv } = env;

let cachedCapabilities: terminalCapabilitiesTypes.TerminalCapabilities | null = null;
let capabilitiesSetExplicitly = false;
let inlineImagesSuspended = false;
let capabilityOverrides: Partial<terminalCapabilitiesTypes.TerminalCapabilities> = {};

let cellDimensions: terminalCapabilitiesTypes.CellDimensions = { heightPx: 18, widthPx: 9 };

function getCellDimensions(): terminalCapabilitiesTypes.CellDimensions {
  return cellDimensions;
}

function setCellDimensions(dims: terminalCapabilitiesTypes.CellDimensions): void {
  cellDimensions = dims;
}

let tmuxHyperlinkProbe: boolean | undefined;

function probedTmuxHyperlinks(): boolean {
  return tmuxHyperlinkProbe ?? false;
}

function needsTmuxHyperlinkProbe(): boolean {
  if (tmuxHyperlinkProbe !== undefined) return false;
  let needed = false;
  const hyperlinks = capabilityOverrides.hyperlinks;
  detectCapabilities(
    hyperlinks === undefined
      ? () => {
          needed = true;
          return false;
        }
      : () => hyperlinks,
  );
  return needed;
}

function setTmuxHyperlinkProbe(forwardsHyperlinks: boolean): void {
  if (tmuxHyperlinkProbe === forwardsHyperlinks) return;
  tmuxHyperlinkProbe = forwardsHyperlinks;
  if (!capabilitiesSetExplicitly) cachedCapabilities = null;
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
  (hints: TerminalHints) => terminalCapabilitiesTypes.TerminalCapabilities,
];

const fullKitty = (): terminalCapabilitiesTypes.TerminalCapabilities => ({
  hyperlinks: true,
  images: "kitty",
  trueColor: true,
});
const trueColorLinks = (): terminalCapabilitiesTypes.TerminalCapabilities => ({
  hyperlinks: true,
  images: null,
  trueColor: true,
});
const trueColorOnly = (): terminalCapabilitiesTypes.TerminalCapabilities => ({
  hyperlinks: false,
  images: null,
  trueColor: true,
});

const CAPABILITY_RULES: readonly CapabilityRule[] = [
  [
    (hints) => isEnvSet("TMUX") || hints.term.startsWith("tmux"),
    (hints) => ({
      hyperlinks: hints.tmuxForwardsHyperlink(),
      images: null,
      trueColor: hints.hasTrueColorHint,
    }),
  ],
  [
    (hints) => hints.term.startsWith("screen"),
    (hints) => ({ hyperlinks: false, images: null, trueColor: hints.hasTrueColorHint }),
  ],
  [
    (hints) => hints.termProgram === "herdr",
    (hints) => ({ hyperlinks: true, images: "kitty", trueColor: hints.hasTrueColorHint }),
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
    () => ({ hyperlinks: true, images: "iterm2", trueColor: true }),
  ],
  [() => isEnvSet("WT_SESSION"), trueColorLinks],
  [(hints) => ["alacritty", "vscode", "zed"].includes(hints.termProgram), trueColorLinks],
  [(hints) => hints.terminalEmulator === "jetbrains-jediterm", trueColorOnly],
  [() => process.platform === "win32", trueColorOnly],
];

function detectCapabilitiesFromEnvironment(
  tmuxForwardsHyperlink: () => boolean,
): terminalCapabilitiesTypes.TerminalCapabilities {
  const term = readEnv("TERM")?.toLowerCase() ?? "";
  const colorTerm = readEnv("COLORTERM")?.toLowerCase() ?? "";
  const hints: TerminalHints = {
    hasTrueColorHint:
      colorTerm === "truecolor" || colorTerm === "24bit" || term.endsWith("-direct"),
    term,
    termProgram: readEnv("TERM_PROGRAM")?.toLowerCase() ?? "",
    terminalEmulator: readEnv("TERMINAL_EMULATOR")?.toLowerCase() ?? "",
    tmuxForwardsHyperlink,
  };
  const rule = CAPABILITY_RULES.find(([matches]) => matches(hints));
  return rule === undefined
    ? { hyperlinks: false, images: null, trueColor: hints.hasTrueColorHint }
    : rule[1](hints);
}

function parseBooleanCapabilityOverride(value: string | undefined): boolean | undefined {
  return value === "1" ? true : value === "0" ? false : undefined;
}

function detectCapabilities(
  tmuxForwardsHyperlink: () => boolean = probedTmuxHyperlinks,
): terminalCapabilitiesTypes.TerminalCapabilities {
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

function getCapabilities(): terminalCapabilitiesTypes.TerminalCapabilities {
  if (cachedCapabilities === null) {
    const hyperlinks = capabilityOverrides.hyperlinks;
    cachedCapabilities = {
      ...detectCapabilities(hyperlinks === undefined ? undefined : () => hyperlinks),
      ...capabilityOverrides,
    };
  }
  return inlineImagesSuspended ? { ...cachedCapabilities, images: null } : cachedCapabilities;
}

function setInlineImagesSuspended(suspended: boolean): void {
  inlineImagesSuspended = suspended;
}

function getTerminalColorMode(
  capabilities: terminalCapabilitiesTypes.TerminalCapabilities = getCapabilities(),
): colorsTypes.TerminalColorMode {
  return capabilities.trueColor ? "truecolor" : "256color";
}

function resetCapabilitiesCache(): void {
  cachedCapabilities = null;
  capabilitiesSetExplicitly = false;
}

function setCapabilityOverrides(
  overrides: Partial<terminalCapabilitiesTypes.TerminalCapabilities>,
): void {
  if (
    capabilityOverrides.images === overrides.images &&
    capabilityOverrides.trueColor === overrides.trueColor &&
    capabilityOverrides.hyperlinks === overrides.hyperlinks
  ) {
    return;
  }
  capabilityOverrides = { ...overrides };
  resetCapabilitiesCache();
}

function setCapabilities(caps: terminalCapabilitiesTypes.TerminalCapabilities): void {
  cachedCapabilities = caps;
  capabilitiesSetExplicitly = true;
}

const terminalCapabilities = {
  detectCapabilities,
  getCapabilities,
  getCellDimensions,
  getTerminalColorMode,
  needsTmuxHyperlinkProbe,
  resetCapabilitiesCache,
  setCapabilities,
  setCapabilityOverrides,
  setCellDimensions,
  setInlineImagesSuspended,
  setTmuxHyperlinkProbe,
};

export default terminalCapabilities;
