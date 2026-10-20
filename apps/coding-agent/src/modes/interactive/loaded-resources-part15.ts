import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import loadedResourcesPart14 from "./loaded-resources-part14.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";

const { buildAddDiagnostics, buildPart4 } = loadedResourcesPart14;

const renderLoadedResources: {
  (
    source: loadedResourcesTypes.LoadedResourcesSource,
    options: loadedResourcesTypes.LoadedResourcesOptions,
  ): (container: tuiTypes.Container) => void;
  (
    container: tuiTypes.Container,
    source: loadedResourcesTypes.LoadedResourcesSource,
    options: loadedResourcesTypes.LoadedResourcesOptions,
  ): void;
} = dual(
  3,
  (
    container: tuiTypes.Container,
    source: loadedResourcesTypes.LoadedResourcesSource,
    options: loadedResourcesTypes.LoadedResourcesOptions,
  ): void => {
    container.clear();
    if (!options.showListing && !options.showDiagnostics) {
      return;
    }

    const { addDiagnostics, skillsResult, promptsResult, extensionsResult, themesResult } =
      buildAddDiagnostics(source, options, container);

    buildPart4(
      options,
      addDiagnostics,
      skillsResult,
      promptsResult,
      extensionsResult,
      source,
      themesResult,
    );
  },
);

const loadedResourcesPart15 = {
  renderLoadedResources,
};

export default loadedResourcesPart15;
