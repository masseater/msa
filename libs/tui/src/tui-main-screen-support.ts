import * as os from "node:os";

import { Clock, DateTime, Effect, Random } from "effect";
import { dual } from "effect/Function";

import BoundedTerminalWriter from "./bounded-terminal-writer.ts";
import fileLog from "./file-log.ts";
import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";
import type tuiMainScreenSupportTypes from "./tui-main-screen-support.types.ts";

const { writeFileInBackground } = fileLog;
const { Platform, pathOperations, platformRuntime } = platformModule;

const KITTY_SEQUENCE_PREFIX = "\x1b_G";

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

function extractKittyImageIds(line: string): number[] {
  return parseKittyImageHeader(line)?.ids ?? [];
}

function extractKittyImageRows(line: string): number {
  return parseKittyImageHeader(line)?.rows ?? 1;
}

function nowIso(): string {
  return DateTime.formatIso(Effect.runSync(DateTime.now));
}

const appendRedrawLog: {
  (directory: string, message: string): void;
  (message: string): (directory: string) => void;
} = dual(2, (directory: string, message: string): void => {
  writeFileInBackground(
    Effect.succeed({
      append: true,
      data: `[${nowIso()}] fullRender: ${message}\n`,
      path: pathOperations.join(directory, "msa-tui-debug.log"),
    }),
  );
});

const writeCrashLog: {
  (
    directory: string | undefined,
    lines: readonly string[],
  ): Effect.Effect<string, platformTypes.PlatformFailure, platformTypes.Platform>;
  (
    lines: readonly string[],
  ): (
    directory: string | undefined,
  ) => Effect.Effect<string, platformTypes.PlatformFailure, platformTypes.Platform>;
} = dual(
  2,
  (
    directory: string | undefined,
    lines: readonly string[],
  ): Effect.Effect<string, platformTypes.PlatformFailure, platformTypes.Platform> =>
    Effect.gen(function* () {
      const platform = yield* Platform;
      const crashLogPath = pathOperations.join(directory ?? os.tmpdir(), "msa-tui-crash.log");
      const data = [`Crash at ${nowIso()}`, ...lines].join("\n");
      yield* platform.writeFile({ append: false, data, path: crashLogPath });
      return crashLogPath;
    }),
);

const crashAfterLogging = (
  crash: tuiMainScreenSupportTypes.RenderCrash,
): Effect.Effect<never, never, platformTypes.Platform> =>
  writeCrashLog(crash.directory, crash.lines).pipe(
    Effect.matchEffect({
      onFailure: (failure) =>
        Effect.die(
          new Error(crash.message(`(not written: ${failure.operation} failed)`), {
            cause: failure,
          }),
        ),
      onSuccess: (crashLogPath) => Effect.die(new Error(crash.message(crashLogPath))),
    }),
  );

function raiseRenderCrash(crash: tuiMainScreenSupportTypes.RenderCrash): Promise<never> {
  return platformRuntime.runPromise(crashAfterLogging(crash));
}

function writeRenderDebugLog(lines: readonly string[]): void {
  const debugPath = pathOperations.join(
    "/tmp/tui",
    `render-${Effect.runSync(Clock.currentTimeMillis)}-${Effect.runSync(Random.next).toString(36).slice(2)}.log`,
  );
  writeFileInBackground(Effect.succeed({ append: false, data: lines.join("\n"), path: debugPath }));
}

const tuiMainScreenSupport = {
  BoundedTerminalWriter,
  appendRedrawLog,
  crashAfterLogging,
  extractKittyImageIds,
  extractKittyImageRows,
  raiseRenderCrash,
  writeCrashLog,
  writeRenderDebugLog,
};

export default tuiMainScreenSupport;
