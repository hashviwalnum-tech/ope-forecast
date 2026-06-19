"""
Feedback endpoint — delivers an in-app message to hashvi2906@gmail.com
via Gmail SMTP (Python stdlib smtplib, no extra dependency).

Required env vars on the backend host (Render):
  FEEDBACK_FROM_EMAIL    — the Gmail address used to send (e.g. ope.noreply@gmail.com)
  FEEDBACK_FROM_PASSWORD — a Gmail App Password for that account
                           (Account → Security → 2-Step Verification → App passwords)

How it reaches the inbox:
  smtplib connects to smtp.gmail.com:587, upgrades to TLS with STARTTLS,
  authenticates with the App Password, and sends a plain-text email.
  The message arrives in hashvi2906@gmail.com's inbox with the owner's name,
  business name and their message in the body.

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

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(from_email, from_password)
            smtp.sendmail(from_email, FEEDBACK_TO, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        log.error("Feedback SMTP authentication failed — check FEEDBACK_FROM_PASSWORD")
        raise HTTPException(
            status_code=503,
            detail="Could not send feedback — please try again later.",
        )
    except Exception as exc:
        log.error("Failed to send feedback email: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Could not send feedback — please try again later.",
        )

    return FeedbackResponse(ok=True)
