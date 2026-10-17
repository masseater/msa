import { DateTime, Effect } from "effect";

import { readEnv } from "./env.ts";
import { writeFileInBackground } from "./file-log.ts";
import { Platform, pathOperations } from "./platform.ts";

function timestampedLogName(): string {
  const now = DateTime.toParts(
    DateTime.makeZonedUnsafe(Effect.runSync(DateTime.now), {
      timeZone: DateTime.zoneMakeLocal(),
    }),
  );
  const pad = (value: number): string => String(value).padStart(2, "0");
  const ts = `${now.year}-${pad(now.month)}-${pad(now.day)}_${pad(now.hour)}-${pad(now.minute)}-${pad(now.second)}`;
  return `tui-${ts}-${process.pid}.log`;
}

function resolveWriteLogPath(configured: string): Effect.Effect<string, never, Platform> {
  const logName = timestampedLogName();
  return Effect.gen(function* () {
    const platform = yield* Platform;
    const isDirectory = yield* platform.isDirectory(configured);
    return isDirectory ? pathOperations.join(configured, logName) : configured;
  });
}

export class TerminalWriteLog {
  private readonly path: Effect.Effect<string, never, Platform> | undefined;

  constructor(configured: string = readEnv("MSA_TUI_WRITE_LOG") ?? "") {
    this.path =
      configured === ""
        ? undefined
        : Effect.runSync(Effect.cached(resolveWriteLogPath(configured)));
  }

  append(data: string): void {
    if (this.path === undefined) return;
    writeFileInBackground(Effect.map(this.path, (path) => ({ path, data, append: true })));
  }
}
