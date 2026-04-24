"""
Local HTTP server for the Moodle Question Extractor extension.
Accepts POST /solve with extracted question data, queries an AI
(using OpenRouter with structured outputs or local models with
JSON fallback), and returns the structured answer.
"""

import json
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from openai import OpenAI

PORT = 5923

# ---------- Provider configuration ----------

PROVIDERS = {
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "env_key": "OPENROUTER_API_KEY",
        "needs_api_key": True,
        "supports_structured_output": True,
    },
    "ollama": {
        "name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "env_key": None,
        "needs_api_key": False,
        "supports_structured_output": False,
    },
    "lmstudio": {
        "name": "LM Studio",
        "base_url": "http://localhost:1234/v1",
        "env_key": None,
        "needs_api_key": False,
        "supports_structured_output": False,
    },
}

DEFAULT_PROVIDER = "openrouter"
DEFAULT_MODEL = "openai/gpt-oss-120b"


def load_config():
    """Read provider and model from .server_config.json (written by main.py)."""
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".server_config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                cfg = json.load(f)
            return cfg.get("provider", DEFAULT_PROVIDER), cfg.get("model", DEFAULT_MODEL)
        except Exception:
            pass
    return DEFAULT_PROVIDER, DEFAULT_MODEL

# ---------- .env & context loading ----------


def load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    value = value.strip().strip("'\"")
                    os.environ[key.strip()] = value
    else:
        print(f"[warn] .env not found at {env_path}")


def get_context():
    context = ""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    if os.path.exists(data_dir) and os.path.isdir(data_dir):
        for filename in sorted(os.listdir(data_dir)):
            if filename.endswith(".txt"):
                filepath = os.path.join(data_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        context += f.read() + "\n"
                except Exception as e:
                    print(f"Error reading {filename}: {e}")
    return context


# ---------- Structured output schemas ----------

SCHEMAS = {
    "K-Prime": {
        "type": "json_schema",
        "json_schema": {
            "name": "kprime_answer",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "answers": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "statement": {"type": "string"},
                                "answer": {"type": "string"},
                                "explanation": {"type": "string"},
                            },
                            "required": ["statement", "answer", "explanation"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["answers"],
                "additionalProperties": False,
            },
        },
    },
    "Multiple Choice": {
        "type": "json_schema",
        "json_schema": {
            "name": "multichoice_answer",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "correctAnswer": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "alternatives": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "index": {"type": "integer"},
                                "reason": {"type": "string"},
                            },
                            "required": ["index", "reason"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["correctAnswer", "explanation", "alternatives"],
                "additionalProperties": False,
            },
        },
    },
    "Lueckentext": {
        "type": "json_schema",
        "json_schema": {
            "name": "gapselect_answer",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "gaps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "gapNumber": {"type": "integer"},
                                "answer": {"type": "string"},
                                "explanation": {"type": "string"},
                            },
                            "required": ["gapNumber", "answer", "explanation"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["gaps"],
                "additionalProperties": False,
            },
        },
    },
    "Zuordnung": {
        "type": "json_schema",
        "json_schema": {
            "name": "match_answer",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "matches": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "statement": {"type": "string"},
                                "answer": {"type": "string"},
                                "explanation": {"type": "string"},
                            },
                            "required": ["statement", "answer", "explanation"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["matches"],
                "additionalProperties": False,
            },
        },
    },
}


def get_schema_for_type(question_type):
    if question_type == "K-Prime":
        return SCHEMAS["K-Prime"]
    elif question_type == "Multiple Choice":
        return SCHEMAS["Multiple Choice"]
    elif "Lueckentext" in question_type or "ückentext" in question_type or question_type == "Gap Select":
        return SCHEMAS["Lueckentext"]
    elif "Zuordnung" in question_type or question_type == "Match":
        return SCHEMAS["Zuordnung"]
    return None


# ---------- Prompt construction ----------


def build_prompt(data):
    q_type = data.get("type", "")
    question_text = data.get("questionText", "")

    base = (
        f"Beantworte die folgende {q_type}-Frage.\n"
        f"Antworte auf Deutsch.\n\n"
        f"Frage:\n{question_text}\n\n"
    )

    if q_type == "K-Prime":
        headers = data.get("headers", [])
        options = data.get("options", [])
        base += f"Spalten: {' / '.join(headers)}\n"
        base += "Aussagen:\n"
        for i, opt in enumerate(options, 1):
            base += f"  {i}. {opt.get('text', '')}\n"

    elif q_type == "Multiple Choice":
        options = data.get("options", [])
        base += "Antwortoptionen:\n"
        for i, opt in enumerate(options, 1):
            base += f"  {i}. {opt.get('text', '')}\n"

    elif "ückentext" in q_type or "Lueckentext" in q_type:
        gaps = data.get("gaps", [])
        base += "Luecken:\n"
        for g in gaps:
            opts_list = g.get("options", [])
            base += f"  Luecke {g.get('index', '?')}: Optionen = {', '.join(opts_list)}\n"

    elif "Zuordnung" in q_type:
        items = data.get("items", [])
        match_opts = data.get("matchOptions", [])
        base += f"Verfuegbare Zuordnungsoptionen: {', '.join(match_opts)}\n"
        base += "Aussagen:\n"
        for i, item in enumerate(items, 1):
            base += f"  {i}. {item.get('statement', '')}\n"

    return base


# ---------- AI query ----------


