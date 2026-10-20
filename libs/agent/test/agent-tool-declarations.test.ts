import { type TranscriptContext, getCurrentSystemMessage, toToolDeclaration } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { Agent, type AgentTool } from "../src/index.ts";
import fixtures from "./support/fixtures.ts";

const { respond, textMessage } = fixtures;

const createTool = (name: string): AgentTool => ({
  description: `${name} tool`,
  execute: () => Promise.resolve({ content: [{ text: name, type: "text" }], details: {} }),
  label: name,
  name,
  parameters: Type.Object({}),
});

const declarations = (context: TranscriptContext): string[] =>
  context.messages.flatMap((message) =>
    message.role === "system"
      ? [
          `+${(message.toolsAdded ?? []).map((tool) => tool.name).join(",")}`,
          `-${(message.toolsRemoved ?? []).map((tool) => tool.name).join(",")}`,
        ]
      : [],
  );

const declaresChanges = Effect.gen(function* () {
  const requests: string[][] = [];
  const agent = new Agent({
    initialState: { systemPrompt: "You are helpful.", tools: [createTool("first")] },
    streamFn: (_model, context) => {
      requests.push(declarations(context));
      return respond(textMessage("done"));
    },
  });
  yield* Effect.promise(() => agent.prompt("one"));
  agent.state.tools = [createTool("second")];
  yield* Effect.promise(() => agent.prompt("two"));
  yield* Effect.promise(() => agent.prompt("three"));
  expect(requests).toEqual([
    ["+first", "-"],
    ["+first", "-", "+second", "-first"],
    ["+first", "-", "+second", "-first"],
  ]);
  const update = agent.state.messages.find(
    (message) => message.role === "system" && message.toolsRemoved !== undefined,
  );
  expect(update).toEqual({
    content: "",
    role: "system",
    timestamp: expect.any(Number),
    toolsAdded: [{ description: "second tool", name: "second", parameters: Type.Object({}) }],
    toolsRemoved: [{ name: "first" }],
  });
  const initial = agent.state.messages[0];
  if (initial?.role !== "system") throw new Error("expected initial system message");
  expect(initial.toolsAdded?.[0]).not.toHaveProperty("execute");
});

const mergesIntoPending = Effect.gen(function* () {
  const echo: AgentTool = { ...createTool("echo"), description: "Echo input", label: "Echo" };
  const agent = new Agent({
    initialState: { systemPrompt: "You are helpful." },
    streamFn: (_model, context) => {
      expect(context.messages.filter((message) => message.role === "system")).toHaveLength(2);
      return respond(textMessage("done"));
    },
  });
  agent.state.tools = [echo];
  yield* Effect.promise(() =>
    agent.prompt([
      { content: "", role: "system", sections: { skills: "<skills>x</skills>" }, timestamp: 1 },
      { content: "hi", role: "user", timestamp: 2 },
    ]),
  );
  expect(agent.state.messages[1]).toEqual({
    content: "",
    role: "system",
    sections: { skills: "<skills>x</skills>" },
    timestamp: 1,
    toolsAdded: [{ description: "Echo input", name: "echo", parameters: Type.Object({}) }],
  });
});

const rewritesPending = Effect.gen(function* () {
  const agent = new Agent({
    initialState: { systemPrompt: "You are helpful.", tools: [createTool("first")] },
    streamFn: () => respond(textMessage("done")),
  });
  yield* Effect.promise(() =>
    agent.prompt([
      {
        content: "",
        role: "system",
        sections: { note: "<note>x</note>" },
        timestamp: 1,
        toolsAdded: [toToolDeclaration(createTool("second"))],
        toolsRemoved: [{ name: "first" }],
      },
      { content: "hi", role: "user", timestamp: 2 },
    ]),
  );
  expect(agent.state.messages[1]).toEqual({
    content: "",
    role: "system",
    sections: { note: "<note>x</note>" },
    timestamp: 1,
  });
  expect(
    getCurrentSystemMessage(agent.state.messages)?.toolsAdded?.map((tool) => tool.name),
  ).toEqual(["first"]);
});

describe("Agent tool declarations", () => {
  it("declares tool loadout changes to the model before the next request", () =>
    Effect.runPromise(declaresChanges));
  it("merges tool changes into a pending system message", () =>
    Effect.runPromise(mergesIntoPending));
  it("rewrites pending tool declarations to match the executable set", () =>
    Effect.runPromise(rewritesPending));
});
