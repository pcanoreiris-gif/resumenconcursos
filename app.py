"""
Dashboard: Concursos de Acreedores en España
Fuente: BOE API (datos.gob.es / boe.es/datosabiertos)
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from database import get_all_concursos, get_db_stats, init_db
from scraper import scrape_recent

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Concursos de Acreedores — España",
    page_icon="⚖️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Province / CCAA capital coordinates for map ───────────────────────────────
CITY_COORDS: dict[str, tuple[float, float]] = {
    "Madrid":           (40.4168, -3.7038),
    "Barcelona":        (41.3851,  2.1734),
    "Valencia":         (39.4699, -0.3763),
    "Sevilla":          (37.3891, -5.9845),
    "Zaragoza":         (41.6488, -0.8891),
    "Málaga":           (36.7213, -4.4214),
    "Murcia":           (37.9922, -1.1307),
    "Palma":            (39.5696,  2.6502),
    "Las Palmas":       (28.1235,-15.4366),
    "Bilbao":           (43.2630, -2.9340),
    "Alicante":         (38.3452, -0.4810),
    "Córdoba":          (37.8882, -4.7794),
    "Valladolid":       (41.6523, -4.7245),
    "Vitoria":          (42.8467, -2.6726),
    "Oviedo":           (43.3614, -5.8494),
    "Gijón":            (43.5453, -5.6615),
    "Tenerife":         (28.4636,-16.2518),
    "Santa Cruz":       (28.4636,-16.2518),
    "Pamplona":         (42.8125, -1.6458),
    "Santander":        (43.4623, -3.8099),
    "Logroño":          (42.4650, -2.4456),
    "Badajoz":          (38.8794, -6.9706),
    "Huelva":           (37.2614, -6.9447),
    "Almería":          (36.8381, -2.4597),
    "Cádiz":            (36.5298, -6.2924),
    "Jaén":             (37.7796, -3.7849),
    "Granada":          (37.1773, -3.5986),
    "Lleida":           (41.6148,  0.6243),
    "Girona":           (41.9794,  2.8214),
    "Tarragona":        (41.1189,  1.2445),
    "Castellón":        (39.9864, -0.0513),
    "Burgos":           (42.3440, -3.6969),
    "León":             (42.5987, -5.5671),
    "Salamanca":        (40.9701, -5.6635),
    "Segovia":          (40.9429, -4.1088),
    "Ávila":            (40.6564, -4.6813),
    "Cuenca":           (40.0704, -2.1374),
    "Guadalajara":      (40.6326, -3.1664),
    "Toledo":           (39.8628, -4.0273),
    "Albacete":         (38.9943, -1.8585),
    "Ciudad Real":      (38.9848, -3.9274),
    "Huesca":           (42.1361, -0.4089),
    "Teruel":           (40.3456, -1.1065),
    "Cáceres":          (39.4752, -6.3724),
    "Mérida":           (38.9166, -6.3436),
    "San Sebastián":    (43.3183, -1.9812),
    "Donostia":         (43.3183, -1.9812),
    "Pontevedra":       (42.4298, -8.6446),
    "Vigo":             (42.2328, -8.7226),
    "Ourense":          (42.3364, -7.8640),
    "Lugo":             (43.0097, -7.5560),
    "Coruña":           (43.3623, -8.4115),
    "Palencia":         (42.0096, -4.5296),
    "Zamora":           (41.5034, -5.7453),
    "Soria":            (41.7640, -2.4693),
    "Ceuta":            (35.8883, -5.3218),
    "Melilla":          (35.2923, -2.9381),
}


# ── Data loading ──────────────────────────────────────────────────────────────
@st.cache_data(ttl=300)
def load_data() -> pd.DataFrame:
    rows = get_all_concursos()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["fecha_pub"] = pd.to_datetime(df["fecha_pub"], format="%Y%m%d", errors="coerce")
    return df


# ── KPI row ───────────────────────────────────────────────────────────────────
def render_kpis(df: pd.DataFrame):
    now = datetime.now()
    this_m = df[df["fecha_pub"].dt.month == now.month]
    prev_m = df[df["fecha_pub"].dt.month == (now.month - 1 if now.month > 1 else 12)]
    vol = (df["tipo_concurso"] == "Voluntario").sum()
    nec = (df["tipo_concurso"] == "Necesario").sum()

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Total concursos", f"{len(df):,}")
    c2.metric(
        "Este mes",
        len(this_m),
        delta=f"{len(this_m) - len(prev_m):+d} vs mes anterior",
    )
    c3.metric("Voluntarios", f"{vol:,}")
    c4.metric("Necesarios", f"{nec:,}")
    cities = df["ciudad"].nunique()
    c5.metric("Ciudades con concursos", cities)


# ── Map ───────────────────────────────────────────────────────────────────────
def render_map(df: pd.DataFrame):
    if df.empty:
        st.info("Sin datos para el mapa.")
        return

    by_city = (
        df.groupby("ciudad")
        .agg(count=("id", "count"), ccaa=("ccaa", "first"))
        .reset_index()
    )
    by_city = by_city[by_city["ciudad"].notna() & (by_city["ciudad"] != "Desconocida")]

    lats, lons, counts, hovers = [], [], [], []
    for _, row in by_city.iterrows():
        coords = CITY_COORDS.get(row["ciudad"])
        if not coords:
            for k, v in CITY_COORDS.items():
                if k.lower() in row["ciudad"].lower():
                    coords = v
                    break
        if not coords:
            continue
        lats.append(coords[0])
        lons.append(coords[1])
        counts.append(row["count"])
        hovers.append(f"<b>{row['ciudad']}</b><br>{row['ccaa']}<br>{row['count']} concursos")

    fig = go.Figure(
        go.Scattergeo(
            lat=lats,
            lon=lons,
            text=hovers,
            hovertemplate="%{text}<extra></extra>",
            mode="markers",
            marker=dict(
                size=[max(c * 4, 8) for c in counts],
                color=counts,
                colorscale="Reds",
                showscale=True,
                colorbar_title="Concursos",
                sizemode="area",
                line_color="white",
                line_width=0.8,
            ),
        )
    )
    fig.update_layout(
        title="Distribución geográfica de concursos de acreedores",
        geo=dict(
            scope="europe",
            center=dict(lat=40.2, lon=-3.5),
            projection_scale=5.5,
            showland=True,
            landcolor="#f5f5f5",
            showcoastlines=True,
            coastlinecolor="#cccccc",
            showcountries=True,
            countrycolor="#dddddd",
            showocean=True,
            oceancolor="#ddeeff",
            showframe=False,
        ),
        height=520,
        margin=dict(l=0, r=0, t=40, b=0),
    )
    st.plotly_chart(fig, use_container_width=True)


# ── Charts ────────────────────────────────────────────────────────────────────
def render_charts(df: pd.DataFrame):
    if df.empty:
        st.info("Sin datos para mostrar.")
        return

    # Row 1: CCAA bar + timeline
    c1, c2 = st.columns([1, 1])

    with c1:
        by_ccaa = (
            df.groupby("ccaa").size().reset_index(name="count")
            .sort_values("count", ascending=True)
            .tail(20)
        )
        by_ccaa = by_ccaa[by_ccaa["ccaa"] != "Desconocida"]
        fig = px.bar(
            by_ccaa, x="count", y="ccaa", orientation="h",
            title="Concursos por Comunidad Autónoma",
            labels={"count": "Nº concursos", "ccaa": ""},
            color="count",
            color_continuous_scale="Reds",
        )
        fig.update_layout(
            coloraxis_showscale=False, height=420,
            margin=dict(l=0, r=10, t=40, b=0),
        )
        st.plotly_chart(fig, use_container_width=True)

    with c2:
        ts = (
            df.set_index("fecha_pub")
            .resample("W")["id"]
            .count()
            .reset_index()
            .rename(columns={"fecha_pub": "semana", "id": "count"})
        )
        fig = px.area(
            ts, x="semana", y="count",
            title="Evolución semanal de nuevos concursos",
            labels={"semana": "", "count": "Nuevos concursos"},
            color_discrete_sequence=["#c0392b"],
        )
        fig.update_layout(height=420, margin=dict(l=0, r=0, t=40, b=0))
        st.plotly_chart(fig, use_container_width=True)

    # Row 2: tipo donut + top ciudades
    c3, c4 = st.columns([1, 1])

    with c3:
        by_tipo = df["tipo_concurso"].value_counts().reset_index()
        by_tipo.columns = ["tipo", "count"]
        fig = px.pie(
            by_tipo, values="count", names="tipo",
            title="Tipo de concurso",
            color_discrete_sequence=["#c0392b", "#e74c3c", "#f1948a"],
            hole=0.45,
        )
        fig.update_layout(height=370, margin=dict(l=0, r=0, t=40, b=0))
        st.plotly_chart(fig, use_container_width=True)

    with c4:
        top_cities = (
            df[df["ciudad"] != "Desconocida"]["ciudad"]
            .value_counts()
            .head(12)
            .reset_index()
        )
        top_cities.columns = ["ciudad", "count"]
        fig = px.bar(
            top_cities, x="ciudad", y="count",
            title="Top ciudades por número de concursos",
            labels={"ciudad": "", "count": "Nº concursos"},
            color="count",
            color_continuous_scale="Reds",
        )
        fig.update_layout(
            coloraxis_showscale=False, height=370,
            margin=dict(l=0, r=0, t=40, b=0),
            xaxis_tickangle=-30,
        )
        st.plotly_chart(fig, use_container_width=True)


# ── Table ─────────────────────────────────────────────────────────────────────
def render_table(df: pd.DataFrame):
    if df.empty:
        st.info("Sin datos.")
        return

    search = st.text_input("Buscar empresa, NIF, ciudad…", placeholder="Ej: Madrid, B12345678")
    if search:
        mask = df.apply(
            lambda row: search.lower() in str(row).lower(), axis=1
        )
        df = df[mask]

    st.caption(f"{len(df):,} registros")

    display = df[[
        "empresa", "nif", "ciudad", "ccaa",
        "fecha_pub", "tipo_concurso", "administrador", "url_html",
    ]].copy()
    display["fecha_pub"] = display["fecha_pub"].dt.strftime("%d/%m/%Y")
    display.columns = [
        "Empresa", "NIF", "Ciudad", "CCAA",
        "Fecha BOE", "Tipo", "Administrador Concursal", "Enlace BOE",
    ]

    st.dataframe(
        display,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Enlace BOE": st.column_config.LinkColumn("Enlace BOE"),
        },
    )


# ── Sidebar ───────────────────────────────────────────────────────────────────
def render_sidebar() -> dict:
    with st.sidebar:
        st.header("⚖️ Concursos ES")
        st.caption("Fuente: BOE · Sección IV / TEJU")

        st.divider()
        st.subheader("Importar datos")
        days = st.slider("Días a importar del BOE", min_value=7, max_value=180, value=90, step=7)

        run = st.button("Actualizar desde BOE", type="primary", use_container_width=True)

        stats = get_db_stats()
        st.divider()
        st.subheader("Base de datos")
        st.metric("Registros totales", f"{stats['total']:,}")
        if stats["oldest"] and stats["newest"]:
            oldest = datetime.strptime(stats["oldest"], "%Y%m%d").strftime("%d/%m/%Y")
            newest = datetime.strptime(stats["newest"], "%Y%m%d").strftime("%d/%m/%Y")
            st.caption(f"Del {oldest} al {newest}")

        st.divider()
        st.subheader("Filtros")

    return {"days": days, "run": run}


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    init_db()
    cfg = render_sidebar()

    # Run scraper
    if cfg["run"]:
        bar  = st.progress(0.0, text="Iniciando…")
        info = st.empty()

        def cb(idx: int, total: int, date_str: str):
            bar.progress(idx / total, text=f"Procesando {date_str[:4]}-{date_str[4:6]}-{date_str[6:]}…")
            info.caption(f"Día {idx+1}/{total}")

        with st.spinner(f"Descargando {cfg['days']} días de trabajo del BOE…"):
            n = scrape_recent(days=cfg["days"], progress_callback=cb)

        bar.empty()
        info.empty()
        st.success(f"✅ {n} nuevos concursos importados.")
        st.cache_data.clear()
        st.rerun()

    # Load & filter
    st.title("Concursos de Acreedores — España")
    st.caption("Datos oficiales del BOE · Sección IV Administración de Justicia / TEJU")

    df = load_data()

    if df.empty:
        st.warning(
            "No hay datos. Pulsa **Actualizar desde BOE** en el panel lateral para importar."
        )
        with st.expander("¿Cómo funciona?"):
            st.markdown("""
            1. Usa el slider para elegir cuántos días históricos quieres importar (recomendado: 90).
            2. Pulsa **Actualizar desde BOE** — el proceso tarda unos minutos (se respeta la tasa de la API).
            3. El dashboard se actualiza automáticamente con los datos descargados.
            4. Los datos se guardan localmente en `data/concursos.db` para consultas posteriores.

            **Fuente:** API pública del BOE (`boe.es/datosabiertos`).
            Los edictos de concurso se publican en la Sección IV (Juzgados de lo Mercantil)
            y en el Suplemento TEJU desde junio de 2021.
            """)
        return

    # Sidebar filters (need data loaded first)
    with st.sidebar:
        ccaa_opts = ["Todas"] + sorted(df["ccaa"].dropna().unique().tolist())
        ccaa_sel  = st.selectbox("Comunidad Autónoma", ccaa_opts)

        tipo_opts = ["Todos"] + sorted(df["tipo_concurso"].dropna().unique().tolist())
        tipo_sel  = st.selectbox("Tipo de concurso", tipo_opts)

        valid_dates = df["fecha_pub"].dropna()
        if not valid_dates.empty:
            min_d = valid_dates.min().date()
            max_d = valid_dates.max().date()
            date_range = st.date_input("Rango de fechas", value=(min_d, max_d),
                                       min_value=min_d, max_value=max_d)
        else:
            date_range = None

    # Apply filters
    fdf = df.copy()
    if ccaa_sel != "Todas":
        fdf = fdf[fdf["ccaa"] == ccaa_sel]
    if tipo_sel != "Todos":
        fdf = fdf[fdf["tipo_concurso"] == tipo_sel]
    if date_range and len(date_range) == 2:
        fdf = fdf[
            (fdf["fecha_pub"].dt.date >= date_range[0]) &
            (fdf["fecha_pub"].dt.date <= date_range[1])
        ]

    # Render
    render_kpis(fdf)
    st.divider()

    tab_map, tab_charts, tab_table = st.tabs(["Mapa", "Gráficos", "Tabla"])
    with tab_map:
        render_map(fdf)
    with tab_charts:
        render_charts(fdf)
    with tab_table:
        render_table(fdf)


if __name__ == "__main__":
    main()
