/**
 * GET /api/range?days=N
 *
 * Returns concurso de acreedores items from the last N working days (max 60).
 * Calls /api/sumario for each day sequentially (server-side, no CORS issues).
 *
 * Query params:
 *   days  – number of working days to look back (default: 30, max: 60)
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

function getWorkingDays(n) {
  const days = [];
  const today = new Date();
  let i = 0;
  while (days.length < n && i < n * 2 + 30) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      days.push(`${y}${m}${dd}`);
    }
    i++;
  }
  return days;
}

async function fetchDaySumario(dateStr) {
  const url = `${BOE_SUMARIO}${dateStr}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml",
      "User-Agent": "ConcursosDashboard/2.0 (investigacion)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`BOE HTTP ${response.status} for ${dateStr}`);
  }

  const xmlText = await response.text();
  const parsed = await parseStringPromise(xmlText, { explicitArray: false, explicitCharkey: false });

  const items = [];
  const diario = parsed?.sumario?.diario;
  if (!diario) return items;

  const secciones = Array.isArray(diario.seccion) ? diario.seccion : [diario.seccion].filter(Boolean);

  for (const seccion of secciones) {
    const numSeccion = seccion?.$?.num || "";
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
          const urlHtml = item.url_html || item.urlHtml || "";
          const cityRaw = extractCityFromTitle(titulo);
          const geo = resolveCity(cityRaw);
          const tipo = /necesari[ao]/i.test(titulo) ? "Necesario" : "Voluntario";
          const dateFormatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

          items.push({
            id,
            titulo: titulo.slice(0, 300),
            fecha_pub: dateFormatted,
            url_boe: id ? `https://www.boe.es/diario_boe/txt.php?id=${id}` : urlHtml,
            url_html: urlHtml,
            tipo_concurso: tipo,
            seccion: numSeccion,
            departamento: (dept?.$?.nombre || dept?.nombre || "").toString().slice(0, 100),
            ...geo,
          });
        }
      }
    }
  }

  return items;
}

export default async function handler(req, res) {
  const rawDays = parseInt(req.query.days || "30", 10);
  const days = Math.min(Math.max(rawDays, 1), 60);

  const workingDays = getWorkingDays(days);
  const allItems = [];
  const errors = [];

  // Process in small batches to stay within Vercel's 10s serverless timeout on hobby plan
  // Batch size 5 with 200ms gap between batches
  const BATCH = 5;
  for (let i = 0; i < workingDays.length; i += BATCH) {
    const batch = workingDays.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((d) => fetchDaySumario(d)));
    for (const r of results) {
      if (r.status === "fulfilled") allItems.push(...r.value);
      else errors.push(r.reason?.message || "unknown error");
    }
    // Small pause between batches — be polite to BOE API
    if (i + BATCH < workingDays.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Sort newest first
  allItems.sort((a, b) => b.fecha_pub.localeCompare(a.fecha_pub));

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  return res.status(200).json({
    days_requested: days,
    working_days_checked: workingDays.length,
    total: allItems.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    items: allItems,
  });
}
