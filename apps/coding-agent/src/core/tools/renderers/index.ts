import type { ToolRenderers } from "../../extensions/types.ts";
import type { ToolName } from "../index.ts";
import { createShellRenderers } from "./bash.ts";
import { editRenderers } from "./edit.ts";
import { findRenderers } from "./find.ts";
import { grepRenderers } from "./grep.ts";
import { lsRenderers } from "./ls.ts";
import { readRenderers } from "./read.ts";
import { webFetchRenderers, webSearchRenderers } from "./web.ts";
import { writeRenderers } from "./write.ts";

export type { ToolRenderers };

type RenderedToolName = ToolName | "web_search" | "web_fetch";

export {
  createShellRenderers,
  editRenderers,
  findRenderers,
  grepRenderers,
  lsRenderers,
  readRenderers,
  webFetchRenderers,
  webSearchRenderers,
  writeRenderers,
};

export function createAllToolRenderers(): Record<RenderedToolName, ToolRenderers> {
  return {
    read: readRenderers,
    bash: createShellRenderers("$"),
    powershell: createShellRenderers("PS>"),
    edit: editRenderers,
    write: writeRenderers,
    grep: grepRenderers,
    find: findRenderers,
    ls: lsRenderers,
    web_search: webSearchRenderers,
    web_fetch: webFetchRenderers,
  };
}

export function withBuiltInRenderers<TDefinition extends ToolRenderers>(
  toolName: string,
  definition: TDefinition | undefined,
): TDefinition | ToolRenderers | undefined {
  const builtIn = createAllToolRenderers()[toolName as RenderedToolName];
  if (!definition) return builtIn;
  if (!builtIn) return definition;
  return {
    ...definition,
    renderCall: definition.renderCall ?? builtIn.renderCall,
    renderResult: definition.renderResult ?? builtIn.renderResult,
  };
}
