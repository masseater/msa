/**
 * Worker entry for the codemode sandbox in bundled builds. The Node bundle and the Bun binary
 * build this file as a separate entrypoint because msa-codemode's own worker file is not on disk
 * there; `getCodemodeWorkerSpecifier()` in config.ts resolves it.
 */
// oxlint-disable-next-line import/no-unassigned-import -- worker の実体を副作用で登録する
import "@msa/codemode/worker";
