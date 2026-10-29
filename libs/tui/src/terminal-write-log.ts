import localTime from "@msa/chord/local-time";
import { Clock, Effect } from "effect";

import env from "./env.ts";
import fileLog from "./file-log.ts";
import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";

const { Platform, pathOperations } = platformModule;
const { readEnv } = env;
const { writeFileInBackground } = fileLog;

function timestampedLogName(): string {
  const ts = localTime.format(Effect.runSync(Clock.currentTimeMillis), "YYYY-MM-DD_HH-mm-ss");
  return `tui-${ts}-${process.pid}.log`;
}

function resolveWriteLogPath(
  configured: string,
): Effect.Effect<string, never, platformTypes.Platform> {
  const logName = timestampedLogName();
  return Effect.gen(function* () {
    const platform = yield* Platform;
    const isDirectory = yield* platform.isDirectory(configured);
    return isDirectory ? pathOperations.join(configured, logName) : configured;
  });
}

export default class TerminalWriteLog {
  private readonly path: Effect.Effect<string, never, platformTypes.Platform> | undefined;

  constructor(configured: string = readEnv("MSA_TUI_WRITE_LOG") ?? "") {
    this.path =
      configured === ""
        ? undefined
        : Effect.runSync(Effect.cached(resolveWriteLogPath(configured)));
  }

  append(data: string): void {
    if (this.path === undefined) return;
    writeFileInBackground(Effect.map(this.path, (path) => ({ append: true, data, path })));
  }
}
