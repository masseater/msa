import type packageManagerCliInternalTypes from "./package-manager-cli-internal.types.ts";
import packageManagerCliPart1 from "./package-manager-cli-part1.ts";
import packageManagerCliPart2 from "./package-manager-cli-part2.ts";
import packageManagerCliPart3Part1 from "./package-manager-cli-part3-part1.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

const {
  parsePackageCommandPart5,
  parsePackageCommandPart6,
  parsePackageCommandPart7,
  parsePackageCommandPart8,
} = packageManagerCliPart1;
const { parsePackageCommandPart3 } = packageManagerCliPart2;
const { parsePackageCommandPart14 } = packageManagerCliPart3Part1;

function parsePackageCommand(
  args: string[],
): packageManagerCliInternalTypes.PackageCommandOptions | undefined {
  const [rawCommand, ...rest] = args;
  let command: packageManagerCliTypes.PackageCommand | undefined =
    parsePackageCommandPart5(rawCommand);
  if (command === undefined) {
    return undefined;
  }

  let {
    help,
    local,
    invalidOption,
    selfFlag,
    extensionsFlag,
    modelsFlag,
    allFlag,
    projectTrustOverride,
    force,
    missingOptionValue,
    extensionFlagSource,
    conflictingOptions,
    source,
    invalidArgument,
  }: {
    help: boolean;
    local: boolean;
    invalidOption: string | undefined;
    selfFlag: boolean;
    extensionsFlag: boolean;
    modelsFlag: boolean;
    allFlag: boolean;
    projectTrustOverride: boolean | undefined;
    force: boolean;
    missingOptionValue: string | undefined;
    extensionFlagSource: string | undefined;
    conflictingOptions: string | undefined;
    source: string | undefined;
    invalidArgument: string | undefined;
  } = parsePackageCommandPart14();

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === undefined) break;
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "-l" || arg === "--local") {
      ({ local, invalidOption } = parsePackageCommandPart8(command, local, invalidOption, arg));
      continue;
    }

    if (arg === "--self") {
      if (command === "update") {
        selfFlag = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--extensions") {
      if (command === "update") {
        extensionsFlag = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--models") {
      if (command === "update") {
        modelsFlag = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--all") {
      if (command === "update") {
        allFlag = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--approve" || arg === "-a") {
      projectTrustOverride = true;
      continue;
    }

    if (arg === "--no-approve" || arg === "-na") {
      projectTrustOverride = false;
      continue;
    }

    if (arg === "--force") {
      if (command === "update") {
        force = true;
      } else {
        invalidOption = invalidOption ?? arg;
      }
      continue;
    }

    if (arg === "--extension") {
      if (command !== "update") {
        invalidOption = invalidOption ?? arg;
        continue;
      }

      ({ index, missingOptionValue, extensionFlagSource, conflictingOptions } =
        parsePackageCommandPart6(
          rest,
          index,
          missingOptionValue,
          arg,
          extensionFlagSource,
          conflictingOptions,
        ));
      continue;
    }

    if (arg.startsWith("-")) {
      invalidOption = invalidOption ?? arg;
      continue;
    }

    ({ source, invalidArgument } = parsePackageCommandPart7(source, invalidArgument, arg));
  }

  let showExtensionsSkippedNote;
  let updateTarget: packageManagerCliInternalTypes.UpdateTarget | undefined;
  ({ showExtensionsSkippedNote, updateTarget, conflictingOptions } = parsePackageCommandPart3(
    command,
    conflictingOptions,
    allFlag,
    selfFlag,
    extensionsFlag,
    modelsFlag,
    extensionFlagSource,
    source,
  ));

  return {
    command,
    conflictingOptions,
    force,
    help,
    invalidArgument,
    invalidOption,
    local,
    missingOptionValue,
    projectTrustOverride,
    showExtensionsSkippedNote,
    source,
    updateTarget,
  };
}

function updateTargetIncludesSelf(target: packageManagerCliInternalTypes.UpdateTarget): boolean {
  return target.type === "all" || target.type === "self";
}

function updateTargetIncludesExtensions(
  target: packageManagerCliInternalTypes.UpdateTarget,
): boolean {
  return target.type === "all" || target.type === "extensions";
}

const packageManagerCliPart3Part2 = {
  parsePackageCommand,
  updateTargetIncludesExtensions,
  updateTargetIncludesSelf,
};

export default packageManagerCliPart3Part2;
