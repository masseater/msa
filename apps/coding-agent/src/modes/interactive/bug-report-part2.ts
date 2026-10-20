import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportPart1 from "./bug-report-part1.ts";
import BorderedLoader from "./components/bordered-loader.ts";
import type borderedLoaderTypes from "./components/bordered-loader.types.ts";
import themeModule from "./theme/theme.ts";

const { theme } = themeModule;
const { showOverlay } = bugReportPart1;

function showLoader(
  context: bugReportInternalTypes.BugReportContext,
  message: string,
): borderedLoaderTypes.BorderedLoader {
  const loader = new BorderedLoader(context.ui, theme, message);
  showOverlay(context, loader);
  return loader;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const bugReportPart2 = {
  errorMessage,
  showLoader,
};

export default bugReportPart2;
