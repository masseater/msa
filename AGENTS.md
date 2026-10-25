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

## 手段の選び方

強制・推奨・指示の手段は次の順で選ぶ。自作するときは、何を探して何が合わなかったかをコミットメッセージに残す。

1. ライブラリ公式の統合手段（lint ルール、skill、plugin、CLI、diagnostics など）
2. それを実現している既存のライブラリやツール
3. 方針を提言しているブログ・issue・discussion
4. 自作

検査を通すために設定を無効化・簡易化したり、閾値を下げたり、抑止ディレクティブを使ったりしない。数値の設定はツールの既定値を保ち、既定値で検査が機能しないときだけ公式の指針で設定する。

## 文書

手書きの文章はルートの AGENTS.md・README.md に限り、コードを読めば分かることは書かない。「なぜ」はコミットメッセージに書く。

## 公開範囲

- このリポジトリは公開されている。issue・PR 本文・コミットメッセージ・コード・docs・コメントに、次のものを書かない。
  - Claude Code のインスタンス名、サブスクリプションのアカウント名などのアカウント名
  - 組織名
  - 個人のメールアドレス
  - キーやトークンの値と、秘密情報の置き場所でのキーの名前
  - セッションログや会話の本文の引用
  - ローカルの絶対パス、ホームディレクトリ（`~/` など）の下のパス
  - このリポジトリ以外のリポジトリの名前・パス・中身
- 書きかけたら、書く前に一般的な言い方（「別のインスタンス」「個人のアカウント」「ローカルの設定ディレクトリ」など）に置き換える。公開した履歴は消せないため、投稿の前に確かめる。

## 作業の完了

- 作業の完了は、PR が main にマージされた時点である。CI が green でも、マージされていなければ完了ではない。
- マージの条件と orchestrator の worker の役目は「PR とマージ」の節に書く。

## このリポジトリの目的

- msa は一般的なコーディングエージェントではない。**masseater 個人が思う開発スタイルを実現するためのツール**である。
- 目的は、**masseater が自分の思想を意識せずに、勝手にその思想どおりの開発が進む**こと。使う人が方針を考えたり設定したりしなくても、そうなるように作る。
- **汎用性は要らない**。他の人や他の開発スタイルに合わせるための抽象化・設定項目・拡張点を持たない。
- **互換性は要らない**。古い設定・古いデータ・古い API を残すための層を作らない。変えるときは置き換える（必要な移行だけを書く）。
- **場合に応じて切り替える機能は要らない**。モードやフラグで「どちらでも選べる」形にせず、本人の思想に沿う 1 つに決める。
- 具体的な手法（開発の進め方、ハーネスが自動化する範囲、人に残す判断、品質の基準、道具の作り方）は、決まったものからこのファイルの該当する節に書く。書くのは目的とやり方だけで、理由と経緯はコミットログに書く。

## 組み込みの指示

- msa の開発スタイル（直し方・理由の置き場所・検証と後片付け・合流先の枝の取り込み・報告の書き方など）は、組み込みの指示が持つ。ユーザー環境の AGENTS.md に頼らない。全セッションに効くものは `apps/coding-agent/src/core/development-style.ts`（system prompt の `development_style` 節）に、役ごとのものは `apps/coding-agent/src/core/orchestrator/prompts.ts` の worker・reviewer の prompt や orchestrator のツールの `promptGuidelines` に、1 か所だけ書く。reviewer はその決まりを判定の基準に使う。
- 環境・個人・アカウントに依る決まり（シェル、リポジトリの置き場所、秘密情報の管理、使うサービスやアカウント）は組み込みの指示に入れない。
- prompt・指針・ツール説明の文言をテストで固定しない。テストで固定するのはハーネスの挙動（判定・状態遷移・ツールが断ることなど）だけにする。どの preamble・指針が選ばれるかを確かめる時は、文字列を書き写さず、定義元が export した値と比べる。

## コマンド

- ユーザーと対話するセッションを始めたら、引数なしの `/loop` を起動する。
- pnpm は直接呼ばない。install・add・remove は `vp install`・`vp add`・`vp remove`、script は `vp run <script>`、binary は `vp exec <bin>`。`vp` が持たないサブコマンドだけ `vp pm <subcommand>` を使う。
- `vp run verify` が唯一のゲート。PR と main への push で CI の verify が走る。pre-push フックは gitleaks だけを走らせる。
- squash merge の本文は手で書き直さず、PR の検査を通ったコミットメッセージを使う。
- テストは `bash test.sh`（verify の `test-all` が回す）。API キーを抜いた隔離環境で全 package をテストする。1 つだけ走らせるときは package のルートで `vp test --run test/<file>.test.ts`（`libs/tui` は `node --test`）。
  - 手元の LLM サーバー（Ollama・LM Studio・llama.cpp）を呼ぶ `libs/ai/test/*-local.test.ts` は、`MSA_LOCAL_LLM_TESTS=1` を付けた時だけ流れる。
