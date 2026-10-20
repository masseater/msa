import type DefaultPackageManager from "../default-package-manager.ts";
import PackageInstallation from "./installation.ts";
import PackageUpdateCheck from "./package-update-check.ts";
import PackageUpdates from "./package-updates.ts";

export default class PackageOperations {
  readonly install: PackageInstallation;
  readonly updates: PackageUpdates;
  readonly updateCheck: PackageUpdateCheck;

  constructor(manager: DefaultPackageManager) {
    this.install = new PackageInstallation(manager);
    this.updates = new PackageUpdates(manager);
    this.updateCheck = new PackageUpdateCheck(manager);
  }
}
