declare namespace intentRuleTypes {
  type ImportBan = Readonly<{
    modules: readonly string[];
    names?: readonly string[];
    prefixes?: readonly string[];
  }>;

  type MemberBan = Readonly<{ object?: string; properties: readonly string[] }>;

  type Intent = Readonly<{
    imports: readonly ImportBan[];
    members: readonly MemberBan[];
    message: string;
  }>;
}

export type { intentRuleTypes as default };
