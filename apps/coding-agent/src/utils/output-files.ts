import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";

import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import { join } from "../core/platform-node.ts";
import { writeFile } from "./node-fs.ts";
import { randomHex } from "./platform-extra.ts";

const OUTPUT_FILE_MODE = 0o600;

function createOutputFilePath(prefix: string, extension: string): string {
  return join(tmpdir(), `${prefix}-${randomHex(8)}${extension}`);
}

export function writeOutputFile(
  prefix: string,
  extension: string,
  data: string | Uint8Array,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const path = createOutputFilePath(prefix, extension);

      yield* awaited(writeFile({ path, data, mode: OUTPUT_FILE_MODE, flag: "wx" }));
      return path;
    }),
  );
}

export function createOutputFileStream(
  prefix: string,
  extension: string,
): { path: string; stream: WriteStream } {
  const path = createOutputFilePath(prefix, extension);
  return { path, stream: createWriteStream(path, { mode: OUTPUT_FILE_MODE, flags: "wx" }) };
}
