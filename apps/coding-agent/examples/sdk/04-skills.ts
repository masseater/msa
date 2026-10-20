import {
  DefaultResourceLoader,
  SessionManager,
  type Skill,
  createAgentSession,
  createSyntheticSourceInfo,
  getAgentDir,
} from "@msa/coding-agent";
import { Console, Effect } from "effect";

const customSkill: Skill = {
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
      skills: [...filteredSkills, customSkill],
      diagnostics: current.diagnostics,
    };
  },
});
await loader.reload();

const { skills: allSkills, diagnostics } = loader.getSkills();
Effect.runSync(
  Console.log(
    "Discovered skills:",
    allSkills.map((s) => s.name),
  ),
);
if (diagnostics.length > 0) {
  Effect.runSync(Console.log("Warnings:", diagnostics));
}

const { session } = await createAgentSession({
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
Effect.runSync(Console.log("Session created with filtered skills"));
session.dispose();
