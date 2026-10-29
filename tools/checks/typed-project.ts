import type { Node, SourceFile } from "typescript/unstable/ast";
import { API, SymbolFlags } from "typescript/unstable/sync";
import type { Checker, Project, Symbol as TsSymbol, Type } from "typescript/unstable/sync";

type Scope = {
  readonly files: (name: string) => boolean;
  readonly project?: string | undefined;
  readonly root: string;
};

type FileScan<F> = (project: Project, file: SourceFile, relative: string) => readonly F[];

const children = (node: Node): readonly Node[] => {
  const found: Node[] = [];
  node.forEachChild((child) => {
    found.push(child);
    return undefined;
  });
  return found;
};

const descendants = (node: Node): readonly Node[] => [node, ...children(node).flatMap(descendants)];

const locate = (file: SourceFile, node: Node): { readonly line: number; readonly text: string } => {
  const start = node.getStart(file);
  return {
    line: file.text.slice(0, start).split("\n").length,
    text: file.text.slice(start, node.end).slice(0, 100),
  };
};

const typeOf = (checker: Checker, node: Node): Type | undefined => {
  try {
    return checker.getTypeAtLocation(node);
  } catch {
    return undefined;
  }
};

const typesOf = (checker: Checker, nodes: readonly Node[]): readonly (Type | undefined)[] => {
  if (nodes.length === 0) return [];
  try {
    return checker.getTypeAtLocation(nodes);
  } catch {
    return nodes.map((node) => typeOf(checker, node));
  }
};

const scanProject = <F>(
  { files, project: config = "tsconfig.json", root }: Scope,
  scanFile: FileScan<F>,
): readonly F[] => {
  const api = new API({ cwd: root });
  const prefix = new URL(`file://${root}/`).pathname;
  try {
    const snapshot = api.updateSnapshot({ openProject: `${root}/${config}` } as never);
    const [project] = snapshot.getProjects();
    if (project === undefined) throw new Error(`${config} の project を開けない`);
    return project.program
      .getSourceFileNames()
      .filter(files)
      .flatMap((name) =>
        scanFile(project, project.program.getSourceFile(name)!, name.replace(prefix, "")),
      );
  } finally {
    api.close();
  }
};

const declaredIn = (symbol: TsSymbol, file: RegExp): boolean =>
  symbol.declarations.some(({ path }) => file.test(path));

const isDefaultLib = (symbol: TsSymbol): boolean => declaredIn(symbol, /\/lib\.[\w.]+\.d\.ts$/iu);

const resolveAlias = (checker: Checker, symbol: TsSymbol): TsSymbol =>
  (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);

const typedProject = {
  declaredIn,
  descendants,
  isDefaultLib,
  locate,
  resolveAlias,
  scanProject,
  typesOf,
};

export default typedProject;
