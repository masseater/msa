import modelUpgradePart2Part1 from "./model-upgrade-part2-part1.ts";
import modelUpgradePart2Part2 from "./model-upgrade-part2-part2.ts";

const {
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  rewriteString,
  rewriteStringArray,
  splitThinkingSuffix,
  upgradeModelReference,
} = modelUpgradePart2Part1;
const { rewriteModelReferencesInSettingsPart1 } = modelUpgradePart2Part2;

const modelUpgradePart2 = {
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  rewriteModelReferencesInSettingsPart1,
  rewriteString,
  rewriteStringArray,
  splitThinkingSuffix,
  upgradeModelReference,
};

export default modelUpgradePart2;
