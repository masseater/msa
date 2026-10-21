import { dual } from "effect/Function";

import type altScreenFrameTypes from "./alt-screen-frame.types.ts";
import type altScreenKittyCacheTypes from "./alt-screen-kitty-cache.types.ts";
import altScreenTerminalModes from "./alt-screen-terminal-modes.ts";
import env from "./env.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import tuiComponent from "./tui-component.ts";
import utils from "./utils.ts";

const { deleteAllKittyPlacements, getKittyImagePlacementRows, isImageLine } = terminalImageKitty;
const { isEnvSet, readEnv } = env;
const { BEGIN_SYNCHRONIZED_OUTPUT, END_SYNCHRONIZED_OUTPUT, kittyImagesDeletion } =
  altScreenTerminalModes;
const { visibleWidth } = utils;
const { compositeTuiLine } = tuiComponent;

interface RedrawPlan {
  fullRedraw: boolean;
  imagesNeedRedraw: boolean;
  isWezTerm: boolean;
}

function kittyCellsChanged(screen: readonly string[], changedRows: readonly boolean[]): boolean {
  return screen.some((line, row) => {
    const placementRows = getKittyImagePlacementRows(line);
    if (placementRows === undefined) return false;
    for (let coveredRow = row; coveredRow < row + placementRows; coveredRow++) {
      if (changedRows[coveredRow] === true) return true;
    }
    return false;
  });
}

function planRedraw(input: altScreenFrameTypes.AltScreenFrameInput): RedrawPlan {
  const { screen, previousScreen } = input;
  const fullRedraw =
    previousScreen.length === 0 ||
    input.previousWidth !== input.width ||
    input.previousHeight !== input.height;
  const changedRows = screen.map((line, row) => line !== previousScreen[row]);
  const imageAnchorsNeedRedraw = screen.some(
    (line, row) =>
      changedRows[row] && (isImageLine(line) || isImageLine(previousScreen[row] ?? "")),
  );
  const isWezTerm =
    isEnvSet("WEZTERM_PANE") || readEnv("TERM_PROGRAM")?.toLowerCase() === "wezterm";
  const imageCellsNeedRedraw =
    !imageAnchorsNeedRedraw &&
    isWezTerm &&
    input.imageProtocol === "kitty" &&
    changedRows.some(Boolean) &&
    kittyCellsChanged(screen, changedRows);
  return {
    fullRedraw,
    imagesNeedRedraw: imageAnchorsNeedRedraw || imageCellsNeedRedraw,
    isWezTerm,
  };
}

function clearSequence(
  input: altScreenFrameTypes.AltScreenFrameInput,
  plan: RedrawPlan,
  hadUploads: boolean,
): string {
  if (plan.fullRedraw) {
    const clearImages =
      input.imageProtocol === "kitty" && hadUploads
        ? deleteAllKittyPlacements()
        : kittyImagesDeletion(input.imageProtocol);
    return `${clearImages}\x1b[2J`;
  }
  if (!plan.imagesNeedRedraw) return "";
  if (input.imageProtocol === "iterm2") return "\x1b[2J";
  if (input.imageProtocol === "kitty") return deleteAllKittyPlacements();
  return "";
}

function rowsSequence(
  input: altScreenFrameTypes.AltScreenFrameInput,
  plan: RedrawPlan,
  prepared: altScreenKittyCacheTypes.PreparedKittyScreen,
): string {
  const { screen, previousScreen, height } = input;
  const redrawAll = plan.fullRedraw || plan.imagesNeedRedraw;
  const rows = Array.from({ length: height }, (_, row) => row).filter(
    (row) => redrawAll || screen[row] !== previousScreen[row],
  );
  const lineAt = (row: number): string => prepared.lines[row] ?? "";
  const drawImagesLast =
    redrawAll && input.imageProtocol === "kitty" && screen.some(isImageLine) && plan.isWezTerm;
  if (!drawImagesLast) {
    return rows.map((row) => `\x1b[${row + 1};1H\x1b[2K${lineAt(row)}`).join("");
  }
  const clears = rows.map((row) => `\x1b[${row + 1};1H\x1b[2K`).join("");
  const text = rows
    .filter((row) => !isImageLine(lineAt(row)))
    .map((row) => `\x1b[${row + 1};1H${lineAt(row)}`)
    .join("");
  const images = rows
    .filter((row) => isImageLine(lineAt(row)))
    .map((row) => `\x1b[${row + 1};1H${lineAt(row)}`)
    .join("");
  return clears + text + images;
}

function cursorSequence(input: altScreenFrameTypes.AltScreenFrameInput): string {
  const { cursor } = input;
  if (cursor === null) return "\x1b[?25l";
  const position = `\x1b[${cursor.row + 1};${Math.min(input.width, cursor.col) + 1}H`;
  return position + (input.showHardwareCursor ? "\x1b[?25h" : "\x1b[?25l");
}

function buildAltScreenFrame(
  input: altScreenFrameTypes.AltScreenFrameInput,
): altScreenFrameTypes.AltScreenFrameOutput {
  const plan = planRedraw(input);
  const redrawImages = plan.fullRedraw || plan.imagesNeedRedraw;
  const hadUploads = input.kittyImages.size > 0;
  const prepared =
    redrawImages && input.imageProtocol === "kitty"
      ? input.kittyImages.prepare(input.screen)
      : { evictedImageDeletion: "", lines: input.screen };
  const buffer =
    BEGIN_SYNCHRONIZED_OUTPUT +
    clearSequence(input, plan, hadUploads) +
    prepared.evictedImageDeletion +
    rowsSequence(input, plan, prepared) +
    cursorSequence(input) +
    END_SYNCHRONIZED_OUTPUT;
  return { buffer, fullRedraw: plan.fullRedraw };
}

const compositeFlashes: {
  (screen: string[], flashLines: string[], frame: altScreenFrameTypes.FlashFrame): string[];
  (flashLines: string[], frame: altScreenFrameTypes.FlashFrame): (screen: string[]) => string[];
} = dual(
  3,
  (screen: string[], flashLines: string[], frame: altScreenFrameTypes.FlashFrame): string[] => {
    const visibleFlashes = flashLines.slice(-frame.height);
    if (visibleFlashes.length === 0) return screen;
    const result = [...screen];
    while (result.length < frame.height) result.push("");
    for (const [row, line] of visibleFlashes.entries()) {
      const flashWidth = visibleWidth(line);
      if (flashWidth === 0) continue;
      result[row] = compositeTuiLine(
        result[row] ?? "",
        line,
        frame.width - flashWidth,
        flashWidth,
        frame.width,
      );
    }
    return result;
  },
);

const altScreenFrame = {
  buildAltScreenFrame,
  compositeFlashes,
};

export default altScreenFrame;
