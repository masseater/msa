import type tuiTypes from "@msa/tui/index.types";

import type diagnosticsTypes from "../../core/diagnostics.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import ThemedText from "./components/themed-text.ts";
import loadedResourcesPart2 from "./loaded-resources-part2.ts";
import type themeTypes from "./theme/theme.types.ts";

const { formatDiagnostics } = loadedResourcesPart2;

function buildAddDiagnosticsPart1Part1(
  container: tuiTypes.Container,
  sectionHeader: (name: string, color: themeTypes.ThemeColor) => string,
  title: string,
  diagnostics: readonly diagnosticsTypes.ResourceDiagnostic[],
  sourceInfos: Map<string, sourceInfoTypes.SourceInfo>,
) {
  container.addChild(
    new ThemedText(
      () => `${sectionHeader(title, "warning")}\n${formatDiagnostics(diagnostics, sourceInfos)}`,
      0,
      0,
    ),
  );
}

const loadedResourcesPart9 = {
  buildAddDiagnosticsPart1Part1,
};

export default loadedResourcesPart9;
