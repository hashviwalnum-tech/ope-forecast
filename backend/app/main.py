import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _origins.split(",")]

from app.db import engine
from app.models import Base
from app.api import businesses, day_records, products, sale_events, sales, periods, analytics


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
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
