import type packageManagerTypes from "../core/package-manager.types.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import type themeTypes from "../modes/interactive/theme/theme.types.ts";
import type startupUiInternalTypes from "./startup-ui-internal.types.ts";

const { loadThemeFromPath } = themeModule;

const OFFICIAL_PACKAGE_NAME = "@msa/coding-agent";

const OFFICIAL_APP_NAME = "msa";

const OFFICIAL_CONFIG_DIR_NAME = ".msa";

function isOfficialDistribution({
  packageName,
  appName,
  configDirName,
}: startupUiInternalTypes.DistributionMetadata): boolean {
  return (
    packageName === OFFICIAL_PACKAGE_NAME &&
    appName === OFFICIAL_APP_NAME &&
    configDirName === OFFICIAL_CONFIG_DIR_NAME
  );
}

function loadThemes(resources: packageManagerTypes.ResolvedResource[]): themeTypes.Theme[] {
  const themes: themeTypes.Theme[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!resource.enabled) continue;
    try {
      const loadedTheme = loadThemeFromPath(resource.path);
      if (loadedTheme.name !== undefined && loadedTheme.name !== "") {
        if (seen.has(loadedTheme.name)) continue;
        seen.add(loadedTheme.name);
      }
      themes.push(loadedTheme);
    } catch {}
  }
  return themes;
}

const startupUiPart1 = {
  isOfficialDistribution,
  loadThemes,
};

export default startupUiPart1;
