"""Calls to Supabase verify its certificate.

Both of them used to switch verification off: the one that fetches the keys
logins are checked against, and the one that carries the service-role key.
"""
import ssl

from app.tls import supabase_ssl_context


def test_certificates_are_verified_by_default(monkeypatch):
    monkeypatch.delenv("OPE_INSECURE_TLS", raising=False)
    ctx = supabase_ssl_context()
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname


def test_the_development_escape_hatch_is_refused_on_render(monkeypatch):
    monkeypatch.setenv("OPE_INSECURE_TLS", "1")
    monkeypatch.setenv("RENDER", "true")
    ctx = supabase_ssl_context()
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname


def test_the_escape_hatch_works_only_off_render(monkeypatch):
    monkeypatch.setenv("OPE_INSECURE_TLS", "1")
    monkeypatch.delenv("RENDER", raising=False)
    assert supabase_ssl_context().verify_mode == ssl.CERT_NONE


def test_nothing_else_switches_verification_off():
    from pathlib import Path
    app_dir = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        str(p.relative_to(app_dir)) for p in app_dir.rglob("*.py")
        if p.name != "tls.py" and "CERT_NONE" in p.read_text(encoding="utf-8")
    ]
    assert offenders == [], f"certificate checks switched off in: {offenders}"
