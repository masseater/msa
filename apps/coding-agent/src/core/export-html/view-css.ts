import type sessionViewTypes from "./session-view.types.ts";

type Graph = sessionViewTypes.SessionGraph;

const TOP = "> #content > #messages >";

const NESTED = "> #content > #messages > .assistant-message > .tool-execution >";

const targeted = (path: string, attribute: string): string =>
  `#app:has(${path} [${attribute}]:target)`;

const UNTARGETED = "body:not(:has([data-v]:target))";

const rule = (selectors: readonly string[], declarations: string): string =>
  selectors.length === 0 ? "" : `${selectors.join(",\n")} { ${declarations} }`;

const viewScopes = (views: number): readonly (readonly [scope: string, view: number])[] => [
  [UNTARGETED, 0],
  ...Array.from(
    { length: views },
    (_, view) => [`body:has([data-v="${view}"]:target)`, view] as const,
  ),
];

const viewRules = (views: number): readonly string[] => {
  const scopes = viewScopes(views);
  return [
    rule(
      scopes.map(([scope, view]) => `${scope} #messages > .v${view}:not(.entry-anchor)`),
      "display: block;",
    ),
    rule(
      scopes.map(([scope, view]) => `${scope} .tree-node.v${view}`),
      "opacity: 1; background: color-mix(in srgb, var(--accent) 10%, transparent);",
    ),
    rule(
      scopes.map(([scope, view]) => `${scope} .tree-node.v${view} .tree-marker::before`),
      'content: "•";',
    ),
  ];
};

const activeRules = (graph: Graph, refs: sessionViewTypes.EntryRefs): readonly string[] => {
  const targets = graph.entries.map(({ id }) => {
    const index = refs.indexOf(id);
    return `${targeted(refs.isNested(id) ? NESTED : TOP, `data-e="${index}"`)} .t${index}`;
  });
  const initial =
    graph.defaultLeaf === undefined ? [] : [`${UNTARGETED} .t${refs.indexOf(graph.defaultLeaf)}`];
  return [rule([...initial, ...targets], "font-weight: bold;")];
};

const viewCss = (graph: Graph, refs: sessionViewTypes.EntryRefs): string =>
  [...viewRules(graph.views.length), ...activeRules(graph, refs)]
    .filter((css) => css !== "")
    .join("\n");

const viewCssModule = { viewCss };

export default viewCssModule;