- パッケージは `apps/`（配布する CLI と eval）・`libs/`（共有するライブラリ）・`tools/`（リポジトリの道具）に置く。`packages/` は作らない（`tools/checks` のテストが落とす）。
- `libs/ai/src/models.generated.ts` は直接編集せず、`vp run generate:models` で作り直す。clone 直後に typecheck が通らないときは `vp run hydrate:model-data` を回す。

## pi との関係

- このリポジトリは pi（https://github.com/earendil-works/pi）の fork から始まったが、pi とは完全に分離した別プロジェクトで、pi は upstream ではない。pi の取り込みは、原則として機能単位で、必要と判断したときだけ行う。取り込むときは msa のコードとして実装し直し、pi のコードをそのまま取り込まない（merge・cherry-pick・コピーをしない）。

## 機能の置き場所

- msa の機能は本体（`apps/coding-agent/src/core` など）に実装する。拡張機能（extensions）は msa の外の機能を簡易に取り込むための仕組みで、msa 自身の機能をそこに置かない。
- 機能はコマンドラインやツールだけで終わらせず、人間が使う画面（TUI）も作る。状態をひと目で見られ、キー操作で覗く・指示する・止められるようにする。
- `apps/coding-agent/src` では、同じパッケージで定義したクラスを継承しない。責務ごとの部品をフィールドに持たせ、委譲して組む（`msa/no-local-class-extends`）。`tui.Container` や `Data.TaggedError` のような、別パッケージが継承して使う前提で出している基底は継承してよい。

## 環境変数

- 環境変数は環境ごとに変わる値だけにする。変わらない値はコードかフラグにする。
- 読み書きは `apps/coding-agent/src/core/platform/index.ts` の `readEnv`・`writeEnv`・`deleteEnv`・`envSnapshot` を通す。`process.env` と `node:process` の `env` は lint で禁じている。

## node の組み込み

- Effect に代わりのある組み込み（`lint.config.ts` の `effectReplaceableBuiltins`）は、`apps/coding-agent/src/core/platform/node/` と `libs/durable/src/env/node/` でだけ読む。`vite.config.ts` で `effecttsgo/node-builtin-import` を外す override もこの 2 つだけに置き、ほかの場所を足さない。`apps/coding-agent/src` では、ほかの組み込みも `core/platform/node/` を通す。
- import 文だけでなく、`require`・`createRequire(...)(...)`・`Module._load`・動的 `import()`・`export ... from` による再 export・`process.getBuiltinModule`・`process.binding` も lint（`msa/no-builtin-require`・`msa/no-builtin-module-lookup`）で禁じている。`node:module` から来た `createRequire`・`Module` と CJS の `module`（`module.constructor`）、`process`・`globalThis` は変数・別名・分割代入・再代入を追い、読み込む先やキーを決められない書き方（文字列でない引数、計算したキー、値を外へ渡すなど）も弾く。
- 同期の fs（`existsSync`・`readFileSync` などの `*Sync`）は `msa/no-sync-fs` で禁じている。Effect の `FileSystem` か platform の非同期 API を使う。起動前など同期でしか書けない処理は、`core/platform/node/` の名前付き関数に閉じる。
- 規則は `tools/oxlint/` にあり、すり抜けの書き方と一覧が effecttsgo・node の fs とずれていないかを `tools/checks/builtin-lint.test.ts` が確かめる。lint の抑止コメントは書けない（`no-comments` で弾く）。読み込む先が実行時に決まるファイルは、`import()` に `pathToFileURL(...)` の URL を直接渡すか、ネイティブアドオンなら `process.dlopen` で読む（`libs/tui/src/native-addon.ts`）。どちらも組み込みには届かない。

## テスト

- テストは `Effect.gen` と `@msa/testing` で書く。`it` には `runTest(effect)` を渡し、`async` 関数と `await` は使わない。
- fs・path・JSON・一時ディレクトリ・時刻・乱数は `@msa/testing` の関数を使い、`node:fs`・`node:path`・`JSON.parse`・`Date.now`・`Math.random`・`console` を直接触らない。
- 環境変数は `withEnv` で与える（`effect.pipe(withEnv({ MSA_X: "1" }))`）。スコープを抜けると元に戻る。子プロセスへは `envSnapshot()` を `env` に渡す。
- 書き方の実例は `apps/coding-agent/test/keybindings-migration.test.ts` と `apps/coding-agent/test/process-env.test.ts`。

