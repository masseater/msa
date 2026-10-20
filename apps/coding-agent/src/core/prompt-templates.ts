import promptTemplatesPart1 from "./prompt-templates-part1.ts";
import promptTemplatesPart2 from "./prompt-templates-part2.ts";

const { expandPromptTemplate, loadPromptTemplates } = promptTemplatesPart2;
const { parseCommandArgs, substituteArgs } = promptTemplatesPart1;

const promptTemplates = {
  expandPromptTemplate,
  loadPromptTemplates,
  parseCommandArgs,
  substituteArgs,
};

export default promptTemplates;
