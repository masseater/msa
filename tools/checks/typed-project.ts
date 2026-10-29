import type { Node, SourceFile } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import type { Project } from "typescript/unstable/sync";

type Scope = { readonly files: (name: string) => boolean; readonly root: string };

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

const scanProject = <F>({ files, root }: Scope, scanFile: FileScan<F>): readonly F[] => {
  const api = new API({ cwd: root });
  const prefix = new URL(`file://${root}/`).pathname;
  try {
    const snapshot = api.updateSnapshot({ openProject: `${root}/tsconfig.json` } as never);
    const [project] = snapshot.getProjects();
    if (project === undefined) throw new Error("tsconfig.json の project を開けない");
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

const typedProject = { descendants, locate, scanProject };

export default typedProject;
