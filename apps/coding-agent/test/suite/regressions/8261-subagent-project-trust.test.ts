import * as NodeServices from "@effect/platform-node/NodeServices";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import subagentExtension from "../../../examples/extensions/subagent/index.ts";
import type { ExtensionUIContext } from "../../../src/core/extensions/index.ts";
import { join } from "../../test-path.ts";
import { createHarness, getMessageText } from "../harness.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

vi.mock("@msa/coding-agent", () => ({
  CONFIG_DIR_NAME: ".msa",
  getAgentDir: () => "/missing-user-agent-dir",
  getMarkdownTheme: () => ({}),
  parseFrontmatter: (content: string) => ({
    frontmatter: { name: "project-agent", description: "Project test agent" },
    body: content,
  }),
  withFileMutationQueue: (_path: string, fn: () => Promise<unknown>) => Promise.resolve(fn()),
}));

interface RunOptions {
  trusted: boolean;
  confirmResult?: boolean;
}

function runProjectAgent(
  options: RunOptions,
): Promise<{ confirmCalls: number; toolResult: string }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({ extensionFactories: [subagentExtension] }),
      );
      const confirm = vi.fn(() => Promise.resolve(options.confirmResult ?? false));

      try {
        const agentsDir = join(harness.tempDir, ".msa", "agents");
        yield* fs.makeDirectory(agentsDir, { recursive: true });
        yield* fs.writeFileString(
          join(agentsDir, "project-agent.md"),
          "---\nname: project-agent\ndescription: Project test agent\n---\n\nHandle the delegated task.\n",
        );
        harness.settingsManager.setProjectTrusted(options.trusted);

        yield* Effect.promise(() =>
          harness.session.bindExtensions({
            uiContext: { confirm } as unknown as ExtensionUIContext,
            mode: "tui",
          }),
        );

        harness.setResponses([
          fauxAssistantMessage(
            fauxToolCall("subagent", {
              agent: "project-agent",
              task: "Test project trust",
              agentScope: "project",
              cwd: join(harness.tempDir, "missing-cwd"),
            }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("done"),
        ]);

        yield* Effect.promise(() => harness.session.prompt("Delegate this task"));

        const toolResult = harness.session.messages.find(
          (message) => message.role === "toolResult",
        );
        return {
          confirmCalls: confirm.mock.calls.length,
          toolResult: getMessageText(toolResult),
        };
      } finally {
        harness.cleanup();
      }
    }),
  );
}

const skipsPerCallConfirmationForTrusted = Effect.gen(function* () {
  const result = yield* Effect.promise(() => runProjectAgent({ trusted: true }));

  expect(result.confirmCalls).toBe(0);
  expect(result.toolResult).not.toContain("Canceled:");
});

const keepsConfirmationForUntrustedInteractiveProjects = Effect.gen(function* () {
  const result = yield* Effect.promise(() =>
    runProjectAgent({ trusted: false, confirmResult: false }),
  );

  expect(result.confirmCalls).toBe(1);
  expect(result.toolResult).toContain("Canceled: project-local agents not approved.");
});

describe("regression #8261: subagent project trust", () => {
  it("skips per-call confirmation for trusted projects", () =>
    Effect.runPromise(skipsPerCallConfirmationForTrusted));
  it("keeps confirmation for untrusted interactive projects", () =>
    Effect.runPromise(keepsConfirmationForUntrustedInteractiveProjects));
});
