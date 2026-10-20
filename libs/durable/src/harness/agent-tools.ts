import { Function } from "effect";

import type typesModule from "./types.types.ts";

const offeredTools: {
  (
    filter: typesModule.AgentState["modelTools"],
  ): <Tool extends typesModule.ToolRegistration>(tools: Tool[]) => Tool[];
  <Tool extends typesModule.ToolRegistration>(
    tools: Tool[],
    filter: typesModule.AgentState["modelTools"],
  ): Tool[];
} = Function.dual(
  2,
  <Tool extends typesModule.ToolRegistration>(
    tools: Tool[],
    filter: typesModule.AgentState["modelTools"],
  ): Tool[] => {
    if (Array.isArray(filter)) return filterTools(tools, filter);
    const removed = new Set(filter?.remove ?? []);
    const kept = tools.filter((tool) => tool.deferred !== true && !removed.has(tool.name));
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const loaded = [...new Set(filter?.add ?? [])].flatMap((name) => {
      const tool = byName.get(name);
      return tool?.deferred === true && !removed.has(name) ? [tool] : [];
    });
    return [...kept, ...loaded];
  },
);

const filterTools: {
  (
    filter: typesModule.AgentState["tools"],
  ): <Tool extends typesModule.ToolRegistration>(tools: Tool[]) => Tool[];
  <Tool extends typesModule.ToolRegistration>(
    tools: Tool[],
    filter: typesModule.AgentState["tools"],
  ): Tool[];
} = Function.dual(
  2,
  <Tool extends typesModule.ToolRegistration>(
    tools: Tool[],
    filter: typesModule.AgentState["tools"],
  ): Tool[] => {
    if (filter === undefined) return tools;
    if (Array.isArray(filter)) {
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      return [...new Set(filter)].flatMap((name) => {
        const tool = byName.get(name);
        return tool === undefined ? [] : [tool];
      });
    }
    const removed = new Set((filter as { remove: string[] }).remove);
    return tools.filter((tool) => !removed.has(tool.name));
  },
);

const selectExtensions: {
  <Tool extends typesModule.ToolRegistration>(
    snapshot: typesModule.RegistrySnapshot<Tool>,
    settings: typesModule.Settings,
  ): (stored: typesModule.AgentState["extensions"]) => typesModule.Extension<Tool>[];
  <Tool extends typesModule.ToolRegistration>(
    stored: typesModule.AgentState["extensions"],
    snapshot: typesModule.RegistrySnapshot<Tool>,
    settings: typesModule.Settings,
  ): typesModule.Extension<Tool>[];
} = Function.dual(
  3,
  <Tool extends typesModule.ToolRegistration>(
    stored: typesModule.AgentState["extensions"],
    snapshot: typesModule.RegistrySnapshot<Tool>,
    settings: typesModule.Settings,
  ): typesModule.Extension<Tool>[] => {
    let selected: string[];
    if (Array.isArray(stored)) selected = stored;
    else {
      const base =
        settings.extensions?.map((extension) => extension.name) ??
        snapshot.installed().map((e) => e.name);
      const edit = stored as { add?: string[]; remove?: string[] } | undefined;
      const removed = new Set(edit?.remove ?? []);
      selected = [...base, ...(edit?.add ?? [])].filter((name) => !removed.has(name));
    }
    const extensions: typesModule.Extension<Tool>[] = [];
    for (const name of new Set(selected)) {
      const extension = snapshot.extension(name);
      if (extension !== undefined) extensions.push(extension);
    }
    return extensions;
  },
);

const applyWrap: {
  <T>(
    target: string,
    wrap: (item: T) => T,
    nameOf: (item: T) => string,
    report: (error: unknown) => void,
  ): (items: Map<string, T>) => void;
  <T>(
    items: Map<string, T>,
    target: string,
    wrap: (item: T) => T,
    nameOf: (item: T) => string,
    report: (error: unknown) => void,
  ): void;
} = Function.dual(
  5,
  <T>(
    items: Map<string, T>,
    target: string,
    wrap: (item: T) => T,
    nameOf: (item: T) => string,
    report: (error: unknown) => void,
  ): void => {
    const item = items.get(target);
    if (item === undefined) return;
    try {
      const wrapped = wrap(item);
      if (nameOf(wrapped) !== target)
        throw new Error(`Wrapper renamed ${target} to ${nameOf(wrapped)}`);
      items.set(target, wrapped);
    } catch (error) {
      items.delete(target);
      report(error);
    }
  },
);

const agentTools = {
  applyWrap,
  filterTools,
  offeredTools,
  selectExtensions,
};

export default agentTools;
