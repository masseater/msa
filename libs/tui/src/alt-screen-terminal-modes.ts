import { dual } from "effect/Function";

import altScreenTerminalModesKit from "./alt-screen-terminal-modes-kit.ts";
import type altScreenTerminalModesTypes from "./alt-screen-terminal-modes.types.ts";
import terminalCapabilities from "./terminal-capabilities.ts";
import type terminalCapabilitiesTypes from "./terminal-capabilities.types.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import textSlice from "./text-slice.ts";
import tuiComponent from "./tui-component.ts";
import tuiFrameLines from "./tui-frame-lines.ts";
import utils from "./utils.ts";

const { ansiSequences, env } = altScreenTerminalModesKit;

const { deleteAllKittyImages, isImageLine } = terminalImageKitty;
const { getCapabilities, setCapabilities } = terminalCapabilities;
const { readEnv } = env;
const { visibleWidth } = utils;
const { sliceByColumn } = textSlice;
const { applyLineResets } = tuiFrameLines;
const { stripOsc133ZonePrefix } = ansiSequences;
const { CURSOR_MARKER } = tuiComponent;

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const DISABLE_AUTOWRAP = "\x1b[?7l";
const ENABLE_AUTOWRAP = "\x1b[?7h";
const ENABLE_BUTTON_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h";
const ENABLE_ALL_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
const BEGIN_SYNCHRONIZED_OUTPUT = "\x1b[?2026h";
const END_SYNCHRONIZED_OUTPUT = "\x1b[?2026l";

function kittyImagesDeletion(protocol: terminalCapabilitiesTypes.ImageProtocol): string {
  return protocol === "kitty" ? deleteAllKittyImages() : "";
}

function suspendInlineImages(): altScreenTerminalModesTypes.ImageCapabilities {
  const capabilities = getCapabilities();
  if (capabilities.images !== "iterm2") return { protocol: capabilities.images, saved: undefined };
  setCapabilities({ ...capabilities, images: null });
  return { protocol: capabilities.images, saved: capabilities };
}

function restoreCapabilities(
  saved: terminalCapabilitiesTypes.TerminalCapabilities | undefined,
): void {
  if (saved !== undefined) setCapabilities(saved);
}

function enterAltScreenSequence(mouseEnabled: boolean): string {
  const term = readEnv("TERM")?.toLowerCase() ?? "";
  const mouseSequence =
    readEnv("TMUX") !== undefined ||
    readEnv("ZELLIJ") !== undefined ||
    readEnv("STY") !== undefined ||
    term.startsWith("tmux") ||
    term.startsWith("screen")
      ? ENABLE_BUTTON_MOTION_MOUSE
      : ENABLE_ALL_MOTION_MOUSE;
  return `${ENTER_ALT_SCREEN}${DISABLE_AUTOWRAP}${mouseEnabled ? mouseSequence : ""}\x1b[2J\x1b[H\x1b[?25l`;
}

const leaveAltScreenSequence: {
  (protocol: terminalCapabilitiesTypes.ImageProtocol, mouseEnabled: boolean): string;
  (mouseEnabled: boolean): (protocol: terminalCapabilitiesTypes.ImageProtocol) => string;
} = dual(
  2,
  (protocol: terminalCapabilitiesTypes.ImageProtocol, mouseEnabled: boolean): string =>
    `${BEGIN_SYNCHRONIZED_OUTPUT}${kittyImagesDeletion(protocol)}${mouseEnabled ? DISABLE_MOUSE : ""}${ENABLE_AUTOWRAP}${END_SYNCHRONIZED_OUTPUT}`,
);

function exitAltScreenPreservingSequence(): string {
  return `${BEGIN_SYNCHRONIZED_OUTPUT}${EXIT_ALT_SCREEN}\x1b[?25h${END_SYNCHRONIZED_OUTPUT}`;
}

const fitLinesToWidth: {
  (lines: readonly string[], width: number): string[];
  (width: number): (lines: readonly string[]) => string[];
} = dual(2, (lines: readonly string[], width: number): string[] =>
  lines.map((line) =>
    isImageLine(line) || visibleWidth(line) <= width ? line : sliceByColumn(line, 0, width, true),
  ),
);

const restoredDocument: {
  (renderedLines: readonly string[], width: number): string[];
  (width: number): (renderedLines: readonly string[]) => string[];
} = dual(2, (renderedLines: readonly string[], width: number): string[] =>
  fitLinesToWidth(
    applyLineResets(
      renderedLines.map((line) => stripOsc133ZonePrefix(line).replaceAll(CURSOR_MARKER, "")),
    ),
    width,
  ),
);

function restoreDocumentSequence(lines: readonly string[]): string {
  let buffer = `${BEGIN_SYNCHRONIZED_OUTPUT}${EXIT_ALT_SCREEN}${DISABLE_AUTOWRAP}`;
  for (const [row, line] of lines.entries()) {
    if (row > 0) buffer += "\r\n";
    buffer += `\r\x1b[2K${line ?? ""}`;
  }
  return `${buffer}\x1b[0m${ENABLE_AUTOWRAP}\r\n\x1b[?25h${END_SYNCHRONIZED_OUTPUT}`;
}

const altScreenTerminalModes = {
  BEGIN_SYNCHRONIZED_OUTPUT,
  END_SYNCHRONIZED_OUTPUT,
  enterAltScreenSequence,
  exitAltScreenPreservingSequence,
  fitLinesToWidth,
  kittyImagesDeletion,
  leaveAltScreenSequence,
  restoreCapabilities,
  restoreDocumentSequence,
  restoredDocument,
  suspendInlineImages,
};

export default altScreenTerminalModes;
