#!/usr/bin/env bash
set -euo pipefail

script_path="${BASH_SOURCE[0]}"
while [[ -L "$script_path" ]]; do
	script_dir="$(cd -P "$(dirname "$script_path")" && pwd)"
	link_target="$(readlink "$script_path")"
	if [[ "$link_target" == /* ]]; then
		script_path="$link_target"
	else
		script_path="$script_dir/$link_target"
	fi
done
script_dir="$(cd -P "$(dirname "$script_path")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

find_stable_msa() {
	local path_entry candidate candidate_dir
	local -a path_entries
	IFS=: read -r -a path_entries <<< "${PATH:-}"
	for path_entry in "${path_entries[@]}"; do
		[[ -n "$path_entry" ]] || path_entry=.
		candidate="$path_entry/msa"
		[[ -x "$candidate" && ! -d "$candidate" ]] || continue
		[[ "$candidate" -ef "$script_path" ]] && continue
		candidate_dir="$(cd -P "$(dirname "$candidate")" && pwd)" || continue
		printf '%s/%s\n' "$candidate_dir" "$(basename "$candidate")"
		return 0
	done
	return 1
}

use_stable=false
args=()
for arg in "$@"; do
	if [[ "$arg" == "--stable" ]]; then
		use_stable=true
	else
		args+=("$arg")
	fi
done

if [[ "${args[0]:-}" == "update" ]]; then
	use_stable=true
fi

if [[ "$use_stable" == true ]]; then
	if ! stable_msa="$(find_stable_msa)"; then
		echo "error: could not find a stable msa executable after the auto-msa wrapper on PATH" >&2
		exit 1
	fi
	exec "$stable_msa" ${args[@]+"${args[@]}"}
fi

dev_msa="$repo_dir/apps/coding-agent/dist/bundle/cli.js"
if [[ ! -x "$dev_msa" ]]; then
	echo "error: development msa build not found; run \`npm run build\` in $repo_dir" >&2
	exit 1
fi

export MSA_EXPERIMENTAL="${MSA_EXPERIMENTAL:-1}"
exec "$dev_msa" ${args[@]+"${args[@]}"}
