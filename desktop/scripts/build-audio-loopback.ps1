[CmdletBinding()]
param(
	[ValidateSet("Debug", "Release")]
	[string]$Configuration = "Release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$outputPath = Join-Path $repositoryRoot "desktop\build\audio-loopback"
$executablePath = Join-Path $outputPath "AudioLoopback.exe"
$go = Get-Command go -ErrorAction SilentlyContinue

if ($null -eq $go) {
	throw "O Go não foi encontrado. Instale o Go 1.23 ou superior para compilar o helper de áudio."
}

New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$oldGoOS = $env:GOOS
$oldGoArch = $env:GOARCH
$env:GOOS = "windows"
$env:GOARCH = "amd64"

try {
	$buildArgs = @("build", "-trimpath")
	if ($Configuration -eq "Release") {
		$buildArgs += @("-ldflags", "-s -w")
	}
	$buildArgs += @("-o", $executablePath, (Join-Path $repositoryRoot "cmd\audio-loopback"))
	& $go.Source @buildArgs
}
finally {
	$env:GOOS = $oldGoOS
	$env:GOARCH = $oldGoArch
}

if ($LASTEXITCODE -ne 0) {
	throw "Falha ao compilar o helper de áudio (go build saiu com código $LASTEXITCODE)."
}

if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
	throw "O build terminou sem gerar $executablePath"
}

Write-Host "Helper de áudio gerado em $executablePath"
