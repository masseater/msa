# toolchain の fence

1 つの関心に 1 つの持ち主。このファイルが「どの設定がどのパスを支配するか」を決める。これが無いと「house の
ツールチェーンを採る」は vendored engine の書き換えを意味してしまう。

## 何を解決するか

msa は pi の engine（`src` 174,587 LOC、`test` 198,162 LOC）を vendored で持ち、手を入れられるようにしている。
`masseater/typescript-template` の規約は、その規約の下で新しく書くコードのために設計されている。vendored コードに
そのまま当てると、整形の変更ではなく書き換えになる。2026-10-15、`4a5d3729` での実測:

| house のルール                                                                                | vendored engine に当てた時のコスト  |
| --------------------------------------------------------------------------------------------- | ----------------------------------- |
| `exactOptionalPropertyTypes`                                                                  | 1,081 errors                        |
| `noUncheckedIndexedAccess`                                                                    | 1,713 errors                        |
| `noPropertyAccessFromIndexSignature`                                                          | 2,217 errors                        |
| `noImplicitOverride` / `noImplicitReturns` / `noUnusedLocals` / `allowUnreachableCode: false` | 11 / 20 / 22 / 4 errors             |
| house の oxlint categories（11 package 中 4 package で測定）                                  | 55,665 errors / 436 rules           |
| `fallow dead-code --no-production`                                                            | 654 findings                        |
| `no-comments`（2 = error）                                                                    | コメント 25,595 行 / 1,126 ファイル |
| 再整形（tabs・width 3 → oxfmt の既定）                                                        | vendored ファイル全件               |

再整形は fork の目的にとってもっとも悪い選択でもある。msa が手を入れるファイルほど、以降の upstream 変更が必ず
衝突するようになる。だから engine は自前の整形を保ち、差は ratchet として記録し、house のルールは msa が新しく
書くコードに full で適用する。

## fence

