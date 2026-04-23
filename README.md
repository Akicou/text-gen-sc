# AI Text Assistant

A hotkey-driven AI assistant that processes selected text using multiple AI providers.

## Supported Providers

| Provider | Description | API Key Required |
|----------|-------------|-----------------|
| **OpenRouter** | Cloud models (GPT, Gemini, etc.) | Yes |
| **Ollama** | Local models via Ollama (`localhost:11434`) | No |
| **LM Studio** | Local models via LM Studio (`localhost:1234`) | No |

## Quick Start

### Linux / macOS

```bash
chmod +x run.sh
./run.sh
```

### Windows (PowerShell)

```powershell
.\run.ps1
```

The scripts automatically create a virtual environment and install dependencies on first run. On subsequent runs they reuse the existing venv.

## Manual Setup

### 1. Create a virtual environment

```bash
python -m venv venv
source venv/bin/activate        # Linux/macOS
.\venv\Scripts\Activate.ps1     # Windows PowerShell
```

### 2. Install dependencies

```bash
pip install pyperclip pydirectinput keyboard openai requests
```

### 3. Run

```bash
python main.py
```

## Configuration

### API Keys

Create a `.env` file in the project root:

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

You can also set the key as a system environment variable instead.

For **Ollama** and **LM Studio**, no API key is needed — just make sure the local server is running.

### Provider-specific setup

**Ollama:**
- Install from [ollama.com](https://ollama.com)
- Pull a model: `ollama pull llama3`
- Ollama runs on `http://localhost:11434` by default
- The app fetches available models automatically

**LM Studio:**
- Install from [lmstudio.ai](https://lmstudio.ai)
- Load a model in LM Studio and start the local server
- Runs on `http://localhost:1234` by default
- If no models are detected, defaults to `local-model` (uses whatever model is currently loaded)

## Building an Executable

You can package the app into a standalone `.exe` using PyInstaller:

```bash
pip install pyinstaller
pyinstaller --onefile --name text-gen-sc main.py
```

The executable will be in `dist/`.

## Usage

You will be prompted to select a provider and model on startup.

### Hotkeys

| Hotkey | Action |
|--------|--------|
| `CTRL+C` | Copy selected text and process it with AI |
| `ALT+U` | Switch provider and model |
| `ALT+Y` | Quit the program |

### Text Commands

Select text starting with a prefix and press `CTRL+C`:

- **`instruction>`** — Sends the text as an instruction to the AI and pastes the response
- **`grammar>`** — Sends the text for grammar correction and pastes the corrected version

### Context Files

Place `.txt` files in the `data/` folder to provide persistent context to the AI. The contents of all `.txt` files are included with every prompt.
