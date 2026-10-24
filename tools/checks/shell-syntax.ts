import { Effect } from "effect";
import { Language, Parser } from "web-tree-sitter";
import type { Node } from "web-tree-sitter";

import type shellSyntaxTypes from "./shell-syntax.types.ts";

type Item = shellSyntaxTypes.Item;
type Link = shellSyntaxTypes.Link;
type Script = shellSyntaxTypes.Script;
type Word = shellSyntaxTypes.Word;

interface Sequence {
  readonly link: Link;
  readonly steps: Script;
}

const LINKS: Readonly<Record<string, Link>> = {
  "&": "concurrent",
  "&&": "and",
  ";": "seq",
  "|": "concurrent",
  "|&": "concurrent",
  "||": "or",
};
const SUBSTITUTION = "command_substitution";

const unescape = (text: string): string => text.replace(/\\(.)/gsu, "$1");

const staticWord = (text: string): Word => ({ dynamic: false, text });
const dynamicWord = (node: Node): Word => ({ dynamic: true, text: node.text });

const joinWords = (words: ReadonlyArray<Word>): Word => ({
  dynamic: words.some((word) => word.dynamic),
  text: words.map((word) => word.text).join(""),
});

const WORDS: Readonly<Record<string, (node: Node) => Word>> = {
  concatenation: (node) => joinWords(node.children.map(wordOf)),
  number: (node) => staticWord(node.text),
  raw_string: (node) => staticWord(node.text.slice(1, -1)),
  string: (node) => joinWords(node.namedChildren.map(wordOf)),
  string_content: (node) => staticWord(unescape(node.text)),
  word: (node) => staticWord(unescape(node.text)),
};

function wordOf(node: Node): Word {
  return (WORDS[node.type] ?? dynamicWord)(node);
}

const only = (item: Item): Script => [{ item, link: "start" }];

const unreadable = (node: Node, syntax = node.type): Script =>
  only({ kind: "unreadable", syntax, text: node.text });

const containsSubstitution = (node: Node): boolean =>
  node.type === SUBSTITUTION || node.namedChildren.some(containsSubstitution);

const isRedirect = (node: Node): boolean => node.type.endsWith("_redirect");

const isUnsafeRedirect = (node: Node): boolean =>
  isRedirect(node) && (node.type !== "file_redirect" || containsSubstitution(node));

function substitutionsIn(node: Node): ReadonlyArray<Script> {
  if (node.type === SUBSTITUTION) return [sequence(node)];
  return node.namedChildren.flatMap(substitutionsIn);
}

const assignmentOf = (node: Node): shellSyntaxTypes.Assignment => {
  const value = node.childForFieldName("value");
  return {
    name: node.childForFieldName("name")?.text ?? "",
    value: value === null ? staticWord("") : wordOf(value),
  };
};

const isArgument = (node: Node): boolean =>
  node.type !== "variable_assignment" && !isRedirect(node);

const wordNode = (node: Node): Node =>
  node.type === "command_name" ? (node.firstChild ?? node) : node;

const assignmentsIn = (node: Node): ReadonlyArray<shellSyntaxTypes.Assignment> =>
  (node.type === "variable_assignment" ? [node] : node.namedChildren)
    .filter((child) => child.type === "variable_assignment")
    .map(assignmentOf);

const simple = (node: Node): Script =>
  only({
    assignments: assignmentsIn(node),
    kind: "simple",
    substitutions: substitutionsIn(node),
    text: node.text,
    words: node.namedChildren.filter(isArgument).map((child) => wordOf(wordNode(child))),
  });

const assignmentsOnly = (node: Node): Script =>
  only({
    assignments: assignmentsIn(node),
    kind: "simple",
    substitutions: substitutionsIn(node),
    text: node.text,
    words: [],
  });

const command = (node: Node): Script => {
  const unsafe = node.namedChildren.find(isUnsafeRedirect);
  return unsafe === undefined ? simple(node) : unreadable(node, unsafe.type);
};

const redirected = (node: Node): Script => {
  const [body, ...redirects] = node.namedChildren;
  const unsafe = redirects.find(isUnsafeRedirect);
  if (unsafe !== undefined) return unreadable(node, unsafe.type);
  return body === undefined ? unreadable(node) : statement(body);
};

const group = (node: Node, isolated: boolean): Script =>
  only({ body: sequence(node), isolated, kind: "group", text: node.text });

const STATEMENTS: Readonly<Record<string, (node: Node) => Script>> = {
  command,
  comment: () => [],
  compound_statement: (node) => group(node, false),
  list: sequence,
  pipeline: sequence,
  redirected_statement: redirected,
  subshell: (node) => group(node, true),
  variable_assignment: assignmentsOnly,
  variable_assignments: assignmentsOnly,
};

function statement(node: Node): Script {
  const handler = STATEMENTS[node.type];
  return handler === undefined ? unreadable(node) : handler(node);
}

const pushStatement = (state: Sequence, node: Node): Sequence => {
  const [first, ...rest] = statement(node);
  if (first === undefined) return { link: "seq", steps: state.steps };
  const link = state.steps.length === 0 ? "start" : state.link;
  return { link: "seq", steps: [...state.steps, { item: first.item, link }, ...rest] };
};

const advance = (state: Sequence, node: Node): Sequence => {
  const link = LINKS[node.type];
  if (link !== undefined) return { link, steps: state.steps };
  return node.isNamed ? pushStatement(state, node) : state;
};

function sequence(node: Node): Script {
  return node.children.reduce<Sequence>(advance, { link: "start", steps: [] }).steps;
}

const parseWith =
  (parser: Parser): shellSyntaxTypes.Parse =>
  (source) => {
    const root = parser.parse(source)?.rootNode;
    if (root === undefined) return only({ kind: "unreadable", syntax: "parse", text: source });
    return root.hasError ? unreadable(root, "a syntax error") : sequence(root);
  };

const makeParser = (grammar: Uint8Array): Effect.Effect<shellSyntaxTypes.Parse> =>
  Effect.gen(function* () {
    yield* Effect.promise(() => Parser.init());
    const language = yield* Effect.promise(() => Language.load(grammar));
    const parser = new Parser();
    parser.setLanguage(language);
    return parseWith(parser);
  });

const shellSyntax = { makeParser };

export default shellSyntax;
