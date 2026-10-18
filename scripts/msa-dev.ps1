$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$noEnv = $false
$forwardArgs = New-Object System.Collections.Generic.List[string]

foreach ($arg in $args) {
	if ($arg -eq "--no-env") {
		$noEnv = $true
	} else {
		$forwardArgs.Add($arg)
	}
}

if ($noEnv) {
	$envVarsToUnset = @(
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_OAUTH_TOKEN",
		"OPENAI_API_KEY",
		"OPENROUTER_API_KEY",
		"OPENCODE_API_KEY",
		"GH_TOKEN",
		"GITHUB_TOKEN",
		"HF_TOKEN",
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_SESSION_TOKEN",
		"AWS_REGION",
		"AWS_DEFAULT_REGION",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
		"AWS_CONTAINER_CREDENTIALS_FULL_URI",
		"AWS_WEB_IDENTITY_TOKEN_FILE"
	)

	foreach ($name in $envVarsToUnset) {
		Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
	}

	Write-Host "Running without API keys..."
}

# --import takes a module specifier, so pass the resolver as a file URL (Windows paths are not specifiers).
$repoRoot = Split-Path -Parent $scriptDir
$resolverUrl = ([System.Uri](Join-Path $repoRoot "apps/coding-agent/src/experimental/source-resolver.ts")).AbsoluteUri
$cliPath = Join-Path $repoRoot "apps/coding-agent/src/cli.ts"
& node --import $resolverUrl $cliPath @forwardArgs
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
	exit $exitCode
}
