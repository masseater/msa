import type aiTypes from "@msa/ai/index.types";
import chalk from "chalk";

import awaitingModule from "../core/awaiting.ts";
import platformNode from "../core/platform-node.ts";
import platform from "../core/platform.ts";
import pathUtils from "../core/tools/path-utils.ts";
import errors from "../utils/errors.ts";
import imageProcess from "../utils/image-process.ts";
import nodeFs from "../utils/node-fs.ts";
import textModule from "../utils/text.ts";

const { awaited } = awaitingModule;
const { resolve } = platformNode;
const { resolveReadPath } = pathUtils;
const { access, fileSize, readFile, readText } = nodeFs;
const { writeError } = platform;
const { processImage } = imageProcess;
const { stripBom } = textModule;
const { toErrorMessage } = errors;

const fileTag = (path: string, body: string) => `<file name="${path}">${body}</file>\n`;

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

function* readImageArgument(absolutePath: string, mimeType: string, autoResizeImages: boolean) {
  const content = yield* awaited(readFile(absolutePath));
  const processed = yield* awaited(processImage(content, mimeType, { autoResizeImages }));
  if (!processed.ok) {
    return { image: undefined, text: fileTag(absolutePath, processed.message) };
  }
  const image: aiTypes.ImageContent = {
    data: processed.data,
    mimeType: processed.mimeType,
    type: "image",
  };
  return { image, text: fileTag(absolutePath, processed.hints.join("\n")) };
}

function* readTextArgument(absolutePath: string) {
  try {
    const content = stripBom(yield* awaited(readText(absolutePath)));
    return fileTag(absolutePath, `\n${content}\n`);
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    writeError(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
    return process.exit(1);
  }
}

const fileArgument = { readImageArgument, readTextArgument, statFileArgument };

export default fileArgument;
