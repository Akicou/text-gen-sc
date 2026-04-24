import pyperclip
import pydirectinput
import keyboard
import os
import sys
from openai import OpenAI
import time
import subprocess
import json
import requests
import tkinter as tk
from tkinter import messagebox
import base64
import io
import tempfile
from PIL import ImageGrab, Image
import ctypes
from ctypes import wintypes
import threading

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
background_mode = "--background" in sys.argv
_control_popup_window = None


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


def load_config():
    """Load provider and model from config file. Returns True if successful."""
    global selected_provider, selected_model, api_key
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".server_config.json")
    if not os.path.exists(config_path):
        return False
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
            selected_provider = config.get("provider")
            selected_model = config.get("model")
            if selected_provider and selected_model:
                if selected_provider in PROVIDERS:
                    provider = PROVIDERS[selected_provider]
                    if provider["needs_api_key"]:
                        key = get_api_key(selected_provider)
                        if key:
                            api_key = key
                        else:
                            return False
                    else:
                        api_key = "not-needed"
                    return True
    except Exception:
        pass
    return False


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


def fetch_openrouter_models():
    """Fetch available models from OpenRouter."""
    try:
        resp = requests.get("https://openrouter.ai/api/v1/models", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        models = []
        for m in data.get("data", []):
            models.append(m["id"])
        models.sort()
        return models
    except Exception as e:
        print(f"Error fetching OpenRouter models: {e}")
        return []


def save_config():
    """Save current provider and model to a shared config file for server.py."""
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".server_config.json")
    config = {"provider": selected_provider, "model": selected_model}
    try:
        with open(config_path, "w") as f:
            json.dump(config, f)
    except Exception:
        pass


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
        models = fetch_openrouter_models()
        if not models:
            print("Could not fetch models from OpenRouter.")
        return models
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
    all_models = get_models_for_provider()
    if not all_models:
        return

    while True:
        if selected_provider == "openrouter":
            query = input(f"\nSearch models (or press Enter to list all {len(all_models)}): ").strip().lower()
            if query:
                models = [m for m in all_models if query in m.lower()]
                if not models:
                    print(f"No models matching '{query}'. Try again.")
                    continue
            else:
                models = all_models
        else:
            models = all_models

        print(f"\nAvailable models ({PROVIDERS[selected_provider]['name']}):")
        for i, model in enumerate(models, 1):
            print(f"  {i}. {model}")
        try:
            choice = int(input("Enter the number: ")) - 1
            if 0 <= choice < len(models):
                selected_model = models[choice]
                print(f"Selected model: {selected_model}")
                save_config()
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
    system_prompt = (
        "You are a helpful assistant. "
        "Respond in plain text only. "
        "Do not use markdown bold (** or __), italic (* or _), headers (#), or any other markdown formatting. "
        "Do not use emojis or special unicode symbols. "
        "Keep responses clean, concise, and plainly formatted."
    )
    try:
        response = client.chat.completions.create(
            model=selected_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": prompt
                    + f"""

            <context>
            {context}
            </context>
            """,
                },
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


def show_control_popup():
    """Show a small popup window with quit button (triggered by ALT+P). Toggles if already open."""
    global _control_popup_window

    # If window exists and is open, close it (toggle behavior)
    if _control_popup_window is not None:
        try:
            if tk.Tk.winfo_exists(_control_popup_window):
                _control_popup_window.destroy()
        except Exception:
            pass
        _control_popup_window = None
        return

    def create_popup():
        global _control_popup_window

        root = tk.Tk()
        root.title("AI Assistant Control")
        root.geometry("300x150")
        root.resizable(False, False)
        root.attributes("-topmost", True)

        # Provider/model info
        info_frame = tk.Frame(root)
        info_frame.pack(pady=10, padx=10, fill=tk.X)

        provider_name = PROVIDERS.get(selected_provider, {}).get("name", "Unknown")
        tk.Label(info_frame, text=f"Provider: {provider_name}", font=("Arial", 10)).pack(anchor=tk.W)
        tk.Label(info_frame, text=f"Model: {selected_model or 'Not set'}", font=("Arial", 10)).pack(anchor=tk.W)

        # Status
        status_label = tk.Label(info_frame, text="Status: Running", fg="green", font=("Arial", 10, "bold"))
        status_label.pack(anchor=tk.W, pady=(5, 0))

        def quit_program():
            status_label.config(text="Stopping...", fg="orange")
            root.update()
            time.sleep(0.1)
            os._exit(0)

        def minimize():
            root.iconify()

        def on_close():
            nonlocal root
            root.iconify()

        # Buttons frame
        btn_frame = tk.Frame(root)
        btn_frame.pack(pady=10)

        tk.Button(btn_frame, text="Quit", command=quit_program, bg="#ff6b6b", fg="white", width=10).pack(side=tk.LEFT, padx=5)
        tk.Button(btn_frame, text="Minimize", command=minimize, width=10).pack(side=tk.LEFT, padx=5)

        root.protocol("WM_DELETE_WINDOW", on_close)
        _control_popup_window = root
        root.mainloop()
        _control_popup_window = None

    # Run popup in separate thread so keyboard hotkey remains responsive
    thread = threading.Thread(target=create_popup, daemon=True)
    thread.start()


