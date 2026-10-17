import { Console, Effect, Schema } from "effect";
import type {
  Node,
  SourceFile,
  StringLiteral,
  NoSubstitutionTemplateLiteral,
} from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";

import { Host, runScript } from "./host.ts";
import { Json } from "./json.ts";

type StringLiteralLike = StringLiteral | NoSubstitutionTemplateLiteral;

const isStringLiteralLike = (node: Node | undefined): node is StringLiteralLike =>
  node !== undefined && (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node));

const isRelativeJavaScriptSpecifier = (specifier: string): boolean =>
  /^\.\.?\//u.test(specifier) && /\.js(?:[?#].*)?$/u.test(specifier);

const specifierOf = (node: Node): StringLiteralLike | undefined => {
  if (isImportDeclaration(node) || isExportDeclaration(node)) {
    return isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier : undefined;
  }
  if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
    const [first] = node.arguments;
    return isStringLiteralLike(first) ? first : undefined;
  }
  if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
    return isStringLiteralLike(node.argument.literal) ? node.argument.literal : undefined;
  }
  return undefined;
};

const collectFailures = (sourceFile: SourceFile, displayPath: string): ReadonlyArray<string> => {
  const failures: Array<string> = [];
  const visit = (node: Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== undefined && isRelativeJavaScriptSpecifier(specifier.text)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        specifier.getStart(sourceFile),
      );
      failures.push(`${displayPath}:${line + 1}:${character + 1}: ${specifier.text}`);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return failures;
};

const program = Effect.gen(function* () {
  const host = yield* Host;
  const listed = yield* host.run({
    command: "git",
    args: ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.ts"],
  });
  const candidates = listed.stdout
    .split("\0")
    .filter((file) => file !== "" && !file.endsWith(".d.ts"));
  const files = yield* Effect.filter(candidates, (file) => host.exists(file));

  const configPath = host.resolve("tsconfig.check-ts-relative-imports.json");
  const config = yield* Schema.encodeEffect(Json)({
    compilerOptions: { noResolve: true, noLib: true, types: [] },
    files: files.map((file) => host.resolve(file)),
  });
  const api = new API({
    cwd: process.cwd(),
    fs: {
      fileExists: (fileName: string) => (host.resolve(fileName) === configPath ? true : undefined),
      readFile: (fileName: string) => (host.resolve(fileName) === configPath ? config : undefined),
    },
  });

  const failures = yield* Effect.sync(() => {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProject(configPath);
    return [...files].sort().flatMap((file) => {
      const sourceFile = project?.program.getSourceFile(host.resolve(file));
      return sourceFile === undefined ? [] : collectFailures(sourceFile, host.relative(".", file));
    });
  }).pipe(Effect.ensuring(Effect.sync(() => api.close())));

  if (failures.length > 0) {
    yield* Console.error("Relative .js imports are not allowed in non-declaration .ts files:");
    yield* Effect.forEach(failures, (failure) => Console.error(`  ${failure}`));
    process.exitCode = 1;
  }
});

runScript(program);
