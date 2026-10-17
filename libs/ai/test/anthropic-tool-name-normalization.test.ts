import { Clock, Effect, Stream } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { getModel, stream } from "../src/compat.ts";
import type { Context, Tool } from "../src/types.ts";
import { resolveApiKey } from "./oauth.ts";

const oauthToken = await resolveApiKey("anthropic");

describe.skipIf(oauthToken === undefined || oauthToken === "")(
  "Anthropic OAuth tool name normalization",
  () => {
    const model = getModel("anthropic", "claude-sonnet-4-6");
    it("should normalize user-defined tool matching CC name (todowrite -> TodoWrite -> todowrite)", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const todoTool: Tool = {
            name: "todowrite",
            description: "Write a todo item",
            parameters: Type.Object({
              task: Type.String({ description: "The task to add" }),
            }),
          };

          const context: Context = {
            systemPrompt:
              "You are a helpful assistant. Use the todowrite tool when asked to add todos.",
            messages: [
              {
                role: "user",
                content: "Add a todo: buy milk. Use the todowrite tool.",
                timestamp: yield* Clock.currentTimeMillis,
              },
            ],
            tools: [todoTool],
          };

          const s = stream(model, context, { apiKey: oauthToken });
          let toolCallName: string | undefined;

          yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
            Stream.orDie,
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "toolcall_end") {
                  const toolCall = event.partial.content[event.contentIndex];
                  if (toolCall?.type === "toolCall") {
                    toolCallName = toolCall.name;
                  }
                }
              }),
            ),
          );

          const response = yield* Effect.promise(() => s.result());
          expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("toolUse");

          expect(toolCallName).toBe("todowrite");
        }),
      ));
  },
);

describe.skipIf(oauthToken === undefined || oauthToken === "")(
  "Anthropic OAuth tool name normalization",
  () => {
    const model = getModel("anthropic", "claude-sonnet-4-6");
    it("should handle msa's built-in tools (read, write, edit, bash)", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const readTool: Tool = {
            name: "read",
            description: "Read a file",
            parameters: Type.Object({
              path: Type.String({ description: "File path" }),
            }),
          };

          const context: Context = {
            systemPrompt: "You are a helpful assistant. Use the read tool to read files.",
            messages: [
              {
                role: "user",
                content: "Read the file /tmp/test.txt using the read tool.",
                timestamp: yield* Clock.currentTimeMillis,
              },
            ],
            tools: [readTool],
          };

          const s = stream(model, context, { apiKey: oauthToken });
          let toolCallName: string | undefined;

          yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
            Stream.orDie,
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "toolcall_end") {
                  const toolCall = event.partial.content[event.contentIndex];
                  if (toolCall?.type === "toolCall") {
                    toolCallName = toolCall.name;
                  }
                }
              }),
            ),
          );

          const response = yield* Effect.promise(() => s.result());
          expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("toolUse");

          expect(toolCallName).toBe("read");
        }),
      ));
  },
);

describe.skipIf(oauthToken === undefined || oauthToken === "")(
  "Anthropic OAuth tool name normalization",
  () => {
    const model = getModel("anthropic", "claude-sonnet-4-6");
    it("should NOT map find to Glob - find is not a CC tool name", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const findTool: Tool = {
            name: "find",
            description: "Find files by pattern",
            parameters: Type.Object({
              pattern: Type.String({ description: "Glob pattern" }),
            }),
          };

          const context: Context = {
            systemPrompt: "You are a helpful assistant. Use the find tool to search for files.",
            messages: [
              {
                role: "user",
                content: "Find all .ts files using the find tool.",
                timestamp: yield* Clock.currentTimeMillis,
              },
            ],
            tools: [findTool],
          };

          const s = stream(model, context, { apiKey: oauthToken });
          let toolCallName: string | undefined;

          yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
            Stream.orDie,
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "toolcall_end") {
                  const toolCall = event.partial.content[event.contentIndex];
                  if (toolCall?.type === "toolCall") {
                    toolCallName = toolCall.name;
                  }
                }
              }),
            ),
          );

          const response = yield* Effect.promise(() => s.result());
          expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("toolUse");

          expect(toolCallName).toBe("find");
        }),
      ));
  },
);

describe.skipIf(oauthToken === undefined || oauthToken === "")(
  "Anthropic OAuth tool name normalization",
  () => {
    const model = getModel("anthropic", "claude-sonnet-4-6");
    it("should handle custom tools that don't match any CC tool names", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const customTool: Tool = {
            name: "my_custom_tool",
            description: "A custom tool",
            parameters: Type.Object({
              input: Type.String({ description: "Input value" }),
            }),
          };

          const context: Context = {
            systemPrompt: "You are a helpful assistant. Use my_custom_tool when asked.",
            messages: [
              {
                role: "user",
                content: "Use my_custom_tool with input 'hello'.",
                timestamp: yield* Clock.currentTimeMillis,
              },
            ],
            tools: [customTool],
          };

          const s = stream(model, context, { apiKey: oauthToken });
          let toolCallName: string | undefined;

          yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
            Stream.orDie,
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "toolcall_end") {
                  const toolCall = event.partial.content[event.contentIndex];
                  if (toolCall?.type === "toolCall") {
                    toolCallName = toolCall.name;
                  }
                }
              }),
            ),
          );

          const response = yield* Effect.promise(() => s.result());
          expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("toolUse");

          expect(toolCallName).toBe("my_custom_tool");
        }),
      ));
  },
);
