declare namespace restrictedMemberTypes {
  type RestrictedMember = {
    readonly message: string;
    readonly module: string;
    readonly path: readonly string[];
  };
}

export type { restrictedMemberTypes as default };
