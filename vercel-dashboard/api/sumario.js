/**
 * GET /api/sumario?date=YYYYMMDD
 *
 * Proxies the BOE Open Data API sumario XML for a given date,
 * parses it, and returns only the "concurso de acreedores" items as JSON.
 *
 * BOE Open Data API docs: https://www.boe.es/datosabiertos/api/
 */

import { parseStringPromise } from "xml2js";

const BOE_SUMARIO = "https://www.boe.es/datosabiertos/api/boe/sumario/";
const CONCURSO_RE =
  /concurso\s+de\s+acreedores|procedimiento\s+concursal|declaraci[oó]n\s+de\s+concurso/i;

const CITY_MAP = {
  Madrid:        { provincia: "Madrid",                ccaa: "Comunidad de Madrid" },
  Barcelona:     { provincia: "Barcelona",              ccaa: "Cataluña" },
  Valencia:      { provincia: "Valencia",               ccaa: "Comunitat Valenciana" },
  Sevilla:       { provincia: "Sevilla",                ccaa: "Andalucía" },
  Zaragoza:      { provincia: "Zaragoza",               ccaa: "Aragón" },
  Málaga:        { provincia: "Málaga",                 ccaa: "Andalucía" },
  Murcia:        { provincia: "Murcia",                 ccaa: "Región de Murcia" },
  Palma:         { provincia: "Islas Baleares",         ccaa: "Islas Baleares" },
  "Las Palmas":  { provincia: "Las Palmas",             ccaa: "Canarias" },
  Bilbao:        { provincia: "Vizcaya",                ccaa: "País Vasco" },
  Alicante:      { provincia: "Alicante",               ccaa: "Comunitat Valenciana" },
  Córdoba:       { provincia: "Córdoba",                ccaa: "Andalucía" },
  Valladolid:    { provincia: "Valladolid",             ccaa: "Castilla y León" },
  Vitoria:       { provincia: "Álava",                  ccaa: "País Vasco" },
  Oviedo:        { provincia: "Asturias",               ccaa: "Principado de Asturias" },
  Gijón:         { provincia: "Asturias",               ccaa: "Principado de Asturias" },
  Tenerife:      { provincia: "Santa Cruz de Tenerife", ccaa: "Canarias" },
  Pamplona:      { provincia: "Navarra",                ccaa: "Comunidad Foral de Navarra" },
  Santander:     { provincia: "Cantabria",              ccaa: "Cantabria" },
  Logroño:       { provincia: "La Rioja",               ccaa: "La Rioja" },
  Badajoz:       { provincia: "Badajoz",                ccaa: "Extremadura" },
  Huelva:        { provincia: "Huelva",                 ccaa: "Andalucía" },
  Almería:       { provincia: "Almería",                ccaa: "Andalucía" },
  Cádiz:         { provincia: "Cádiz",                  ccaa: "Andalucía" },
  Jaén:          { provincia: "Jaén",                   ccaa: "Andalucía" },
  Granada:       { provincia: "Granada",                ccaa: "Andalucía" },
  Lleida:        { provincia: "Lleida",                 ccaa: "Cataluña" },
  Girona:        { provincia: "Girona",                 ccaa: "Cataluña" },
  Tarragona:     { provincia: "Tarragona",              ccaa: "Cataluña" },
  Castellón:     { provincia: "Castellón",              ccaa: "Comunitat Valenciana" },
  Burgos:        { provincia: "Burgos",                 ccaa: "Castilla y León" },
  León:          { provincia: "León",                   ccaa: "Castilla y León" },
  Salamanca:     { provincia: "Salamanca",              ccaa: "Castilla y León" },
  Segovia:       { provincia: "Segovia",                ccaa: "Castilla y León" },
  Ávila:         { provincia: "Ávila",                  ccaa: "Castilla y León" },
  Cuenca:        { provincia: "Cuenca",                 ccaa: "Castilla-La Mancha" },
  Guadalajara:   { provincia: "Guadalajara",            ccaa: "Castilla-La Mancha" },
  Toledo:        { provincia: "Toledo",                 ccaa: "Castilla-La Mancha" },
  Albacete:      { provincia: "Albacete",               ccaa: "Castilla-La Mancha" },
  "Ciudad Real": { provincia: "Ciudad Real",            ccaa: "Castilla-La Mancha" },
  Huesca:        { provincia: "Huesca",                 ccaa: "Aragón" },
  Teruel:        { provincia: "Teruel",                 ccaa: "Aragón" },
  Cáceres:       { provincia: "Cáceres",                ccaa: "Extremadura" },
  Mérida:        { provincia: "Badajoz",                ccaa: "Extremadura" },
  "San Sebastián": { provincia: "Guipúzcoa",            ccaa: "País Vasco" },
  Donostia:      { provincia: "Guipúzcoa",              ccaa: "País Vasco" },
  Pontevedra:    { provincia: "Pontevedra",             ccaa: "Galicia" },
  Vigo:          { provincia: "Pontevedra",             ccaa: "Galicia" },
  Ourense:       { provincia: "Ourense",                ccaa: "Galicia" },
  Lugo:          { provincia: "Lugo",                   ccaa: "Galicia" },
  Coruña:        { provincia: "A Coruña",               ccaa: "Galicia" },
  Palencia:      { provincia: "Palencia",               ccaa: "Castilla y León" },
  Zamora:        { provincia: "Zamora",                 ccaa: "Castilla y León" },
  Soria:         { provincia: "Soria",                  ccaa: "Castilla y León" },
  Ceuta:         { provincia: "Ceuta",                  ccaa: "Ceuta" },
  Melilla:       { provincia: "Melilla",                ccaa: "Melilla" },
};

