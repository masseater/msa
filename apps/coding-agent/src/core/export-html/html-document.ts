import { Effect, FileSystem, Schema } from "effect";

import config from "../../config.ts";
import themeModule from "../../modes/interactive/theme/theme.ts";
import paths from "../../utils/paths.ts";
import platform from "../platform/index.ts";
import nodeRuntime from "../platform/runtime.ts";
import exportColors from "./export-colors.ts";
import type exportTypesTypes from "./export-types.ts";

const { formatLocalTime, nonEmptyOr, rethrowCause } = platform;
const { APP_NAME, getExportTemplateDir } = config;
const { deriveExportColors, generateThemeVars } = exportColors;
const { getResolvedThemeColors, getThemeExportColors } = themeModule;
const { normalizePath } = paths;

const readTemplates = (templateDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const read = (...segments: string[]) =>
      fs.readFileString(platform.join(templateDir, ...segments), "utf-8");
    return {
      hljsJs: yield* read("vendor", "highlight.min.js"),
      markedJs: yield* read("vendor", "marked.min.js"),
      template: yield* read("template.html"),
      templateCss: yield* read("template.css"),
      templateJs: yield* read("template.js"),
    };
  });

const formatIfSet = (timestamp: string | undefined, layout: string): string | undefined =>
  timestamp === undefined || timestamp === "" ? undefined : formatLocalTime(timestamp, layout);

const localTimesOf = ({
  entries,
  header,
}: exportTypesTypes.SessionData): exportTypesTypes.LocalTimes => ({
  entries: Object.fromEntries(
    entries.flatMap(({ id, timestamp }) => {
      const time = formatIfSet(timestamp, "HH:mm:ss");
      return time === undefined ? [] : [[id, time]];
    }),
  ),
  session: formatIfSet(header?.timestamp, "YYYY-MM-DD HH:mm:ss"),
});

const encodeSessionData = (sessionData: exportTypesTypes.SessionData) =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
    ...sessionData,
    localTimes: localTimesOf(sessionData),
  }).pipe(
    Effect.map((json) => Buffer.from(json).toString("base64")),
    Effect.orDie,
  );

const generateHtml = Effect.fn("generateHtml")(function* (
  sessionData: exportTypesTypes.SessionData,
  themeName: string | undefined,
) {
  const { template, templateCss, templateJs, markedJs, hljsJs } =
    yield* readTemplates(getExportTemplateDir());
  const themeVars = generateThemeVars(themeName);
  const colors = getResolvedThemeColors(themeName);
  const themeExport = getThemeExportColors(themeName);
  const derivedExportColors = deriveExportColors(nonEmptyOr(colors["userMessageBg"], "#343541"));
  const bodyBg = themeExport.pageBg ?? derivedExportColors.pageBg;
  const containerBg = themeExport.cardBg ?? derivedExportColors.cardBg;
  const infoBg = themeExport.infoBg ?? derivedExportColors.infoBg;

  const sessionDataBase64 = yield* encodeSessionData(sessionData);

  const css = templateCss
    .replace("{{THEME_VARS}}", themeVars)
    .replace("{{BODY_BG}}", bodyBg)
    .replace("{{CONTAINER_BG}}", containerBg)
    .replace("{{INFO_BG}}", infoBg);

  return template
    .replace("{{CSS}}", css)
    .replace("{{JS}}", templateJs)
    .replace("{{SESSION_DATA}}", sessionDataBase64)
    .replace("{{MARKED_JS}}", markedJs)
    .replace("{{HIGHLIGHT_JS}}", hljsJs);
});

const writeExport = Effect.fn("writeExport")(function* (
  sessionData: exportTypesTypes.SessionData,
  opts: exportTypesTypes.ExportOptions,
  inputFile: string,
) {
  const html = yield* generateHtml(sessionData, opts.themeName);
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
