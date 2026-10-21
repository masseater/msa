import { Effect, Random } from "effect";
import { dual } from "effect/Function";

import type terminalImageKittyTypes from "./terminal-image-kitty.types.ts";

const KITTY_PREFIX = "\x1b_G";
const ITERM2_PREFIX = "\x1b]1337;File=";

function isImageLine(line: string): boolean {
  if (line.startsWith(KITTY_PREFIX) || line.startsWith(ITERM2_PREFIX)) {
    return true;
  }
  return line.includes(KITTY_PREFIX) || line.includes(ITERM2_PREFIX);
}

function allocateImageId(): number {
  return Math.floor(Effect.runSync(Random.next) * 0xfffffffe) + 1;
}

const encodeKitty: {
  (
    base64Data: string,
    options?: {
      columns?: number;
      rows?: number;
      imageId?: number | undefined;
      moveCursor?: boolean | undefined;
    },
  ): string;
  (options?: {
    columns?: number;
    rows?: number;
    imageId?: number | undefined;
    moveCursor?: boolean | undefined;
  }): (base64Data: string) => string;
} = dual(
  (args) => typeof args[0] === "string",
  (
    base64Data: string,
    options: {
      columns?: number;
      rows?: number;
      imageId?: number | undefined;
      moveCursor?: boolean | undefined;
    } = {},
  ): string => {
    const CHUNK_SIZE = 4096;

    const params: string[] = ["a=T", "f=100", "q=2"];

    if (options.moveCursor === false) params.push("C=1");
    if (options.columns !== undefined && options.columns !== 0) params.push(`c=${options.columns}`);
    if (options.rows !== undefined && options.rows !== 0) params.push(`r=${options.rows}`);
    if (options.imageId !== undefined && options.imageId !== 0) params.push(`i=${options.imageId}`);

    if (base64Data.length <= CHUNK_SIZE) {
      return `\x1b_G${params.join(",")};${base64Data}\x1b\\`;
    }

    const chunks: string[] = [];
    let offset = 0;
    let isFirst = true;

    while (offset < base64Data.length) {
      const chunk = base64Data.slice(offset, offset + CHUNK_SIZE);
      const isLast = offset + CHUNK_SIZE >= base64Data.length;

      if (isFirst) {
        chunks.push(`\x1b_G${params.join(",")},m=1;${chunk}\x1b\\`);
        isFirst = false;
      } else if (isLast) {
        chunks.push(`\x1b_Gm=0;${chunk}\x1b\\`);
      } else {
        chunks.push(`\x1b_Gm=1;${chunk}\x1b\\`);
      }

      offset += CHUNK_SIZE;
    }

    return chunks.join("");
  },
);

function deleteKittyImage(imageId: number): string {
  return `\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`;
}

function deleteAllKittyImages(): string {
  return "\x1b_Ga=d,d=A,q=2\x1b\\";
}

function deleteAllKittyPlacements(): string {
  return "\x1b_Ga=d,d=a,q=2\x1b\\";
}

interface RegisteredKittyImageMetadata extends terminalImageKittyTypes.KittyImageMetadata {
  transmissionGeneration: number;
}

const kittyImageMetadata = new Map<number, RegisteredKittyImageMetadata>();
let kittyTransmissionGeneration = 0;

function registerKittyImageMetadata(metadata: terminalImageKittyTypes.KittyImageMetadata): void {
  kittyTransmissionGeneration += 1;
  kittyImageMetadata.delete(metadata.imageId);
  kittyImageMetadata.set(metadata.imageId, {
    ...metadata,
    transmissionGeneration: kittyTransmissionGeneration,
  });
  if (kittyImageMetadata.size > 1000) {
    const oldestImageId = kittyImageMetadata.keys().next().value;
    if (oldestImageId !== undefined) kittyImageMetadata.delete(oldestImageId);
  }
}

function getRegisteredKittyImageMetadataFromControls(
  controls: string,
): RegisteredKittyImageMetadata | undefined {
  const imageId = /(?:^|,)i=(\d+)(?:,|$)/u.exec(controls)?.[1];
  return imageId === undefined ? undefined : kittyImageMetadata.get(Number.parseInt(imageId, 10));
}

interface KittyCommand {
  index: number;
  controls: string;
  length: number;
}

function findKittyCommand(line: string): KittyCommand | undefined {
  const index = line.indexOf(KITTY_PREFIX);
  if (index === -1) return undefined;
  const controlsEnd = line.indexOf(";", index + KITTY_PREFIX.length);
  if (controlsEnd === -1) return undefined;
  return {
    controls: line.slice(index + KITTY_PREFIX.length, controlsEnd),
    index,
    length: controlsEnd + 1 - index,
  };
}

function getRegisteredKittyImageMetadata(line: string): RegisteredKittyImageMetadata | undefined {
  const controls = findKittyCommand(line)?.controls;
  return controls === undefined ? undefined : getRegisteredKittyImageMetadataFromControls(controls);
}

