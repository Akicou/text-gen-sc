#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/venv"
VENV_PYTHON="$VENV_DIR/bin/python"
FALLBACK_REQUIREMENTS=(pyperclip keyboard pynput openai requests Pillow)
SERVER_PID=""

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
    bootstrap_python="$(find_python)"
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

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
    fi
}

setup_venv

# Start the AI solve server in the background for this session.
"$VENV_PYTHON" "$SCRIPT_DIR/server.py" &
SERVER_PID="$!"
trap cleanup EXIT

echo "AI server started on http://localhost:5923 (PID $SERVER_PID)"
echo "Starting AI assistant..."

"$VENV_PYTHON" "$SCRIPT_DIR/main.py"
