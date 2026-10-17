import * as fs from "node:fs";
import * as os from "node:os";

import { Clock, DateTime, Effect, Random } from "effect";
import { dual } from "effect/Function";

import { writeFileInBackground } from "./file-log.ts";
import { pathOperations } from "./platform.ts";

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
  (directory: string | undefined, lines: readonly string[]): string;
  (lines: readonly string[]): (directory: string | undefined) => string;
} = dual(2, (directory: string | undefined, lines: readonly string[]): string => {
  const crashLogPath = pathOperations.join(directory ?? os.tmpdir(), "msa-tui-crash.log");
  const crashData = [`Crash at ${nowIso()}`, ...lines].join("\n");
  fs.mkdirSync(pathOperations.dirname(crashLogPath), { recursive: true });
  fs.writeFileSync(crashLogPath, crashData);
  return crashLogPath;
});

export function writeRenderDebugLog(lines: readonly string[]): void {
  const debugPath = pathOperations.join(
    "/tmp/tui",
    `render-${Effect.runSync(Clock.currentTimeMillis)}-${Effect.runSync(Random.next).toString(36).slice(2)}.log`,
  );
  writeFileInBackground(Effect.succeed({ path: debugPath, data: lines.join("\n"), append: false }));
}
