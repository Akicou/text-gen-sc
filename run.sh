#!/usr/bin/env bash
set -e

VENV_DIR="venv"
REQUIREMENTS="pyperclip pydirectinput keyboard openai requests Pillow"

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    source "$VENV_DIR/bin/activate"
    echo "Installing dependencies..."
    pip install $REQUIREMENTS
else
    source "$VENV_DIR/bin/activate"
fi

python main.py
