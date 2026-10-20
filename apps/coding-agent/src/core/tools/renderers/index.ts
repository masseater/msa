import { Function as Fn } from "effect";

import type extensionsTypesTypes from "../../extensions/types.types.ts";
import bashModule from "./bash.ts";
import editModule from "./edit.ts";
import findModule from "./find.ts";
import grepModule from "./grep.ts";
import lsModule from "./ls.ts";
import readModule from "./read.ts";
import web from "./web.ts";
import writeModule from "./write.ts";

const { createShellRenderers } = bashModule;
const { editRenderers } = editModule;
const { findRenderers } = findModule;
const { grepRenderers } = grepModule;
const { lsRenderers } = lsModule;
const { readRenderers } = readModule;
const { webFetchRenderers, webSearchRenderers } = web;
const { writeRenderers } = writeModule;

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

function createAllToolRenderers(): Record<RenderedToolName, extensionsTypesTypes.ToolRenderers> {
  return {
    bash: createShellRenderers("$"),
    edit: editRenderers,
    find: findRenderers,
    grep: grepRenderers,
    ls: lsRenderers,
    powershell: createShellRenderers("PS>"),
    read: readRenderers,
    web_fetch: webFetchRenderers,
    web_search: webSearchRenderers,
    write: writeRenderers,
  };
}

type WithBuiltIn = <TDefinition extends extensionsTypesTypes.ToolRenderers>(
  toolName: string,
  definition: TDefinition | undefined,
) => TDefinition | extensionsTypesTypes.ToolRenderers | undefined;

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

const withBuiltInRenderers: {
  <TDefinition extends extensionsTypesTypes.ToolRenderers>(
    definition: TDefinition | undefined,
  ): (toolName: string) => TDefinition | extensionsTypesTypes.ToolRenderers | undefined;
  <TDefinition extends extensionsTypesTypes.ToolRenderers>(
    toolName: string,
    definition: TDefinition | undefined,
  ): TDefinition | extensionsTypesTypes.ToolRenderers | undefined;
} = Fn.dual(2, withBuiltInRenderersImpl);

const renderers = {
  createAllToolRenderers,
  createShellRenderers,
  editRenderers,
  findRenderers,
  grepRenderers,
  lsRenderers,
  readRenderers,
  webFetchRenderers,
  webSearchRenderers,
  withBuiltInRenderers,
  writeRenderers,
};

export default renderers;
