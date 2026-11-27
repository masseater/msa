import testing from "@msa/testing";
import { Effect } from "effect";

import skillDirectory from "../src/core/skill-directory.ts";

const { resolvePath } = testing;
const { loadSkillsFromDir } = skillDirectory;

const fixturesDir = resolvePath(__dirname, "fixtures/skills");

const loadedFrom = (dir: string) =>
  Effect.promise(() => loadSkillsFromDir({ dir, source: "test" }));

const skillsSupport = {
  fixturesDir,
  loadedFrom,
};

export default skillsSupport;
