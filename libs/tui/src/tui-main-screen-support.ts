import * as os from "node:os";

import { Clock, DateTime, Effect, Random } from "effect";
import { dual } from "effect/Function";

import { writeFileInBackground } from "./file-log.ts";
import { Platform, type PlatformFailure, pathOperations, platformRuntime } from "./platform.ts";

const KITTY_SEQUENCE_PREFIX = "\x1b_G";
const MAX_RENDER_WRITE_CHARS = 1024 * 1024;

export class BoundedTerminalWriter {
  private buffer = "";
  private writtenChars = 0;
  private readonly write: (data: string) => void;

  constructor(write: (data: string) => void) {
    this.write = write;
  }

  append(value: string): void {
    let offset = 0;
    while (offset < value.length) {
      const capacity = MAX_RENDER_WRITE_CHARS - this.buffer.length;
      if (capacity === 0) {
        this.flush();
        continue;
      }

      let end = Math.min(value.length, offset + capacity);
      if (
        end < value.length &&
        value.charCodeAt(end - 1) >= 0xd800 &&
        value.charCodeAt(end - 1) <= 0xdbff &&
        value.charCodeAt(end) >= 0xdc00 &&
        value.charCodeAt(end) <= 0xdfff
      ) {
        end--;
      }
      if (end === offset) {
        this.flush();
        continue;
      }

      this.buffer += value.slice(offset, end);
      offset = end;
      if (this.buffer.length === MAX_RENDER_WRITE_CHARS) {
        this.flush();
      }
    }
  }

  flush(): void {
    if (this.buffer === "") return;
    this.write(this.buffer);
    this.writtenChars += this.buffer.length;
    this.buffer = "";
  }

  get length(): number {
    return this.writtenChars + this.buffer.length;
  }
}

interface KittyImageHeader {
  ids: number[];
  rows: number;
}

function parseKittyImageHeader(line: string): KittyImageHeader | undefined {
  const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
  if (sequenceStart === -1) return undefined;
  const paramsStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
  const paramsEnd = line.indexOf(";", paramsStart);
  if (paramsEnd === -1) return undefined;

  const ids: number[] = [];
  let rows = 1;
  for (const param of line.slice(paramsStart, paramsEnd).split(",")) {
    const [key, value] = param.split("=", 2);
    if (value === undefined) continue;
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > 0xffffffff) continue;
    if (key === "i") ids.push(numberValue);
    else if (key === "r") rows = numberValue;
  }
  return { ids, rows };
}

export function extractKittyImageIds(line: string): number[] {
  return parseKittyImageHeader(line)?.ids ?? [];
}

export function extractKittyImageRows(line: string): number {
  return parseKittyImageHeader(line)?.rows ?? 1;
}

function nowIso(): string {
  return DateTime.formatIso(Effect.runSync(DateTime.now));
}

export const appendRedrawLog: {
  (directory: string, message: string): void;
  (message: string): (directory: string) => void;
} = dual(2, (directory: string, message: string): void => {
  writeFileInBackground(
    Effect.succeed({
      path: pathOperations.join(directory, "msa-tui-debug.log"),
      data: `[${nowIso()}] fullRender: ${message}\n`,
      append: true,
    }),
  );
});

export const writeCrashLog: {
  (
    directory: string | undefined,
    lines: readonly string[],
  ): Effect.Effect<string, PlatformFailure, Platform>;
  (
    lines: readonly string[],
  ): (directory: string | undefined) => Effect.Effect<string, PlatformFailure, Platform>;
} = dual(
  2,
  (
    directory: string | undefined,
    lines: readonly string[],
  ): Effect.Effect<string, PlatformFailure, Platform> =>
    Effect.gen(function* () {
      const platform = yield* Platform;
      const crashLogPath = pathOperations.join(directory ?? os.tmpdir(), "msa-tui-crash.log");
      const data = [`Crash at ${nowIso()}`, ...lines].join("\n");
      yield* platform.writeFile({ path: crashLogPath, data, append: false });
      return crashLogPath;
    }),
);

export interface RenderCrash {
  readonly directory: string | undefined;
  readonly lines: readonly string[];
  readonly message: (crashLogPath: string) => string;
}

export const crashAfterLogging = (crash: RenderCrash): Effect.Effect<never, never, Platform> =>
  writeCrashLog(crash.directory, crash.lines).pipe(
    Effect.matchEffect({
      onSuccess: (crashLogPath) => Effect.die(new Error(crash.message(crashLogPath))),
      onFailure: (failure) =>
        Effect.die(
          new Error(crash.message(`(not written: ${failure.operation} failed)`), {
            cause: failure,
          }),
        ),
    }),
  );

export function raiseRenderCrash(crash: RenderCrash): Promise<never> {
  return platformRuntime.runPromise(crashAfterLogging(crash));
}

export function writeRenderDebugLog(lines: readonly string[]): void {
  const debugPath = pathOperations.join(
    "/tmp/tui",
    `render-${Effect.runSync(Clock.currentTimeMillis)}-${Effect.runSync(Random.next).toString(36).slice(2)}.log`,
  );
  writeFileInBackground(Effect.succeed({ path: debugPath, data: lines.join("\n"), append: false }));
}
