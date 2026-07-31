"""HTTP microservice and service-owned editor for Dungeongen."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, request, send_from_directory

from .project import (
    MAX_PROJECT_BYTES,
    ProjectValidationError,
    default_project,
    generate_project,
    parse_project_bytes,
    project_bytes,
    render_project_jpeg,
)

EDITOR_ROOT = Path(__file__).with_name("editor")
SERVICE_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config.json"
LOCALE_PATTERN = re.compile(r"^[a-z]{2}(?:-[A-Z]{2})?$")
DEFAULT_COLOR_APPLY_DELAY_MS = 350

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_PROJECT_BYTES
_CAPABILITY_TTL_SECONDS = 60 * 60
_CAPABILITY_SECRET = secrets.token_bytes(32)


def _json_error(code: str, status: int) -> tuple[Response, int]:
    return jsonify({"success": False, "error": code}), status


def _public_editor_config() -> dict[str, int]:
    value: object = {}
    if SERVICE_CONFIG_PATH.is_file():
        try:
            value = json.loads(SERVICE_CONFIG_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            value = {}
    raw_delay = value.get("colorApplyDelayMs") if isinstance(value, dict) else None
    if isinstance(raw_delay, bool) or not isinstance(raw_delay, (int, float)):
        raw_delay = DEFAULT_COLOR_APPLY_DELAY_MS
    return {"colorApplyDelayMs": max(0, min(5000, int(raw_delay)))}


def _editor_response(filename: str, mimetype: str) -> Response:
    response = send_from_directory(EDITOR_ROOT, filename, mimetype=mimetype, max_age=0)
    response.headers["Cache-Control"] = "no-store"
    if filename == "index.html":
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' blob: data:; "
            "connect-src 'self'; "
            "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*"
        )
    return response


def _mint_capability() -> str:
    payload = f"{int(time.time()) + _CAPABILITY_TTL_SECONDS}:{secrets.token_urlsafe(18)}".encode("ascii")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    signature = hmac.new(_CAPABILITY_SECRET, encoded.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def _has_valid_capability() -> bool:
    token = request.headers.get("X-Dungeongen-Capability", "")
    if not token or "." not in token:
        return False
    encoded, signature = token.rsplit(".", 1)
    expected = hmac.new(_CAPABILITY_SECRET, encoded.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return False
    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        payload = base64.urlsafe_b64decode(padded.encode("ascii")).decode("ascii")
        expires_at = int(payload.split(":", 1)[0])
    except (ValueError, UnicodeDecodeError):
        return False
    return int(time.time()) < expires_at


@app.after_request
def _security_headers(response: Response) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.get("/health")
def health() -> Response:
    return jsonify({"status": "ok"})


@app.post("/internal/capabilities")
def create_capability() -> Response:
    return jsonify({"capability": _mint_capability(), "expiresInSeconds": _CAPABILITY_TTL_SECONDS})


@app.get("/")
def index() -> Response:
    return redirect("/dungeon-editor", code=302)


@app.get("/dungeon-editor")
def editor() -> Response:
    return _editor_response("index.html", "text/html; charset=utf-8")


@app.get("/dungeon-editor/editor.css")
def editor_css() -> Response:
    return _editor_response("editor.css", "text/css; charset=utf-8")


@app.get("/dungeon-editor/editor.js")
def editor_js() -> Response:
    return _editor_response("editor.js", "application/javascript; charset=utf-8")


@app.get("/dungeon-editor/config.json")
def editor_config() -> Response:
    response = jsonify(_public_editor_config())
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/dungeon-editor/i18n/<locale>.json")
def editor_locale(locale: str) -> Response:
    normalized = locale if LOCALE_PATTERN.fullmatch(locale) else "ru"
    locale_path = EDITOR_ROOT / "i18n" / f"{normalized}.json"
    if not locale_path.is_file():
        locale_path = EDITOR_ROOT / "i18n" / "ru.json"
    response = send_from_directory(
        locale_path.parent,
        locale_path.name,
        mimetype="application/json; charset=utf-8",
        max_age=0,
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/dungeongen/editor/generate")
def generate() -> tuple[Response, int] | Response:
    if not _has_valid_capability():
        return _json_error("unauthorized", 401)
    data = request.get_json(silent=True)
    try:
        project = generate_project(data)
    except ProjectValidationError as error:
        return _json_error(str(error), 400)
    except Exception:
        app.logger.exception("Dungeongen generation failed")
        return _json_error("generationFailed", 500)
    return jsonify({"success": True, "project": project})


@app.post("/api/dungeongen/projects/default")
def create_default_project() -> Response:
    return Response(project_bytes(default_project()), mimetype="application/json")


@app.post("/api/dungeongen/projects/export")
def export_project() -> tuple[Response, int] | Response:
    try:
        project = parse_project_bytes(request.get_data(cache=False))
        if project["renderSvg"] is None:
            raise ProjectValidationError("emptyProject")
        image = render_project_jpeg(project)
    except ProjectValidationError as error:
        return _json_error(str(error), 400)
    except Exception:
        app.logger.exception("Dungeongen JPG export failed")
        return _json_error("exportFailed", 500)
    return Response(
        image,
        mimetype="image/jpeg",
        headers={"Content-Disposition": 'inline; filename="dungeon.jpg"'},
    )


if __name__ == "__main__":
    config = json.loads(SERVICE_CONFIG_PATH.read_text(encoding="utf-8")) if SERVICE_CONFIG_PATH.is_file() else {}
    app.run(host="0.0.0.0", port=int(config.get("port", 5050)), threaded=True, use_reloader=False)
