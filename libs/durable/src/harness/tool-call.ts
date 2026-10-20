import type { ToolCall } from "@msa/ai";
import { validateToolArguments } from "@msa/ai/utils/validation";
import type chordTypes from "@msa/chord/index.types";
import { Cause, Effect, Exit, Function } from "effect";

import entries from "../entries.ts";
import errors from "../errors.ts";
import bridge from "./bridge.ts";
import type toolCallTypes from "./tool-call.types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";

const { AssistantEntry } = entries;
const { errorMessage } = errors;
const { eachHook, hookResult } = bridge;

const resolveTool = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  input: toolTypesModule.ToolTaskInput,
  name: string,
  context: chordTypes.Context,
) {
  const agent = yield* Effect.promise(() => runtime.agent(context));
  const tools = input.kind === "model" ? agent.tools : agent.callable;
  return tools.find((tool) => tool.name === name);
});

const readCall = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  input: toolTypesModule.ToolTaskInput,
  context: chordTypes.Context,
) {
  if (input.kind === "nested")
    return yield* Effect.succeed<typesModule.ToolHookCall>({
      ...input.call,
      parent: { callId: input.parentCallId, taskId: input.parent },
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
  return yield* Effect.succeed<typesModule.ToolHookCall>(call);
});

const prepareArguments: typesModule.Dual2<
  typesModule.ToolRegistration,
  typesModule.JsonObject,
  toolCallTypes.Checked
> = Function.dual(
  2,
  (tool: typesModule.ToolRegistration, args: typesModule.JsonObject): toolCallTypes.Checked => {
    if (tool.prepareArguments === undefined) return { args };
    try {
      return { args: tool.prepareArguments(args) as typesModule.JsonObject };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  },
);

const validate: typesModule.Dual3<
  typesModule.ToolRegistration,
  ToolCall,
  typesModule.JsonObject,
  toolCallTypes.Checked
> = Function.dual(
  3,
  (
    tool: typesModule.ToolRegistration,
    call: ToolCall,
    args: typesModule.JsonObject,
  ): toolCallTypes.Checked => {
    try {
      return {
        args: validateToolArguments(tool, { ...call, arguments: args }) as typesModule.JsonObject,
      };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  },
);

function checkKey(key: string): void {
  if (key === "" || key.includes("/") || key === "__proto__" || /^[1-9][0-9]*$/u.test(key)) {
    throw new Error(
      `Nested call key ${JSON.stringify(key)} must be non-empty, without "/", not "__proto__", and not a positive integer`,
    );
  }
}

const jsonEqual: typesModule.Dual2<chordTypes.JsonValue, chordTypes.JsonValue, boolean> =
  Function.dual(2, (a: chordTypes.JsonValue, b: chordTypes.JsonValue): boolean => {
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
  });

const askHooks = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  call: typesModule.ToolHookCall,
  initial: typesModule.JsonObject,
  context: chordTypes.Context,
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
            else if (decision?.arguments !== undefined)
              args = decision.arguments as typesModule.JsonObject;
            return Effect.void;
          },
        )
      : Effect.void,
  );
  return { args, block };
});

const toolCall = {
  askHooks,
  checkKey,
  jsonEqual,
  prepareArguments,
  readCall,
  resolveTool,
  validate,
};

export default toolCall;
