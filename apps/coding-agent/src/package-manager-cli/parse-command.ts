import type packageManagerCliInternalTypes from "../package-manager-cli-internal.types.ts";
import type packageManagerCliTypes from "../package-manager-cli.types.ts";

type Command = packageManagerCliTypes.PackageCommand;
type UpdateTarget = packageManagerCliInternalTypes.UpdateTarget;

type Scan = {
  local: boolean;
  force: boolean;
  help: boolean;
  projectTrustOverride?: boolean | undefined;
  invalidOption?: string | undefined;
  invalidArgument?: string | undefined;
  missingOptionValue?: string | undefined;
  conflictingOptions?: string | undefined;
  source?: string | undefined;
  self: boolean;
  extensions: boolean;
  models: boolean;
  all: boolean;
  extensionSource?: string | undefined;
};

type UpdateFlag = "self" | "extensions" | "models" | "all" | "force";

const UPDATE_FLAGS: ReadonlyMap<string, UpdateFlag> = new Map([
  ["--self", "self"],
  ["--extensions", "extensions"],
  ["--models", "models"],
  ["--all", "all"],
  ["--force", "force"],
]);

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

function parseCommandName(raw: string | undefined): Command | undefined {
  if (raw === "uninstall") return "remove";
  return raw === "install" || raw === "remove" || raw === "update" || raw === "list"
    ? raw
    : undefined;
}

function conflict(scan: Scan, message: string): void {
  scan.conflictingOptions ??= message;
}

function scanExtensionOption(scan: Scan, arg: string, value: string | undefined): number {
  if (value === undefined || value === "" || value.startsWith("-")) {
    scan.missingOptionValue ??= arg;
    return 0;
  }
  if (present(scan.extensionSource)) conflict(scan, "--extension can only be provided once");
  else scan.extensionSource = value;
  return 1;
}

function scanOption(scan: Scan, command: Command, arg: string, next: string | undefined): number {
  const updateFlag = UPDATE_FLAGS.get(arg);
  if (arg === "-h" || arg === "--help") scan.help = true;
  else if (arg === "-l" || arg === "--local") {
    if (command === "install" || command === "remove") scan.local = true;
    else scan.invalidOption ??= arg;
  } else if (updateFlag !== undefined) {
    if (command === "update") scan[updateFlag] = true;
    else scan.invalidOption ??= arg;
  } else if (arg === "--approve" || arg === "-a") scan.projectTrustOverride = true;
  else if (arg === "--no-approve" || arg === "-na") scan.projectTrustOverride = false;
  else if (arg === "--extension") {
    if (command === "update") return scanExtensionOption(scan, arg, next);
    scan.invalidOption ??= arg;
  } else scan.invalidOption ??= arg;
  return 0;
}

function scanArgs(command: Command, rest: readonly string[]): Scan {
  const scan: Scan = {
    all: false,
    extensions: false,
    force: false,
    help: false,
    local: false,
    models: false,
    self: false,
  };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === undefined) break;
    if (arg.startsWith("-")) {
      index += scanOption(scan, command, arg, rest[index + 1]);
    } else if (present(scan.source)) {
      scan.invalidArgument ??= arg;
    } else {
      scan.source = arg;
    }
  }
  return scan;
}

function checkAllConflicts(scan: Scan): void {
  if (!scan.all) return;
  if (scan.self || scan.extensions || scan.models || present(scan.extensionSource)) {
    conflict(scan, "--all cannot be combined with --self, --extensions, --models, or --extension");
  }
  if (present(scan.source)) conflict(scan, "--all cannot be combined with a positional source");
}

function modelsTarget(scan: Scan): UpdateTarget {
  if (scan.self || scan.extensions || scan.all || present(scan.extensionSource)) {
    conflict(scan, "--models cannot be combined with --self, --extensions, --all, or --extension");
  }
  if (present(scan.source)) conflict(scan, "--models cannot be combined with a positional source");
  return { type: "models" };
}

function extensionTarget(scan: Scan, extensionSource: string): UpdateTarget {
  if (scan.self || scan.extensions || scan.all) {
    conflict(scan, "--extension cannot be combined with --self, --extensions, or --all");
  }
  if (present(scan.source)) {
    conflict(scan, "--extension cannot be combined with a positional source");
  }
  return { source: extensionSource, type: "extensions" };
}

function sourceTarget(scan: Scan, source: string): UpdateTarget {
  if (source === "self" || source === "msa") {
    return scan.extensions ? { type: "all" } : { type: "self" };
  }
  if (scan.extensions || scan.self || scan.all) {
    conflict(
      scan,
      "positional update targets cannot be combined with --self, --extensions, or --all",
    );
  }
  return { source, type: "extensions" };
}

function updateTarget(scan: Scan): { target: UpdateTarget; skippedNote: boolean } {
  checkAllConflicts(scan);
  if (scan.models) return { skippedNote: false, target: modelsTarget(scan) };
  if (present(scan.extensionSource)) {
    return { skippedNote: false, target: extensionTarget(scan, scan.extensionSource) };
  }
  if (present(scan.source)) return { skippedNote: false, target: sourceTarget(scan, scan.source) };
  if (scan.all || (scan.self && scan.extensions))
    return { skippedNote: false, target: { type: "all" } };
  if (scan.self) return { skippedNote: false, target: { type: "self" } };
  if (scan.extensions) return { skippedNote: false, target: { type: "extensions" } };
  return { skippedNote: true, target: { type: "self" } };
}

function parsePackageCommand(
  args: string[],
): packageManagerCliInternalTypes.PackageCommandOptions | undefined {
  const [rawCommand, ...rest] = args;
  const command = parseCommandName(rawCommand);
  if (command === undefined) return undefined;
  const scan = scanArgs(command, rest);
  const update = command === "update" ? updateTarget(scan) : undefined;
  return {
    command,
    conflictingOptions: scan.conflictingOptions,
    force: scan.force,
    help: scan.help,
    invalidArgument: scan.invalidArgument,
    invalidOption: scan.invalidOption,
    local: scan.local,
    missingOptionValue: scan.missingOptionValue,
    projectTrustOverride: scan.projectTrustOverride,
    showExtensionsSkippedNote: update?.skippedNote ?? false,
    source: scan.source,
    updateTarget: update?.target,
  };
}

const parseCommand = { parsePackageCommand };

export default parseCommand;
