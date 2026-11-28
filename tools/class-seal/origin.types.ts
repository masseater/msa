declare namespace classOriginTypes {
  type Span = { readonly start: number; readonly end: number };

  type AstNode = Span & { readonly type: string } & Readonly<Record<string, unknown>>;

  type Origin =
    | { readonly kind: "reference"; readonly containers: readonly Span[] }
    | {
        readonly kind: "product";
        readonly probe: (callee: string) => string;
        readonly callee: Span;
      }
    | { readonly kind: "unknown" };

  type Imported = { readonly name: string | undefined; readonly source: string };

  type Module = {
    readonly imports: ReadonlyMap<string, Imported>;
    readonly shadowed: ReadonlySet<string>;
  };

  type Path = { readonly root: AstNode; readonly keys: readonly string[]; readonly spans: Span[] };

  type Resolved = { readonly imported: Imported; readonly path: Path };
}

export type { classOriginTypes as default };
