"""Web preview for dungeon generation."""

import sys

# Pyodide imports ``dungeongen.webview.project`` for the browser-side editor
# core.  Importing the Flask app from the package initializer would pull the
# server-only Flask dependency into that browser import before ``project`` can
# load.  Keep native/server behaviour unchanged while making the package
# initializer dependency-free on Emscripten.
if sys.platform == "emscripten":
    app = None
else:
    from .app import app

__all__ = ["app"]
