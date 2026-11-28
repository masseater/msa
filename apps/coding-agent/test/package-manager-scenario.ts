import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { packagePaths } = packageManagerSupport;
const { awaited, dirnameOf, joinPath, makeDirectory, writeTextFile } = testing;

type Kind = "extensions" | "prompts" | "skills" | "themes";

interface Scenario {
  readonly disabled?: readonly string[];
  readonly enabled?: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly kind: Kind;
  readonly match?: "endsWith" | "includes";
  readonly patterns: readonly string[];
  readonly where: { readonly agent: true } | { readonly packageNamed: string };
}

type Fixture = ReturnType<typeof packageManagerFixture.usePackageManagerFixture>;

const topLevelSetter = {
  extensions: "setExtensionPaths",
  prompts: "setPromptTemplatePaths",
  skills: "setSkillPaths",
  themes: "setThemePaths",
} as const;

const filesOf = (paths: readonly string[], content: string): Record<string, string> =>
  Object.fromEntries(paths.map((path) => [path, content]));

const resolves = (fixture: Fixture, scenario: Scenario) =>
  Effect.gen(function* () {
    const base =
      "agent" in scenario.where
        ? fixture.agentDir
        : joinPath(fixture.tempDir, scenario.where.packageNamed);
    for (const [path, content] of Object.entries(scenario.files)) {
      const absolute = joinPath(base, path);
      yield* makeDirectory(dirnameOf(absolute));
      yield* writeTextFile(absolute, content);
    }
    if ("agent" in scenario.where) {
      fixture.settingsManager.resources[topLevelSetter[scenario.kind]]([...scenario.patterns]);
    } else {
      fixture.settingsManager.resources.setPackages([
        {
          extensions: [],
          prompts: [],
          skills: [],
          source: base,
          themes: [],
          [scenario.kind]: [...scenario.patterns],
        },
      ]);
    }

    const resolved = (yield* awaited(fixture.packageManager.resolution.resolve()))[scenario.kind];
    for (const name of scenario.enabled ?? []) {
      expect(resolved.some((r) => packagePaths.isEnabled(r, name, scenario.match))).toBe(true);
    }
    for (const name of scenario.disabled ?? []) {
      expect(resolved.some((r) => packagePaths.isDisabled(r, name, scenario.match))).toBe(true);
    }
  });

const packageManagerScenario = { filesOf, resolves };

export default packageManagerScenario;
