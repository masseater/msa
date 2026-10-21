import zip from "../utils/zip.ts";
import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import type bugReportTypes from "./bug-report.types.ts";

const { writeZipArchive } = zip;

function bugReportFiles(
  bundle: bugReportTypes.BugReportBundle,
): bugReportInternalTypes.BugReportFile[] {
  const files: bugReportInternalTypes.BugReportFile[] = [
    {
      contentType: "application/json",
      data: `${JSON.stringify(bundle.metadata, null, 2)}\n`,
      name: "report.json",
    },
    {
      contentType: "application/json",
      data: `${JSON.stringify(bundle.diagnostics, null, 2)}\n`,
      name: "diagnostics.json",
    },
  ];
  if (bundle.sessionJsonl !== undefined) {
    files.push({
      contentType: "application/x-ndjson",
      data: bundle.sessionJsonl,
      name: "session.jsonl",
    });
  }
  if (bundle.summary !== undefined) {
    files.push({
      contentType: "text/markdown",
      data: bundle.summary.endsWith("\n") ? bundle.summary : `${bundle.summary}\n`,
      name: "summary.md",
    });
  }
  return files;
}

function writeBugReportArchive(
  bundle: bugReportTypes.BugReportBundle,
  filePath: string,
): Promise<void> {
  return writeZipArchive(filePath, bugReportFiles(bundle));
}

function bugReportArchiveFileName(id: string): string {
  return `msa-bug-report-${id}.zip`;
}

const bugReportArchive = { bugReportArchiveFileName, writeBugReportArchive };

export default bugReportArchive;
