import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Console, Effect } from "effect";

const {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createSyntheticSourceInfo,
  getAgentDir,
} = codingAgent;

const customSkill: codingAgentTypes.Skill = {
  baseDir: "/virtual",
  description: "Custom project instructions",
  disableModelInvocation: false,
  filePath: "/virtual/SKILL.md",
  name: "my-skill",
  sourceInfo: createSyntheticSourceInfo("/virtual/SKILL.md", { source: "sdk" }),
};

const loader = new DefaultResourceLoader({
  agentDir: getAgentDir(),
  cwd: process.cwd(),
  skillsOverride: (current) => {
    const filteredSkills = current.skills.filter(
      (s) => s.name.includes("browser") || s.name.includes("search"),
    );
    return {
      diagnostics: current.diagnostics,
      skills: [...filteredSkills, customSkill],
    };
  },
});

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.promise(() => loader.reload());

    const { skills: allSkills, diagnostics } = loader.getSkills();
    yield* Console.log(
      "Discovered skills:",
      allSkills.map((s) => s.name),
    );
    if (diagnostics.length > 0) {
      yield* Console.log("Warnings:", diagnostics);
    }

    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
      }),
    );
    yield* Console.log("Session created with filtered skills");
    session.dispose();
  }),
);
