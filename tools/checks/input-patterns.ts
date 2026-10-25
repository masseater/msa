import type inputPatternsTypes from "./input-patterns.types.ts";

type Coverage = inputPatternsTypes.Coverage;
type Matcher = inputPatternsTypes.Matcher;
type Rule = inputPatternsTypes.Rule;

const MATCHERS: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => Matcher]> = [
  [/^\*\*$/u, () => () => true],
  [/^\*$/u, () => (file) => !file.includes("/")],
  [
    /^\*\*\/([^*/]+)\/\*\*$/u,
    ([, name]) =>
      (file) =>
        `/${file}`.includes(`/${name}/`),
  ],
  [
    /^([^*]+)\/\*\*$/u,
    ([, dir]) =>
      (file) =>
        file.startsWith(`${dir}/`),
  ],
  [
    /^([^*]+)$/u,
    ([, path]) =>
      (file) =>
        file === path,
  ],
];

const matcherOf = (body: string): Matcher | undefined =>
  MATCHERS.flatMap(([pattern, make]) => {
    const match = pattern.exec(body);
    return match === null ? [] : [make(match)];
  })[0];

const ruleOf = (pattern: string): Rule | undefined => {
  const exclude = pattern.startsWith("!");
  const test = matcherOf(exclude ? pattern.slice(1) : pattern);
  return test === undefined ? undefined : { exclude, test };
};

const coverageOf = (patterns: ReadonlyArray<string>): Coverage => {
  const rules = patterns.map((pattern) => ({ pattern, rule: ruleOf(pattern) }));
  const unread = rules.filter((entry) => entry.rule === undefined).map((entry) => entry.pattern);
  if (unread.length > 0) return { problem: `cannot read the cache inputs ${unread.join(", ")}` };
  const read = rules.flatMap((entry) => (entry.rule === undefined ? [] : [entry.rule]));
  const included = read.filter((rule) => !rule.exclude);
  const excluded = read.filter((rule) => rule.exclude);
  return {
    covers: (file) =>
      included.some((rule) => rule.test(file)) && !excluded.some((rule) => rule.test(file)),
  };
};

const inputPatterns = { coverageOf };

export default inputPatterns;
