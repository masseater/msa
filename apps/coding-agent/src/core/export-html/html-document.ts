import { Effect, FileSystem } from "effect";

import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import syntaxHighlight from "../../utils/syntax-highlight.ts";
import platform from "../platform/index.ts";
import nodeRuntime from "../platform/runtime.ts";
import type exportTypesTypes from "./export-types.ts";
import renderPageModule from "./render-page.ts";

const { rethrowCause } = platform;
const { APP_NAME, getExportTemplateCssPath } = config;
const { normalizePath } = paths;
const { loadAllHighlightLanguages } = syntaxHighlight;
const { renderPage } = renderPageModule;

const generateHtml = Effect.fn("generateHtml")(function* (
  sessionData: exportTypesTypes.SessionData,
  opts: exportTypesTypes.ExportOptions,
) {
  const templateCss = yield* FileSystem.FileSystem.use((fs) =>
    fs.readFileString(getExportTemplateCssPath(), "utf-8"),
  );
  yield* Effect.promise(() => loadAllHighlightLanguages());
  return renderPage(sessionData, templateCss, opts);
});

const writeExport = Effect.fn("writeExport")(function* (
  sessionData: exportTypesTypes.SessionData,
  opts: exportTypesTypes.ExportOptions,
  inputFile: string,
) {
  const html = yield* generateHtml(sessionData, opts);
  const outputPath =
    opts.outputPath !== undefined && opts.outputPath !== ""
      ? normalizePath(opts.outputPath)
      : `${APP_NAME}-session-${platform.basename(inputFile, ".jsonl")}.html`;
  yield* FileSystem.FileSystem.use((fs) => fs.writeFileString(outputPath, html));
  return outputPath;
});

const writeHtmlExport = (
  sessionData: exportTypesTypes.SessionData,
  opts: exportTypesTypes.ExportOptions,
  inputFile: string,
): Promise<string> =>
  nodeRuntime.runPromise(rethrowCause(writeExport(sessionData, opts, inputFile)));

const htmlDocument = { writeHtmlExport };

export default htmlDocument;
