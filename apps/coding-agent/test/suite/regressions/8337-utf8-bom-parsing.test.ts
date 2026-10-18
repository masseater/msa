import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { SettingsManager } from "../../../src/core/settings-manager.ts";
import { parseFrontmatter } from "../../../src/utils/frontmatter.ts";
import { splitBom } from "../../../src/utils/text.ts";
import { stringifyJson } from "../../test-json.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let testDir: string;

const loadsFrontmatterAndSettingsWithA = Effect.gen(function* () {
  expect(splitBom("\uFEFFcontent")).toEqual({ bom: "\uFEFF", text: "content" });
  const document = "---\nname: demo\ndescription: Test\n---\nBody";
  expect(parseFrontmatter(`\uFEFF${document}`)).toEqual({
    frontmatter: { name: "demo", description: "Test" },
    body: "Body",
  });

  const agentDir = join(testDir, "agent");
  const projectDir = join(testDir, "project");
  yield* fs.makeDirectory(join(projectDir, ".msa"), { recursive: true });
  yield* fs.makeDirectory(agentDir, { recursive: true });
  const globalSettingsPath = join(agentDir, "settings.json");
  yield* fs.writeFileString(
    globalSettingsPath,
    `\uFEFF${stringifyJson({ defaultModel: "global-model" })}`,
  );
  yield* fs.writeFileString(
    join(projectDir, ".msa", "settings.json"),
    `\uFEFF${stringifyJson({ defaultProvider: "project-provider" })}`,
  );

  const settings = SettingsManager.create(projectDir, agentDir);
  expect(settings.getDefaultModel()).toBe("global-model");
  expect(settings.getDefaultProvider()).toBe("project-provider");

  settings.setTheme("dark");
  yield* Effect.promise(() => settings.flush());
  expect(yield* fs.readFileString(globalSettingsPath)).not.toMatch(/^\uFEFF/u);
});

describe("issue #8337 UTF-8 BOM parsing", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        const value = (testDir = yield* fs.makeTempDirectory({ prefix: "msa-8337-" }));
        return value;
      }),
    ),
  );
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        if (yield* fs.exists(testDir)) {
          yield* fs.remove(testDir, { recursive: true, force: true });
        }
      }),
    ),
  );
  it("loads frontmatter and settings with a leading BOM", () =>
    Effect.runPromise(loadsFrontmatterAndSettingsWithA));
});
