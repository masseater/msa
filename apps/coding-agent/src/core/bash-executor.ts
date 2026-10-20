import * as Effect from "effect/Effect";

import ansi from "../utils/ansi.ts";
import outputFiles from "../utils/output-files.ts";
import shell from "../utils/shell.ts";
import awaitingModule from "./awaiting.ts";
import type bashExecutorTypes from "./bash-executor.types.ts";
import type nodeFsTypes from "./platform/node/fs.types.ts";
import nodeStreamPromises from "./platform/node/stream-promises.ts";
import type bashTypes from "./tools/bash.types.ts";
import truncate from "./tools/truncate.ts";

const { finished } = nodeStreamPromises;

const { awaited, awaiting } = awaitingModule;
const { DEFAULT_MAX_BYTES, truncateTail } = truncate;
const { createOutputFileStream } = outputFiles;
const { sanitizeBinaryOutput } = shell;
const { splitIncompleteAnsiSuffix, stripAnsi } = ansi;

function executeBashWithOperations(
  command: string,
  cwd: string,
  operations: bashTypes.BashOperations,
  options?: bashExecutorTypes.BashExecutorOptions,
): Promise<bashExecutorTypes.BashResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const outputChunks: string[] = [];
      let outputBytes = 0;
      const maxOutputBytes = DEFAULT_MAX_BYTES * 2;

      let tempFilePath: string | undefined;
      let tempFileStream: nodeFsTypes.WriteStream | undefined;
      let totalBytes = 0;

      const ensureTempFile = () => {
        if (tempFilePath !== undefined && tempFilePath !== "") {
          return;
        }
        ({ path: tempFilePath, stream: tempFileStream } = createOutputFileStream(
          "msa-bash",
          ".log",
        ));
        for (const chunk of outputChunks) {
          tempFileStream.write(chunk);
        }
      };

      const decoder = new TextDecoder();
      let pendingAnsi = "";

      const appendText = (rawText: string) => {
        const text = sanitizeBinaryOutput(stripAnsi(rawText)).replace(/\r/gu, "");
        if (text === "") {
          return;
        }

        if (totalBytes > DEFAULT_MAX_BYTES) {
          ensureTempFile();
        }

        if (tempFileStream !== undefined) {
          tempFileStream.write(text);
        }

        outputChunks.push(text);
        outputBytes += text.length;
        while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
          const removed = outputChunks.shift()!;
          outputBytes -= removed.length;
        }

        if (options?.onChunk !== undefined) {
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
        ({ exitCode } = yield* awaited(
          operations.exec(command, cwd, { onData, signal: options?.signal }),
        ));
      } catch (err) {
        if (options?.signal?.aborted !== true) {
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
      if (tempFileStream !== undefined) {
        const closed = tempFileStream.end();
        const settled = finished(closed);
        yield* awaited(settled);
      }
      const cancelled = options?.signal?.aborted ?? false;

      return {
        cancelled,
        exitCode: cancelled ? undefined : (exitCode ?? undefined),
        fullOutputPath: tempFilePath,
        output: truncationResult.truncated ? truncationResult.content : fullOutput,
        truncated: truncationResult.truncated,
      };
    }),
  );
}

const bashExecutor = {
  executeBashWithOperations,
};

export default bashExecutor;
