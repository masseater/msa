import modelUpgradePart1 from "./model-upgrade-part1.ts";
import modelUpgradePart2 from "./model-upgrade-part2.ts";
import modelUpgradePart3 from "./model-upgrade-part3.ts";

const {
  candidatesNamedByChanges,
  formatModelUpgrade,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
} = modelUpgradePart3;
const { compareModelVersions, parseModelIdVersion } = modelUpgradePart1;
const { createUpgradeReplacements, findModelUpgrade, findModelUpgrades, upgradeModelReference } =
  modelUpgradePart2;

const modelUpgrade = {
  candidatesNamedByChanges,
  compareModelVersions,
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  formatModelUpgrade,
  parseModelIdVersion,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
  upgradeModelReference,
};

export default modelUpgrade;
