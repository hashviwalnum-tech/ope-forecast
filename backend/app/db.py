import os
from collections.abc import Generator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

def with_explicit_driver(url: str) -> str:
    """Name the PostgreSQL driver rather than inherit SQLAlchemy's default.

    SQLAlchemy 2.1 changed the default for a bare ``postgresql://`` from
    psycopg2 to psycopg 3, which is not installed, and the deploy died on
    startup with ``No module named 'psycopg'``.  Saying psycopg2 here means the
    URL in Render can stay the plain one Supabase hands out.  ``postgres://``
    (Heroku-style) is accepted for the same reason.  A URL that already names
    a driver, or is not PostgreSQL, is left alone.
    """
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url


DATABASE_URL = with_explicit_driver(os.environ["DATABASE_URL"])

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
