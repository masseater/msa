# slice 03 — pnpm + catalog

## 解禁される契約

package manager が 1 つになり、lockfile が 1 つになり、バージョンは 1 つの表で宣言される。内部依存は
`1.2.0` のような実バージョン固定ではなく workspace link になり、npm から別物が解決される事故が起きなくなる。

## 接ぎ目

- 新しい `pnpm-workspace.yaml`:
  - `packages`: `packages/*`・`apps/*`・`libs/*`・`infra/*`・`tools/*`・`.claude`、および
    `packages/coding-agent/examples/extensions/*` の 5 つ。
  - `catalogMode: prefer` と、外部依存（重複を除いて 51 個）を pi の固定バージョンで並べた `catalog:`、
    `overrides: { protobufjs: 7.6.6 }`、`saveExact: true`、`.npmrc` の `min-release-age` の意図を移した設定。
- 11 package と 5 example member の `"@earendil-works/pi-*": "1.2.0"` を `"workspace:*"` に。
  本当に外部の `@earendil-works/*`（`gondolin` など）は実バージョンのまま。
- `package-lock.json`・`.npmrc`・root の `workspaces` フィールド・
  `packages/coding-agent/examples/extensions/with-deps/package-lock.json` を削除。
- root `package.json`: `packageManager` を固定。`build` は `pnpm -r --workspace-concurrency=1 run build`
  （または今の順序を再現する明示的な `--filter`: chord → tui → telemetry → codemode → mcp → ai → durable →
  env → agent → coding-agent）。package 内スクリプトと `.mjs` ヘルパーの `npm --prefix ../x` は
  `pnpm --filter <name>` に。
- `.husky` はここでは残す（slice 04 が置き換える）。

## 主要な unknown（隠さず書く）

npm は推移的依存をすべて hoist するが pnpm はしない。宣言していない依存を import していると、install は通るのに
解決が失敗する。対応の梯子:

1. 既定の isolated `node_modules`（pnpm 本来の挙動。これを望んでいる）。
2. import している package に依存を宣言する（正しい修正。数個で済むなら必ずこれをやる）。
3. 依存木の都合で 2 が現実的でない時だけ `.npmrc` の `node-linker=hoisted`（強制した package 名をコメントに残す）。

## 他の 8 package を触る前の spike

まず `packages/chord`・`packages/telemetry`・`packages/tui` の 3 つだけを変換し、
`pnpm install --frozen-lockfile && pnpm -r run build && pnpm -r run test` が通ることを示す。それから残りを変換する。
「`vp` が web でない emit 型 monorepo を回せるか」はここで白黒つける。

## 実測で分かったこと（この slice の実装中に判明）

- pnpm の isolated link が、upstream の hoist 前提を 3 箇所で露呈させた（すべて「宣言漏れ」または「root からの
  解決」で、`node-linker=hoisted` には逃げずに直した）:
  - `packages/ai` が `@smithy/types` を import しているのに宣言していない → dependencies に追加
  - `scripts/build-coding-agent-bundle.mjs` が `https-proxy-agent` を repo root から resolve していた →
    `packages/ai` から resolve するように変更
  - `packages/coding-agent` の `copy-binary-assets` が `../../node_modules/...` を見ていた →
    自パッケージの `node_modules` 相対に変更
- `packages/env` のテストは Rust の daemon（`packages/env/daemon/target/debug/pi-env`）を必要とする。
  `pnpm --filter @earendil-works/pi-env run build:daemon`（要 cargo）を先に走らせないと 6 ファイルが落ちる。
  これは slice 05 の `verify` の依存に入れる。
- login-shell 起動のテストは、アカウントシェルが POSIX でないと落ちる。このマシンのシェルは fish で、
  `fish -lc 'exec "$0" "$@"'` が exit 127 になるため、テスト側で POSIX シェルの時だけ実行するようにした
  （詳細と実測は `docs/toolchain-fence.md`）。
- 移行後のゲート（すべて実測）:
  - `pnpm install` → 280 packages、`allowBuilds` は canvas と esbuild のみ true
  - `pnpm run check` → biome + 残したチェック + tsc --noEmit が緑
  - `pnpm run build` → 11 package をトポロジカル順で build し、`dist/bundle/cli.js --version` = 1.2.0
  - `bash test.sh` → 11 package すべて緑（テストファイル: coding-agent 294 + 6 skip、ai 145 + 27 skip、
    durable 60 + 2 skip、chord 44、env 5 + 1 skip、codemode 6、evals 6、mcp 5、agent 4、telemetry 2、tui は node:test）
  - `bash pi-test.sh --version` → 1.2.0
  - `pnpm ls -r --depth -1` と workspace の symlink が `link:packages/*` を指す
- upstream の `check` の一部（`check:ts-imports`）はどの package manager でも動くので残した。

## spike の結果（`vp` が emit 型 monorepo を回せるか）

slice 04 で確かめる。slice 03 の時点では `pnpm -r --workspace-concurrency=1 --if-present run build` が
全 11 package を正しい順序で build でき、`bundle/cli.js --version` が 1.2.0 を返すことを確認している。

## 人が実行・確認できるもの

```bash
cd ~/ghq/github.com/masseater/msa
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm -r run build
pnpm -r run test
node packages/coding-agent/dist/cli.js --help        # build が出す成果物のパスに合わせる
bash pi-test.sh --version
test -f pnpm-lock.yaml && test ! -f package-lock.json
pnpm ls -r --depth -1 | grep pi-ai                   # link:packages/ai に解決される
```

## グリーンを保つもの

644 個の test ファイル全部、`tsc --noEmit` = 0 errors、ソースからの CLI、
`node scripts/check-entry-graphs.mjs`、`packages/tui` の native ビルドが読めること。

## 任せる判断

- `build` を `pnpm -r` のトポロジカル順にするか明示 `--filter` 順にするか（今の順序を再現する楽な方）。
- `apps/`・`libs/`・`infra/`・`tools/` の glob を今足すか、最初の msa package を作る slice で足すか
  （既定: 今足して、トポロジーだけ先に存在させる）。

## この設計をひっくり返す feedback

- `node-linker=hoisted` でないと build できないなら、宣言漏れを隠す link mode を黙って受容せず、fence 文書に
  はっきり書く。
