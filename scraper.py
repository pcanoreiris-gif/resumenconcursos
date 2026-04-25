"""
BOE scraper for concursos de acreedores.

Fuentes:
  - BOE Sección IV  (Administración de Justicia / Juzgados de lo Mercantil)
  - BOE Suplemento TEJU (Tablón Edictal Judicial Único, desde junio 2021)

API oficial BOE: https://www.boe.es/datosabiertos/api/
"""

import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Callable, Optional

import requests

from database import init_db, is_date_scraped, log_scrape, upsert_concurso

log = logging.getLogger(__name__)

# ── API endpoints ──────────────────────────────────────────────────────────────
BOE_SUMARIO  = "https://www.boe.es/datosabiertos/api/boe/sumario/{date}"
BOE_DOC      = "https://www.boe.es/datosabiertos/api/boe/id/{id}"
HEADERS      = {
    "Accept": "application/xml",
    "User-Agent": "ConcursosDashboard/1.0 (investigacion academica)",
}
DELAY        = 0.6   # seconds between requests

# ── Geography ─────────────────────────────────────────────────────────────────
# Maps city keywords → (provincia, CCAA)
CITY_MAP: dict[str, tuple[str, str]] = {
    "Madrid":               ("Madrid",              "Comunidad de Madrid"),
    "Barcelona":            ("Barcelona",            "Cataluña"),
    "Valencia":             ("Valencia",             "Comunitat Valenciana"),
    "Sevilla":              ("Sevilla",              "Andalucía"),
    "Zaragoza":             ("Zaragoza",             "Aragón"),
    "Málaga":               ("Málaga",               "Andalucía"),
    "Murcia":               ("Murcia",               "Región de Murcia"),
    "Palma":                ("Islas Baleares",       "Islas Baleares"),
    "Las Palmas":           ("Las Palmas",           "Canarias"),
    "Bilbao":               ("Vizcaya",              "País Vasco"),
    "Alicante":             ("Alicante",             "Comunitat Valenciana"),
    "Córdoba":              ("Córdoba",              "Andalucía"),
    "Valladolid":           ("Valladolid",           "Castilla y León"),
    "Vitoria":              ("Álava",                "País Vasco"),
    "Gijón":                ("Asturias",             "Principado de Asturias"),
    "Oviedo":               ("Asturias",             "Principado de Asturias"),
    "Tenerife":             ("Santa Cruz de Tenerife","Canarias"),
    "Santa Cruz":           ("Santa Cruz de Tenerife","Canarias"),
    "Pamplona":             ("Navarra",              "Comunidad Foral de Navarra"),
    "Santander":            ("Cantabria",            "Cantabria"),
    "Logroño":              ("La Rioja",             "La Rioja"),
    "Badajoz":              ("Badajoz",              "Extremadura"),
    "Huelva":               ("Huelva",               "Andalucía"),
    "Almería":              ("Almería",              "Andalucía"),
    "Cádiz":                ("Cádiz",                "Andalucía"),
    "Jaén":                 ("Jaén",                 "Andalucía"),
    "Granada":              ("Granada",              "Andalucía"),
    "Lleida":               ("Lleida",               "Cataluña"),
    "Girona":               ("Girona",               "Cataluña"),
    "Tarragona":            ("Tarragona",            "Cataluña"),
    "Castellón":            ("Castellón",            "Comunitat Valenciana"),
    "Burgos":               ("Burgos",               "Castilla y León"),
    "León":                 ("León",                 "Castilla y León"),
    "Salamanca":            ("Salamanca",            "Castilla y León"),
    "Segovia":              ("Segovia",              "Castilla y León"),
    "Ávila":                ("Ávila",                "Castilla y León"),
    "Cuenca":               ("Cuenca",               "Castilla-La Mancha"),
    "Guadalajara":          ("Guadalajara",          "Castilla-La Mancha"),
    "Toledo":               ("Toledo",               "Castilla-La Mancha"),
    "Albacete":             ("Albacete",             "Castilla-La Mancha"),
    "Ciudad Real":          ("Ciudad Real",          "Castilla-La Mancha"),
    "Huesca":               ("Huesca",               "Aragón"),
    "Teruel":               ("Teruel",               "Aragón"),
    "Cáceres":              ("Cáceres",              "Extremadura"),
    "Mérida":               ("Badajoz",              "Extremadura"),
    "San Sebastián":        ("Guipúzcoa",            "País Vasco"),
    "Donostia":             ("Guipúzcoa",            "País Vasco"),
    "Pontevedra":           ("Pontevedra",           "Galicia"),
    "Vigo":                 ("Pontevedra",           "Galicia"),
    "Ourense":              ("Ourense",              "Galicia"),
    "Lugo":                 ("Lugo",                 "Galicia"),
    "Coruña":               ("A Coruña",             "Galicia"),
    "Palencia":             ("Palencia",             "Castilla y León"),
    "Zamora":               ("Zamora",               "Castilla y León"),
    "Soria":                ("Soria",                "Castilla y León"),
    "Ceuta":                ("Ceuta",                "Ceuta"),
    "Melilla":              ("Melilla",              "Melilla"),
}


