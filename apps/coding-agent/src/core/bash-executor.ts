import type { WriteStream } from "node:fs";
import { finished } from "node:stream/promises";

import { splitIncompleteAnsiSuffix, stripAnsi } from "../utils/ansi.ts";
import { createOutputFileStream } from "../utils/output-files.ts";
import { sanitizeBinaryOutput } from "../utils/shell.ts";
import type { BashOperations } from "./tools/bash.ts";
import { DEFAULT_MAX_BYTES, truncateTail } from "./tools/truncate.ts";

export interface BashExecutorOptions {
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface BashResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string | undefined;
}

export async function executeBashWithOperations(
  command: string,
  cwd: string,
  operations: BashOperations,
  options?: BashExecutorOptions,
): Promise<BashResult> {
  const outputChunks: string[] = [];
  let outputBytes = 0;
  const maxOutputBytes = DEFAULT_MAX_BYTES * 2;

  let tempFilePath: string | undefined;
  let tempFileStream: WriteStream | undefined;
  let totalBytes = 0;

  const ensureTempFile = () => {
    if (tempFilePath) {
      return;
    }
    ({ path: tempFilePath, stream: tempFileStream } = createOutputFileStream("msa-bash", ".log"));
    for (const chunk of outputChunks) {
      tempFileStream.write(chunk);
    }
  };

  const decoder = new TextDecoder();
  let pendingAnsi = "";

  const appendText = (rawText: string) => {
    const text = sanitizeBinaryOutput(stripAnsi(rawText)).replace(/\r/g, "");
    if (!text) {
      return;
    }

    if (totalBytes > DEFAULT_MAX_BYTES) {
      ensureTempFile();
    }

    if (tempFileStream) {
      tempFileStream.write(text);
    }

    outputChunks.push(text);
    outputBytes += text.length;
    while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
      const removed = outputChunks.shift()!;
      outputBytes -= removed.length;
    }

    if (options?.onChunk) {
      options.onChunk(text);
    }
  };

  const onData = (data: Buffer) => {
    totalBytes += data.length;
    const { complete, pending } = splitIncompleteAnsiSuffix(
      pendingAnsi + decoder.decode(data, { stream: true }),
    );
    pendingAnsi = pending;
    appendText(complete);
  };

  const flushOutput = () => {
    const rest = pendingAnsi + decoder.decode();
    pendingAnsi = "";
    appendText(rest);
  };

  let exitCode: number | null = null;
  try {
    ({ exitCode } = await operations.exec(command, cwd, { onData, signal: options?.signal }));
  } catch (err) {
    if (!options?.signal?.aborted) {
      tempFileStream?.end();
      throw err;
    }
  }

  flushOutput();
  const fullOutput = outputChunks.join("");
  const truncationResult = truncateTail(fullOutput);
  if (truncationResult.truncated) {
    ensureTempFile();
  }
  if (tempFileStream) await finished(tempFileStream.end());
  const cancelled = options?.signal?.aborted ?? false;

  return {
    output: truncationResult.truncated ? truncationResult.content : fullOutput,
    exitCode: cancelled ? undefined : (exitCode ?? undefined),
    cancelled,
    truncated: truncationResult.truncated,
    fullOutputPath: tempFilePath,
  };
}
