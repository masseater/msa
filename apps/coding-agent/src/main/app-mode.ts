import type argsTypes from "../cli/args.types.ts";
import type projectTrustTypes from "../core/project-trust.types.ts";

function resolveAppMode(
  parsed: argsTypes.Args,
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
): projectTrustTypes.AppMode {
  if (parsed.mode === "rpc") {
    return "rpc";
  }
  if (parsed.mode === "json") {
    return "json";
  }
  if (parsed.print === true || !stdinIsTTY || !stdoutIsTTY) {
    return "print";
  }
  return "interactive";
}

function toPrintOutputMode(appMode: projectTrustTypes.AppMode): Exclude<argsTypes.Mode, "rpc"> {
  return appMode === "json" ? "json" : "text";
}

function isPlainRuntimeMetadataCommand(parsed: argsTypes.Args): boolean {
  return (
    parsed.print !== true &&
    parsed.mode === undefined &&
    (parsed.help === true || parsed.listModels !== undefined)
  );
}

const appModes = { isPlainRuntimeMetadataCommand, resolveAppMode, toPrintOutputMode };

export default appModes;
