import bugReportArchive from "./bug-report-archive.ts";
import bugReportMetadata from "./bug-report-metadata.ts";
import bugReportRedaction from "./bug-report-redaction.ts";
import bugReportSummary from "./bug-report-summary.ts";

const { BUG_REPORT_CUSTOM_ENTRY_TYPE, collectBugReportDiagnostics, collectBugReportMetadata } =
  bugReportMetadata;
const { redactJsonValue, redactUrl } = bugReportRedaction;
const { bugReportArchiveFileName, writeBugReportArchive } = bugReportArchive;
const { generateBugReportSummary } = bugReportSummary;

const bugReport = {
  BUG_REPORT_CUSTOM_ENTRY_TYPE,
  bugReportArchiveFileName,
  collectBugReportDiagnostics,
  collectBugReportMetadata,
  generateBugReportSummary,
  redactJsonValue,
  redactUrl,
  writeBugReportArchive,
};

export default bugReport;