def normalize_result(question_type, raw):
    """Normalize AI response to match the expected schema regardless of field names."""
    if "error" in raw:
        return raw

    # Gap Select: expect { gaps: [{ gapNumber, answer, explanation }] }
    if "ückentext" in question_type or "Lueckentext" in question_type or question_type == "Gap Select":
        # Model may return "answers" instead of "gaps"
        items = raw.get("gaps") or raw.get("answers") or []
        normalized = []
        for item in items:
            normalized.append({
                "gapNumber": item.get("gapNumber") or item.get("gap_number") or item.get("number", 0),
                "answer": item.get("answer") or item.get("selectedOption") or item.get("selected_option") or item.get("value", ""),
                "explanation": item.get("explanation") or item.get("reasoning") or item.get("reason") or "",
            })
        return {"gaps": normalized}

    # K-Prime: expect { answers: [{ statement, answer, explanation }] }
    if question_type == "K-Prime":
        items = raw.get("answers") or raw.get("items") or raw.get("rows") or []
        normalized = []
        for item in items:
            normalized.append({
                "statement": item.get("statement") or item.get("text") or item.get("description", ""),
                "answer": item.get("answer") or item.get("selectedOption") or item.get("selected_option") or item.get("value") or item.get("selection", ""),
                "explanation": item.get("explanation") or item.get("reasoning") or item.get("reason") or "",
            })
        return {"answers": normalized}

    # Multiple Choice: expect { correctAnswer (int), explanation, alternatives }
    if question_type == "Multiple Choice":
        ca = raw.get("correctAnswer") or raw.get("correct_answer") or raw.get("correct") or raw.get("answer") or 0
        return {
            "correctAnswer": int(ca) if not isinstance(ca, int) else ca,
            "explanation": raw.get("explanation") or raw.get("reasoning") or raw.get("reason", ""),
            "alternatives": raw.get("alternatives") or raw.get("wrong_answers") or [],
        }

    # Match: expect { matches: [{ statement, answer, explanation }] }
    if "Zuordnung" in question_type or question_type == "Match":
        items = raw.get("matches") or raw.get("answers") or raw.get("items") or []
        normalized = []
        for item in items:
            normalized.append({
                "statement": item.get("statement") or item.get("text") or item.get("description", ""),
                "answer": item.get("answer") or item.get("selectedOption") or item.get("selected_option") or item.get("match") or item.get("value", ""),
                "explanation": item.get("explanation") or item.get("reasoning") or item.get("reason") or "",
            })
        return {"matches": normalized}

    return raw


def extract_json_from_response(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    brace_match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass
    return {"error": "Could not extract JSON from response", "raw": text}


def query_ai_structured(question_data):
    load_env()
    provider_id, model = load_config()
    provider = PROVIDERS.get(provider_id, PROVIDERS[DEFAULT_PROVIDER])

    api_key = "not-needed"
    if provider["needs_api_key"]:
        api_key = os.environ.get(provider["env_key"])
        print(f"[debug] API key loaded: {'yes (' + api_key[:8] + '...)' if api_key else 'NO'}")
        if not api_key:
            return {"error": f"Missing API key: {provider['env_key']}"}

    client = OpenAI(api_key=api_key, base_url=provider["base_url"])

    context = get_context()
    q_type = question_data.get("type", "")
    prompt = build_prompt(question_data)

    system_prompt = (
        "You are an expert tutor for Swiss ABU (Allgemeinbildender Unterricht). "
        "Answer exam questions accurately based on Swiss law and insurance systems. "
        "Respond in German. You MUST respond with valid JSON matching the requested schema."
    )

    schema = get_schema_for_type(q_type)
    use_structured = provider.get("supports_structured_output", False) and schema is not None

    # For local models, include the expected schema in the prompt
    schema_hint = ""
    if not use_structured and schema:
        schema_hint = (
            f"\n\nRespond ONLY with valid JSON using EXACTLY these field names:\n"
            f"{json.dumps(schema['json_schema']['schema'], indent=2, ensure_ascii=False)}\n"
            f"Do NOT use any other field names. Do NOT wrap in markdown code blocks."
        )

    try:
        kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt + schema_hint},
                {
                    "role": "user",
                    "content": f"{prompt}\n\n<context>\n{context}\n</context>",
                },
            ],
        }

        if use_structured:
            kwargs["response_format"] = schema

        response = client.chat.completions.create(**kwargs)
        content = response.choices[0].message.content.strip()

        if use_structured:
            raw = json.loads(content)
        else:
            raw = extract_json_from_response(content)

        print(f"Raw AI response for {q_type}: {json.dumps(raw, ensure_ascii=False)[:500]}")
        result = normalize_result(q_type, raw)
        print(f"Normalized result: {json.dumps(result, ensure_ascii=False)[:500]}")
        return result

    except json.JSONDecodeError:
        return {"error": "AI returned invalid JSON", "raw": content}
    except Exception as e:
        return {"error": str(e)}


# ---------- HTTP handler ----------


class SolveHandler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == "/solve":
            self._handle_solve()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_solve(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            question_data = json.loads(body)
        except (json.JSONDecodeError, ValueError) as e:
            self._send_json({"error": f"Invalid JSON: {str(e)}"}, 400)
            return

        print(f"Solving: {question_data.get('type', '?')} — {question_data.get('qNo', '?')}")
        result = query_ai_structured(question_data)

        status = 200 if "error" not in result else 500
        self._send_json(result, status)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[server] {args[0] if args else ''}")


# ---------- Main ----------


def main():
    load_env()
    provider_id, model = load_config()
    provider = PROVIDERS.get(provider_id, PROVIDERS[DEFAULT_PROVIDER])
    print(f"Server starting on http://localhost:{PORT}")
    print(f"Provider: {provider['name']} ({provider_id})")
    print(f"Model: {model}")
    if not provider["needs_api_key"]:
        print("(no API key needed for this provider)")
    print("Config is read from .server_config.json on each request.")
    print("Run main.py to change provider/model, then the server picks it up automatically.")
    server = HTTPServer(("127.0.0.1", PORT), SolveHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
