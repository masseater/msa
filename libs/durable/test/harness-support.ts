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

import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export function tool(name: string, description = `${name} tool`): ToolRegistration {
  return defineTool({
    name,
    description,
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

export function assistant(
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

export function toolResult(id: string, text = `result ${id}`): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: `tool-${id}`,
    content: [{ type: "text", text }],
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

export function addTool<Tool extends ToolRegistration>(
  registry: Registry<Tool>,
  tool: Tool,
  name = `tool:${tool.name}`,
): Installed {
  return installOne(registry, defineExtension<Tool>({ name, tools: [tool] }));
}

export function addTask(
  registry: Registry,
  task: AnyTask,
  name = `task:${task.definition.name}`,
): Installed {
  return installOne(registry, defineExtension({ name, tasks: [task] }));
}

let hookExtensions = 0;

export function addHooks<K extends AnyTask>(
  registry: Registry,
  task: K,
  handlers: Partial<HooksOf<K>>,
  name = `hooks:${++hookExtensions}`,
): Installed {
  return installOne(registry, defineExtension({ name, hooks: [hook(task, handlers)] }));
}

export function addSection<Tool extends ToolRegistration = ToolRegistration>(
  registry: Registry<Tool>,
  key: string,
  render: PromptSection<Tool>["render"],
  options?: { readonly tag?: boolean },
  name = `section:${key}`,
): Installed {
  return installOne(
    registry,
    defineExtension<Tool>({ name, sections: [section(key, render, options)] }),
  );
}
