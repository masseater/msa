import { lintSource } from "@secretlint/core";
import { rules } from "@secretlint/secretlint-rule-preset-recommend";

const RULE_PREFIX = "@secretlint/secretlint-rule-";
const SUPPRESSING_RULE = `${RULE_PREFIX}filter-comments`;

const detectingRules = rules
  .filter((rule) => rule.meta.id !== SUPPRESSING_RULE)
  .map((rule) => ({ id: rule.meta.id, rule }));

function findSecrets(text: string): Promise<string[]> {
  return lintSource({
    options: {
      config: { rules: detectingRules },
      maskSecrets: true,
      noPhysicFilePath: true,
    },
    source: { content: text, contentType: "text", filePath: "memory.txt" },
  }).then((result) => [
    ...new Set(result.messages.map((message) => message.ruleId.replace(RULE_PREFIX, ""))),
  ]);
}

const secretCheck = { findSecrets };

export default secretCheck;