| パス                                                                                            | formatter / linter                                                                                                                                    | TypeScript                                                          | plugin・rule                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/**` — vendored pi engine                                                              | `vp fmt` の対象外（整形は upstream のまま）。lint は `vite.config.engine.ts` で `correctness` + `suspicious` を測り、ratchet として持つ               | emit は pi の `tsconfig.build.json`、追加の strict フラグは ratchet | `no-comments` off、decision plugin off、`fallow` 除外      |
| `apps/**`, `libs/**`, `tools/**`, `infra/**`, `vite.config*.ts` — msa のコード                  | `vp check`（oxfmt の既定 + `sortImports` + `sortPackageJson`、oxlint は `correctness`・`suspicious`・`perf`・`pedantic`・`nursery` + `denyWarnings`） | `tsconfig.base.json` の house strict                                | `no-comments`。decision plugin は msa のコードが現れてから |
| `packages/ai/src/models.generated.ts`, `**/*.generated.ts`, `packages/ai/src/providers/data/**` | どちらも無視                                                                                                                                          | —                                                                   | —                                                          |
| `scripts/**`, `.pi/**`, `.github/**`, pi の root config・docs・scripts                          | `vp fmt`・`vp lint` の対象外（upstream の持ち物。slice 05 以降で個別に決める）                                                                        | —                                                                   | —                                                          |
| `specs/**`, `docs/**`, `*.md`                                                                   | oxfmt のみ（prose lint は入れていない）                                                                                                               | —                                                                   | `no-comments` と decision plugin は適用しない              |

`packages/**` のファイルは `vp fmt` で整形されない。きれいな木で最初に `vp fmt` を流した時、
`git diff --stat -- packages` が空であることが fence の証明になる。pi の流儀（tabs・width 3・120 桁・
`sortImports: false`）を `fmt.overrides` で与えても一致しない: 2026-10-15 の実測で `packages/**` + `scripts/**` の
143 ファイルが差分になり、CSS 風のテンプレート 1 件は oxfmt がパースできなかった。整形の持ち主を 2 つにするより、
engine は触らない。

`no-comments` と decision plugin は msa 側にも今は入れていない。`no-comments` は msa のコード（`tools/fence-counts.mjs`
と `vite.config*.ts`）に効いており、decision plugin は有料の decider をゲートに持ち込むので、msa のコードが現れて
から有効にする。

## ratchet

engine は自前の設定ですでにグリーン（`tsc --noEmit -p tsconfig.json` → 0 errors）。追加の strict フラグと engine の
lint は、先送りではなく数値として記録する:

```sh
pnpm run fence:counts   # 測定して tools/fence-counts.baseline.json を書き換える
pnpm run fence:check    # 測定して、どれかの数が増えていたら失敗する
```

`tools/fence-counts.baseline.json` はフラグごとの数と、測定時の commit を持つ。数はいつでも下げてよい（手を
入れたファイルは、関係するフラグの分だけ厳しくする）。上げてはならない。

`fence:check` は pre-push と CI が呼ぶ `vp run verify` の中に入っている。typecheck を 11 回走らせるが、engine の
oxlint は 0.3 秒なので、ゲート全体への影響は小さい。

2026-10-15、`4a5d3729` での実測:

| フラグ                                           | errors |
| ------------------------------------------------ | ------ |
| `exactOptionalPropertyTypes`                     | 1081   |
| `noUncheckedIndexedAccess`                       | 1713   |
| `noPropertyAccessFromIndexSignature`             | 2217   |
| `noUnusedLocals`                                 | 22     |
| `noImplicitReturns`                              | 20     |
| `noImplicitOverride`                             | 11     |
| `allowUnreachableCode: false`                    | 4      |
| `noFallthroughCasesInSwitch`                     | 0      |
| `noUnusedParameters`                             | 0      |
| `noUncheckedSideEffectImports`                   | 0      |
| `allowUnusedLabels`                              | 0      |
| engine の oxlint（`correctness` + `suspicious`） | 1635   |

engine の lint は「グリーンにする」対象ではなく ratchet にした。`correctness` + `suspicious` でも 1,635 errors あり、
内訳は `no-underscore-dangle` 895・`no-shadow` 217・`block-scoped-var` 148・`no-control-regex` 111 のように pi の
既存の書き方と衝突するルールが上位を占める。ルールを削ってグリーンにするよりは、pi のまま測って増加だけを止める。

msa 側の oxlint は `style` と `restriction` を切っている。`tools/**` と config に対する CLI 向けコードで
`no-magic-numbers`・`no-ternary`・`node/no-sync`・`sort-vars` などが 59 errors 出て、house のそれらのルールは app の
コードを前提にしている（house 自身も config 用の `overrides` を持つ）。`correctness`・`suspicious`・`perf`・
`pedantic`・`nursery` と `no-comments` は効かせたままなので、msa のコードが増えたらここで調整する。

## 依存バージョンの持ち方

- `packages/**` — upstream の literal な exact pin のまま。upstream が上げたバージョンがそのまま効く。catalog に
  移すと `package.json` の bump が無視され、upstream の更新が静かに効かなくなる。
- msa のコードと root の開発ツール — `catalog:`（house の `catalogMode: prefer` に従う）。
- pnpm の isolated `node_modules` では、宣言していない依存は解決できない。upstream は npm の hoist に依存して
  `@smithy/types` を宣言せずに import していたので、`packages/ai` の dependencies に足した（同じ理由の漏れが
  出たら、その都度その package に宣言を足す。`node-linker=hoisted` では隠さない）。

hoist 前提だった箇所の修正（upstream を取り込むたびに戻っていないか見る）:

| 場所                                    | 直した内容                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/ai/package.json`              | `@smithy/types` を dependencies に宣言（import しているのに未宣言だった）                                           |
| `scripts/build-coding-agent-bundle.mjs` | `https-proxy-agent` を repo root ではなく `packages/ai` から resolve するようにした                                 |
| `packages/coding-agent/package.json`    | `copy-binary-assets` の `photon_rs_bg.wasm` を root の hoist 前提パスから自パッケージの `node_modules` 相対に変えた |
| `packages/env/test/ssh.test.ts`         | login-shell 起動のテストを POSIX なアカウントシェルの時だけ実行するようにした（下記）                               |

`packages/env` の login-shell 起動（`exec "$SHELL" -lc 'exec "$0" "$@"'`）は POSIX 構文で、`.profile`/`.zprofile`
を読む前提。アカウントシェルが fish だと `$@` が解釈できず exit 127 になる（masseater のマシンが該当。実測:
`fish -lc 'exec "$0" "$@"' /bin/echo ok` → `fish: $@ is not supported` / exit 127）。product 側の対応（fish の
`$argv` を出す、`config.fish` を読む）は Phase B 以降。今はテストを POSIX シェルの時だけ実行し、理由をコメントに
残している。upstream に投げる候補。

## base config を 2 つ持つ理由

1 つの base では、engine の `dist/` emit と msa コードの house 流 `noEmit` を両立できない。

- `packages/**` — pi の `tsconfig.base.json`（`module`/`moduleResolution` Node16、`declaration`、`erasableSyntaxOnly`、
  `verbatimModuleSyntax`、`allowImportingTsExtensions`、`rewriteRelativeImportExtensions`）と、package ごとの
  `tsconfig.build.json`。
- msa のコード — house の `tsconfig.base.json`（strict フラグ一式）に `erasableSyntaxOnly` と `verbatimModuleSyntax`
  を足したもの（pi の node type-stripping な開発フローがこの 2 つに依存している）。msa の最初の package を作る時に
  追加する。今は `tools/fence-counts.mjs` が同じフラグを engine に対して測っている（上の ratchet）。

## ゲート

`vp run verify` が唯一の入口で、pre-push と CI がこれを呼ぶ。中身:

| タスク          | 内容                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| `vp check`      | oxfmt + oxlint（msa のパス）+ 型チェックではない                         |
| `engine-checks` | `check-ts-relative-imports`・`check-entry-graphs`・`check-browser-smoke` |
| `fence-check`   | strict フラグ 11 本と engine lint の ratchet                             |
| `test-all`      | `bash test.sh`（pi の隔離環境で全 package のテスト）                     |

base の `tsc --noEmit -p tsconfig.json` は独立したタスクにしていない。flag 無しの config が壊れていれば、
ratchet の 11 本すべてで diagnostics が増えて `fence-check` が落ちるため。

commit は `.vite-hooks/`（`vp config` が入れる dispatcher）で守る: pre-commit は `vp staged`（staged なファイルに
`vp check --fix`）、commit-msg は `vp exec commitlint --edit`、pre-push は `vp run verify`。husky は使わない。

## house テンプレートから意図的に採らないもの

`eslint.config.ts` と web app 向け plugin 一式（`@eslint-react`・`@tanstack/*`・`drizzle`・`shadcn`・`steiger`・
`html-eslint`・`react-hooks`・tailwind）— msa に web app は無い。vendored な英語 docs への `textlint` + `yomiyasu`
— その文章は upstream のもの。`release-please`・`renovate`・`autofix.yml`・`up-to-date.yml`・`zap.yml`・
Cloudflare deploy job — msa はまだ何も publish せず、deploy 先も無い。`packages/**` への `fallow` と decision
plugin — 上の表のとおり。`.intent` の skill ゲート — まだ intent package が無い。

いずれも「忘れた」のではなく「今は採らない」決定で、msa が `apps/**` に app を持つ時や publish を始める時に、
fence の msa 側にだけ戻ってくる。
