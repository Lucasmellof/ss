[CmdletBinding()]
param(
	[Parameter(Position = 0)]
	[string]$FilesFolder,
	[switch]$SkipSigned
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\.."))

function Get-ProcessEnvironmentValue {
	param([Parameter(Mandatory)][string]$Name)

	return [Environment]::GetEnvironmentVariable($Name, "Process")
}

function Import-DotEnv {
	param([Parameter(Mandatory)][string]$Path)

	if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
		return
	}

	foreach ($line in Get-Content -LiteralPath $Path) {
		$valueLine = $line.Trim()
		if ([string]::IsNullOrWhiteSpace($valueLine) -or $valueLine.StartsWith("#")) {
			continue
		}
		if ($valueLine.StartsWith("export ")) {
			$valueLine = $valueLine.Substring(7).TrimStart()
		}

		$separator = $valueLine.IndexOf("=")
		if ($separator -le 0) {
			continue
		}

		$name = $valueLine.Substring(0, $separator).Trim()
		$value = $valueLine.Substring($separator + 1).Trim()
		if ($value.Length -ge 2) {
			$first = $value[0]
			$last = $value[$value.Length - 1]
			if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
				$value = $value.Substring(1, $value.Length - 2)
			}
		}

		# Existing CI/session variables take precedence over .env values.
		if ([string]::IsNullOrWhiteSpace((Get-ProcessEnvironmentValue $name))) {
			[Environment]::SetEnvironmentVariable($name, $value, "Process")
		}
	}
}

function Get-RequiredEnvironmentValue {
	param([Parameter(Mandatory)][string]$Name)

	$value = Get-ProcessEnvironmentValue $Name
	if ([string]::IsNullOrWhiteSpace($value)) {
		throw "Missing required environment variable '$Name'. Add it to .env or the current PowerShell session."
	}
	return $value
}

function Resolve-ConfiguredFile {
	param(
		[Parameter(Mandatory)][string]$EnvironmentName,
		[Parameter(Mandatory)][string]$Description
	)

	$configuredPath = Get-ProcessEnvironmentValue $EnvironmentName
	if ([string]::IsNullOrWhiteSpace($configuredPath)) {
		return $null
	}

	$resolvedPath = [IO.Path]::GetFullPath($configuredPath)
	if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
		throw "$Description configured in $EnvironmentName was not found: $resolvedPath"
	}
	return $resolvedPath
}

function Resolve-SignTool {
	$configuredPath = Resolve-ConfiguredFile "SIGNTOOL_PATH" "SignTool"
	if ($null -ne $configuredPath) {
		return $configuredPath
	}

	$command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
	if ($null -ne $command) {
		return $command.Path
	}

	$roots = @(
		(Get-ProcessEnvironmentValue "WindowsSdkDir"),
		$(if (-not [string]::IsNullOrWhiteSpace((Get-ProcessEnvironmentValue "ProgramFiles"))) { Join-Path (Get-ProcessEnvironmentValue "ProgramFiles") "Windows Kits\10\bin" }),
		$(if (-not [string]::IsNullOrWhiteSpace((Get-ProcessEnvironmentValue "ProgramFiles(x86)"))) { Join-Path (Get-ProcessEnvironmentValue "ProgramFiles(x86)") "Windows Kits\10\bin" })
	) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) }

	foreach ($root in $roots) {
		$matches = @(Get-ChildItem -LiteralPath $root -Filter "signtool.exe" -File -Recurse -ErrorAction SilentlyContinue)
		foreach ($match in ($matches | Sort-Object FullName -Descending)) {
			if ($match.FullName -match "\\x64\\signtool\.exe$") {
				return $match.FullName
			}
		}
	}

	throw "signtool.exe was not found. Install the Windows SDK or set SIGNTOOL_PATH in .env."
}

function Resolve-CodeSigningDlib {
	$configuredPath = Resolve-ConfiguredFile "AZURE_CODESIGNING_DLIB_PATH" "Azure Code Signing dlib"
	if ($null -ne $configuredPath) {
		return $configuredPath
	}

	$roots = @(
		$(if (-not [string]::IsNullOrWhiteSpace((Get-ProcessEnvironmentValue "ProgramFiles"))) { Get-ProcessEnvironmentValue "ProgramFiles" }),
		$(if (-not [string]::IsNullOrWhiteSpace((Get-ProcessEnvironmentValue "ProgramFiles(x86)"))) { Get-ProcessEnvironmentValue "ProgramFiles(x86)" }),
		$(if (-not [string]::IsNullOrWhiteSpace((Get-ProcessEnvironmentValue "LOCALAPPDATA"))) { Get-ProcessEnvironmentValue "LOCALAPPDATA" }),
		(Join-Path $repoRoot "tools")
	) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) }

	foreach ($root in $roots) {
		$matches = @(Get-ChildItem -LiteralPath $root -Filter "Azure.CodeSigning.Dlib.dll" -File -Recurse -ErrorAction SilentlyContinue)
		foreach ($match in ($matches | Where-Object { $_.FullName -match "\\x64\\" })) {
			return $match.FullName
		}
		foreach ($match in $matches) {
			return $match.FullName
		}
	}

	throw "Azure.CodeSigning.Dlib.dll was not found. Install Microsoft Artifact Signing Client Tools or set AZURE_CODESIGNING_DLIB_PATH in .env."
}

