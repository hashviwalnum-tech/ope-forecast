"""
Feedback endpoint — delivers an in-app message to hashvi2906@gmail.com by SMTP
(Python stdlib smtplib, no extra dependency).

This is the app's ONLY outbound email. Everything a user receives — signup
confirmation, password recovery, email-change — is sent by Supabase through the
SMTP server configured in its own dashboard, not from here. The two are wholly
separate: Supabase never reads these variables, and this never reads Supabase's.
Pointing both at the same provider is a good idea (see docs/EMAIL.md) but it is
two pieces of configuration either way, and forgetting one leaves that half
silently dead.

Required env vars on the backend host (Render):
  FEEDBACK_FROM_EMAIL    — the address to send from
  FEEDBACK_FROM_PASSWORD — its SMTP password

Optional, to use something other than Gmail:
  FEEDBACK_SMTP_HOST     — default smtp.gmail.com
  FEEDBACK_SMTP_PORT     — default 587 (STARTTLS)

The default is Gmail with an App Password, which works but is the weakest link
here: Google expires App Passwords, disables them when account settings change,
and rate-limits programmatic sending. A transactional provider (Resend, Brevo)
is steadier, and with the host/port above it is a configuration change rather
than a code change.

Authentication: caller must be a logged-in user (get_current_user).
"""
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user

log = logging.getLogger(__name__)

FEEDBACK_TO = "hashvi2906@gmail.com"

DEFAULT_SMTP_HOST = "smtp.gmail.com"
DEFAULT_SMTP_PORT = 587

router = APIRouter(prefix="/feedback", tags=["Feedback"])


class FeedbackCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    business_name: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=2000)


class FeedbackResponse(BaseModel):
    ok: bool


@router.post("", response_model=FeedbackResponse, status_code=200)
def submit_feedback(
    body: FeedbackCreate,
    _user_id: str = Depends(get_current_user),
) -> FeedbackResponse:
    from_email = os.environ.get("FEEDBACK_FROM_EMAIL", "")
    from_password = os.environ.get("FEEDBACK_FROM_PASSWORD", "")

    if not from_email or not from_password:
        log.error(
            "Feedback email not configured — set FEEDBACK_FROM_EMAIL and "
            "FEEDBACK_FROM_PASSWORD in environment variables"
        )
        raise HTTPException(
            status_code=503,
            detail="Feedback is not configured on this server yet. Please contact us directly.",
        )

    subject = f"Ope Feedback — {body.name} ({body.business_name})"
    text_body = (
        f"Name: {body.name}\n"
        f"Business: {body.business_name}\n\n"
        f"Message:\n{body.message}\n"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = FEEDBACK_TO
    msg["Reply-To"] = from_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))

    host = os.environ.get("FEEDBACK_SMTP_HOST") or DEFAULT_SMTP_HOST
    try:
        port = int(os.environ.get("FEEDBACK_SMTP_PORT") or DEFAULT_SMTP_PORT)
    except ValueError:
        log.error("FEEDBACK_SMTP_PORT is not a number; falling back to %s",
                  DEFAULT_SMTP_PORT)
        port = DEFAULT_SMTP_PORT

    try:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(from_email, from_password)
            smtp.sendmail(from_email, FEEDBACK_TO, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        log.error("Feedback SMTP authentication failed at %s:%s — check "
                  "FEEDBACK_FROM_EMAIL and FEEDBACK_FROM_PASSWORD", host, port)
        raise HTTPException(
            status_code=503,
            detail="Could not send feedback — please try again later.",
        )
    except Exception as exc:
        log.error("Failed to send feedback email via %s:%s: %s", host, port, exc)
        raise HTTPException(
            status_code=503,
            detail="Could not send feedback — please try again later.",
        )

    return FeedbackResponse(ok=True)
