import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "concursos.db"


def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS concursos (
            id              TEXT PRIMARY KEY,
            empresa         TEXT,
            nif             TEXT,
            juzgado         TEXT,
            ciudad          TEXT,
            provincia       TEXT,
            ccaa            TEXT,
            fecha_pub       TEXT,
            tipo_concurso   TEXT,
            administrador   TEXT,
            titulo          TEXT,
            texto           TEXT,
            url_html        TEXT,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scrape_log (
            date        TEXT PRIMARY KEY,
            n_items     INTEGER,
            scraped_at  TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def is_date_scraped(date_str: str) -> bool:
    if not DB_PATH.exists():
        return False
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT 1 FROM scrape_log WHERE date = ?", (date_str,)).fetchone()
    conn.close()
    return row is not None


def upsert_concurso(data: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        INSERT OR IGNORE INTO concursos
            (id, empresa, nif, juzgado, ciudad, provincia, ccaa,
             fecha_pub, tipo_concurso, administrador, titulo, texto, url_html)
        VALUES
            (:id, :empresa, :nif, :juzgado, :ciudad, :provincia, :ccaa,
             :fecha_pub, :tipo_concurso, :administrador, :titulo, :texto, :url_html)
        """,
        data,
    )
    conn.commit()
    conn.close()


def log_scrape(date_str: str, n_items: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO scrape_log (date, n_items) VALUES (?, ?)",
        (date_str, n_items),
    )
    conn.commit()
    conn.close()


def get_all_concursos() -> list[dict]:
    if not DB_PATH.exists():
        return []
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM concursos ORDER BY fecha_pub DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_db_stats() -> dict:
    if not DB_PATH.exists():
        return {"total": 0, "oldest": None, "newest": None}
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT COUNT(*) AS total, MIN(fecha_pub) AS oldest, MAX(fecha_pub) AS newest FROM concursos"
    ).fetchone()
    conn.close()
    return {"total": row[0], "oldest": row[1], "newest": row[2]}
