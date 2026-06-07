import logging
import os
from contextlib import asynccontextmanager

import sentry_sdk
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration

_sentry_dsn = os.environ.get("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        integrations=[StarletteIntegration(), FastApiIntegration()],
    )

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _origins.split(",")]

from app.db import engine
from app.models import Base
from app.api import businesses, day_records, orders, products, sale_events, sales, periods, analytics, recurring_patterns, regulars
from app.api import telegram as telegram_api
from app.api import bot as bot_api


def _migrate_sqlite_products(eng) -> None:
    """Add new optional columns to the products table if they don't exist yet."""
    from sqlalchemy import inspect, text
    inspector = inspect(eng)
    if "products" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("products")}
    with eng.connect() as conn:
        if "storage_capacity" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN storage_capacity REAL"))
        if "shelf_life_days" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN shelf_life_days INTEGER"))
        if "unit_mode" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN unit_mode TEXT DEFAULT 'whole'"))
        if "price" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN price REAL"))
        if "service_time_minutes" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN service_time_minutes REAL"))
        conn.commit()


def _migrate_sqlite_day_records(eng) -> None:
    """Add undo columns to day_records if they don't exist yet."""
    from sqlalchemy import inspect, text
    inspector = inspect(eng)
    if "day_records" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("day_records")}
    with eng.connect() as conn:
        if "prev_customers" not in existing:
            conn.execute(text("ALTER TABLE day_records ADD COLUMN prev_customers INTEGER"))
        if "prev_notes" not in existing:
            conn.execute(text("ALTER TABLE day_records ADD COLUMN prev_notes TEXT"))
        conn.commit()


def _migrate_sqlite_products_v2(eng) -> None:
    """Add created_at column to products if it doesn't exist yet."""
    from sqlalchemy import inspect, text
    inspector = inspect(eng)
    if "products" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("products")}
    with eng.connect() as conn:
        if "created_at" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN created_at TIMESTAMP"))
        conn.commit()


def _migrate_sqlite_telegram_links(eng) -> None:
    """Create telegram_links table columns if the table already exists without them."""
    from sqlalchemy import inspect, text
    inspector = inspect(eng)
    if "telegram_links" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("telegram_links")}
    with eng.connect() as conn:
        if "link_code" not in existing:
            conn.execute(text("ALTER TABLE telegram_links ADD COLUMN link_code TEXT"))
        if "link_code_expires_at" not in existing:
            conn.execute(text("ALTER TABLE telegram_links ADD COLUMN link_code_expires_at TIMESTAMP"))
        conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    _migrate_sqlite_products(engine)
    _migrate_sqlite_products_v2(engine)
    _migrate_sqlite_day_records(engine)
    _migrate_sqlite_telegram_links(engine)
    yield


app = FastAPI(title="Ops Forecast API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

_log = logging.getLogger(__name__)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Returning a response here (rather than re-raising) keeps the response
    # flowing back through CORSMiddleware so CORS headers are included.
    # Without this, ServerErrorMiddleware intercepts the exception before
    # CORSMiddleware can add headers, making every backend crash look like a
    # CORS error in the browser.
    _log.exception("Unhandled exception: %s %s", request.method, request.url)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.include_router(businesses.router)
app.include_router(day_records.router)
app.include_router(orders.router)
app.include_router(products.router)
app.include_router(sale_events.router)
app.include_router(sales.router)
app.include_router(periods.router)
app.include_router(recurring_patterns.router)
app.include_router(regulars.router)
app.include_router(analytics.router)
app.include_router(telegram_api.router)
app.include_router(bot_api.router)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok"}
