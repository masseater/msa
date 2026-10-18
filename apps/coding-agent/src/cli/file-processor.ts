import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "path";

import type { ImageContent } from "@msa/ai";
import chalk from "chalk";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import { writeError } from "../core/platform.ts";
import { resolveReadPath } from "../core/tools/path-utils.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { processImage } from "../utils/image-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";
import { stripBom } from "../utils/text.ts";

export interface ProcessedFiles {
  text: string;
  images: ImageContent[];
}

export interface ProcessFileOptions {
  autoResizeImages?: boolean;
}

export function processFileArguments(
  fileArgs: string[],
  options?: ProcessFileOptions,
): Promise<ProcessedFiles> {
  return Effect.runPromise(
    awaiting(function* () {
      const autoResizeImages = options?.autoResizeImages ?? true;
      let text = "";
      const images: ImageContent[] = [];

      for (const fileArg of fileArgs) {
        const absolutePath = resolve(resolveReadPath(fileArg, process.cwd()));

        try {
          yield* awaited(access(absolutePath));
        } catch {
          writeError(chalk.red(`Error: File not found: ${absolutePath}`));
          process.exit(1);
        }

        const stats = yield* awaited(stat(absolutePath));
        if (stats.size === 0) {
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

          const attachment: ImageContent = {
            type: "image",
            mimeType: processed.mimeType,
            data: processed.data,
          };
          images.push(attachment);

          if (processed.hints.length > 0) {
            text += `<file name="${absolutePath}">${processed.hints.join("\n")}</file>\n`;
          } else {
            text += `<file name="${absolutePath}"></file>\n`;
          }
        } else {
          try {
            const content = stripBom(yield* awaited(readFile(absolutePath, "utf-8")));
            text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
          } catch (error: unknown) {
            const message = toErrorMessage(error);
            writeError(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
            process.exit(1);
          }
        }
      }

      return { text, images };
    }),
  );
}
