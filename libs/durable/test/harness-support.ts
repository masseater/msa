import type {
  AssistantMessage,
  Message,
  StopReason,
  SystemMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@msa/ai";
import { createModels, Type } from "@msa/ai";
import {
  type AnyTask,
  defineExtension,
  defineTool,
  type Extension,
  type HooksOf,
  hook,
  type PromptSection,
  type Registry,
  type Storage,
  section,
  type ToolRegistration,
} from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export function tool(name: string): ToolRegistration {
  return defineTool({
    name,
    description: `${name} tool`,
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ output: [] }),
  });
}

export const openHarness = Effect.fn("openHarness")(function* (
  storage: Storage,
  toolNames: readonly string[] = [],
  options: { readonly registry?: Registry; readonly onReport?: (error: unknown) => void } = {},
) {
  const registry = options.registry ?? createRegistry();
  if (toolNames.length > 0)
    registry.install(
      defineExtension({ name: "tools", tools: toolNames.map((name) => tool(name)) }),
    );
  const harness = yield* awaited(
    Harness.open(
      storage,
      {
        models: createModels(),
        registry,
        ...(options.onReport === undefined ? {} : { onReport: options.onReport }),
      },
      context,
    ),
  );
  return { harness, registry };
});

export function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 1 };
}

function assistantImpl(
  text: string,
  options: { readonly calls?: readonly string[]; readonly stopReason?: StopReason } = {},
): AssistantMessage {
  const calls: ToolCall[] = (options.calls ?? []).map((id) => ({
    type: "toolCall",
    id,
    name: `tool-${id}`,
    arguments: {},
  }));
  return {
    role: "assistant",
    content: [{ type: "text", text }, ...calls],
    api: "faux",
    provider: "faux",
    model: "faux",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: options.stopReason ?? (calls.length > 0 ? "toolUse" : "stop"),
    timestamp: 2,
  };
}

export const assistant: {
  (options?: {
    readonly calls?: readonly string[];
    readonly stopReason?: StopReason;
  }): (text: string) => ReturnType<typeof assistantImpl>;
  (
    text: string,
    options?: { readonly calls?: readonly string[]; readonly stopReason?: StopReason },
  ): ReturnType<typeof assistantImpl>;
} = dual((args) => typeof args[0] === "string", assistantImpl);

export function toolResult(id: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: `tool-${id}`,
    content: [{ type: "text", text: `result ${id}` }],
    isError: false,
    timestamp: 3,
  };
}

export function system(sections: Record<string, string | null>): SystemMessage {
  return { role: "system", content: "", sections, timestamp: 4 };
}

export function describeMessage(message: Message): string {
  switch (message.role) {
    case "user":
      return `user:${message.content as string}`;
    case "assistant": {
      const text = message.content.find((content) => content.type === "text");
      return `assistant:${text?.type === "text" ? text.text : ""}`;
    }
    case "toolResult": {
      const text = message.content.find((content) => content.type === "text");
      return `result:${message.toolCallId}:${message.isError ? "error" : text?.type === "text" ? text.text : ""}`;
    }
    case "system":
      return `system:${Object.keys(message.sections ?? {}).join(",")}`;
  }
}

export type Installed = { dispose(): void };

function installOne<Tool extends ToolRegistration>(
  registry: Registry<Tool>,
  extension: Extension<Tool>,
): Installed {
  registry.install(extension);
  return { dispose: () => registry.uninstall(extension) };
}

function addToolImpl<Tool extends ToolRegistration>(
  registry: Registry<Tool>,
  tool: Tool,
): Installed {
  return installOne(registry, defineExtension<Tool>({ name: `tool:${tool.name}`, tools: [tool] }));
}

export const addTool: {
  <Tool extends ToolRegistration>(tool: Tool): (registry: Registry<Tool>) => Installed;
  <Tool extends ToolRegistration>(registry: Registry<Tool>, tool: Tool): Installed;
} = dual(2, addToolImpl);

function addTaskImpl(registry: Registry, task: AnyTask): Installed {
  return installOne(
    registry,
    defineExtension({ name: `task:${task.definition.name}`, tasks: [task] }),
  );
}

export const addTask: {
  (task: AnyTask): (registry: Registry) => ReturnType<typeof addTaskImpl>;
  (registry: Registry, task: AnyTask): ReturnType<typeof addTaskImpl>;
} = dual(2, addTaskImpl);

let hookExtensions = 0;

function addHooksImpl<K extends AnyTask>(
  registry: Registry,
  task: K,
  handlers: Partial<HooksOf<K>>,
): Installed {
  return installOne(
    registry,
    defineExtension({ name: `hooks:${++hookExtensions}`, hooks: [hook(task, handlers)] }),
  );
}

export const addHooks: {
  <K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): (registry: Registry) => Installed;
  <K extends AnyTask>(registry: Registry, task: K, handlers: Partial<HooksOf<K>>): Installed;
} = dual(3, addHooksImpl);

function addSectionImpl(
  registry: Registry,
  key: string,
  render: PromptSection["render"],
  options?: { readonly tag?: boolean },
): Installed {
  return installOne(
    registry,
    defineExtension({ name: `section:${key}`, sections: [section(key, render, options)] }),
  );
}

export const addSection: {
  (
    key: string,
    render: PromptSection["render"],
    options?: { readonly tag?: boolean },
  ): (registry: Registry) => Installed;
  (
    registry: Registry,
    key: string,
    render: PromptSection["render"],
    options?: { readonly tag?: boolean },
  ): Installed;
} = dual((args) => typeof args[1] === "string", addSectionImpl);
