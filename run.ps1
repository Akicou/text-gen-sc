$VenvDir = "venv"
$Requirements = @("pyperclip", "pydirectinput", "keyboard", "openai", "requests")

if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating virtual environment..."
    python -m venv $VenvDir
    & "$VenvDir\Scripts\Activate.ps1"
    Write-Host "Installing dependencies..."
    pip install @Requirements
} else {
    & "$VenvDir\Scripts\Activate.ps1"
}

python main.py
