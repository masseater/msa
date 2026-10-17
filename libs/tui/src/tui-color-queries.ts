import { Effect } from "effect";

import { matchCsiSequence } from "./ansi-sequences.ts";
import { type CancelDelay, runAfter } from "./delay.ts";
import {
  parseOscColorResponse,
  parseTerminalColorSchemeReport,
  type RgbColor,
  type TerminalColors,
  type TerminalColorScheme,
} from "./terminal-colors.ts";

type PendingTerminalColorQuery = {
  foreground?: RgbColor | undefined;
  background?: RgbColor | undefined;
  palette: Array<RgbColor | undefined>;
  replied: Set<string>;
  deliver: ((colors: TerminalColors) => void) | undefined;
  cancelTimeout: CancelDelay | undefined;
};

export interface TerminalColorQueryOptions {
  timeoutMs: number;
  onLateReply?: (colors: TerminalColors) => void;
}

const TERMINAL_PALETTE_SIZE = 16;
const TERMINAL_COLOR_REPLY_COUNT = 2 + TERMINAL_PALETTE_SIZE;
const TERMINAL_COLOR_QUERY = `\x1b]10;?\x07\x1b]11;?\x07${Array.from(
  { length: TERMINAL_PALETTE_SIZE },
  (_, index) => `\x1b]4;${index};?\x07`,
).join("")}\x1b[c`;
const DEVICE_ATTRIBUTES_BODY = /^\?[\d;]*$/u;

function terminalColorQueryResult(query: PendingTerminalColorQuery): TerminalColors {
  const palette = query.palette.every((color) => color !== undefined)
    ? (query.palette as RgbColor[])
    : undefined;
  return { foreground: query.foreground, background: query.background, palette };
}

function completeTerminalColorQuery(query: PendingTerminalColorQuery): void {
  const deliver = query.deliver;
  query.deliver = undefined;
  query.cancelTimeout?.();
  deliver?.(terminalColorQueryResult(query));
}

export class TerminalColorQueries {
  private readonly pending: PendingTerminalColorQuery[] = [];
  private readonly schemeListeners = new Set<(scheme: TerminalColorScheme) => void>();

  onSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void {
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
    if (matchCsiSequence({ data, finals: "c", body: DEVICE_ATTRIBUTES_BODY }) !== null) {
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
    { timeoutMs, onLateReply }: TerminalColorQueryOptions,
    write: (data: string) => void,
  ): Promise<TerminalColors> {
    return Effect.runPromise(
      Effect.callback<TerminalColors>((resume) => {
        const resolve = (colors: TerminalColors): void => resume(Effect.succeed(colors));
        const query: PendingTerminalColorQuery = {
          palette: Array.from({ length: TERMINAL_PALETTE_SIZE }, () => undefined),
          replied: new Set(),
          deliver: resolve,
          cancelTimeout: undefined,
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
