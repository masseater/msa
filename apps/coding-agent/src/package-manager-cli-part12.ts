import { dual } from "effect/Function";

import packageManagerCliPart11 from "./package-manager-cli-part11.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

const { handleConfigCommandImpl } = packageManagerCliPart11;

const handleConfigCommand: {
  (
    args: string[],
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): Promise<boolean>;
  (
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): (args: string[]) => Promise<boolean>;
} = dual((args: IArguments) => args.length >= 1, handleConfigCommandImpl);

const packageManagerCliPart12 = {
  handleConfigCommand,
};

export default packageManagerCliPart12;
