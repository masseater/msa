# @msa/testing

テストだけが使う Effect の補助。本番コードからは import しない。

## 何をまとめているか

テストが直接触ると lint に掛かるもの（`node:fs`・`node:path`・`JSON.parse`・`Date.now`・`Math.random`・`console`）を、Effect のサービス越しの薄い関数に置き換える。すべて `Effect<A, never>` を返すので、`Effect.gen` の中から `yield*` で呼べる。

- `readTextFile`・`writeTextFile`・`appendTextFile`・`pathExists`・`readDirectory`・`makeDirectory`・`copyFile`・`changeMode`・`fileSize`・`removePath`
- `makeTempDir`・`makeTempFile`・`removeDir`・`removeDirRetrying`・`removeDirs`・`tempPath`・`tempRoot`
- `readJsonFile`・`writeJsonFile`・`toJsonText`・`fromJsonText`（JSON は Schema で読み書きする）
- `joinPath`・`dirnameOf`・`basenameOf`・`resolvePath`・`relativePath`・`isAbsolutePath`・`pathDelimiter`
- `currentTimeMillis`・`nowIso`・`randomSuffix`・`awaited`・`failure`・`pollUntil`・`abortController`
- `timersArmedBy`（渡した Effect から辿れる非同期リソースが張ったタイマーだけを数える）
- `runTest`（`it` から Effect を走らせる）・`testRuntime`・`provideNode`

## 使い方

```ts
import {
  joinPath,
  makeTempDir,
  readTextFile,
  removeDir,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const created: string[] = [];
afterEach(() => runTest(Effect.forEach(created.splice(0), removeDir, { discard: true })));

describe("example", () => {
  it("writes a file", () =>
    runTest(
      Effect.gen(function* () {
        const directory = yield* makeTempDir("example-");
        created.push(directory);
        yield* writeTextFile(joinPath(directory, "a.txt"), "hello");
        expect(yield* readTextFile(joinPath(directory, "a.txt"))).toBe("hello");
      }),
    ));
});
```

## 決まり

- テスト本体は `Effect.gen` で書く。`async` 関数と `await` は使わない（`Effect.promise` で Promise を包む）。
- 一時ディレクトリは `makeTempDir` で作り、`afterEach` で `removeDir`／`removeDirs` する。Windows で消えない時は `removeDirRetrying`。
- 空の `Effect.gen` は `require-yield` に掛かるので、`yield* Effect.void` を置く。
