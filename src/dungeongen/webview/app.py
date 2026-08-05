"""HTTP microservice and service-owned editor for Dungeongen."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, redirect, request, send_from_directory

from .project import (
    CANVAS_PADDING_CELLS,
    DEFAULT_GRID_SIZE,
    MAX_PROJECT_BYTES,
    ProjectValidationError,
    default_project,
    edit_project,
    generate_project,
    parse_project_bytes,
    checkpoint_project,
    project_bytes,
    render_edited_project,
    render_project_jpeg,
)

EDITOR_ROOT = Path(__file__).with_name("editor")
SERVICE_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config.json"
LOCALE_PATTERN = re.compile(r"^[a-z]{2}(?:-[A-Z]{2})?$")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
DEFAULT_COLOR_APPLY_DELAY_MS = 350
DEFAULT_CANONICAL_RENDER_DELAY_MS = 10_000
DEFAULT_PREVIEW_SIZE_PIXELS = 48
DEFAULT_WORKING_COPY_IDLE_SAVE_MS = 15_000
DEFAULT_WORKING_COPY_INTERVAL_MS = 300_000
DEFAULT_THEME_SAVE_TIMEOUT_MS = 20_000

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_PROJECT_BYTES + 512 * 1024
_CAPABILITY_TTL_SECONDS = 60 * 60
_CAPABILITY_SECRET = secrets.token_bytes(32)


def _json_error(code: str, status: int) -> tuple[Response, int]:
    return jsonify({"success": False, "error": code}), status


def _service_config() -> dict[str, Any]:
    candidates = (SERVICE_CONFIG_PATH, Path.cwd() / "config.json")
    for path in candidates:
        if not path.is_file():
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            return value
    return {}


def _logging_enabled(config: dict[str, Any], key: str) -> bool:
    logging_config = config.get("logging")
    return isinstance(logging_config, dict) and logging_config.get(key) is True


def _public_editor_config() -> dict[str, int | bool]:
    value = _service_config()
    raw_delay = value.get("colorApplyDelayMs")
    if isinstance(raw_delay, bool) or not isinstance(raw_delay, (int, float)):
        raw_delay = DEFAULT_COLOR_APPLY_DELAY_MS
    raw_render_delay = value.get("canonicalRenderDelayMs")
    if isinstance(raw_render_delay, bool) or not isinstance(raw_render_delay, (int, float)):
        raw_render_delay = DEFAULT_CANONICAL_RENDER_DELAY_MS
    raw_preview_size = value.get("previewSizePixels")
    if isinstance(raw_preview_size, bool) or not isinstance(raw_preview_size, (int, float)):
        raw_preview_size = DEFAULT_PREVIEW_SIZE_PIXELS
    raw_idle_save = value.get("workingCopyIdleSaveMs")
    if isinstance(raw_idle_save, bool) or not isinstance(raw_idle_save, (int, float)):
        raw_idle_save = DEFAULT_WORKING_COPY_IDLE_SAVE_MS
    raw_interval_save = value.get("workingCopyIntervalMs")
    if isinstance(raw_interval_save, bool) or not isinstance(raw_interval_save, (int, float)):
        raw_interval_save = DEFAULT_WORKING_COPY_INTERVAL_MS
    raw_theme_save_timeout = value.get("themeSaveTimeoutMs")
    if isinstance(raw_theme_save_timeout, bool) or not isinstance(raw_theme_save_timeout, (int, float)):
        raw_theme_save_timeout = DEFAULT_THEME_SAVE_TIMEOUT_MS
    return {
        "colorApplyDelayMs": max(0, min(5000, int(raw_delay))),
        "canonicalRenderDelayMs": max(0, min(60_000, int(raw_render_delay))),
        "previewSizePixels": max(32, min(256, int(raw_preview_size))),
        "workingCopyIdleSaveMs": max(1000, min(300_000, int(raw_idle_save))),
        "workingCopyIntervalMs": max(10_000, min(1_800_000, int(raw_interval_save))),
        "themeSaveTimeoutMs": max(5_000, min(120_000, int(raw_theme_save_timeout))),
        "gridSizePixels": DEFAULT_GRID_SIZE,
        "canvasPaddingCells": CANVAS_PADDING_CELLS,
        "editTimeLogging": _logging_enabled(value, "EDIT_TIME_LOGGING"),
        "themeSaveLogging": _logging_enabled(value, "THEME_SAVE_LOGGING"),
    }


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


@app.get("/dungeon-editor/encoder-worker.js")
def encoder_worker_js() -> Response:
    return _editor_response("encoder-worker.js", "application/javascript; charset=utf-8")


@app.get("/dungeon-editor/loadscreen_small.png")
def editor_loadscreen_image() -> Response:
    return _editor_response("loadscreen_small.png", "image/png")


@app.get("/dungeon-editor/palettes.json")
def editor_palettes() -> Response:
    return _editor_response("palettes.json", "application/json; charset=utf-8")


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
        defer_render = isinstance(data, dict) and data.get("deferRender") is True
        project = generate_project(data, render_svg=not defer_render)
    except ProjectValidationError as error:
        return _json_error(str(error), 400)
    except Exception:
        app.logger.exception("Dungeongen generation failed")
        return _json_error("generationFailed", 500)
    return jsonify({"success": True, "project": project})


@app.post("/dungeon-editor/api/edit")
@app.post("/api/dungeongen/editor/edit")
def edit() -> tuple[Response, int] | Response:
    provided_request_id = request.headers.get("X-Dungeongen-Request-Id", "")
    request_id = (
        provided_request_id
        if REQUEST_ID_PATTERN.fullmatch(provided_request_id)
        else secrets.token_hex(4)
    )
    service_config = _service_config()
    editing_logging = _logging_enabled(service_config, "EDITING_LOGGING")
    edit_time_logging = _logging_enabled(service_config, "EDIT_TIME_LOGGING")
    if (editing_logging or edit_time_logging) and app.logger.getEffectiveLevel() > logging.INFO:
        app.logger.setLevel(logging.INFO)
    if not _has_valid_capability():
        if editing_logging:
            app.logger.info("[EDITING] rejected id=%s path=%s reason=unauthorized", request_id, request.path)
        return _json_error("unauthorized", 401)
    request_started_at = time.perf_counter()
    decode_started_at = time.perf_counter()
    data = request.get_json(silent=True)
    decode_elapsed_ms = (time.perf_counter() - decode_started_at) * 1000
    operation = data.get("operation") if isinstance(data, dict) else None
    operation_type = operation.get("type") if isinstance(operation, dict) else "invalid"
    started_at = request_started_at

    timing_entries: list[tuple[str, float]] = []

    def record_timing(stage: str, elapsed_ms: float) -> None:
        timing_entries.append((stage, elapsed_ms))

    def flush_timings() -> None:
        for stage, elapsed_ms in timing_entries:
            app.logger.info(
                "[EDIT-TIME] id=%s operation=%s stage=%s elapsed_ms=%.2f",
                request_id, operation_type, stage, elapsed_ms,
            )

    timing = record_timing if edit_time_logging else None
    if timing is not None:
        timing("request_decode", decode_elapsed_ms)
    if editing_logging:
        app.logger.info(
            "[EDITING] started id=%s path=%s operation=%s bytes=%s",
            request_id, request.path, operation_type, request.content_length or 0,
        )
    try:
        project = edit_project(data, timing=timing, validate_size=False)
        encoded_project = project_bytes(project, timing=timing, normalize=False)
    except ProjectValidationError as error:
        if editing_logging:
            app.logger.info(
                "[EDITING] rejected id=%s operation=%s error=%s elapsed_ms=%d",
                request_id, operation_type, str(error), int((time.perf_counter() - started_at) * 1000),
            )
        if timing is not None:
            timing("request_handler_total", (time.perf_counter() - request_started_at) * 1000)
            flush_timings()
        return _json_error(str(error), 400)
    except Exception:
        app.logger.exception("[EDITING] failed id=%s operation=%s", request_id, operation_type)
        if timing is not None:
            timing("request_handler_total", (time.perf_counter() - request_started_at) * 1000)
            flush_timings()
        return _json_error("editFailed", 500)
    if editing_logging:
        structure = project.get("structure") or {}
        app.logger.info(
            "[EDITING] completed id=%s operation=%s cells=%d rooms=%d elapsed_ms=%d",
            request_id, operation_type, len(structure.get("floorCells", [])),
            len(structure.get("rooms", [])), int((time.perf_counter() - started_at) * 1000),
        )
    response_started_at = time.perf_counter()
    response = Response(
        b'{"success":true,"project":' + encoded_project + b"}",
        mimetype="application/json",
    )
    if timing is not None:
        timing("response_serialization", (time.perf_counter() - response_started_at) * 1000)
        timing("request_handler_total", (time.perf_counter() - request_started_at) * 1000)
        flush_timings()
    return response


@app.post("/dungeon-editor/api/render")
@app.post("/api/dungeongen/editor/render")
def render_edit() -> tuple[Response, int] | Response:
    provided_request_id = request.headers.get("X-Dungeongen-Request-Id", "")
    request_id = provided_request_id if REQUEST_ID_PATTERN.fullmatch(provided_request_id) else secrets.token_hex(4)
    service_config = _service_config()
    editing_logging = _logging_enabled(service_config, "EDITING_LOGGING")
    edit_time_logging = _logging_enabled(service_config, "EDIT_TIME_LOGGING")
    if (editing_logging or edit_time_logging) and app.logger.getEffectiveLevel() > logging.INFO:
        app.logger.setLevel(logging.INFO)
    if not _has_valid_capability():
        return _json_error("unauthorized", 401)

    request_started_at = time.perf_counter()
    decode_started_at = time.perf_counter()
    data = request.get_json(silent=True)
    decode_elapsed_ms = (time.perf_counter() - decode_started_at) * 1000
    timing_entries: list[tuple[str, float]] = []

    def record_timing(stage: str, elapsed_ms: float) -> None:
        timing_entries.append((stage, elapsed_ms))

    def flush_timings() -> None:
        for stage, elapsed_ms in timing_entries:
            app.logger.info(
                "[EDIT-TIME] id=%s operation=render stage=%s elapsed_ms=%.2f",
                request_id, stage, elapsed_ms,
            )

    timing = record_timing if edit_time_logging else None
    if timing is not None:
        timing("request_decode", decode_elapsed_ms)

    if editing_logging:
        app.logger.info(
            "[EDITING] started id=%s path=%s operation=render bytes=%s",
            request_id, request.path, request.content_length or 0,
        )
    try:
        project = render_edited_project(data, timing=timing, validate_size=False)
        encoded_project = project_bytes(project, timing=timing, normalize=False)
    except ProjectValidationError as error:
        if editing_logging:
            app.logger.info(
                "[EDITING] rejected id=%s operation=render error=%s elapsed_ms=%d",
                request_id, str(error), int((time.perf_counter() - request_started_at) * 1000),
            )
        if timing is not None:
            timing("request_handler_total", (time.perf_counter() - request_started_at) * 1000)
            flush_timings()
        return _json_error(str(error), 400)
    except Exception:
        app.logger.exception("[EDITING] failed id=%s operation=render", request_id)
        if timing is not None:
            timing("request_handler_total", (time.perf_counter() - request_started_at) * 1000)
            flush_timings()
        return _json_error("editFailed", 500)

    response = Response(
        b'{"success":true,"project":' + encoded_project + b"}",
        mimetype="application/json",
    )
    total_ms = (time.perf_counter() - request_started_at) * 1000
    if timing is not None:
        timing("request_handler_total", total_ms)
        flush_timings()
    if editing_logging:
        app.logger.info("[EDITING] completed id=%s operation=render elapsed_ms=%d", request_id, int(total_ms))
    return response


@app.post("/dungeon-editor/api/checkpoint")
@app.post("/api/dungeongen/editor/checkpoint")
def checkpoint_edit() -> tuple[Response, int] | Response:
    if not _has_valid_capability():
        return _json_error("unauthorized", 401)
    try:
        project = checkpoint_project(request.get_json(silent=True), validate_size=False)
        encoded_project = project_bytes(project, normalize=False)
    except ProjectValidationError as error:
        return _json_error(str(error), 400)
    except Exception:
        app.logger.exception("[EDITING] checkpoint failed")
        return _json_error("editFailed", 500)
    return Response(
        b'{"success":true,"project":' + encoded_project + b"}",
        mimetype="application/json",
    )


@app.post("/api/dungeongen/projects/default")
def create_default_project() -> Response:
    return Response(project_bytes(default_project()), mimetype="application/json")


@app.post("/api/dungeongen/projects/export")
def export_project() -> tuple[Response, int] | Response:
    try:
        project = parse_project_bytes(request.get_data(cache=False))
        # Durable editor saves intentionally omit renderSvg to keep project files compact.
        # JPG rendering is based on layout/structure and validates those fields itself.
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
    config = _service_config()
    app.run(host="0.0.0.0", port=int(config.get("port", 8094)), threaded=True, use_reloader=False)
