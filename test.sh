#!/usr/bin/env bash
set -euo pipefail

# Isolate user resources, credentials, temporary files, and tool configuration.
temp_parent="${TMPDIR:-/tmp}"
temp_parent="${temp_parent%/}"
test_root="$(mktemp -d "$temp_parent/msa-test.XXXXXX")"
git_askpass="$(type -P false)"
readonly temp_parent test_root git_askpass

mkdir -p "$test_root/home/.config" "$test_root/tmp" "$test_root/cache/npm"
# Mark the generated root so cleanup can verify ownership before deleting it.
touch "$test_root/.msa-test-owned" "$test_root/npm-userconfig" "$test_root/npm-globalconfig"

# Rootless podman stores files owned by subordinate IDs under the isolated home, which only podman can remove.
remove_podman_storage() {
	[[ -d "$test_root/home/.local/share/containers" ]] || return 0
	env -i "PATH=$PATH" "HOME=$test_root/home" "TMPDIR=$test_root/tmp" "XDG_CONFIG_HOME=$test_root/home/.config" \
		podman system reset --force >/dev/null 2>&1 || true
}

# Only remove the marked directory created above, never an unverified path.
cleanup() {
	local status=$?
	trap - EXIT

	case "$test_root" in
		"$temp_parent"/msa-test.*)
			if [[ -d "$test_root" && ! -L "$test_root" && -f "$test_root/.msa-test-owned" ]]; then
				remove_podman_storage
				rm -rf -- "$test_root"
			else
				printf "Refusing to remove unverified test directory: %s\n" "$test_root" >&2
				[[ $status -ne 0 ]] || status=1
			fi
			;;
		*)
			printf "Refusing to remove unexpected test directory: %s\n" "$test_root" >&2
			[[ $status -ne 0 ]] || status=1
			;;
	esac

	exit "$status"
}
trap cleanup EXIT

# Start from an empty environment and allow only required platform and test settings.
test_env=(
	"PATH=$PATH"
	"PWD=$PWD"
	"HOME=$test_root/home"
	"USERPROFILE=$test_root/home"
	"TMPDIR=$test_root/tmp"
	"TMP=$test_root/tmp"
	"TEMP=$test_root/tmp"
	"XDG_CONFIG_HOME=$test_root/home/.config"
	"XDG_CACHE_HOME=$test_root/cache"
	"LANG=C"
	"LC_ALL=C"
	"TZ=UTC"
	"GIT_CONFIG_NOSYSTEM=1"
	"GIT_CONFIG_GLOBAL=/dev/null"
	"GIT_TERMINAL_PROMPT=0"
	"GIT_ASKPASS=$git_askpass"
	"GIT_EDITOR=true"
	"GIT_SEQUENCE_EDITOR=true"
	"NPM_CONFIG_USERCONFIG=$test_root/npm-userconfig"
	"NPM_CONFIG_GLOBALCONFIG=$test_root/npm-globalconfig"
	"NPM_CONFIG_CACHE=$test_root/cache/npm"
)

# Native Windows needs these inherited values to launch child processes.
for name in SystemRoot SYSTEMROOT WINDIR COMSPEC PATHEXT; do
	value="${!name-}"
	[[ -z "$value" ]] || test_env+=("$name=$value")
done

# Trust extra certificates of proxies that inspect HTTPS (corporate proxies, sandboxes).
# Network tests fail with self-signed certificate errors without it.
value="${NODE_EXTRA_CA_CERTS-}"
[[ -z "$value" ]] || test_env+=("NODE_EXTRA_CA_CERTS=$value")

# Pass the opt-in for the tests that call local LLM servers.
value="${MSA_LOCAL_LLM_TESTS-}"
[[ -z "$value" ]] || test_env+=("MSA_LOCAL_LLM_TESTS=$value")

# Pass the shard that CI splits the vitest files into.
value="${MSA_TEST_SHARD-}"
[[ -z "$value" ]] || test_env+=("MSA_TEST_SHARD=$value")

# Preserve CI detection only for runner behavior and test reporting.
for name in CI GITHUB_ACTIONS; do
	value="${!name-}"
	[[ -z "$value" ]] || test_env+=("$name=$value")
done

# The orchestrator graph tests also run against Neo4j when it is configured.
for name in NEO4J_URI NEO4J_USERNAME NEO4J_PASSWORD; do
	value="${!name-}"
	[[ -z "$value" ]] || test_env+=("$name=$value")
done

# Wrap the run so it holds in cloud containers, where CI's conditions differ:
# - Root bypasses file permissions through CAP_DAC_OVERRIDE and CAP_DAC_READ_SEARCH (capabilities(7)),
#   so tests that expect EACCES hold only once setpriv(1) drops both from the bounding and inheritable sets.
# - PID 1 never reaps orphans, so killed grandchildren stay zombies; tini registered as a subreaper
#   (tini -s, the mode tini's README gives for when it cannot be PID 1) reaps them.
wrapper=(env -i)
if [[ "$(id -u)" == 0 ]]; then
	wrapper=(setpriv --bounding-set=-dac_override,-dac_read_search --inh-caps=-dac_override,-dac_read_search "${wrapper[@]}")
fi
if [[ "${CLAUDE_CODE_REMOTE-}" == true ]]; then
	wrapper=(tini -s -- "${wrapper[@]}")
fi

echo "Running tests without API keys in isolated home: $test_root/home"
"${wrapper[@]}" "${test_env[@]}" vp run test
