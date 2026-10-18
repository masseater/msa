import { Console, Effect } from "effect";

import {
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type Skill,
} from "@msa/coding-agent";


const customSkill: Skill = {
  name: "my-skill",
  description: "Custom project instructions",
  filePath: "/virtual/SKILL.md",
  baseDir: "/virtual",
  sourceInfo: createSyntheticSourceInfo("/virtual/SKILL.md", { source: "sdk" }),
  disableModelInvocation: false,
};

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
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
