import * as NodeServices from "@effect/platform-node/NodeServices";
import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem, Function as Fn, ManagedRuntime } from "effect";

import paths from "../../utils/paths.ts";
import platform from "../platform/index.ts";
import SessionManager from "../session-manager.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import type exportTypesTypes from "./export-types.ts";
import htmlDocument from "./html-document.ts";
import renderCustomTools from "./render-custom-tools.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { ToolFailure, fromMaybePromise, rethrowCause } = platform;
const { resolvePath } = paths;
const { writeHtmlExport } = htmlDocument;
const { preRenderCustomTools } = renderCustomTools;

const normalizeOptions = (
  options: exportTypesTypes.ExportOptions | string | undefined,
): exportTypesTypes.ExportOptions =>
  typeof options === "string" ? { outputPath: options } : (options ?? {});

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
  return yield* fromMaybePromise(() => writeHtmlExport(sessionData, opts, sessionFile));
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
  return yield* fromMaybePromise(() => writeHtmlExport(sessionData, opts, resolvedInputPath));
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
