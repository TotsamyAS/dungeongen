"""Production Gunicorn entry point using service-owned JSON configuration."""

from __future__ import annotations

import json
from pathlib import Path

from gunicorn.app.base import BaseApplication

from .app import app


def load_config() -> dict[str, int]:
    candidates = (Path.cwd() / "config.json", Path(__file__).resolve().parents[3] / "config.json")
    for path in candidates:
        if path.is_file():
            with path.open("r", encoding="utf-8") as source:
                value = json.load(source)
            return {
                "port": int(value.get("port", 5050)),
                "workers": int(value.get("workers", 2)),
                "threads": int(value.get("threads", 2)),
                "timeout": int(value.get("requestTimeoutSeconds", 180)),
            }
    return {"port": 5050, "workers": 2, "threads": 2, "timeout": 180}


class DungeongenApplication(BaseApplication):
    def load_config(self) -> None:
        service = load_config()
        options = {
            "bind": f"0.0.0.0:{service['port']}",
            "workers": service["workers"],
            "threads": service["threads"],
            "timeout": service["timeout"],
            "preload_app": True,
            "accesslog": "-",
            "errorlog": "-",
        }
        for key, value in options.items():
            self.cfg.set(key, value)

    def load(self):
        return app


if __name__ == "__main__":
    DungeongenApplication().run()
