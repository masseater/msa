import type DefaultPackageManager from "../default-package-manager.ts";
import NpmInstalls from "./npm-installs.ts";
import NpmPaths from "./npm-paths.ts";
import NpmTool from "./npm-tool.ts";
import NpmUpdateCheck from "./npm-update-check.ts";

export default class NpmPackages {
  readonly paths: NpmPaths;
  readonly tool: NpmTool;
  readonly installs: NpmInstalls;
  readonly updates: NpmUpdateCheck;

  constructor(manager: DefaultPackageManager) {
    this.paths = new NpmPaths(manager);
    this.tool = new NpmTool(manager);
    this.installs = new NpmInstalls(manager);
    this.updates = new NpmUpdateCheck(manager);
  }
}