function getExplicitKittyImageRows(controls: string): number | undefined {
  const value = /(?:^|,)r=(\d+)(?:,|$)/u.exec(controls)?.[1];
  if (value === undefined) return undefined;
  const rows = Number.parseInt(value, 10);
  return rows > 0 ? rows : undefined;
}

function getKittyImageRowsFromControls(controls: string, fallbackRows: number): number {
  return getExplicitKittyImageRows(controls) ?? fallbackRows;
}

function getKittyImageMetadata(
  line: string,
): terminalImageKittyTypes.KittyImageMetadata | undefined {
  const metadata = getRegisteredKittyImageMetadata(line);
  if (metadata === undefined) return undefined;
  return {
    columns: metadata.columns,
    heightPx: metadata.heightPx,
    imageId: metadata.imageId,
    rows: metadata.rows,
    widthPx: metadata.widthPx,
  };
}

const KITTY_PLACEMENT_CONTROL_KEYS = new Set([
  "i",
  "p",
  "x",
  "y",
  "w",
  "h",
  "X",
  "Y",
  "c",
  "r",
  "C",
  "U",
  "z",
  "P",
  "Q",
  "H",
  "V",
]);

function getKittyImagePlacementRows(line: string): number | undefined {
  const controls = findKittyCommand(line)?.controls;
  if (controls === undefined) return undefined;
  const explicitRows = getExplicitKittyImageRows(controls);
  if (explicitRows !== undefined) return explicitRows;
  return getRegisteredKittyImageMetadataFromControls(controls)?.rows;
}

function getKittyImagePlacement(
  line: string,
): terminalImageKittyTypes.KittyImagePlacement | undefined {
  const match = findKittyCommand(line);
  const imageControls = match?.controls;
  if (match === undefined || imageControls === undefined) return undefined;
  const metadata = getRegisteredKittyImageMetadataFromControls(imageControls);
  if (metadata === undefined) return undefined;

  let commandStart = match.index;
  let commandControls = imageControls;
  let transmissionEnd: number;
  while (true) {
    const terminator = line.indexOf("\x1b\\", commandStart + KITTY_PREFIX.length);
    if (terminator === -1) return undefined;
    transmissionEnd = terminator + 2;
    if (!/(?:^|,)m=1(?:,|$)/u.test(commandControls)) break;
    commandStart = transmissionEnd;
    if (!line.startsWith(KITTY_PREFIX, commandStart)) return undefined;
    const controlsEnd = line.indexOf(";", commandStart + KITTY_PREFIX.length);
    if (controlsEnd === -1) return undefined;
    commandControls = line.slice(commandStart + KITTY_PREFIX.length, controlsEnd);
  }

  const controls = imageControls
    .split(",")
    .filter((control) => KITTY_PLACEMENT_CONTROL_KEYS.has(control.split("=", 1)[0] ?? ""));
  const sequence = `\x1b_Ga=p,q=2,${controls.join(",")}\x1b\\`;
  return {
    estimatedDecodedBytes: metadata.widthPx * metadata.heightPx * 4,
    imageId: metadata.imageId,
    replacementLine: `${line.slice(0, match.index)}${sequence}${line.slice(transmissionEnd)}`,
    rows: getKittyImageRowsFromControls(imageControls, metadata.rows),
    sequence,
    transmissionBytes: transmissionEnd - match.index,
    transmissionGeneration: metadata.transmissionGeneration,
  };
}

const cropKittyImageLine: {
  (line: string, hiddenRows: number, visibleRows: number): string;
  (hiddenRows: number, visibleRows: number): (line: string) => string;
} = dual(3, (line: string, hiddenRows: number, visibleRows: number): string => {
  const metadata = getKittyImageMetadata(line);
  const match = findKittyCommand(line);
  const imageControls = match?.controls;
  if (
    metadata === undefined ||
    match === undefined ||
    imageControls === undefined ||
    hiddenRows < 0 ||
    hiddenRows >= metadata.rows ||
    visibleRows <= 0
  )
    return line;
  const croppedRows = Math.min(visibleRows, metadata.rows - hiddenRows);
  if (hiddenRows === 0 && croppedRows === metadata.rows) return line;
  const sourceY = Math.floor((metadata.heightPx * hiddenRows) / metadata.rows);
  const sourceEnd = Math.ceil((metadata.heightPx * (hiddenRows + croppedRows)) / metadata.rows);
  const sourceHeight = Math.max(1, Math.min(metadata.heightPx, sourceEnd) - sourceY);
  const controls = imageControls.split(",").filter((control) => !/^[yhr]=/u.test(control));
  controls.push(`y=${sourceY}`, `h=${sourceHeight}`, `r=${croppedRows}`);
  return `${line.slice(0, match.index)}\x1b_G${controls.join(",")};${line.slice(match.index + match.length)}`;
});

const terminalImageKitty = {
  allocateImageId,
  cropKittyImageLine,
  deleteAllKittyImages,
  deleteAllKittyPlacements,
  deleteKittyImage,
  encodeKitty,
  getKittyImageMetadata,
  getKittyImagePlacement,
  getKittyImagePlacementRows,
  isImageLine,
  registerKittyImageMetadata,
};

export default terminalImageKitty;
