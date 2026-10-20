import DefaultPackageManagerLayer11 from "./default-package-manager-layer-11.ts";
import type packageManagerTypes from "./package-manager.types.ts";

export default class DefaultPackageManager
  extends DefaultPackageManagerLayer11
  implements packageManagerTypes.PackageManager {}
