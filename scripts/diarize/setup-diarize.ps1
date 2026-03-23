# setup-diarize.ps1
# Installs Python 3.12, creates a venv, and installs diarization dependencies.
# Run from the project root: powershell -ExecutionPolicy Bypass -File scripts/diarize/setup-diarize.ps1

$ErrorActionPreference = 'Stop'
$VenvDir = '.venv'
$Requirements = 'scripts/diarize/requirements.txt'

# ── 1. Ensure Python 3.12 ────────────────────────────────────────────────────

$python312 = $null

# Check if py launcher can find 3.12
try {
    $ver = & py -3.12 --version 2>&1
    if ($ver -match '3\.12') {
        $python312 = 'py -3.12'
        Write-Host "Found Python 3.12 via py launcher: $ver"
    }
} catch {}

if (-not $python312) {
    Write-Host 'Python 3.12 not found. Installing via winget...'

    # winget is built into Windows 10 (1709+) and Windows 11
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Error (
            'winget is not available. Install Python 3.12 manually from https://www.python.org/downloads/ ' +
            'then re-run this script.'
        )
    }

    winget install --id Python.Python.3.12 --source winget --silent --accept-package-agreements --accept-source-agreements

    # Refresh PATH so py launcher picks up the new install
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')

    $ver = & py -3.12 --version 2>&1
    if ($ver -match '3\.12') {
        $python312 = 'py -3.12'
        Write-Host "Installed Python 3.12: $ver"
    } else {
        Write-Error 'Python 3.12 installation succeeded but py launcher cannot find it. Open a new terminal and re-run.'
    }
}

# ── 2. Create venv ───────────────────────────────────────────────────────────

if (Test-Path $VenvDir) {
    Write-Host "Venv '$VenvDir' already exists — skipping creation."
} else {
    Write-Host "Creating venv at $VenvDir ..."
    & py -3.12 -m venv $VenvDir
}

# ── 3. Install dependencies ──────────────────────────────────────────────────

Write-Host "Installing $Requirements ..."
& "$VenvDir\Scripts\pip.exe" install --upgrade pip --quiet
& "$VenvDir\Scripts\pip.exe" install -r $Requirements

# ── 4. Done ──────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host 'Setup complete. Run diarization with:'
Write-Host '  npm run diarize -- --python .venv\Scripts\python.exe'
