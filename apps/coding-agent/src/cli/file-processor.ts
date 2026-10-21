import type aiTypes from "@msa/ai/index.types";
import chalk from "chalk";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import platformNode from "../core/platform-node.ts";
import platform from "../core/platform.ts";
import pathUtils from "../core/tools/path-utils.ts";
import errors from "../utils/errors.ts";
import imageProcess from "../utils/image-process.ts";
import mime from "../utils/mime.ts";
import nodeFs from "../utils/node-fs.ts";
import textModule from "../utils/text.ts";
import type fileProcessorTypes from "./file-processor.types.ts";

const { awaited, awaiting } = awaitingModule;
const { resolve } = platformNode;
const { resolveReadPath } = pathUtils;
const { access, fileSize, readFile, readText } = nodeFs;
const { writeError } = platform;
const { detectSupportedImageMimeTypeFromFile } = mime;
const { processImage } = imageProcess;
const { stripBom } = textModule;
const { toErrorMessage } = errors;

function processFileArgumentsImpl(
  fileArgs: string[],
  options?: fileProcessorTypes.ProcessFileOptions,
): Promise<fileProcessorTypes.ProcessedFiles> {
  return Effect.runPromise(
    awaiting(function* () {
      const autoResizeImages = options?.autoResizeImages ?? true;
      let text = "";
      const images: aiTypes.ImageContent[] = [];

      for (const fileArg of fileArgs) {
        const { size, absolutePath } = yield* statFileArgument(fileArg);
        if (size === 0) {
          continue;
        }

        const mimeType = yield* awaited(detectSupportedImageMimeTypeFromFile(absolutePath));

        if (mimeType !== null && mimeType !== "") {
          const content = yield* awaited(readFile(absolutePath));
          const processed = yield* awaited(processImage(content, mimeType, { autoResizeImages }));

          if (!processed.ok) {
            text += `<file name="${absolutePath}">${processed.message}</file>\n`;
            continue;
          }

          const attachment: aiTypes.ImageContent = {
            data: processed.data,
            mimeType: processed.mimeType,
            type: "image",
          };
          images.push(attachment);

          if (processed.hints.length > 0) {
            text += `<file name="${absolutePath}">${processed.hints.join("\n")}</file>\n`;
          } else {
            text += `<file name="${absolutePath}"></file>\n`;
          }
        } else {
          try {
            const content = stripBom(yield* awaited(readText(absolutePath)));
            text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
          } catch (error: unknown) {
            const message = toErrorMessage(error);
            writeError(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
            process.exit(1);
          }
        }
      }

      return { images, text };
    }),
  );
}

const processFileArguments: {
  (
    fileArgs: string[],
    options?: fileProcessorTypes.ProcessFileOptions,
  ): Promise<fileProcessorTypes.ProcessedFiles>;
  (
    options?: fileProcessorTypes.ProcessFileOptions,
  ): (fileArgs: string[]) => Promise<fileProcessorTypes.ProcessedFiles>;
} = dual((args: IArguments) => args.length >= 1, processFileArgumentsImpl);

const fileProcessor = {
  processFileArguments,
};

export default fileProcessor;

function* statFileArgument(fileArg: string) {
  const absolutePath = resolve(yield* awaited(resolveReadPath(fileArg, process.cwd())));

  try {
    yield* awaited(access(absolutePath));
  } catch {
    writeError(chalk.red(`Error: File not found: ${absolutePath}`));
    process.exit(1);
  }

  const size = yield* awaited(fileSize(absolutePath));
  return { absolutePath, size };
}
