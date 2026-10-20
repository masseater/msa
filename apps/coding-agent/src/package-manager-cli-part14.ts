import { dual } from "effect/Function";

import packageManagerCliPart13 from "./package-manager-cli-part13.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

const { handlePackageCommandImpl } = packageManagerCliPart13;

const handlePackageCommand: {
  (
    args: string[],
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): Promise<boolean>;
  (
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): (args: string[]) => Promise<boolean>;
} = dual((args: IArguments) => args.length >= 1, handlePackageCommandImpl);

const packageManagerCliPart14 = {
  handlePackageCommand,
};

export default packageManagerCliPart14;
