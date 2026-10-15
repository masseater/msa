<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## コマンド

- pnpm は直接呼ばない。install・add・remove は `vp install`・`vp add`・`vp remove`、script は `vp run <script>`、binary は `vp exec <bin>`。`vp` が持たないサブコマンドだけ `vp pm <subcommand>` を使う。
- `vp run verify` が唯一のゲート。pre-push フックも同じ verify を走らせる。
- テストは `bash test.sh`（verify の `test-all` が回す）。API キーを抜いた隔離環境で全 package をテストする。1 つだけ走らせるときは package のルートで `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/<file>.test.ts`（`packages/tui` は `node --test`）。
- `packages/ai/src/models.generated.ts` は直接編集せず、`vp run generate:models` で作り直す。clone 直後に typecheck が通らないときは `vp run hydrate:model-data` を回す。

## pi との関係

- このリポジトリは pi（https://github.com/earendil-works/pi）から fork したもので、pi とは完全に切り離されている。pi 側に変更があっても、都度ユーザーの判断で pick して取り込むだけにする。

## 環境変数

- 環境変数は環境ごとに変わる値だけにする。変わらない値はコードかフラグにする。

## ライブラリ

- ライブラリが型を提供する値は、その型のまま `Schema.decode*` に渡す。
- ライブラリが export する型・スキーマ・enum・定数を書き写さない。
- 外部 API のクライアントは手で包まず、Effect 公式のパッケージ、distilled.cloud、公開 OpenAPI から `@effect/openapi-generator` で生成、の順に選ぶ。

## PR とマージ

- PR のレビュー、PR ごとの CI・動作検証・デプロイはしない。動作は main にマージしてから確かめる。
- マージ前に base を取り込み、手元の `vp run verify` を通してから自分でマージする。マージしてよいかは聞かない。ルールセットのバイパスや `--admin` は使わない。

## 公開先

- デプロイ先や外部公開しているもの（サイト、API、npm パッケージなど）があれば、その URL を README に一覧で載せる。

## スキル

- 複数リポで使う自作スキルは masseater/skills に置き、skills CLI で入れる。
