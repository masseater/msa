import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import type argsTypes from "../cli/args.types.ts";
import fileProcessor from "../cli/file-processor.ts";
import initialMessageModule from "../cli/initial-message.ts";
import awaitingModule from "../core/awaiting.ts";
import interop from "../utils/interop.ts";
import pathsModule from "../utils/paths.ts";

const { processFileArguments } = fileProcessor;
const { buildInitialMessage } = initialMessageModule;
const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { resolvePath, isLocalPath } = pathsModule;

function readPipedStdin(): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (process.stdin.isTTY) {
        return undefined;
      }

      return yield* awaited(
        callbackPromise((resolve) => {
          let data = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => {
            data += chunk;
          });
          process.stdin.on("end", () => {
            resolve(data.trim() || undefined);
          });
          process.stdin.resume();
        }),
      );
    }),
  );
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
  return paths?.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value));
}

function prepareInitialMessage(
  parsed: argsTypes.Args,
  stdinContent?: string,
): Promise<{
  initialMessage?: string | undefined;
  initialImages?: aiTypes.ImageContent[] | undefined;
}> {
  return Effect.runPromise(
    awaiting(function* () {
      if (parsed.fileArgs.length === 0) {
        return buildInitialMessage({ parsed, stdinContent });
      }

      const { text, images } = yield* awaited(
        processFileArguments(parsed.fileArgs, { autoResizeImages: false }),
      );
      return buildInitialMessage({
        fileImages: images,
        fileText: text,
        parsed,
        stdinContent,
      });
    }),
  );
}

const cliInput = { isTruthyEnvFlag, prepareInitialMessage, readPipedStdin, resolveCliPaths };

export default cliInput;