def _get_xml(url: str) -> Optional[ET.Element]:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return ET.fromstring(resp.content)
    except Exception as exc:
        log.warning("Error fetching %s: %s", url, exc)
        return None


def _ciudad_from_juzgado(text: str) -> Optional[str]:
    """Extract city name from juzgado text."""
    m = re.search(
        r"Juzgado[^,\n]*?de\s+(?:lo\s+Mercantil[^,\n]*?de\s+)?([A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑÜ]?[a-záéíóúñü]+)*)",
        text,
        re.IGNORECASE,
    )
    return m.group(1).strip() if m else None


def _resolve_city(city: Optional[str]) -> tuple[str, str, str]:
    """Return (ciudad, provincia, ccaa) from a raw city string."""
    if not city:
        return ("Desconocida", "Desconocida", "Desconocida")
    for key, (prov, ccaa) in CITY_MAP.items():
        if key.lower() in city.lower():
            return (key, prov, ccaa)
    return (city, city, "Desconocida")


def _extract_concurso(item_id: str, titulo: str, url_html: str, fecha_pub: str) -> Optional[dict]:
    """Fetch full edicto XML and extract structured concurso data."""
    root = _get_xml(BOE_DOC.format(id=item_id))
    if root is None:
        return None

    # Full text (join all text nodes)
    texto = " ".join(t.strip() for t in root.itertext() if t.strip())

    # ── Empresa ───────────────────────────────────────────────────────────────
    empresa = None
    for pat in [
        r"concurso de acreedores[^a-záéíóúñ]{0,15}a\s+([A-ZÁÉÍÓÚÑÜ][^,.\n]{2,80}?(?:S\.L\.U?\.?|S\.A\.U?\.?|S\.L\b|S\.A\b|SLU|SAU|SL|SA|SOCIEDAD LIMITADA|SOCIEDAD ANÓNIMA))",
        r"(?:deudora?|concursada?)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑÜ][^,.\n]{2,80}?(?:S\.L\.U?\.?|S\.A\.U?\.?|SLU|SAU|SL|SA))",
        r"la\s+mercantil\s+([A-ZÁÉÍÓÚÑÜ][^,.\n]{2,80}?(?:S\.L\.U?\.?|S\.A\.U?\.?|SLU|SAU|SL|SA))",
        r"la\s+empresa\s+([A-ZÁÉÍÓÚÑÜ][^,.\n]{2,80}?(?:S\.L\.U?\.?|S\.A\.U?\.?|SLU|SAU|SL|SA))",
        r"concurso[^a-z]{1,20}a\s+(?:don|doña|d\.|dña\.)\s+([A-ZÁÉÍÓÚÑÜ][^,.\n]{4,60})",
    ]:
        m = re.search(pat, texto, re.IGNORECASE)
        if m:
            empresa = m.group(1).strip().rstrip(",. ")
            break

    if not empresa:
        # Fall back: use titulo, strip the court header
        empresa = re.sub(
            r"^Edicto[^,]*,\s*del\s+Juzgado[^,]+,\s*(?:sobre\s+)?",
            "",
            titulo,
            flags=re.IGNORECASE,
        ).strip()[:120]

    # ── NIF / CIF ─────────────────────────────────────────────────────────────
    nif = None
    for pat in [
        r"\b([ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J])\b",   # CIF empresa
        r"\b(\d{8}[A-Z])\b",                              # DNI persona
    ]:
        m = re.search(pat, texto.upper())
        if m:
            nif = m.group(1)
            break

    # ── Juzgado & ciudad ──────────────────────────────────────────────────────
    ciudad_raw = _ciudad_from_juzgado(titulo) or _ciudad_from_juzgado(texto)
    ciudad, provincia, ccaa = _resolve_city(ciudad_raw)

    # ── Tipo de concurso ──────────────────────────────────────────────────────
    if re.search(r"\bnecesari[ao]\b", texto, re.IGNORECASE):
        tipo = "Necesario"
    else:
        tipo = "Voluntario"

    # ── Administrador concursal ───────────────────────────────────────────────
    administrador = None
    for pat in [
        r"administrador(?:a)?\s+concursal[,:\s]+([A-ZÁÉÍÓÚÑÜ][A-Za-záéíóúñü\s]{4,60}?)(?:[,;.]|$)",
        r"(?:se\s+nombra|se\s+designa)[^,]{0,30}\badministrador[^,]{0,20}[,\s]+([A-ZÁÉÍÓÚÑÜ][A-Za-záéíóúñü\s]{4,50}?)(?:[,;.]|$)",
    ]:
        m = re.search(pat, texto, re.IGNORECASE)
        if m:
            administrador = m.group(1).strip()
            break

    return {
        "id":            item_id,
        "empresa":       empresa,
        "nif":           nif,
        "juzgado":       titulo[:200],
        "ciudad":        ciudad,
        "provincia":     provincia,
        "ccaa":          ccaa,
        "fecha_pub":     fecha_pub,
        "tipo_concurso": tipo,
        "administrador": administrador,
        "titulo":        titulo[:300],
        "texto":         texto[:3000],
        "url_html":      url_html,
    }


