import { Function as Fn } from "effect";

import type { ToolRenderers } from "../../extensions/types.ts";
import { createShellRenderers } from "./bash.ts";
import { editRenderers } from "./edit.ts";
import { findRenderers } from "./find.ts";
import { grepRenderers } from "./grep.ts";
import { lsRenderers } from "./ls.ts";
import { readRenderers } from "./read.ts";
import { webFetchRenderers, webSearchRenderers } from "./web.ts";
import { writeRenderers } from "./write.ts";

export type { ToolRenderers };

type RenderedToolName =
  | "read"
  | "bash"
  | "powershell"
  | "edit"
  | "write"
  | "grep"
  | "find"
  | "ls"
  | "web_search"
  | "web_fetch";

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

type WithBuiltIn = <TDefinition extends ToolRenderers>(
  toolName: string,
  definition: TDefinition | undefined,
) => TDefinition | ToolRenderers | undefined;

const withBuiltInRenderersImpl: WithBuiltIn = (toolName, definition) => {
  const builtIn = createAllToolRenderers()[toolName as RenderedToolName];
  if (definition === undefined) return builtIn;
  if (builtIn === undefined) return definition;
  return {
    ...definition,
    renderCall: definition.renderCall ?? builtIn.renderCall,
    renderResult: definition.renderResult ?? builtIn.renderResult,
  };
};

export const withBuiltInRenderers: {
  <TDefinition extends ToolRenderers>(
    definition: TDefinition | undefined,
  ): (toolName: string) => TDefinition | ToolRenderers | undefined;
  <TDefinition extends ToolRenderers>(
    toolName: string,
    definition: TDefinition | undefined,
  ): TDefinition | ToolRenderers | undefined;
} = Fn.dual(2, withBuiltInRenderersImpl);
