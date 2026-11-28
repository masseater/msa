import type { Context, ESTree } from "vite-plus/lint/plugins";
import { defineRule } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import type intentRuleTypes from "./intent-rule.types.ts";
import reporter from "./reporter.ts";
import scopeLookup from "./scope-lookup.ts";
import StaticString from "./static-string.ts";

type Node = flowTypes.Node;

type PropertyNode = Extract<Node, { type: "Property" }>;

type ImportSpecifier = ESTree.ImportDeclaration["specifiers"][number];

const allowedOf = (context: Context): readonly string[] => {
  const [options] = context.options as readonly (
    | Readonly<{ allowed?: readonly string[] }>
    | undefined
  )[];
  return options?.allowed ?? [];
};

const isNamed = (source: string, names: readonly string[]): boolean =>
  names.some((name) => source === name || source.startsWith(`${name}/`));

const matches = (source: string, ban: intentRuleTypes.ImportBan): boolean =>
  ban.modules.includes(source) || (ban.prefixes ?? []).some((prefix) => source.startsWith(prefix));

const importedName = (specifier: ESTree.ImportSpecifier): string =>
  specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;

const bannedSpecifiers = (
  specifiers: readonly ImportSpecifier[],
  names: readonly string[],
): readonly ImportSpecifier[] =>
  specifiers.filter(
    (specifier) =>
      specifier.type === "ImportNamespaceSpecifier" ||
      (specifier.type === "ImportSpecifier" && names.includes(importedName(specifier))),
  );

type SourceDeclaration =
  | ESTree.ImportDeclaration
  | ESTree.ExportAllDeclaration
  | ESTree.ExportNamedDeclaration;

const sourceOf = (node: SourceDeclaration): string | undefined => {
  const value = node.source?.value;
  return typeof value === "string" ? value : undefined;
};

const reportBan = (
  node: SourceDeclaration,
  ban: intentRuleTypes.ImportBan,
  report: (node: Node) => void,
): void => {
  if (ban.names === undefined) {
    report(node);
  } else if (node.type === "ImportDeclaration") {
    for (const specifier of bannedSpecifiers(node.specifiers, ban.names)) report(specifier);
  }
};

const checkSource = (
  node: SourceDeclaration,
  intent: intentRuleTypes.Intent,
  allowed: readonly string[],
  report: (node: Node) => void,
): void => {
  const source = sourceOf(node);
  if (source === undefined || isNamed(source, allowed)) return;
  for (const ban of intent.imports.filter((candidate) => matches(source, candidate)))
    reportBan(node, ban, report);
};

const patternOf = (node: Node): Node | null => {
  const pattern = node.parent as Node | null;
  return pattern?.type === "ObjectPattern" ? (pattern.parent as Node | null) : null;
};

const destructuredFrom = (node: Node): Node | undefined => {
  const owner = patternOf(node);
  return owner?.type === "VariableDeclarator" ? (owner.init as Node | undefined) : undefined;
};

const destructuredKey = (node: PropertyNode): string | undefined =>
  node.computed || node.key.type !== "Identifier" ? undefined : node.key.name;

const objectNameOf = (node: Node | undefined): string | undefined =>
  node?.type === "Identifier" ? node.name : undefined;

const isBanned = (
  bans: readonly intentRuleTypes.MemberBan[],
  property: string,
  object?: string,
): boolean =>
  bans.some(
    (ban) =>
      ban.properties.includes(property) && (ban.object === undefined || ban.object === object),
  );

const isBannedDestructure = (
  node: PropertyNode,
  bans: readonly intentRuleTypes.MemberBan[],
): boolean => {
  const from = destructuredFrom(node);
  const key = destructuredKey(node);
  return from !== undefined && key !== undefined && isBanned(bans, key, objectNameOf(from));
};

const defineIntentRule = (intent: intentRuleTypes.Intent) =>
  defineRule({
    create(context) {
      const report = reporter.createReporter(context, intent.message);
      const allowed = allowedOf(context);
      const strings = new StaticString(context);
      const nameOf = (node: ESTree.MemberExpression): string | undefined =>
        node.computed ? strings.fold(node.property) : scopeLookup.staticMemberName(node);
      return {
        ExportAllDeclaration: (node) => checkSource(node, intent, allowed, report),
        ExportNamedDeclaration: (node) => checkSource(node, intent, allowed, report),
        ImportDeclaration: (node) => checkSource(node, intent, allowed, report),
        MemberExpression(node) {
          const name = nameOf(node);
          if (name !== undefined && isBanned(intent.members, name, objectNameOf(node.object)))
            report(node);
        },
        Property(node) {
          if (isBannedDestructure(node, intent.members)) report(node);
        },
      };
    },
    meta: {
      schema: [
        {
          additionalProperties: false,
          properties: { allowed: { items: { type: "string" }, type: "array" } },
          type: "object",
        },
      ],
      type: "problem",
    },
  });

const intentRule = { defineIntentRule };

export default intentRule;
