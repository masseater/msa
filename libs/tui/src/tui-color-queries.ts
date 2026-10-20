import { Effect } from "effect";

import ansiSequences from "./ansi-sequences.ts";
import delay from "./delay.ts";
import type delayTypes from "./delay.types.ts";
import terminalColors from "./terminal-colors.ts";
import type terminalColorsTypes from "./terminal-colors.types.ts";
import type tuiColorQueriesTypes from "./tui-color-queries.types.ts";

const { parseOscColorResponse, parseTerminalColorSchemeReport } = terminalColors;
const { matchCsiSequence } = ansiSequences;
const { runAfter } = delay;

type PendingTerminalColorQuery = {
  foreground?: terminalColorsTypes.RgbColor | undefined;
  background?: terminalColorsTypes.RgbColor | undefined;
  palette: Array<terminalColorsTypes.RgbColor | undefined>;
  replied: Set<string>;
  deliver: ((colors: terminalColorsTypes.TerminalColors) => void) | undefined;
  cancelTimeout: delayTypes.CancelDelay | undefined;
};

const TERMINAL_PALETTE_SIZE = 16;
const TERMINAL_COLOR_REPLY_COUNT = 2 + TERMINAL_PALETTE_SIZE;
const TERMINAL_COLOR_QUERY = `\x1b]10;?\x07\x1b]11;?\x07${Array.from(
  { length: TERMINAL_PALETTE_SIZE },
  (_, index) => `\x1b]4;${index};?\x07`,
).join("")}\x1b[c`;
const DEVICE_ATTRIBUTES_BODY = /^\?[\d;]*$/u;

function terminalColorQueryResult(
  query: PendingTerminalColorQuery,
): terminalColorsTypes.TerminalColors {
  const palette = query.palette.every((color) => color !== undefined)
    ? (query.palette as terminalColorsTypes.RgbColor[])
    : undefined;
  return { background: query.background, foreground: query.foreground, palette };
}

function completeTerminalColorQuery(query: PendingTerminalColorQuery): void {
  const deliver = query.deliver;
  query.deliver = undefined;
  query.cancelTimeout?.();
  deliver?.(terminalColorQueryResult(query));
}

export default class TerminalColorQueries {
  private readonly pending: PendingTerminalColorQuery[] = [];
  private readonly schemeListeners = new Set<
    (scheme: terminalColorsTypes.TerminalColorScheme) => void
  >();

  onSchemeChange(listener: (scheme: terminalColorsTypes.TerminalColorScheme) => void): () => void {
    this.schemeListeners.add(listener);
    return () => {
      this.schemeListeners.delete(listener);
    };
  }

  consumeSchemeReport(data: string): boolean {
    const scheme = parseTerminalColorSchemeReport(data);
    if (scheme === undefined) {
      return false;
    }
    for (const listener of this.schemeListeners) {
      listener(scheme);
    }
    return true;
  }

  consumeResponse(data: string): boolean {
    const query = this.pending[0];
    if (query === undefined) {
      return false;
    }
    if (matchCsiSequence({ body: DEVICE_ATTRIBUTES_BODY, data, finals: "c" }) !== null) {
      this.pending.shift();
      completeTerminalColorQuery(query);
      return true;
    }

    const response = parseOscColorResponse(data);
    if (response === undefined) {
      return false;
    }
    const { target, rgb } = response;
    const key = String(target);
    if (query.deliver === undefined || query.replied.has(key)) {
      return true;
    }
    query.replied.add(key);
    if (target === "foreground") {
      query.foreground = rgb;
    } else if (target === "background") {
      query.background = rgb;
    } else if (target < TERMINAL_PALETTE_SIZE) {
      query.palette[target] = rgb;
    }
    if (query.replied.size === TERMINAL_COLOR_REPLY_COUNT) {
      completeTerminalColorQuery(query);
    }
    return true;
  }

  query(
    { timeoutMs, onLateReply }: tuiColorQueriesTypes.TerminalColorQueryOptions,
    write: (data: string) => void,
  ): Promise<terminalColorsTypes.TerminalColors> {
    return Effect.runPromise(
      Effect.callback<terminalColorsTypes.TerminalColors>((resume) => {
        const resolve = (colors: terminalColorsTypes.TerminalColors): void =>
          resume(Effect.succeed(colors));
        const query: PendingTerminalColorQuery = {
          cancelTimeout: undefined,
          deliver: resolve,
          palette: Array.from({ length: TERMINAL_PALETTE_SIZE }, () => undefined),
          replied: new Set(),
        };
        query.cancelTimeout = runAfter(timeoutMs, () => {
          query.deliver = onLateReply;
          resolve(terminalColorQueryResult(query));
        });
        this.pending.push(query);
        write(TERMINAL_COLOR_QUERY);
      }),
    );
  }
}
