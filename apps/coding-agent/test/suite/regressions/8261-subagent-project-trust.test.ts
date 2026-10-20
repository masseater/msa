import * as NodeServices from "@effect/platform-node/NodeServices";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import subagentExtension from "../../../examples/extensions/subagent/index.ts";
import type extensionsTypes from "../../../src/core/extensions/index.types.ts";
import harnessModule from "../harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness, getMessageText } = harnessModule;

const { joinPath } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

vi.mock("@msa/coding-agent", () => ({
  default: {
    CONFIG_DIR_NAME: ".msa",
    getAgentDir: () => "/missing-user-agent-dir",
    getMarkdownTheme: () => ({}),
    parseFrontmatter: (content: string) => ({
      body: content,
      frontmatter: { description: "Project test agent", name: "project-agent" },
    }),
    withFileMutationQueue: (_path: string, fn: () => Promise<unknown>) => Promise.resolve(fn()),
  },
}));

interface RunOptions {
  trusted: boolean;
  confirmResult?: boolean;
}

const writeProjectAgent = (tempDir: string) =>
  Effect.gen(function* () {
    const agentsDir = joinPath(tempDir, ".msa", "agents");
    yield* fs.makeDirectory(agentsDir, { recursive: true });
    yield* fs.writeFileString(
      joinPath(agentsDir, "project-agent.md"),
      "---\nname: project-agent\ndescription: Project test agent\n---\n\nHandle the delegated task.\n",
    );
  });

const delegateResponses = (tempDir: string) => [
  fauxAssistantMessage(
    fauxToolCall("subagent", {
      agent: "project-agent",
      agentScope: "project",
      cwd: joinPath(tempDir, "missing-cwd"),
      task: "Test project trust",
    }),
    { stopReason: "toolUse" },
  ),
  fauxAssistantMessage("done"),
];

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
        yield* writeProjectAgent(harness.tempDir);
        harness.settingsManager.setProjectTrusted(options.trusted);

        yield* Effect.promise(() =>
          harness.session.bindExtensions({
            mode: "tui",
            uiContext: { confirm } as unknown as extensionsTypes.ExtensionUIContext,
          }),
        );

        harness.setResponses(delegateResponses(harness.tempDir));

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
    runProjectAgent({ confirmResult: false, trusted: false }),
  );

  expect(result.confirmCalls).toBe(1);
  expect(result.toolResult).toContain("Canceled: project-local agents not approved.");
});

const skipsPerCallConfirmationForTrustedProjects = () =>
  Effect.runPromise(skipsPerCallConfirmationForTrusted);

const keepsConfirmationForUntrustedInteractiveProjects2 = () =>
  Effect.runPromise(keepsConfirmationForUntrustedInteractiveProjects);

describe("regression #8261: subagent project trust", () => {
  it(
    "skips per-call confirmation for trusted projects",
    skipsPerCallConfirmationForTrustedProjects,
  );
  it(
    "keeps confirmation for untrusted interactive projects",
    keepsConfirmationForUntrustedInteractiveProjects2,
  );
});
