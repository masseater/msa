import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import skillsSupport from "./skills-support.ts";

const { fixturesDir, loadedFrom } = skillsSupport;

const { runTest } = testing;

const MINIMUM_FIXTURE_SKILLS = 6;

type Loaded = Effect.Success<ReturnType<typeof loadedFrom>>;

const loadCases: {
  readonly dir: string;
  readonly name: string;
  readonly verify: (loaded: Loaded) => void;
}[] = [
  {
    dir: fixturesDir,
    name: "should load all skills from fixture directory",
    verify: ({ skills }) => {
      expect(skills.length).toBeGreaterThanOrEqual(MINIMUM_FIXTURE_SKILLS);
    },
  },
  {
    dir: "/non/existent/path",
    name: "should return empty for non-existent directory",
    verify: ({ skills, diagnostics }) => {
      expect(skills).toHaveLength(0);
      expect(diagnostics).toHaveLength(0);
    },
  },
];

describe("skills", () => {
  describe("loadSkillsFromDir", () => {
    it.each(loadCases)("$name", ({ dir, verify }) => runTest(Effect.map(loadedFrom(dir), verify)));
  });
});
