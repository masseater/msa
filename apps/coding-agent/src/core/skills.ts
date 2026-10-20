import skillsPart2 from "./skills-part2.ts";
import skillsPart3 from "./skills-part3.ts";

const { formatSkillsForPrompt, loadSkillsFromDir } = skillsPart2;
const { loadSkills } = skillsPart3;

const skills = {
  formatSkillsForPrompt,
  loadSkills,
  loadSkillsFromDir,
};

export default skills;
