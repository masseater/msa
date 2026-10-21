import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import mime from "../utils/mime.ts";
import fileArgument from "./file-argument.ts";
import type fileProcessorTypes from "./file-processor.types.ts";

const { awaited, awaiting } = awaitingModule;
const { detectSupportedImageMimeTypeFromFile } = mime;
const { readImageArgument, readTextArgument, statFileArgument } = fileArgument;

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
        if (size === 0) continue;
        const mimeType = yield* awaited(detectSupportedImageMimeTypeFromFile(absolutePath));
        if (mimeType === null || mimeType === "") {
          text += yield* readTextArgument(absolutePath);
          continue;
        }
        const read = yield* readImageArgument(absolutePath, mimeType, autoResizeImages);
        if (read.image !== undefined) images.push(read.image);
        text += read.text;
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