foreach ($envPath in @(
		(Join-Path $repoRoot ".env"),
		(Join-Path $repoRoot "desktop\.env")
	)) {
	Import-DotEnv $envPath
}

$tenantId = Get-RequiredEnvironmentValue "AZURE_TENANT_ID"
$clientId = Get-RequiredEnvironmentValue "AZURE_CLIENT_ID"
$clientSecret = Get-RequiredEnvironmentValue "AZURE_CLIENT_SECRET"

# Keep these assignments explicit so the child dlib process uses EnvironmentCredential.
[Environment]::SetEnvironmentVariable("AZURE_TENANT_ID", $tenantId, "Process")
[Environment]::SetEnvironmentVariable("AZURE_CLIENT_ID", $clientId, "Process")
[Environment]::SetEnvironmentVariable("AZURE_CLIENT_SECRET", $clientSecret, "Process")

$endpoint = Get-ProcessEnvironmentValue "AZURE_TRUSTED_SIGNING_ENDPOINT"
if ([string]::IsNullOrWhiteSpace($endpoint)) {
	$endpoint = "https://eus.codesigning.azure.net/"
}
$accountName = Get-ProcessEnvironmentValue "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"
if ([string]::IsNullOrWhiteSpace($accountName)) {
	$accountName = "enx-signing"
}
$certificateProfileName = Get-ProcessEnvironmentValue "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME"
if ([string]::IsNullOrWhiteSpace($certificateProfileName)) {
	$certificateProfileName = "ENX-Code-Signing"
}

if ([string]::IsNullOrWhiteSpace($FilesFolder)) {
	$FilesFolder = Join-Path $repoRoot "desktop\artifacts\electron-builder-release"
}
$FilesFolder = [IO.Path]::GetFullPath($FilesFolder)
if (-not (Test-Path -LiteralPath $FilesFolder -PathType Container)) {
	throw "Files folder was not found: $FilesFolder"
}

$signToolPath = Resolve-SignTool
$dlibPath = Resolve-CodeSigningDlib
$files = @(Get-ChildItem -LiteralPath $FilesFolder -Filter "*.exe" -File -Recurse)
if ($files.Count -eq 0) {
	throw "No .exe files were found under $FilesFolder. Build the Windows artifact first."
}

$metadataPath = Join-Path ([IO.Path]::GetTempPath()) "screen-share-trusted-signing-$PID.json"
$metadata = [ordered]@{
	Endpoint = $endpoint
	CodeSigningAccountName = $accountName
	CertificateProfileName = $certificateProfileName
	CorrelationId = "screen-share-local-$([DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss"))"
	ExcludeCredentials = @(
		"ManagedIdentityCredential",
		"WorkloadIdentityCredential",
		"SharedTokenCacheCredential",
		"VisualStudioCredential",
		"VisualStudioCodeCredential",
		"AzureCliCredential",
		"AzurePowerShellCredential",
		"AzureDeveloperCliCredential",
		"InteractiveBrowserCredential"
	)
}

try {
	$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataPath -Encoding UTF8

	Write-Host "Signing $($files.Count) .exe file(s) with Azure Trusted Signing..."
	Write-Host "Account: $accountName | Certificate profile: $certificateProfileName"

	$failed = 0
	foreach ($file in $files) {
		if ($SkipSigned) {
			$signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
			if ($signature.Status -eq "Valid") {
				Write-Host "Skipping already valid signature: $($file.FullName)"
				continue
			}
		}

		Write-Host "Signing: $($file.FullName)"
		& $signToolPath sign /v /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $dlibPath /dmdf $metadataPath $file.FullName
		$exitCode = $LASTEXITCODE
		if ($exitCode -ne 0) {
			$failed++
			Write-Warning "Signing failed for $($file.FullName) with exit code $exitCode."
		}
	}

	if ($failed -gt 0) {
		throw "$failed file(s) failed to sign."
	}

	Write-Host "Signing completed successfully."
}
finally {
	Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
}
