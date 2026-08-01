"""Shared webview project exceptions without renderer imports."""


class ProjectValidationError(ValueError):
    """Raised when untrusted project or editor input is invalid."""