function resolveCity(text) {
  if (!text) return { ciudad: "Desconocida", provincia: "Desconocida", ccaa: "Desconocida" };
  const norm = text.normalize("NFC");
  for (const [key, geo] of Object.entries(CITY_MAP)) {
    if (norm.toLowerCase().includes(key.toLowerCase())) {
      return { ciudad: key, ...geo };
    }
  }
  return { ciudad: text.trim().slice(0, 50), provincia: text.trim().slice(0, 50), ccaa: "Desconocida" };
}

function extractCityFromTitle(titulo) {
  const m = titulo.match(
    /Juzgado[^,\n]*?de\s+(?:lo\s+Mercantil[^,\n]*?de\s+)?([A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑÜ]?[a-záéíóúñü]+)*)/i
  );
  return m ? m[1].trim() : null;
}

function detectTipo(titulo) {
  if (/necesari[ao]/i.test(titulo)) return "Necesario";
  return "Voluntario";
}

function formatDate(dateStr) {
  // YYYYMMDD → YYYY-MM-DD
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

export default async function handler(req, res) {
  const { date } = req.query;

  if (!date || !/^\d{8}$/.test(date)) {
    return res.status(400).json({ error: "Parámetro 'date' requerido en formato YYYYMMDD" });
  }

  const url = `${BOE_SUMARIO}${date}`;
  let xmlText;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/xml",
        "User-Agent": "ConcursosDashboard/2.0 (investigacion; github.com)",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        // No BOE on that day (weekend / holiday)
        return res.status(200).json({ date: formatDate(date), items: [], total: 0 });
      }
      throw new Error(`BOE HTTP ${response.status}`);
    }

    xmlText = await response.text();
  } catch (err) {
    return res.status(502).json({ error: `Error contactando BOE: ${err.message}` });
  }

  let parsed;
  try {
    parsed = await parseStringPromise(xmlText, { explicitArray: false, explicitCharkey: false });
  } catch (err) {
    return res.status(502).json({ error: `Error parseando XML del BOE: ${err.message}` });
  }

  // Navigate the BOE XML structure
  // Root: sumario → diario → seccion[] → departamento[] → epigrafe[] → item[]
  const items = [];
  const diario = parsed?.sumario?.diario;
  if (!diario) {
    return res.status(200).json({ date: formatDate(date), items: [], total: 0 });
  }

  const secciones = Array.isArray(diario.seccion) ? diario.seccion : [diario.seccion].filter(Boolean);

  for (const seccion of secciones) {
    const numSeccion = seccion?.$?.num || "";
    // Sección IV = Administración de Justicia, also TEJU supplement
    const isRelevant = ["IV", "TEJU", "SUPLEMENTO"].some((s) =>
      numSeccion.toUpperCase().includes(s)
    );
    if (!isRelevant) continue;

    const depts = Array.isArray(seccion.departamento)
      ? seccion.departamento
      : [seccion.departamento].filter(Boolean);

    for (const dept of depts) {
      const epigrafes = Array.isArray(dept.epigrafe)
        ? dept.epigrafe
        : [dept.epigrafe].filter(Boolean);

      for (const epigrafe of epigrafes) {
        const epItems = Array.isArray(epigrafe.item)
          ? epigrafe.item
          : [epigrafe.item].filter(Boolean);

        for (const item of epItems) {
          const titulo = (item.titulo || "").toString().trim();
          if (!CONCURSO_RE.test(titulo)) continue;

          const id = item?.$?.id || item.id || "";
          const urlHtml = item.url_html || item.urlHtml || `https://www.boe.es/boe/dias/${date.slice(0,4)}/${date.slice(4,6)}/${date.slice(6,8)}/index.php`;

          const cityRaw = extractCityFromTitle(titulo);
          const geo = resolveCity(cityRaw);

          items.push({
            id,
            titulo: titulo.slice(0, 300),
            fecha_pub: formatDate(date),
            url_boe: id ? `https://www.boe.es/diario_boe/txt.php?id=${id}` : urlHtml,
            url_html: urlHtml,
            tipo_concurso: detectTipo(titulo),
            seccion: numSeccion,
            departamento: (dept?.$?.nombre || dept?.nombre || "").toString().slice(0, 100),
            ...geo,
          });
        }
      }
    }
  }

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({ date: formatDate(date), items, total: items.length });
}