## ライブラリ

- ライブラリが型を提供する値は、その型のまま `Schema.decode*` に渡す。
- ライブラリが export する型・スキーマ・enum・定数を書き写さない。
- 外部 API のクライアントは手で包まず、Effect 公式のパッケージ、distilled.cloud、公開 OpenAPI から `@effect/openapi-generator` で生成、の順に選ぶ。

## エージェント向けの機能

- エージェント（モデル）が使う機能は、内部の組み込みツールとして実装する。CLI のサブコマンドを足して、シェルから引数で叩く形にしない（モデルに教える面が増え、失敗の扱いもその場で書くことになる）。
- 人間が端末から同じことをしたい場合も、ツールを CLI から呼べるようにするのではなく、TUI の画面か、必要なときだけ薄い入口を用意する。
- 機械的に決まること（重複の照合、差分の取り込み、状態の確認、本文への定型の追記、冪等性の確保、入力の検証など）はツールの実装が行い、モデルにやらせない。モデルに「確認してから呼べ」と頼る手順は、ツールが先に確かめて結果を返す形にする。モデルは判断が要るところだけを担う。

## 一括の書き換え

- 同じ形の書き換えを多くのファイルに当てるときは、使い捨てのスクリプト（python・node の一時スクリプト、sed、perl の一行置換）を書かない。msa の組み込みの codemod ツールを使う（issue #95 で作る）。
- 組み込みのレシピで足りないときは、レシピを足す（`tools/codemods/`）。その場のスクリプトは、レシピを足すより明らかに小さいと分かる場合だけにして、何を探して何が足りなかったかをコミットメッセージに残す。

## テスト

- モックを使わない。実モジュールを呼び出す（DB も本物を一時ディレクトリに作って使う）。古典学派（Detroit school）のテストにする。外部プロセスやネットワークを避けられない場合だけ例外にし、理由はコミットログに書く。
- 無駄に DRY にしない。準備を共通ヘルパーへ注ぎ込むと、そのヘルパーが肥大化して何が必要なのか分からなくなる。準備は各テストファイル・各 `describe` の中で明示的に書く。共通化してよいのは、本当に同じ意図で何度も使う小さいものだけ。
- テストは「準備→実行→検証」が読んで分かる形にする。抽象化より明示を優先する。
- 分割などでテストを複製しない。同じ内容のテストが 2 か所にあれば 1 つ残して削除する。準備（setup）の複製はかまわない。

## PR とマージ

- PR を判定するのは orchestrator の reviewer だけにする。ほかに PR のレビュー、PR ごとの動作検証・デプロイはしない。動作は main にマージしてから確かめる。
- reviewer の指摘のうちタスクのゴールに入るものは、深刻度に関係なく同じ PR で直し、再レビューで合格してからマージする。マージしてから別 issue に分けない。別 issue にしてよいのは、タスクのゴールの外の問題だけ。
- マージ前に base を取り込み、PR の `verify` と `up-to-date` が通ってからマージする。対話セッションでは自分でマージする。マージしてよいかは聞かない。ルールセットのバイパスや `--admin` は使わない。
- orchestrator の work task は自分の PR を持ち、ハーネスがタスクの枝から PR を見つける。PR が無い・push されていない・CI が落ちた・BEHIND か衝突のときは worker に差し戻し、CI が走っているあいだは worker を起こさずに待ち、reviewer の合格後にハーネスが合格した head で squash merge し、マージを確かめてから task を completed にして worktree と枝を消す。
- orchestrator の worker は次のとおりにする。
  - PR を自分でマージしない。`gh pr merge` と auto-merge は worker と reviewer の shell が早めに拒み、すり抜けてもハーネスが見つけて task を stopped にする。
  - 役目は、PR を出して push し、ターンを終えるところまで。CI の終わりはハーネスが待ち、落ちたら worker に戻す。
  - reviewer から差し戻された指摘は、同じ枝に足して同じ PR で直す。
  - main の `verify` が赤いときは自分で直さず、直す担当のタスクが main に入るのを待ち、rebase してから進める。

## 公開先

- デプロイ先や外部公開しているもの（サイト、API、npm パッケージなど）があれば、その URL を README に一覧で載せる。

## スキル

- 複数リポで使う自作スキルは masseater/skills に置き、skills CLI で入れる。
