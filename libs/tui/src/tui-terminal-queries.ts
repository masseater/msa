import { Effect } from "effect";

import ansiSequences from "./ansi-sequences.ts";
import terminalCapabilitiesProbe from "./terminal-capabilities-probe.ts";
import terminalCapabilities from "./terminal-capabilities.ts";
import type tuiTerminalQueriesTypes from "./tui-terminal-queries.types.ts";

const { getCapabilities, needsTmuxHyperlinkProbe, setCellDimensions } = terminalCapabilities;
const { matchCsiSequence } = ansiSequences;
const { primeTerminalCapabilities } = terminalCapabilitiesProbe;

const CELL_SIZE_BODY = /^6;(\d+);(\d+)$/u;

function cellSizeQuery(): string {
  return getCapabilities().images === null ? "" : "\x1b[16t";
}

function consumeCellSizeResponse(data: string): tuiTerminalQueriesTypes.CellSizeResponse {
  const [, height, width] =
    matchCsiSequence({ body: CELL_SIZE_BODY, data, finals: "t" })?.groups ?? [];
  if (height === undefined || width === undefined) {
    return "none";
  }
  const heightPx = parseInt(height, 10);
  const widthPx = parseInt(width, 10);
  if (heightPx <= 0 || widthPx <= 0) {
    return "ignored";
  }
  setCellDimensions({ heightPx, widthPx });
  return "updated";
}

function probeCapabilitiesInBackground(onUpdate: () => void): void {
  if (!needsTmuxHyperlinkProbe()) return;
  Effect.runFork(primeTerminalCapabilities.pipe(Effect.andThen(Effect.sync(onUpdate))));
}

const tuiTerminalQueries = {
  cellSizeQuery,
  consumeCellSizeResponse,
  probeCapabilitiesInBackground,
};

export default tuiTerminalQueries;
