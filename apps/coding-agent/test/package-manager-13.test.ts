import testing from "@msa/testing";
import { describe, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerScenario from "./package-manager-scenario.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { filesOf, resolves } = packageManagerScenario;

const { runTest } = testing;

const SOURCE = "export default function() {}";

const include = [
  {
    name: "should force-include themes",
    scenario: {
      disabled: ["dark.json", "light.json"],
      enabled: ["special.json"],
      files: filesOf(["themes/dark.json", "themes/light.json", "themes/special.json"], "{}"),
      kind: "themes",
      patterns: ["themes", "!themes/*.json", "+themes/special.json"],
      where: { agent: true },
    },
  },
  {
    name: "should force-include prompts",
    scenario: {
      disabled: ["review.md", "explain.md"],
      enabled: ["debug.md"],
      files: {
        "prompts/debug.md": "Debug",
        "prompts/explain.md": "Explain",
        "prompts/review.md": "Review",
      },
      kind: "prompts",
      patterns: ["prompts", "!prompts/*.md", "+prompts/debug.md"],
      where: { agent: true },
    },
  },
] as const;

const exclude = [
  {
    name: "should force-exclude top-level resources",
    scenario: {
      disabled: ["alpha.ts"],
      enabled: ["beta.ts"],
      files: filesOf(["extensions/alpha.ts", "extensions/beta.ts"], SOURCE),
      kind: "extensions",
      patterns: ["extensions", "+extensions/alpha.ts", "-extensions/alpha.ts"],
      where: { agent: true },
    },
  },
  {
    name: "should force-exclude in package filters",
    scenario: {
      disabled: ["alpha.ts"],
      enabled: ["beta.ts"],
      files: filesOf(["extensions/alpha.ts", "extensions/beta.ts"], SOURCE),
      kind: "extensions",
      patterns: ["extensions/*.ts", "+extensions/alpha.ts", "-extensions/alpha.ts"],
      where: { packageNamed: "force-exclude-pkg" },
    },
  },
] as const;

describe("DefaultPackageManager", () => {
  describe("force-include patterns", () => {
    for (const { name, scenario } of include) {
      it(name, () => runTest(resolves(fixture, scenario)));
    }
  });

  describe("force-exclude patterns", () => {
    for (const { name, scenario } of exclude) {
      it(name, () => runTest(resolves(fixture, scenario)));
    }
  });
});
