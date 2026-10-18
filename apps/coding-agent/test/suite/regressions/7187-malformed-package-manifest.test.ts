import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { DefaultPackageManager } from "../../../src/core/package-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import { stringifyJson } from "../../test-json.ts";
import { join } from "../../test-path.ts";
import { createHarness } from "../harness.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const ignoresInvalidResourceFieldsWithoutDropping = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  const tempDir = yield* fs.makeTempDirectory({ prefix: "msa-7187-" });
  const agentDir = join(tempDir, "agent");
  try {
    const packageDir = join(agentDir, "npm", "node_modules", "bad-package");
    const skillPath = join(packageDir, "skills", "bad", "SKILL.md");
    const promptPath = join(packageDir, "prompts", "valid.md");
    yield* fs.makeDirectory(join(packageDir, "skills", "bad"), { recursive: true });
    yield* fs.makeDirectory(join(packageDir, "prompts"), { recursive: true });
    yield* fs.writeFileString(skillPath, "---\nname: bad\ndescription: Must not load\n---\n");
    yield* fs.writeFileString(promptPath, "Valid prompt\n");
    yield* fs.writeFileString(
      join(packageDir, "package.json"),
      stringifyJson({
        name: "bad-package",
        version: "1.0.0",
        msa: {
          skills: "./skills",
          prompts: ["./prompts"],
        },
      }),
    );
    const packageManager = new DefaultPackageManager({
      cwd: tempDir,
      agentDir,
      settingsManager: SettingsManager.inMemory({ packages: ["npm:bad-package"] }),
    });

    const resources = yield* Effect.promise(() => packageManager.resolve());
    expect(resources.skills.map((skill) => skill.path)).not.toContain(skillPath);
    expect(resources.prompts.map((prompt) => prompt.path)).toContain(promptPath);
  } finally {
    yield* fs.remove(tempDir, { recursive: true, force: true });
    harness.cleanup();
  }
});

describe("issue #7187 malformed package manifest", () => {
  it("ignores invalid resource fields without dropping valid fields", () =>
    Effect.runPromise(ignoresInvalidResourceFieldsWithoutDropping));
});
