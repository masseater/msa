import bugReportPart1 from "./bug-report-part1.ts";
import bugReportPart2 from "./bug-report-part2.ts";
import bugReportPart4 from "./bug-report-part4.ts";

const { BUG_REPORT_CUSTOM_ENTRY_TYPE, redactJsonValue, redactUrl } = bugReportPart1;
const {
  bugReportArchiveFileName,
  collectBugReportDiagnostics,
  collectBugReportMetadata,
  writeBugReportArchive,
} = bugReportPart2;
const { generateBugReportSummary } = bugReportPart4;

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
