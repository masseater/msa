import { defineExtension, section, wrapSection } from "@msa/durable";
import { createRegistry } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { Skills, type AppTool, Coding, resolve } from "./harness-registry-support.ts";
import { context } from "./session-support.ts";

function rendered(agent: ReturnType<typeof resolve>): Promise<[string, string | undefined][]> {
  const input = {
    conversationId: 1 as never,
    agent,
    env: undefined,
    shown: {},
    read: {
      snapshot: () => Promise.resolve(undefined),
      snapshotAsOf: () => Promise.resolve(undefined),
    },
  };
  return Promise.resolve(
    Promise.all(
      agent.sections.map((item) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return [item.key, yield* awaited(item.render(input, context))] as [
              string,
              string | undefined,
            ];
          }),
        ),
      ),
    ),
  );
}

const ordersSectionsExtension = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const local = createRegistry<AppTool>();
  const Override = defineExtension<AppTool>({
    name: "override",
    sections: [section("preamble", () => "You review.", { tag: false })],
    wraps: [
      wrapSection("cwd", (inner) => ({
        ...inner,
        render: (input, ctx) =>
          runPromise(
            Effect.gen(function* () {
              return `${yield* awaited(inner.render(input, ctx))}!`;
            }),
          ),
      })),
      wrapSection("instructions", () => {
        throw new Error("never");
      }),
    ],
  });
  for (const extension of [Coding, Skills, Override]) local.install(extension);
  const reports: unknown[] = [];
  const agent = resolve({ instructions: "Be terse." }, local.snapshot(), {}, reports);
  expect(yield* awaited(rendered(agent))).toEqual([
    ["preamble", "You review."],
    ["cwd", "/repo!"],
    ["skills", "S"],
    ["instructions", "Be terse."],
  ]);
  expect(agent.sections.at(-1)!.tag).toBeUndefined();
  expect(reports).toEqual([]);
});

describe("agent resolution", () => {
  it("orders sections by extension, replaces same keys in place, and renders instructions last and unwrapped", () =>
    Effect.runPromise(ordersSectionsExtension));
});