# --- Screenshot Feature ---

_screenshot_active = False
_screenshot_last_done = 0


def get_monitor_rect_from_mouse():
    """Return (left, top, right, bottom) of the monitor under the mouse cursor."""
    point = wintypes.POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(point))

    class MONITORINFOEXW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("rcMonitor", wintypes.RECT),
            ("rcWork", wintypes.RECT),
            ("dwFlags", wintypes.DWORD),
            ("szDevice", ctypes.c_wchar * 32),
        ]

    hmonitor = ctypes.windll.user32.MonitorFromPoint(point, 2)  # MONITOR_DEFAULTTONEAREST
    info = MONITORINFOEXW()
    info.cbSize = ctypes.sizeof(MONITORINFOEXW)
    ctypes.windll.user32.GetMonitorInfoW(hmonitor, ctypes.byref(info))

    r = info.rcMonitor
    return (r.left, r.top, r.right, r.bottom)


def capture_region(bbox):
    """Capture a screenshot of the given screen region (left, top, right, bottom)."""
    return ImageGrab.grab(bbox=bbox)


def image_to_base64(image):
    """Convert a PIL Image to a base64-encoded PNG string."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


def query_ai_vision(image_base64, prompt):
    """Query the AI with a base64 image and text prompt using the vision API."""
    provider = PROVIDERS[selected_provider]
    client = OpenAI(
        api_key=api_key if provider["needs_api_key"] else "not-needed",
        base_url=provider["base_url"],
    )
    context = get_context()
    system_prompt = (
        "You are a helpful assistant that analyzes images and text. "
        "Respond in plain text only. "
        "Do not use markdown bold (** or __), italic (* or _), headers (#), or any other markdown formatting. "
        "Do not use emojis or special unicode symbols. "
        "Keep responses clean, concise, and plainly formatted."
    )
    try:
        response = client.chat.completions.create(
            model=selected_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{image_base64}"
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt + f"\n\n<context>\n{context}\n</context>",
                        },
                    ],
                },
            ],
            reasoning_effort="medium",
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error querying AI with vision: {e}")
        return ""


def open_in_notepad(text):
    """Write text to a temp file and open it in Notepad."""
    fd, path = tempfile.mkstemp(suffix=".txt", prefix="ai_response_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    subprocess.Popen(["notepad.exe", path])


class ScreenshotOverlay:
    """Fullscreen transparent overlay for selecting a screen region."""

    def __init__(self, monitor_rect):
        self.monitor_rect = monitor_rect
        self.start_x = None
        self.start_y = None
        self.end_x = None
        self.end_y = None
        self.selection_rect_id = None
        self.result = None
        self.root = None
        self.canvas = None

    def show(self):
        """Display the overlay and block until selection is made or cancelled."""
        mon_left, mon_top, mon_right, mon_bottom = self.monitor_rect
        width = mon_right - mon_left
        height = mon_bottom - mon_top

        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.geometry(f"{width}x{height}+{mon_left}+{mon_top}")
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.3)
        self.root.configure(bg="black")

        self.canvas = tk.Canvas(
            self.root,
            bg="black",
            highlightthickness=0,
            cursor="cross",
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)

        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.root.bind("<Escape>", self._on_cancel)

        self.root.focus_force()

        # Global escape hook as fallback in case tkinter doesn't have focus
        self._escape_hook = keyboard.on_press_key("esc", lambda _: self.root.after(0, self._cancel))

        self.root.mainloop()

        # Clean up the global hook
        keyboard.unhook(self._escape_hook)

        return self.result

    def _on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y

    def _on_drag(self, event):
        if self.selection_rect_id:
            self.canvas.delete(self.selection_rect_id)
        self.end_x = event.x
        self.end_y = event.y
        self.selection_rect_id = self.canvas.create_rectangle(
            self.start_x, self.start_y, self.end_x, self.end_y,
            outline="white", width=2, fill="", dash=(4, 4),
        )

    def _on_release(self, event):
        self.end_x = event.x
        self.end_y = event.y
        mon_left, mon_top = self.monitor_rect[0], self.monitor_rect[1]

        left = min(self.start_x, self.end_x) + mon_left
        top = min(self.start_y, self.end_y) + mon_top
        right = max(self.start_x, self.end_x) + mon_left
        bottom = max(self.start_y, self.end_y) + mon_top

        if right - left < 5 or bottom - top < 5:
            self.result = None
        else:
            self.result = (left, top, right, bottom)

        self.root.destroy()

    def _cancel(self):
        self.result = None
        self.root.destroy()

    def _on_cancel(self, event):
        self._cancel()


def handle_alt_t():
    """Handle ALT+T: screenshot region selection and AI analysis."""
    global _screenshot_active, _screenshot_last_done
    if _screenshot_active or (time.time() - _screenshot_last_done) < 1.0:
        return
    _screenshot_active = True

    if selected_model is None:
        print("No model selected. Press ALT+U to select a model.")
        _screenshot_active = False
        return

    try:
        monitor_rect = get_monitor_rect_from_mouse()

        overlay = ScreenshotOverlay(monitor_rect)
        selected_region = overlay.show()

        if selected_region is None:
            print("Screenshot cancelled.")
            return

        time.sleep(0.15)
        screenshot = capture_region(selected_region)

        max_dim = 2048
        if max(screenshot.size) > max_dim:
            screenshot.thumbnail((max_dim, max_dim), Image.LANCZOS)

        img_b64 = image_to_base64(screenshot)

        print("Analyzing screenshot...")
        prompt = (
            "Analyze this screenshot. First, briefly describe what is visible. "
            "Then, if there are any questions, problems, errors, code, or requests visible in the image, "
            "actively solve or answer them. Do not just read out what is on screen — provide real solutions, "
            "explanations, fixes, or answers to anything shown."
        )
        response = query_ai_vision(img_b64, prompt)

        if not response:
            print("No response from AI.")
            return

        open_in_notepad(response)
        print("Screenshot analysis opened in Notepad.")

    except Exception as e:
        print(f"Error during screenshot analysis: {e}")
    finally:
        _screenshot_last_done = time.time()
        _screenshot_active = False


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

    if background_mode:
        # Load previous config instead of asking
        if not load_config():
            print("No valid configuration found. Please run run.ps1 interactively first.")
            sys.exit(1)
        print(f"Background mode started with {PROVIDERS[selected_provider]['name']} / {selected_model}")
    else:
        select_provider()
        select_model()

    keyboard.add_hotkey("ctrl+c", handle_ctrl_c)
    keyboard.add_hotkey("alt+t", handle_alt_t)
    keyboard.add_hotkey("alt+u", handle_alt_u)
    keyboard.add_hotkey("alt+y", handle_alt_y)
    keyboard.add_hotkey("alt+p", show_control_popup)

    if not background_mode:
        print(
            "\nProgram running.\n"
            "  CTRL+C  - Process selected text\n"
            "  ALT+T   - Screenshot analysis\n"
            "  ALT+U   - Change provider/model\n"
            "  ALT+Y   - Quit\n"
            "  ALT+P   - Control menu"
        )
    keyboard.wait()


if __name__ == "__main__":
    main()
