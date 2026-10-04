"""The TLS context for every outbound call the backend makes to Supabase.

Both callers used to switch certificate checking off entirely, with the note
that the signing keys are public anyway. That reasoning does not hold: what TLS
protects here is not secrecy but *authenticity*. Anyone able to sit between this
server and Supabase could have served their own signing key — and from then on
forged a valid login for any account — or read the service-role key, which
bypasses every row-level security policy, off the account-deletion call.

So certificates are verified. The one escape hatch is for a development machine
behind a network that intercepts TLS (the original reason for switching it off):
OPE_INSECURE_TLS=1 skips verification, and is refused outright on Render.
"""
from __future__ import annotations

import logging
import os
import ssl

log = logging.getLogger(__name__)


def supabase_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if os.environ.get("OPE_INSECURE_TLS") == "1":
        if os.environ.get("RENDER"):
            log.error("OPE_INSECURE_TLS is set on Render and has been ignored — "
                      "certificate checks stay on in a deployment.")
            return ctx
        log.warning("OPE_INSECURE_TLS=1: Supabase certificates are NOT verified. "
                    "Development only.")
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx
