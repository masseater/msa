import platform from "../platform/index.ts";
import executableFiles from "../platform/node/executable-files.ts";
import nodeOs from "../platform/node/os.ts";
import type bashTypesTypes from "../tools/bash-types.types.ts";
import mergeGuard from "./merge-guard.ts";

const { installExecutable } = executableFiles;
const { delimiter, join } = platform;

const BUILTIN_GROUPS = [
  "alias",
  "api",
  "attestation",
  "auth",
  "browse",
  "cache",
  "co",
  "codespace",
  "completion",
  "config",
  "cs",
  "extension",
  "gist",
  "gpg-key",
  "help",
  "issue",
  "label",
  "org",
  "pr",
  "preview",
  "project",
  "release",
  "repo",
  "ruleset",
  "run",
  "search",
  "secret",
  "ssh-key",
  "status",
  "variable",
  "workflow",
];

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

const SCRIPT = `#!/bin/sh
set -f
reason=${quoted(mergeGuard.REASON)}
merge_re='/pulls/[^/[:space:]]+/(merge|auto-merge)|mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest'
alias_re="$merge_re|(^|[^[:alnum:]_-])pr[[:space:]]+merge([^[:alnum:]_-]|$)"
refuse() { printf 'gh: %s\\n' "$reason" >&2; exit 1; }
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
real=
saved_ifs=$IFS
IFS=:
for dir in $PATH; do
  [ -n "$dir" ] || dir=.
  [ "$(CDPATH= cd -- "$dir" 2>/dev/null && pwd -P)" = "$here" ] && continue
  if [ -f "$dir/gh" ] && [ -x "$dir/gh" ]; then real=$dir/gh; break; fi
done
IFS=$saved_ifs
[ -n "$real" ] || { printf 'gh: command not found\\n' >&2; exit 127; }
stdin_file=
has() { printf '%s' "$1" | grep -Eq -- "$2"; }
file_has() {
  if [ "$1" = - ]; then
    if [ -z "$stdin_file" ]; then
      stdin_file=$(mktemp "\${TMPDIR:-/tmp}/msa-gh.XXXXXX") || exit 1
      cat > "$stdin_file"
    fi
    grep -Eq -- "$2" "$stdin_file"
  else
    [ -f "$1" ] && grep -Eq -- "$2" "$1"
  fi
}
check_api() {
  input=
  for arg in "$@"; do
    if [ -n "$input" ]; then input=; file_has "$arg" "$merge_re" && refuse; continue; fi
    has "$arg" "$merge_re" && refuse
    case $arg in
      --input) input=1 ;;
      --input=*) file_has "\${arg#--input=}" "$merge_re" && refuse ;;
      *=@*) file_has "\${arg#*=@}" "$merge_re" && refuse ;;
    esac
  done
  return 0
}
check_alias() {
  for arg in "$@"; do
    has "$arg" "$alias_re" && refuse
  done
  [ "$command" = import ] || return 0
  seen=
  for arg in "$@"; do
    if [ -n "$seen" ]; then
      case $arg in -?*) ;; *) file_has "$arg" "$alias_re" && refuse ;; esac
    fi
    [ "$arg" = import ] && seen=1
  done
  return 0
}
after_group() {
  while [ $# -gt 0 ]; do
    if [ "$1" = "$group" ]; then shift; "$after" "$@"; return; fi
    shift
  done
}
check_expanded() {
  has "$(printf '%s' "$expansion" | sed 's/[$][0-9][0-9]*//g') $*" "$alias_re" && refuse
  case $expansion in api|api[[:space:]]*) check_api "$@" ;; esac
  return 0
}
group=
command=
skip=
for arg in "$@"; do
  if [ -n "$skip" ]; then skip=; continue; fi
  case $arg in
    -R|--repo) skip=1 ;;
    -*) ;;
    *) if [ -z "$group" ]; then group=$arg; else command=$arg; break; fi ;;
  esac
done
case $group in
  pr) [ "$command" = merge ] && refuse ;;
  api) check_api "$@" ;;
  alias) check_alias "$@" ;;
  ${BUILTIN_GROUPS.filter((name) => !["pr", "api", "alias"].includes(name)).join("|")}|"") ;;
  *)
    expansion=$("$real" alias list 2>/dev/null | awk -v name="$group" 'index($0, name ":") == 1 { print substr($0, length(name) + 2); exit }' | sed "s/^[[:space:]]*//; s/^['\\"]//; s/['\\"][[:space:]]*$//")
    if [ -n "$expansion" ]; then after=check_expanded; after_group "$@"; fi
    ;;
esac
if [ -n "$stdin_file" ]; then
  exec 0< "$stdin_file"
  rm -f "$stdin_file"
fi
exec "$real" "$@"
`;

function directoryOf(agentDir: string): string {
  return join(agentDir, "bin", "worker");
}

function install(agentDir: string): string {
  const directory = directoryOf(agentDir);
  installExecutable(join(directory, "gh"), SCRIPT);
  return directory;
}

function spawnHook(agentDir: string): bashTypesTypes.BashSpawnHook | undefined {
  if (nodeOs.platform() === "win32") return undefined;
  return (context) => {
    const directory = install(agentDir);
    const path = context.env["PATH"];
    return {
      ...context,
      env: {
        ...context.env,
        PATH: path === undefined || path === "" ? directory : `${directory}${delimiter}${path}`,
      },
    };
  };
}

const ghGuard = { SCRIPT, install, spawnHook };

export default ghGuard;
