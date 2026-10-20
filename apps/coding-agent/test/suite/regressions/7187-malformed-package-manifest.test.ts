import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { DefaultPackageManager } from "../../../src/core/package-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import harnessModule from "../harness.ts";

const { createHarness } = harnessModule;

const { joinPath, toJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const ignoresInvalidResourceFieldsWithoutDropping = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  const tempDir = yield* fs.makeTempDirectory({ prefix: "msa-7187-" });
  const agentDir = joinPath(tempDir, "agent");
  try {
    const packageDir = joinPath(agentDir, "npm", "node_modules", "bad-package");
    const skillPath = joinPath(packageDir, "skills", "bad", "SKILL.md");
    const promptPath = joinPath(packageDir, "prompts", "valid.md");
    yield* fs.makeDirectory(joinPath(packageDir, "skills", "bad"), { recursive: true });
    yield* fs.makeDirectory(joinPath(packageDir, "prompts"), { recursive: true });
    yield* fs.writeFileString(skillPath, "---\nname: bad\ndescription: Must not load\n---\n");
    yield* fs.writeFileString(promptPath, "Valid prompt\n");
    yield* fs.writeFileString(
      joinPath(packageDir, "package.json"),
      yield* toJsonText({
        msa: {
          prompts: ["./prompts"],
          skills: "./skills",
        },
        name: "bad-package",
        version: "1.0.0",
      }),
    );
    const packageManager = new DefaultPackageManager({
      agentDir,
      cwd: tempDir,
      settingsManager: SettingsManager.inMemory({ packages: ["npm:bad-package"] }),
    });

    const resources = yield* Effect.promise(() => packageManager.resolve());
    expect(resources.skills.map((skill) => skill.path)).not.toContain(skillPath);
    expect(resources.prompts.map((prompt) => prompt.path)).toContain(promptPath);
  } finally {
    yield* fs.remove(tempDir, { force: true, recursive: true });
    harness.cleanup();
  }
});

const ignoresInvalidResourceFieldsWithoutDroppingValid = () =>
  Effect.runPromise(ignoresInvalidResourceFieldsWithoutDropping);

describe("issue #7187 malformed package manifest", () => {
  it(
    "ignores invalid resource fields without dropping valid fields",
    ignoresInvalidResourceFieldsWithoutDroppingValid,
  );
});
