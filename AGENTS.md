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
- `vp run verify` が唯一のゲート。PR と main への push で CI の verify が走る。pre-push フックは gitleaks だけを走らせる。
- テストは `bash test.sh`（verify の `test-all` が回す）。API キーを抜いた隔離環境で全 package をテストする。1 つだけ走らせるときは package のルートで `vp test --run test/<file>.test.ts`（`libs/tui` は `node --test`）。
- パッケージは `apps/`（配布する CLI と eval）・`libs/`（共有するライブラリ）・`tools/`（リポジトリの道具）に置く。`packages/` は作らない（verify の `workspace-layout` が落とす）。
- `libs/ai/src/models.generated.ts` は直接編集せず、`vp run generate:models` で作り直す。clone 直後に typecheck が通らないときは `vp run hydrate:model-data` を回す。

## pi との関係

- このリポジトリは pi（https://github.com/earendil-works/pi）の fork から始まったが、pi とは完全に分離した別プロジェクトで、pi は upstream ではない。pi の取り込みは、原則として機能単位で、必要と判断したときだけ行う。取り込むときは msa のコードとして実装し直し、pi のコードをそのまま取り込まない（merge・cherry-pick・コピーをしない）。

## 機能の置き場所

- msa の機能は本体（`apps/coding-agent/src/core` など）に実装する。拡張機能（extensions）は msa の外の機能を簡易に取り込むための仕組みで、msa 自身の機能をそこに置かない。
- 機能はコマンドラインやツールだけで終わらせず、人間が使う画面（TUI）も作る。状態をひと目で見られ、キー操作で覗く・指示する・止められるようにする。

## 環境変数

- 環境変数は環境ごとに変わる値だけにする。変わらない値はコードかフラグにする。

## ライブラリ

- ライブラリが型を提供する値は、その型のまま `Schema.decode*` に渡す。
- ライブラリが export する型・スキーマ・enum・定数を書き写さない。
- 外部 API のクライアントは手で包まず、Effect 公式のパッケージ、distilled.cloud、公開 OpenAPI から `@effect/openapi-generator` で生成、の順に選ぶ。

## テスト

- モックを使わない。実モジュールを呼び出す（DB も本物を一時ディレクトリに作って使う）。古典学派（Detroit school）のテストにする。外部プロセスやネットワークを避けられない場合だけ例外にし、理由はコミットログに書く。
- 無駄に DRY にしない。準備を共通ヘルパーへ注ぎ込むと、そのヘルパーが肥大化して何が必要なのか分からなくなる。準備は各テストファイル・各 `describe` の中で明示的に書く。共通化してよいのは、本当に同じ意図で何度も使う小さいものだけ。
- テストは「準備→実行→検証」が読んで分かる形にする。抽象化より明示を優先する。
- 分割などでテストを複製しない。同じ内容のテストが 2 か所にあれば 1 つ残して削除する。準備（setup）の複製はかまわない。

## PR とマージ

- PR のレビュー、PR ごとの動作検証・デプロイはしない。動作は main にマージしてから確かめる。
- マージ前に base を取り込み、PR の `verify` と `up-to-date` が通ってから自分でマージする。マージしてよいかは聞かない。ルールセットのバイパスや `--admin` は使わない。

## 公開先

- デプロイ先や外部公開しているもの（サイト、API、npm パッケージなど）があれば、その URL を README に一覧で載せる。

## スキル

- 複数リポで使う自作スキルは masseater/skills に置き、skills CLI で入れる。
