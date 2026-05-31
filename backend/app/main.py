import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _origins.split(",")]

from app.db import engine
from app.models import Base
from app.api import businesses, day_records, products, sale_events, sales, periods, analytics


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
        conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    _migrate_sqlite_products(engine)
    yield


app = FastAPI(title="Ops Forecast API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(businesses.router)
app.include_router(day_records.router)
app.include_router(products.router)
app.include_router(sale_events.router)
app.include_router(sales.router)
app.include_router(periods.router)
app.include_router(analytics.router)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok"}
