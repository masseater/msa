import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem, Function as Fn, Schema } from "effect";

import { APP_NAME, getExportTemplateDir } from "../../config.ts";
import {
  getResolvedThemeColors,
  getThemeExportColors,
} from "../../modes/interactive/theme/theme.ts";
import { normalizePath, resolvePath } from "../../utils/paths.ts";
import {
  ToolFailure,
  nonEmptyOr,
  pathOperations,
  platformRuntime,
  rethrowCause,
} from "../platform/index.ts";
import { SessionManager } from "../session-manager.ts";
import { deriveExportColors, generateThemeVars } from "./export-colors.ts";
import type { ExportOptions, RenderedToolHtml, SessionData } from "./export-types.ts";
import { preRenderCustomTools } from "./render-custom-tools.ts";

export type { ExportOptions, ToolHtmlRenderer } from "./export-types.ts";

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

const encodeSessionData = (sessionData: SessionData) =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(sessionData).pipe(
    Effect.map((json) => Buffer.from(json).toString("base64")),
    Effect.orDie,
  );

const generateHtml = Effect.fn("generateHtml")(function* (
  sessionData: SessionData,
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

const normalizeOptions = (options: ExportOptions | string | undefined): ExportOptions =>
  typeof options === "string" ? { outputPath: options } : (options ?? {});

const writeExport = Effect.fn("writeExport")(function* (
  sessionData: SessionData,
  opts: ExportOptions,
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
  sm: SessionManager,
  state: agentTypes.AgentState | undefined,
  options: ExportOptions | string | undefined,
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
  const renderedTools: Record<string, RenderedToolHtml> | undefined =
    opts.toolRenderer === undefined ? undefined : preRenderCustomTools(entries, opts.toolRenderer);
  const sessionData: SessionData = {
    entries,
    header: sm.getHeader(),
    leafId: sm.getLeafId(),
    renderedTools:
      renderedTools !== undefined && Object.keys(renderedTools).length > 0
        ? renderedTools
        : undefined,
    systemPrompt: state?.systemPrompt,
    tools: state?.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
  return yield* writeExport(sessionData, opts, sessionFile);
});

const exportFile = Effect.fn("exportFromFile")(function* (
  inputPath: string,
  options: ExportOptions | string | undefined,
) {
  const opts = normalizeOptions(options);
  const resolvedInputPath = resolvePath(inputPath);
  const exists = yield* FileSystem.FileSystem.use((fs) => fs.exists(resolvedInputPath));
  if (!exists) return yield* new ToolFailure({ message: `File not found: ${resolvedInputPath}` });
  const sm = yield* Effect.sync(() => SessionManager.open(resolvedInputPath));
  const sessionData: SessionData = {
    entries: sm.getEntries(),
    header: sm.getHeader(),
    leafId: sm.getLeafId(),
    systemPrompt: undefined,
    tools: undefined,
  };
  return yield* writeExport(sessionData, opts, resolvedInputPath);
});

export const exportSessionToHtml: {
  (
    state?: agentTypes.AgentState,
    options?: ExportOptions | string,
  ): (sm: SessionManager) => Promise<string>;
  (
    sm: SessionManager,
    state?: agentTypes.AgentState,
    options?: ExportOptions | string,
  ): Promise<string>;
} = Fn.dual(
  (args) => args[0] instanceof SessionManager,
  (
    sm: SessionManager,
    state?: agentTypes.AgentState,
    options?: ExportOptions | string,
  ): Promise<string> => platformRuntime.runPromise(rethrowCause(exportSession(sm, state, options))),
);

export const exportFromFile: {
  (options?: ExportOptions | string): (inputPath: string) => Promise<string>;
  (inputPath: string, options?: ExportOptions | string): Promise<string>;
} = Fn.dual(
  (args) => typeof args[0] === "string",
  (inputPath: string, options?: ExportOptions | string): Promise<string> =>
    platformRuntime.runPromise(rethrowCause(exportFile(inputPath, options))),
);
