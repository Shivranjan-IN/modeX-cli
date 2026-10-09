<#PSScriptInfo
.VERSION 1.0
.GUID 12345678-1234-1234-1234-123456789012
.AUTHOR Modex CLI Team
.COPYRIGHT (c) 2024 Modex CLI Team
.LICENSE MIT
#>

<# 
.SYNOPSIS
    Modex CLI - Quick Install Script for Windows PowerShell

.DESCRIPTION
    Installs Modex CLI globally via npm. Requires Node.js 22+.

.PARAMETER Version
    Version to install (default: latest)

.PARAMETER InstallDir
    Installation directory (default: $env:USERPROFILE\.modex\bin)

.EXAMPLE
    iwr https://raw.githubusercontent.com/modex-cli/modex/main/install.ps1 -UseBasicParsing | iex

.EXAMPLE
    iwr https://raw.githubusercontent.com/modex-cli/modex/main/install.ps1 -UseBasicParsing | iex -Version 0.0.1
#>

param(
    [string]$Version = "latest",
    [string]$InstallDir = "$env:USERPROFILE\.modex\bin",
    [string]$NpmRegistry = "https://registry.npmjs.org"
)

$Blue = [ConsoleColor]::Cyan
$Green = [ConsoleColor]::Green
$Yellow = [ConsoleColor]::Yellow
$Red = [ConsoleColor]::Red

function Log { Write-Host "[modex] $args" -ForegroundColor $Blue }
function Success { Write-Host "[modex] $args" -ForegroundColor $Green }
function Warn { Write-Host "[modex] $args" -ForegroundColor $Yellow }
function Error { Write-Host "[modex] $args" -ForegroundColor $Red }

function Check-Node {
    try {
        $nodeVersion = node --version 2>$null
        if (-not $nodeVersion) { throw "Node not found" }
        $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
        if ($major -lt 22) { throw "Node.js 22+ required, found $nodeVersion" }
        Log "Node.js $nodeVersion ✓"
    } catch {
        Error "Node.js 22+ not found. Install from https://nodejs.org/"
        exit 1
    }
}

function Check-Npm {
    try {
        $npmVersion = npm --version 2>$null
        if (-not $npmVersion) { throw "npm not found" }
        Log "npm $npmVersion ✓"
    } catch {
        Error "npm not found. Install Node.js with npm."
        exit 1
    }
}

function Install-Modex {
    Log "Installing Modex CLI..."
    $pkg = if ($Version -eq "latest") { "@modex/cli@latest" } else { "@modex/cli@$Version" }
    try {
        npm install -g $pkg --registry $NpmRegistry 2>&1 | ForEach-Object { Log $_ }
    } catch {
        Error "Installation failed: $_"
        exit 1
    }
    Success "Modex CLI installed globally"
}

function Verify-Install {
    if (Get-Command modex -ErrorAction SilentlyContinue) {
        $version = modex --version 2>$null ?? "unknown"
        Success "Modex CLI $version is ready!"
        Log "Run 'modex' to start"
    } else {
        Warn "Modex installed but not in PATH"
        Log "Add to your profile: \$env:PATH += \";$InstallDir\""
        Log "Or run with: npx @modex/cli"
    }
}

# Main
Write-Host @"
███╗   ███╗ ██████╗ ██████╗ ███████╗██╗  ██╗
████╗ ████║██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝
██╔████╔██║██║   ██║██║  ██║█████╗   ╚███╔╝ 
██║╚██╔╝██║██║   ██║██║  ██║██╔══╝   ██╔██╗ 
██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗██╔╝ ██╗
╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝
        ONE CLI. EVERY MODEL. FREE-FIRST.
"@ -ForegroundColor $Blue

Check-Node
Check-Npm
Install-Modex
Verify-Install

Write-Host @"

Quick start:
  modex                 # Interactive REPL
  modex --pick          # Choose model, then chat
  modex "your question" # One-shot

Free API keys (add to ~/.modex/.env):
  GROQ_API_KEY=gsk_...        https://console.groq.com/keys
  CEREBRAS_API_KEY=csk-...    https://cloud.cerebras.ai/
  NVIDIA_API_KEY=nvapi-...    https://build.nvidia.com/
  OPENROUTER_API_KEY=skor-... https://openrouter.ai/keys
"@ -ForegroundColor $Blue