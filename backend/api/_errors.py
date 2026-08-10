"""Shared HTTP error helpers.

The project wraps every FastAPI error in a `{error, code, message, detail}`
envelope. This helper keeps that contract in one place so callers don't
copy-paste the 4-key dict literal.
"""
from fastapi import HTTPException


def http_error(status_code: int, code: str, message: str, **detail_fields):
    """Build a `HTTPException` carrying the project's standard envelope.

    Extra keyword arguments become the `detail` dict so callers can pass
    context like `section=payload.section` without nesting literals.

    Example:
        raise http_error(400, "VALIDATION_ERROR", "section 必须是 ...",
                         section=payload.section)
    """
    detail = {"error": True, "code": code, "message": message, "detail": detail_fields}
    return HTTPException(status_code=status_code, detail=detail)
