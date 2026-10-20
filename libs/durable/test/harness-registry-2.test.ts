import { defineExtension, section, wrapSection } from "@msa/durable";
import { createRegistry } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessRegistrySupport from "./harness-registry-support.ts";
import type harnessRegistrySupportTypes from "./harness-registry-support.types.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { Coding, Skills, resolve } = harnessRegistrySupport;
const { context } = sessionSupport;

function rendered(agent: ReturnType<typeof resolve>): Promise<[string, string | undefined][]> {
  const input = {
    agent,
    conversationId: 1 as never,
    env: undefined,
    read: {
      snapshot: () => Promise.resolve(undefined),
      snapshotAsOf: () => Promise.resolve(undefined),
    },
    shown: {},
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

  const local = createRegistry<harnessRegistrySupportTypes.AppTool>();
  const Override = defineExtension<harnessRegistrySupportTypes.AppTool>({
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
