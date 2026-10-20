import type { RegistrySnapshot } from "@msa/durable";
import { Harness, createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { chatSetup } = chatSupport;
const { awaited } = effectSupport;
const { context } = sessionSupport;

const rejectsRegistryWithout = Effect.gen(function* () {
  const empty = createRegistry().snapshot();
  const snapshot: RegistrySnapshot = {
    extension: () => undefined,
    installed: () => [],
    sections: () => [],
    task: (name) => (name === "msa.generation" ? undefined : empty.task(name)),
    tasks: () => empty.tasks().filter((task) => task.definition.name !== "msa.generation"),
    tools: () => [],
  };
  yield* awaited(
    expect(
      Harness.open(
        new MemoryStorage(),
        {
          models: chatSetup().models,
          registry: { snapshot: () => snapshot, subscribe: () => () => {} },
        },
        context,
      ),
    ).rejects.toThrow("Registry lacks built-in tasks msa.generation"),
  );
});

describe("generation", () => {
  it("rejects a registry without the built-in tasks", () =>
    Effect.runPromise(rejectsRegistryWithout));
});
