import { Effect } from "effect";

import { matchCsiSequence } from "./ansi-sequences.ts";
import { primeTerminalCapabilities } from "./terminal-capabilities-probe.ts";
import {
  getCapabilities,
  needsTmuxHyperlinkProbe,
  setCellDimensions,
} from "./terminal-capabilities.ts";

const CELL_SIZE_BODY = /^6;(\d+);(\d+)$/u;

export function cellSizeQuery(): string {
  return getCapabilities().images === null ? "" : "\x1b[16t";
}

export type CellSizeResponse = "none" | "ignored" | "updated";

export function consumeCellSizeResponse(data: string): CellSizeResponse {
  const [, height, width] =
    matchCsiSequence({ data, finals: "t", body: CELL_SIZE_BODY })?.groups ?? [];
  if (height === undefined || width === undefined) {
    return "none";
  }
  const heightPx = parseInt(height, 10);
  const widthPx = parseInt(width, 10);
  if (heightPx <= 0 || widthPx <= 0) {
    return "ignored";
  }
  setCellDimensions({ widthPx, heightPx });
  return "updated";
}

export function probeCapabilitiesInBackground(onUpdate: () => void): void {
  if (!needsTmuxHyperlinkProbe()) return;
  Effect.runFork(primeTerminalCapabilities.pipe(Effect.andThen(Effect.sync(onUpdate))));
}
