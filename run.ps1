$VenvDir = "venv"
$Requirements = @("pyperclip", "pydirectinput", "keyboard", "openai", "requests", "Pillow")

if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating virtual environment..."
    python -m venv $VenvDir
    & "$VenvDir\Scripts\Activate.ps1"
    Write-Host "Installing dependencies..."
    pip install @Requirements
} else {
    & "$VenvDir\Scripts\Activate.ps1"
}

# Start the AI solve server in the background
Start-Process -NoNewWindow -FilePath "python" -ArgumentList "server.py"
Write-Host "AI server started on http://localhost:5923"

python main.py
