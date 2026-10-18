import type { RegistrySnapshot } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup } from "./chat-support.ts";
import { context } from "./session-support.ts";

describe("generation", () => {
  it("rejects a registry without the built-in tasks", async () => {
    const empty = createRegistry().snapshot();
    const snapshot: RegistrySnapshot = {
      installed: () => [],
      extension: () => undefined,
      tools: () => [],
      sections: () => [],
      tasks: () => empty.tasks().filter((task) => task.definition.name !== "msa.generation"),
      task: (name) => (name === "msa.generation" ? undefined : empty.task(name)),
    };
    await expect(
      Harness.open(
        new MemoryStorage(),
        {
          models: chatSetup().models,
          registry: { snapshot: () => snapshot, subscribe: () => () => {} },
        },
        context,
      ),
    ).rejects.toThrow("Registry lacks built-in tasks msa.generation");
  });
});
