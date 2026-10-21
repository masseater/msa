import type { ESTree } from "vite-plus/lint/plugins";

declare namespace flowTypes {
  type Node = ESTree.Node;

  type MaybeNode = Node | null | undefined;

  type Key = { readonly name: string | undefined; readonly mayBe: (target: string) => boolean };

  type Outcome<K extends string> = K | "ok" | "unknown";

  type Holder = ESTree.CallExpression | ESTree.NewExpression | ESTree.ObjectProperty;

  type Flow<K extends string> = {
    readonly argument: (kind: K, holder: Holder, index: number) => Outcome<K>;
    readonly call: (kind: K, call: ESTree.CallExpression | ESTree.NewExpression) => Outcome<K>;
    readonly escape: (kind: K) => Outcome<K>;
    readonly member: (kind: K, key: Key) => Outcome<K>;
    readonly unknown: (node: Node) => void;
  };

  type Reporters = {
    readonly restricted: (node: Node) => void;
    readonly unknown: (node: Node) => void;
  };
}

export type { flowTypes as default };
