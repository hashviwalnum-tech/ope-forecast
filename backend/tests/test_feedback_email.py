"""The feedback form is the only channel a beta user has for saying something is broken.

It had no test at all, and on the live deployment it answers 503 because the
Render service lost `FEEDBACK_FROM_EMAIL` and `FEEDBACK_FROM_PASSWORD` when it
was recreated. Nothing surfaced that: the form fails for the user and nobody
else finds out.

Nothing here sends mail. `smtplib.SMTP` is replaced by a stand-in that records
where it was told to connect and what it was asked to send, which is enough to
pin the two things worth pinning: that an unconfigured server refuses rather
than pretending, and that the host and port are configuration rather than
Gmail forever.
"""
from __future__ import annotations

import smtplib
from email import message_from_string

import pytest
from fastapi.testclient import TestClient

from app.api import feedback as feedback_api
from app.api.deps import get_current_user
from app.main import app

BODY = {"name": "Dana", "business_name": "Corner Cafe", "message": "The chart is blank."}


@pytest.fixture()
def client():
    app.dependency_overrides[get_current_user] = lambda: "feedback-test-user"
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


class FakeSMTP:
    """Stands in for a mail server. Records, never connects."""

    calls: list[dict] = []

    def __init__(self, host, port, timeout=None):
        self.record = {"host": host, "port": port, "login": None, "sent": None}
        FakeSMTP.calls.append(self.record)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        pass

    def starttls(self):
        pass

    def login(self, user, password):
        self.record["login"] = user

    def sendmail(self, sender, to, message):
        self.record["sent"] = (sender, to, message)


@pytest.fixture()
def fake_smtp(monkeypatch):
    FakeSMTP.calls = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


def _configure(monkeypatch, **extra):
    monkeypatch.setenv("FEEDBACK_FROM_EMAIL", "ope.noreply@example.com")
    monkeypatch.setenv("FEEDBACK_FROM_PASSWORD", "an-smtp-password")
    for k in ("FEEDBACK_SMTP_HOST", "FEEDBACK_SMTP_PORT"):
        monkeypatch.delenv(k, raising=False)
    for k, v in extra.items():
        monkeypatch.setenv(k, v)


def test_an_unconfigured_server_refuses_rather_than_pretending(client, monkeypatch, fake_smtp):
    monkeypatch.delenv("FEEDBACK_FROM_EMAIL", raising=False)
    monkeypatch.delenv("FEEDBACK_FROM_PASSWORD", raising=False)
    res = client.post("/feedback", json=BODY)
    assert res.status_code == 503
    assert fake_smtp.calls == [], "it must not even open a connection"


def test_feedback_reaches_the_owner(client, monkeypatch, fake_smtp):
    _configure(monkeypatch)
    assert client.post("/feedback", json=BODY).status_code == 200

    (call,) = fake_smtp.calls
    assert (call["host"], call["port"]) == ("smtp.gmail.com", 587)
    sender, to, raw = call["sent"]
    assert to == feedback_api.FEEDBACK_TO

    # Decoded, not searched raw: the body is base64 so that non-Latin names and
    # messages survive, and a substring check on the wire format would pass on
    # an empty mail as readily as a full one.
    parsed = message_from_string(raw)
    text = "".join(
        part.get_payload(decode=True).decode("utf-8")
        for part in parsed.walk() if part.get_content_type() == "text/plain"
    )
    for fragment in ("Dana", "Corner Cafe", "The chart is blank."):
        assert fragment in text


def test_the_mail_server_is_configuration_not_gmail_forever(client, monkeypatch, fake_smtp):
    """So moving to a transactional provider is env vars, not a code change."""
    _configure(monkeypatch, FEEDBACK_SMTP_HOST="smtp.resend.com",
               FEEDBACK_SMTP_PORT="587")
    assert client.post("/feedback", json=BODY).status_code == 200
    (call,) = fake_smtp.calls
    assert (call["host"], call["port"]) == ("smtp.resend.com", 587)


def test_a_nonsense_port_falls_back_instead_of_crashing(client, monkeypatch, fake_smtp):
    _configure(monkeypatch, FEEDBACK_SMTP_PORT="not-a-number")
    assert client.post("/feedback", json=BODY).status_code == 200
    assert fake_smtp.calls[0]["port"] == 587


def test_a_server_that_rejects_the_password_is_reported_as_a_failure(
        client, monkeypatch, fake_smtp):
    _configure(monkeypatch)

    def refuse(self, user, password):
        raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

    monkeypatch.setattr(FakeSMTP, "login", refuse)
    res = client.post("/feedback", json=BODY)
    assert res.status_code == 503
    # The user is told it failed. What failed is for the log, not for them.
    assert "password" not in res.json()["detail"].lower()


def test_feedback_requires_a_signed_in_user():
    """An open form is a spam relay pointed at the owner's inbox."""
    app.dependency_overrides.pop(get_current_user, None)
    assert TestClient(app).post("/feedback", json=BODY).status_code == 401
