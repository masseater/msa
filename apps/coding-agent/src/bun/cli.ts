#!/usr/bin/env node
// oxlint-disable-next-line import/no-unassigned-import -- sandbox 環境のセットアップを副作用で読み込む
import "./sandbox-env-setup.ts";
// oxlint-disable-next-line import/no-unassigned-import -- runtime のセットアップを副作用で読み込む
import "./runtime-setup.ts";
// oxlint-disable-next-line import/no-unassigned-import -- CLI 本体（副作用で実行される）
import "../cli.ts";
