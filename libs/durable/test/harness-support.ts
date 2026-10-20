import type {
  AssistantMessage,
  Message,
  StopReason,
  SystemMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@msa/ai";
import { Type, createModels } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import type harnessSupportTypes from "./harness-support.types.ts";
import sessionSupport from "./session-support.ts";

const { defineExtension, defineTool, hook, section } = durable;
const { Harness, createRegistry } = harnessModule;

const { awaited } = effectSupport;
const { context } = sessionSupport;

function tool(name: string): durableTypes.ToolRegistration {
  return defineTool({
    description: `${name} tool`,
    execute: () => Promise.resolve({ output: [] }),
    name,
    parameters: Type.Object({}),
  });
}

const openHarness = Effect.fn("openHarness")(function* (
  storage: durableTypes.Storage,
  toolNames: readonly string[] = [],
  options: {
    readonly registry?: durableTypes.Registry;
    readonly onReport?: (error: unknown) => void;
  } = {},
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

function user(text: string): UserMessage {
  return { content: text, role: "user", timestamp: 1 };
}

function assistantImpl(
  text: string,
  options: { readonly calls?: readonly string[]; readonly stopReason?: StopReason } = {},
): AssistantMessage {
  const calls: ToolCall[] = (options.calls ?? []).map((id) => ({
    arguments: {},
    id,
    name: `tool-${id}`,
    type: "toolCall",
  }));
  return {
    api: "faux",
    content: [{ text, type: "text" }, ...calls],
    model: "faux",
    provider: "faux",
    role: "assistant",
    stopReason: options.stopReason ?? (calls.length > 0 ? "toolUse" : "stop"),
    timestamp: 2,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

const assistant: {
  (options?: {
    readonly calls?: readonly string[];
    readonly stopReason?: StopReason;
  }): (text: string) => ReturnType<typeof assistantImpl>;
  (
    text: string,
    options?: { readonly calls?: readonly string[]; readonly stopReason?: StopReason },
  ): ReturnType<typeof assistantImpl>;
} = dual((args) => typeof args[0] === "string", assistantImpl);

function toolResult(id: string): ToolResultMessage {
  return {
    content: [{ text: `result ${id}`, type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: 3,
    toolCallId: id,
    toolName: `tool-${id}`,
  };
}

function system(sections: Record<string, string | null>): SystemMessage {
  return { content: "", role: "system", sections, timestamp: 4 };
}

function describeMessage(message: Message): string {
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

function installOne<Tool extends durableTypes.ToolRegistration>(
  registry: durableTypes.Registry<Tool>,
  extension: durableTypes.Extension<Tool>,
): harnessSupportTypes.Installed {
  registry.install(extension);
  return { dispose: () => registry.uninstall(extension) };
}

function addToolImpl<Tool extends durableTypes.ToolRegistration>(
  registry: durableTypes.Registry<Tool>,
  toolInner: Tool,
): harnessSupportTypes.Installed {
  return installOne(
    registry,
    defineExtension<Tool>({ name: `tool:${toolInner.name}`, tools: [toolInner] }),
  );
}

const addTool: {
  <Tool extends durableTypes.ToolRegistration>(
    tool: Tool,
  ): (registry: durableTypes.Registry<Tool>) => harnessSupportTypes.Installed;
  <Tool extends durableTypes.ToolRegistration>(
    registry: durableTypes.Registry<Tool>,
    tool: Tool,
  ): harnessSupportTypes.Installed;
} = dual(2, addToolImpl);

function addTaskImpl(
  registry: durableTypes.Registry,
  task: durableTypes.AnyTask,
): harnessSupportTypes.Installed {
  return installOne(
    registry,
    defineExtension({ name: `task:${task.definition.name}`, tasks: [task] }),
  );
}

const addTask: {
  (task: durableTypes.AnyTask): (registry: durableTypes.Registry) => ReturnType<typeof addTaskImpl>;
  (registry: durableTypes.Registry, task: durableTypes.AnyTask): ReturnType<typeof addTaskImpl>;
} = dual(2, addTaskImpl);

let hookExtensions = 0;

function addHooksImpl<K extends durableTypes.AnyTask>(
  registry: durableTypes.Registry,
  task: K,
  handlers: Partial<durableTypes.HooksOf<K>>,
): harnessSupportTypes.Installed {
  return installOne(
    registry,
    defineExtension({ hooks: [hook(task, handlers)], name: `hooks:${++hookExtensions}` }),
  );
}

const addHooks: {
  <K extends durableTypes.AnyTask>(
    task: K,
    handlers: Partial<durableTypes.HooksOf<K>>,
  ): (registry: durableTypes.Registry) => harnessSupportTypes.Installed;
  <K extends durableTypes.AnyTask>(
    registry: durableTypes.Registry,
    task: K,
    handlers: Partial<durableTypes.HooksOf<K>>,
  ): harnessSupportTypes.Installed;
} = dual(3, addHooksImpl);

function addSectionImpl(
  registry: durableTypes.Registry,
  key: string,
  render: durableTypes.PromptSection["render"],
  options?: { readonly tag?: boolean },
): harnessSupportTypes.Installed {
  return installOne(
    registry,
    defineExtension({ name: `section:${key}`, sections: [section(key, render, options)] }),
  );
}

const addSection: {
  (
    key: string,
    render: durableTypes.PromptSection["render"],
    options?: { readonly tag?: boolean },
  ): (registry: durableTypes.Registry) => harnessSupportTypes.Installed;
  (
    registry: durableTypes.Registry,
    key: string,
    render: durableTypes.PromptSection["render"],
    options?: { readonly tag?: boolean },
  ): harnessSupportTypes.Installed;
} = dual((args) => typeof args[1] === "string", addSectionImpl);

const harnessSupport = {
  addHooks,
  addSection,
  addTask,
  addTool,
  assistant,
  describeMessage,
  openHarness,
  system,
  tool,
  toolResult,
  user,
};

export default harnessSupport;
