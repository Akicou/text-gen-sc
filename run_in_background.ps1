$VenvDir = "venv"
$ConfigPath = ".server_config.json"

# Check if config exists with previous provider/model selection
if (-not (Test-Path $ConfigPath)) {
    Write-Host "No previous configuration found. Please run run.ps1 interactively first."
    exit 1
}

# Read the config to verify it has the required data
$config = Get-Content $ConfigPath | ConvertFrom-Json
if (-not $config.provider -or -not $config.model) {
    Write-Host "Invalid configuration. Please run run.ps1 interactively first."
    exit 1
}

# Ensure venv exists
if (-not (Test-Path $VenvDir)) {
    Write-Host "Virtual environment not found. Creating..."
    python -m venv $VenvDir
    & "$VenvDir\Scripts\Activate.ps1"
    Write-Host "Installing dependencies..."
    $Requirements = @("pyperclip", "pydirectinput", "keyboard", "openai", "requests", "Pillow")
    pip install @Requirements
} else {
    & "$VenvDir\Scripts\Activate.ps1"
}

# Start the AI solve server in the background (hidden)
$serverProcess = Start-Process -WindowStyle Hidden -FilePath "$VenvDir\Scripts\python.exe" -ArgumentList "server.py" -WorkingDirectory $PSScriptRoot -PassThru

# Start main.py in background mode (hidden)
$mainProcess = Start-Process -WindowStyle Hidden -FilePath "$VenvDir\Scripts\python.exe" -ArgumentList "main.py", "--background" -WorkingDirectory $PSScriptRoot -PassThru

Write-Host "AI is now running in the background."
Write-Host "  Press ALT+P to open the control menu"
Write-Host "  Or find 'python.exe' in Task Manager to quit"
Write-Host ""
Write-Host "Provider: $($config.provider)"
Write-Host "Model: $($config.model)"
