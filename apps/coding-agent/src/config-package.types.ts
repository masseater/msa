declare namespace configPackageTypes {
  type InstallChange = { kind: "updated"; version: string } | { kind: "removed" };
}

export type { configPackageTypes as default };
