import pyperclip
import pydirectinput
import keyboard
import os
from openai import OpenAI
import time
import subprocess
import json
import requests

# Provider configurations
PROVIDERS = {
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "env_key": "OPENROUTER_API_KEY",
        "needs_api_key": True,
    },
    "ollama": {
        "name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "env_key": None,
        "needs_api_key": False,
    },
    "lmstudio": {
        "name": "LM Studio",
        "base_url": "http://localhost:1234/v1",
        "env_key": None,
        "needs_api_key": False,
    },
}

# Global state
selected_model = None
selected_provider = None
api_key = None


def load_env():
    """Load environment variables from .env file if it exists."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key.strip()] = value.strip()


def get_api_key(provider_id):
    """Get the API key for a provider from environment."""
    provider = PROVIDERS[provider_id]
    if not provider["needs_api_key"]:
        return "not-needed"
    env_key = provider["env_key"]
    key = os.environ.get(env_key)
    if not key:
        print(f"\nNo API key found. Set {env_key} in your .env file or environment.")
        return None
    return key


def fetch_ollama_models():
    """Fetch available models from Ollama."""
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return [m["name"] for m in data.get("models", [])]
    except Exception as e:
        print(f"Error fetching Ollama models: {e}")
        return []


def fetch_lmstudio_models():
    """Fetch available models from LM Studio. Falls back to 'local-model'."""
    try:
        resp = requests.get("http://localhost:1234/v1/models", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        models = [m["id"] for m in data.get("data", [])]
        return models if models else ["local-model"]
    except Exception:
        return ["local-model"]


# Default OpenRouter models
OPENROUTER_MODELS = [
    "openai/gpt-oss-120b",
    "google/gemini-2.0-flash-001",
    "google/gemma-3n-e4b-it",
]


def select_provider():
    """Select the AI provider."""
    global selected_provider, api_key
    while True:
        print("\nSelect a provider:")
        providers = list(PROVIDERS.items())
        for i, (pid, pinfo) in enumerate(providers, 1):
            print(f"  {i}. {pinfo['name']}")
        try:
            choice = int(input("Enter the number: ")) - 1
            if 0 <= choice < len(providers):
                selected_provider = providers[choice][0]
                key = get_api_key(selected_provider)
                if key is None:
                    continue
                api_key = key
                print(f"Selected provider: {PROVIDERS[selected_provider]['name']}")
                break
            else:
                print("Invalid choice.")
        except ValueError:
            print("Please enter a number.")


def get_models_for_provider():
    """Get the list of available models for the selected provider."""
    if selected_provider == "openrouter":
        return OPENROUTER_MODELS
    elif selected_provider == "ollama":
        models = fetch_ollama_models()
        if not models:
            print("No models found. Make sure Ollama is running.")
        return models
    elif selected_provider == "lmstudio":
        return fetch_lmstudio_models()
    return []


def select_model():
    """Select a model from the current provider's model list."""
    global selected_model
    models = get_models_for_provider()
    if not models:
        return

    while True:
        print(f"\nAvailable models ({PROVIDERS[selected_provider]['name']}):")
        for i, model in enumerate(models, 1):
            print(f"  {i}. {model}")
        try:
            choice = int(input("Enter the number: ")) - 1
            if 0 <= choice < len(models):
                selected_model = models[choice]
                print(f"Selected model: {selected_model}")
                break
            else:
                print("Invalid choice.")
        except ValueError:
            print("Please enter a number.")


def get_context():
    context = ""
    data_dir = "./data"

    if os.path.exists(data_dir) and os.path.isdir(data_dir):
        for filename in os.listdir(data_dir):
            if filename.endswith(".txt"):
                filepath = os.path.join(data_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        context += f.read() + "\n"
                except Exception as e:
                    print(f"Error reading {filename}: {e}")

    return context


def query_ai(prompt):
    """Query the AI using the selected provider and model."""
    provider = PROVIDERS[selected_provider]
    client = OpenAI(
        api_key=api_key if provider["needs_api_key"] else "not-needed",
        base_url=provider["base_url"],
    )
    context = get_context()
    try:
        response = client.chat.completions.create(
            model=selected_model,
            messages=[
                {
                    "role": "user",
                    "content": prompt
                    + f"""

            <context>
            {context}
            </context>
            """,
                }
            ],
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error querying AI: {e}")
        return ""


def get_selected_text():
    keyboard.send("ctrl+c")
    time.sleep(0.1)
    return pyperclip.paste()


def handle_ctrl_c():
    if selected_model is None:
        print("No model selected. Press ALT+U to select a model.")
        return

    selected_text = get_selected_text()
    if not selected_text:
        print("No text selected.")
        return

    if selected_text.lower().startswith("instruction>"):
        instruction = selected_text[12:].strip()
        prompt = f"Follow this instruction: {instruction}"
        response = query_ai(prompt)
        pyperclip.copy(response)
        keyboard.send("ctrl+v")
    elif selected_text.lower().startswith("grammar>"):
        text_to_correct = selected_text[8:].strip()
        prompt = f"Correct the grammar in this text: {text_to_correct}"
        response = query_ai(prompt)
        pyperclip.copy(response)
        keyboard.send("ctrl+v")
    else:
        print("Selected text does not start with 'instruction>' or 'grammar>'.")


def get_current_network_name():
    try:
        result = subprocess.run(
            ["netsh", "wlan", "show", "interfaces"],
            capture_output=True,
            text=True,
            check=True,
        )
        for line in result.stdout.split("\n"):
            if "SSID" in line and "BSSID" not in line:
                network_name = line.split(":", 1)[1].strip()
                return network_name
        return None
    except Exception as e:
        print(f"Error getting network name: {e}")
        return None


def handle_alt_u():
    select_provider()
    select_model()


def handle_alt_y():
    print("Stopping program...")
    os._exit(0)


def setup_environment():
    if not os.path.exists("./data"):
        os.makedirs("./data")
    if not os.path.exists("./data/context.txt"):
        with open("./data/context.txt", "w") as f:
            f.write(
                "Hello User, Write anything in here to let the Assistant know what they should know. Refer to the README for configuration!"
            )


def main():
    load_env()
    setup_environment()

    select_provider()
    select_model()

    keyboard.add_hotkey("ctrl+c", handle_ctrl_c)
    keyboard.add_hotkey("alt+u", handle_alt_u)
    keyboard.add_hotkey("alt+y", handle_alt_y)

    print(
        "\nProgram running.\n"
        "  CTRL+C  - Process selected text\n"
        "  ALT+U   - Change provider/model\n"
        "  ALT+Y   - Quit"
    )
    keyboard.wait()


if __name__ == "__main__":
    main()
