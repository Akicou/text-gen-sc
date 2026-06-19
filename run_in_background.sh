#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/venv"
VENV_PYTHON="$VENV_DIR/bin/python"
CONFIG_PATH="$SCRIPT_DIR/.server_config.json"
LOG_DIR="$SCRIPT_DIR/logs"
PID_DIR="$SCRIPT_DIR/.pids"
FALLBACK_REQUIREMENTS=(pyperclip keyboard openai requests Pillow)

find_python() {
    local candidate path
    for candidate in python3 python; do
        if command -v "$candidate" >/dev/null 2>&1; then
            path="$(command -v "$candidate")"
            if "$path" -c 'import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
                printf '%s\n' "$path"
                return 0
            fi
        fi
    done

    echo "Python 3 is required. Install it from https://www.python.org/downloads/ or Homebrew." >&2
    exit 1
}

install_dependencies() {
    echo "Installing dependencies..."
    "$VENV_PYTHON" -m pip install --upgrade pip

    if [ -f "$SCRIPT_DIR/requirements.txt" ]; then
        "$VENV_PYTHON" -m pip install -r "$SCRIPT_DIR/requirements.txt"
    else
        "$VENV_PYTHON" -m pip install "${FALLBACK_REQUIREMENTS[@]}"
    fi
}

setup_venv() {
    local bootstrap_python install_deps
    bootstrap_python="$1"
    install_deps=0

    if [ -d "$VENV_DIR" ] && [ ! -x "$VENV_PYTHON" ]; then
        echo "Existing virtual environment is not usable on macOS/Linux. Recreating..."
        rm -rf "$VENV_DIR"
    fi

    if [ ! -d "$VENV_DIR" ]; then
        echo "Creating virtual environment..."
        "$bootstrap_python" -m venv "$VENV_DIR"
        install_deps=1
    fi

    if [ ! -x "$VENV_PYTHON" ]; then
        echo "Virtual environment setup failed: $VENV_PYTHON not found." >&2
        exit 1
    fi

    if [ "$install_deps" -eq 1 ] || [ "${INSTALL_DEPS:-0}" = "1" ]; then
        install_dependencies
    fi
}

read_config() {
    local python_bin
    python_bin="$1"

    if [ ! -f "$CONFIG_PATH" ]; then
        echo "No previous configuration found. Please run ./run.sh interactively first." >&2
        exit 1
    fi

    "$python_bin" - "$CONFIG_PATH" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        config = json.load(f)
    provider = config.get("provider")
    model = config.get("model")
    if not provider or not model:
        raise ValueError("provider/model missing")
except Exception:
    print("Invalid configuration. Please run ./run.sh interactively first.", file=sys.stderr)
    sys.exit(1)

print(provider)
print(model)
PY
}

start_background_process() {
    local name pid_file log_file existing_pid pid
    name="$1"
    pid_file="$2"
    log_file="$3"
    shift 3

    if [ -f "$pid_file" ]; then
        existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
        if [ -n "$existing_pid" ] && kill -0 "$existing_pid" >/dev/null 2>&1; then
            echo "$name already running (PID $existing_pid)."
            return 0
        fi
    fi

    nohup "$@" > "$log_file" 2>&1 &
    pid="$!"
    printf '%s\n' "$pid" > "$pid_file"
    sleep 0.2

    if ! kill -0 "$pid" >/dev/null 2>&1; then
        echo "$name failed to start. Check log: $log_file" >&2
        return 1
    fi

    echo "$name started (PID $pid). Log: $log_file"
}

BOOTSTRAP_PYTHON="$(find_python)"
CONFIG_VALUES="$(read_config "$BOOTSTRAP_PYTHON")" || exit 1
PROVIDER="$(printf '%s\n' "$CONFIG_VALUES" | sed -n '1p')"
MODEL="$(printf '%s\n' "$CONFIG_VALUES" | sed -n '2p')"

setup_venv "$BOOTSTRAP_PYTHON"
mkdir -p "$LOG_DIR" "$PID_DIR"

start_background_process "AI server" "$PID_DIR/server.pid" "$LOG_DIR/server.log" \
    "$VENV_PYTHON" "$SCRIPT_DIR/server.py"

start_background_process "AI assistant" "$PID_DIR/main.pid" "$LOG_DIR/main.log" \
    "$VENV_PYTHON" "$SCRIPT_DIR/main.py" --background

echo ""
echo "AI is now running in the background."
echo "  Press ALT+P (Option+P on Mac keyboards) to open the control menu."
echo "  Logs: $LOG_DIR"
echo "  Stop: kill \$(cat \"$PID_DIR/main.pid\") \$(cat \"$PID_DIR/server.pid\")"
echo ""
echo "Provider: $PROVIDER"
echo "Model: $MODEL"
