import { expect, it } from "vite-plus/test";

import classSealTransform from "../../../tools/class-seal/transform.ts";

const worker = {
  filename: "src/extensions/codemode/worker.ts",
  module: "src/extensions/codemode/worker",
  runtime: "../../core/platform/node/class-seal.ts",
  shared: "../../core/platform/node/class-seal-tui.ts",
};

const standalone = (code: string) => () => classSealTransform.sealModule(code, worker);

it("leaves the codemode worker entry untransformed while it only imports packages", () => {
  expect(
    classSealTransform.sealModule(
      'import workerMain from "@msa/codemode/worker-main";\nworkerMain.startCodemodeWorker();\n',
      worker,
    ),
  ).toBeUndefined();
});

it("stops the build when the codemode worker entry defines a class", () => {
  expect(standalone("export default class Probe {}\n")).toThrow("class を書かない");
  expect(standalone("export const probe = class {};\n")).toThrow("class を書かない");
});

it("stops the build when the codemode worker entry imports a module of src", () => {
  expect(standalone('import "../../core/platform/node/class-seal-tui.ts";\n')).toThrow(
    "src の module を import しない",
  );
  expect(standalone('export * from "./tool.ts";\n')).toThrow("src の module を import しない");
  expect(standalone('void import("./tool.ts");\n')).toThrow("src の module を import しない");
  expect(standalone("const name = './tool.ts';\nvoid import(name);\n")).toThrow(
    "src の module を import しない",
  );
});

const other = {
  ...worker,
  filename: "src/extensions/codemode/tool.ts",
  module: "src/extensions/codemode/tool",
};

it("transforms every other module of src", () => {
  const sealed = classSealTransform.sealModule("export const value = 1;\n", other);
  expect(sealed?.code.startsWith(`import ${classSealTransform.RUNTIME} from`)).toBe(true);
  expect(sealed?.code).not.toContain(classSealTransform.SHARED);
});

it("hands the startup list of tui bases to every check in a module that imports tui", () => {
  const sealed = classSealTransform.sealModule(
    'import tui from "@msa/tui";\nexport class C extends tui.Container {}\n',
    other,
  );
  expect(sealed?.code).toContain(
    `import ${classSealTransform.SHARED} from "../../core/platform/node/class-seal-tui.ts";`,
  );
  expect(sealed?.code).toContain(`.reference(tui.Container, [tui], ${classSealTransform.SHARED})`);
});

it("leaves the tui list out of a module that imports only the types of tui", () => {
  const sealed = classSealTransform.sealModule(
    'import type tui from "@msa/tui";\nexport type T = typeof tui;\n',
    other,
  );
  expect(sealed?.code).not.toContain(classSealTransform.SHARED);
});
