import type packageManagerCliInternalTypes from "./package-manager-cli-internal.types.ts";
import packageManagerCliPart1 from "./package-manager-cli-part1.ts";

const { parsePackageCommandPart1 } = packageManagerCliPart1;

function parsePackageCommandPart3(
  command: string,
  conflictingOptions: string | undefined,
  allFlag: boolean,
  selfFlag: boolean,
  extensionsFlag: boolean,
  modelsFlag: boolean,
  extensionFlagSource: string | undefined,
  source: string | undefined,
) {
  let updateTarget: packageManagerCliInternalTypes.UpdateTarget | undefined;
  let showExtensionsSkippedNote = false;
  if (command === "update") {
    conflictingOptions = parsePackageCommandPart1(
      allFlag,
      selfFlag,
      extensionsFlag,
      modelsFlag,
      extensionFlagSource,
      conflictingOptions,
      source,
    );

    ({ conflictingOptions, updateTarget, showExtensionsSkippedNote } =
      parsePackageCommandPart3Part1(
        modelsFlag,
        conflictingOptions,
        updateTarget,
        selfFlag,
        extensionsFlag,
        allFlag,
        extensionFlagSource,
        source,
        showExtensionsSkippedNote,
      ));
  }
  return { conflictingOptions, showExtensionsSkippedNote, updateTarget };
}

function parsePackageCommandPart3Part1(
  modelsFlag: boolean,
  conflictingOptions: string | undefined,
  updateTarget: packageManagerCliInternalTypes.UpdateTarget | undefined,
  selfFlag: boolean,
  extensionsFlag: boolean,
  allFlag: boolean,
  extensionFlagSource: string | undefined,
  source: string | undefined,
  showExtensionsSkippedNote: boolean,
) {
  if (modelsFlag) {
    ({ conflictingOptions, updateTarget } = parsePackageCommandPart2(
      selfFlag,
      extensionsFlag,
      allFlag,
      extensionFlagSource,
      conflictingOptions,
      source,
      updateTarget,
    ));
  } else if (extensionFlagSource !== undefined && extensionFlagSource !== "") {
    if (selfFlag || extensionsFlag || allFlag) {
      conflictingOptions =
        conflictingOptions ?? "--extension cannot be combined with --self, --extensions, or --all";
    }
    if (source !== undefined && source !== "") {
      conflictingOptions =
        conflictingOptions ?? "--extension cannot be combined with a positional source";
    }
    updateTarget = { source: extensionFlagSource, type: "extensions" };
  } else if (source !== undefined && source !== "") {
    const sourceIsSelf = source === "self" || source === "msa";
    if (sourceIsSelf) {
      updateTarget = extensionsFlag ? { type: "all" } : { type: "self" };
    } else {
      if (extensionsFlag || selfFlag || allFlag) {
        conflictingOptions =
          conflictingOptions ??
          "positional update targets cannot be combined with --self, --extensions, or --all";
      }
      updateTarget = { source, type: "extensions" };
    }
  } else if (allFlag) {
    updateTarget = { type: "all" };
  } else if (selfFlag && extensionsFlag) {
    updateTarget = { type: "all" };
  } else if (selfFlag) {
    updateTarget = { type: "self" };
  } else if (extensionsFlag) {
    updateTarget = { type: "extensions" };
  } else {
    updateTarget = { type: "self" };
    showExtensionsSkippedNote = true;
  }
  return { conflictingOptions, showExtensionsSkippedNote, updateTarget };
}

function parsePackageCommandPart2(
  selfFlag: boolean,
  extensionsFlag: boolean,
  allFlag: boolean,
  extensionFlagSource: string | undefined,
  conflictingOptions: string | undefined,
  source: string | undefined,
  updateTarget: packageManagerCliInternalTypes.UpdateTarget | undefined,
) {
  if (
    selfFlag ||
    extensionsFlag ||
    allFlag ||
    (extensionFlagSource !== undefined && extensionFlagSource !== "")
  ) {
    conflictingOptions =
      conflictingOptions ??
      "--models cannot be combined with --self, --extensions, --all, or --extension";
  }
  if (source !== undefined && source !== "") {
    conflictingOptions =
      conflictingOptions ?? "--models cannot be combined with a positional source";
  }
  updateTarget = { type: "models" };
  return { conflictingOptions, updateTarget };
}

const packageManagerCliPart2 = {
  parsePackageCommandPart3,
};

export default packageManagerCliPart2;
