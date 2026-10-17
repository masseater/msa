import type { ToolCall } from "@msa/ai";
import { validateToolArguments } from "@msa/ai/utils/validation";
import type { Context, JsonValue } from "@msa/chord";
import { Cause, Effect, Exit, Function } from "effect";

import { AssistantEntry } from "../entries.ts";
import { errorMessage } from "../errors.ts";
import { eachHook, hookResult } from "./bridge.ts";
import type { ToolRuntime, ToolTaskInput } from "./tool-types.ts";
import type { Dual2, Dual3, JsonObject, ToolHookCall, ToolRegistration } from "./types.ts";

export const resolveTool = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  input: ToolTaskInput,
  name: string,
  context: Context,
) {
  const agent = yield* Effect.promise(() => runtime.agent(context));
  const tools = input.kind === "model" ? agent.tools : agent.callable;
  return tools.find((tool) => tool.name === name);
});

export const readCall = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  input: ToolTaskInput,
  context: Context,
) {
  if (input.kind === "nested")
    return yield* Effect.succeed<ToolHookCall>({
      ...input.call,
      parent: { taskId: input.parent, callId: input.parentCallId },
    });
  const entry = yield* Effect.promise(() =>
    runtime.entry(AssistantEntry, input.assistant, context),
  );
  const message = entry?.model?.[0];
  const call =
    message?.role === "assistant"
      ? message.content.find(
          (content): content is ToolCall =>
            content.type === "toolCall" && content.id === input.callId,
        )
      : undefined;
  if (call === undefined)
    return yield* Effect.die(
      new Error(`Entry ${input.assistant} has no tool call ${input.callId}`),
    );
  return yield* Effect.succeed<ToolHookCall>(call);
});

export type Checked = { readonly args: JsonObject } | { readonly error: string };

export const prepareArguments: Dual2<ToolRegistration, JsonObject, Checked> = Function.dual(
  2,
  (tool: ToolRegistration, args: JsonObject): Checked => {
    if (tool.prepareArguments === undefined) return { args };
    try {
      return { args: tool.prepareArguments(args) as JsonObject };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  },
);

export const validate: Dual3<ToolRegistration, ToolCall, JsonObject, Checked> = Function.dual(
  3,
  (tool: ToolRegistration, call: ToolCall, args: JsonObject): Checked => {
    try {
      return { args: validateToolArguments(tool, { ...call, arguments: args }) as JsonObject };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  },
);

export function checkKey(key: string): void {
  if (key === "" || key.includes("/") || key === "__proto__" || /^[1-9][0-9]*$/u.test(key)) {
    throw new Error(
      `Nested call key ${JSON.stringify(key)} must be non-empty, without "/", not "__proto__", and not a positive integer`,
    );
  }
}

export const jsonEqual: Dual2<JsonValue, JsonValue, boolean> = Function.dual(
  2,
  (a: JsonValue, b: JsonValue): boolean => {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((item, index) => jsonEqual(item, b[index]!))
      );
    }
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key]!, b[key]!))
    );
  },
);

export const askHooks = Effect.fnUntraced(function* (
  runtime: ToolRuntime,
  call: ToolHookCall,
  initial: JsonObject,
  context: Context,
) {
  let args = initial;
  let block: string | undefined;
  yield* eachHook(runtime.hooks, "beforeTool", (hook) =>
    block === undefined
      ? Effect.flatMap(
          Effect.exit(hookResult(() => hook({ ...call, arguments: args }, runtime, context))),
          (exit) => {
            if (Exit.isFailure(exit)) {
              const error = Cause.squash(exit.cause);
              if (runtime.signal.aborted) return Effect.die(error);
              block = errorMessage(error);
              return Effect.void;
            }
            const decision = exit.value;
            if (decision?.block !== undefined) block = decision.block;
            else if (decision?.arguments !== undefined) args = decision.arguments as JsonObject;
            return Effect.void;
          },
        )
      : Effect.void,
  );
  return { args, block };
});
