declare namespace configPackageTypes {
  type InstallChange = { kind: "updated"; version: string } | { kind: "removed" };
  type EmbeddedAssets = {
    readonly changelog: string;
    readonly exportTemplateCss: string;
    readonly quickJSWasm: string;
  };
}

export type { configPackageTypes as default };
