"""Errors an owner reads, carrying a code a client can translate.

FastAPI's own HTTPException carries only `detail`, an English sentence. A
CodedHTTPException adds `code` and `params` to the JSON body beside it, so a
client can say the same thing in the owner's language and fall back to
`detail` for a code it does not know. Registered in main.py.
"""
from __future__ import annotations

from fastapi import HTTPException


class CodedHTTPException(HTTPException):
    def __init__(self, status_code: int, detail: str, code: str,
                 params: dict | None = None) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
        self.params = params or {}


def rule_http(status_code: int, err: ValueError) -> HTTPException:
    """The HTTP form of a rule error from the engine, keeping its code if it has one."""
    code = getattr(err, "code", None)
    if code:
        return CodedHTTPException(status_code, str(err), code, getattr(err, "params", {}))
    return HTTPException(status_code=status_code, detail=str(err))