_CONCURSO_RE = re.compile(
    r"concurso\s+de\s+acreedores|procedimiento\s+concursal|declaraci[oó]n\s+de\s+concurso",
    re.IGNORECASE,
)


def scrape_date(date_str: str) -> int:
    """Scrape BOE for a given date (YYYYMMDD). Returns number of new records saved."""
    if is_date_scraped(date_str):
        return 0

    root = _get_xml(BOE_SUMARIO.format(date=date_str))
    if root is None:
        log_scrape(date_str, 0)
        return 0

    saved = 0
    for item in root.iter("item"):
        titulo = (item.findtext("titulo") or "").strip()
        if not _CONCURSO_RE.search(titulo):
            continue

        item_id  = item.get("id", "")
        url_html = item.findtext("url_html") or ""
        if not item_id:
            continue

        time.sleep(DELAY)
        data = _extract_concurso(item_id, titulo, url_html, date_str)
        if data:
            upsert_concurso(data)
            saved += 1
            log.info("Saved: %s  [%s]", data["empresa"], item_id)

    log_scrape(date_str, saved)
    return saved


def scrape_recent(
    days: int = 90,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> int:
    """Scrape the last *days* working days from the BOE. Returns total records saved."""
    init_db()
    total = 0
    today = datetime.now()
    working_days = [
        today - timedelta(days=i)
        for i in range(days)
        if (today - timedelta(days=i)).weekday() < 5  # Mon–Fri only
    ]

    for idx, day in enumerate(working_days):
        date_str = day.strftime("%Y%m%d")
        if progress_callback:
            progress_callback(idx, len(working_days), date_str)
        log.info("Scraping %s …", date_str)
        total += scrape_date(date_str)
        time.sleep(0.2)

    return total
