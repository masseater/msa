declare namespace localClassExtendsTypes {
  type WorkspacePackage = { readonly dir: string; readonly specifiers: readonly string[] };

  type ClassExtendsOptions = {
    readonly builtins: readonly string[];
    readonly packages: readonly WorkspacePackage[];
    readonly probeRoot: string;
  };
}

export type { localClassExtendsTypes as default };
