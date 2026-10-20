import * as NodeServices from "@effect/platform-node/NodeServices";
import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem, Function as Fn, ManagedRuntime, Schema } from "effect";

import config from "../../config.ts";
import themeModule from "../../modes/interactive/theme/theme.ts";
import paths from "../../utils/paths.ts";
import platform from "../platform/index.ts";
import SessionManager from "../session-manager.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import exportColors from "./export-colors.ts";
import type exportTypesTypes from "./export-types.ts";
import renderCustomTools from "./render-custom-tools.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { ToolFailure, nonEmptyOr, pathOperations, rethrowCause } = platform;
const { APP_NAME, getExportTemplateDir } = config;
const { deriveExportColors, generateThemeVars } = exportColors;
const { getResolvedThemeColors, getThemeExportColors } = themeModule;
const { normalizePath, resolvePath } = paths;
const { preRenderCustomTools } = renderCustomTools;

const readTemplates = (templateDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const read = (...segments: string[]) =>
      fs.readFileString(pathOperations.join(templateDir, ...segments), "utf-8");
    return {
      hljsJs: yield* read("vendor", "highlight.min.js"),
      markedJs: yield* read("vendor", "marked.min.js"),
      template: yield* read("template.html"),
      templateCss: yield* read("template.css"),
      templateJs: yield* read("template.js"),
    };
  });

const encodeSessionData = (sessionData: exportTypesTypes.SessionData) =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(sessionData).pipe(
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

const normalizeOptions = (
  options: exportTypesTypes.ExportOptions | string | undefined,
): exportTypesTypes.ExportOptions =>
  typeof options === "string" ? { outputPath: options } : (options ?? {});

const writeExport = Effect.fn("writeExport")(function* (
  sessionData: exportTypesTypes.SessionData,
  opts: exportTypesTypes.ExportOptions,
  inputFile: string,
) {
  const html = yield* generateHtml(sessionData, opts.themeName);
  const outputPath =
    opts.outputPath !== undefined && opts.outputPath !== ""
      ? normalizePath(opts.outputPath)
      : `${APP_NAME}-session-${pathOperations.basename(inputFile, ".jsonl")}.html`;
  yield* FileSystem.FileSystem.use((fs) => fs.writeFileString(outputPath, html));
  return outputPath;
});

const exportSession = Effect.fn("exportSessionToHtml")(function* (
  sm: sessionManagerTypes.SessionManager,
  state: agentTypes.AgentState | undefined,
  options: exportTypesTypes.ExportOptions | string | undefined,
) {
  const opts = normalizeOptions(options);
  const sessionFile = sm.getSessionFile();
  if (sessionFile === undefined || sessionFile === "") {
    return yield* new ToolFailure({ message: "Cannot export in-memory session to HTML" });
  }
  const exists = yield* FileSystem.FileSystem.use((fs) => fs.exists(sessionFile));
  if (!exists) {
    return yield* new ToolFailure({
      message: "Nothing to export yet - start a conversation first",
    });
  }
  const entries = sm.getEntries();
  const renderedTools: Record<string, exportTypesTypes.RenderedToolHtml> | undefined =
    opts.toolRenderer === undefined ? undefined : preRenderCustomTools(entries, opts.toolRenderer);
  const sessionData: exportTypesTypes.SessionData = {
    entries,
    header: sm.getHeader(),
    leafId: sm.getLeafId(),
    renderedTools:
      renderedTools !== undefined && Object.keys(renderedTools).length > 0
        ? renderedTools
        : undefined,
    systemPrompt: state?.systemPrompt,
    tools: state?.tools?.map((t) => ({
      description: t.description,
      name: t.name,
      parameters: t.parameters,
    })),
  };
  return yield* writeExport(sessionData, opts, sessionFile);
});

const exportFile = Effect.fn("exportFromFile")(function* (
  inputPath: string,
  options: exportTypesTypes.ExportOptions | string | undefined,
) {
  const opts = normalizeOptions(options);
  const resolvedInputPath = resolvePath(inputPath);
  const exists = yield* FileSystem.FileSystem.use((fs) => fs.exists(resolvedInputPath));
  if (!exists) return yield* new ToolFailure({ message: `File not found: ${resolvedInputPath}` });
  const sm = yield* Effect.sync(() => SessionManager.open(resolvedInputPath));
  const sessionData: exportTypesTypes.SessionData = {
    entries: sm.getEntries(),
    header: sm.getHeader(),
    leafId: sm.getLeafId(),
    systemPrompt: undefined,
    tools: undefined,
  };
  return yield* writeExport(sessionData, opts, resolvedInputPath);
});

const exportSessionToHtml: {
  (
    state?: agentTypes.AgentState,
    options?: exportTypesTypes.ExportOptions | string,
  ): (sm: sessionManagerTypes.SessionManager) => Promise<string>;
  (
    sm: sessionManagerTypes.SessionManager,
    state?: agentTypes.AgentState,
    options?: exportTypesTypes.ExportOptions | string,
  ): Promise<string>;
} = Fn.dual(
  (args) => args[0] instanceof SessionManager,
  (
    sm: sessionManagerTypes.SessionManager,
    state?: agentTypes.AgentState,
    options?: exportTypesTypes.ExportOptions | string,
  ): Promise<string> => nodeRuntime.runPromise(rethrowCause(exportSession(sm, state, options))),
);

const exportFromFile: {
  (options?: exportTypesTypes.ExportOptions | string): (inputPath: string) => Promise<string>;
  (inputPath: string, options?: exportTypesTypes.ExportOptions | string): Promise<string>;
} = Fn.dual(
  (args) => typeof args[0] === "string",
  (inputPath: string, options?: exportTypesTypes.ExportOptions | string): Promise<string> =>
    nodeRuntime.runPromise(rethrowCause(exportFile(inputPath, options))),
);

const exportHtml = {
  exportFromFile,
  exportSessionToHtml,
};

export default exportHtml;
