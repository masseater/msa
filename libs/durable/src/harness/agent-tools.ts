import { Function } from "effect";

import type {
  AgentState,
  Extension,
  RegistrySnapshot,
  Settings,
  ToolRegistration,
} from "./types.ts";

export const offeredTools: {
  (filter: AgentState["modelTools"]): <Tool extends ToolRegistration>(tools: Tool[]) => Tool[];
  <Tool extends ToolRegistration>(tools: Tool[], filter: AgentState["modelTools"]): Tool[];
} = Function.dual(
  2,
  <Tool extends ToolRegistration>(tools: Tool[], filter: AgentState["modelTools"]): Tool[] => {
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

export const filterTools: {
  (filter: AgentState["tools"]): <Tool extends ToolRegistration>(tools: Tool[]) => Tool[];
  <Tool extends ToolRegistration>(tools: Tool[], filter: AgentState["tools"]): Tool[];
} = Function.dual(
  2,
  <Tool extends ToolRegistration>(tools: Tool[], filter: AgentState["tools"]): Tool[] => {
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

export const selectExtensions: {
  <Tool extends ToolRegistration>(
    snapshot: RegistrySnapshot<Tool>,
    settings: Settings,
  ): (stored: AgentState["extensions"]) => Extension<Tool>[];
  <Tool extends ToolRegistration>(
    stored: AgentState["extensions"],
    snapshot: RegistrySnapshot<Tool>,
    settings: Settings,
  ): Extension<Tool>[];
} = Function.dual(
  3,
  <Tool extends ToolRegistration>(
    stored: AgentState["extensions"],
    snapshot: RegistrySnapshot<Tool>,
    settings: Settings,
  ): Extension<Tool>[] => {
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
    const extensions: Extension<Tool>[] = [];
    for (const name of new Set(selected)) {
      const extension = snapshot.extension(name);
      if (extension !== undefined) extensions.push(extension);
    }
    return extensions;
  },
);

export const applyWrap: {
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
