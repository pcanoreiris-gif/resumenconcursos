// Serverless function: fetches concursos de acreedores from BOE daily sumario
// Sprint 1: empresa, fecha, CCAA (desde juzgado), tipo, referencia BOE
// Sprint 2: NIF, pasivo, admin concursal, sector (Registro Público Concursal)

const PROVINCE_TO_CCAA = {
  'MADRID':          'Comunidad de Madrid',
  'BARCELONA':       'Cataluña',
  'TARRAGONA':       'Cataluña',
  'GIRONA':          'Cataluña',
  'LLEIDA':          'Cataluña',
  'VALENCIA':        'Comunitat Valenciana',
  'ALICANTE':        'Comunitat Valenciana',
  'CASTELLON':       'Comunitat Valenciana',
  'CASTELLÓN':       'Comunitat Valenciana',
  'SEVILLA':         'Andalucía',
  'MÁLAGA':          'Andalucía',
  'MALAGA':          'Andalucía',
  'GRANADA':         'Andalucía',
  'CÓRDOBA':         'Andalucía',
  'CORDOBA':         'Andalucía',
  'ALMERÍA':         'Andalucía',
  'ALMERIA':         'Andalucía',
  'HUELVA':          'Andalucía',
  'CÁDIZ':           'Andalucía',
  'CADIZ':           'Andalucía',
  'JAÉN':            'Andalucía',
  'JAEN':            'Andalucía',
  'BILBAO':          'País Vasco',
  'VITORIA':         'País Vasco',
  'DONOSTIA':        'País Vasco',
  'SAN SEBASTIAN':   'País Vasco',
  'ZARAGOZA':        'Aragón',
  'HUESCA':          'Aragón',
  'TERUEL':          'Aragón',
  'VALLADOLID':      'Castilla y León',
  'BURGOS':          'Castilla y León',
  'SALAMANCA':       'Castilla y León',
  'PALENCIA':        'Castilla y León',
  'ZAMORA':          'Castilla y León',
  'SEGOVIA':         'Castilla y León',
  'AVILA':           'Castilla y León',
  'ÁVILA':           'Castilla y León',
  'SORIA':           'Castilla y León',
  'LEON':            'Castilla y León',
  'LEÓN':            'Castilla y León',
  'VIGO':            'Galicia',
  'CORUÑA':          'Galicia',
  'LUGO':            'Galicia',
  'OURENSE':         'Galicia',
  'PONTEVEDRA':      'Galicia',
  'MURCIA':          'Región de Murcia',
  'CARTAGENA':       'Región de Murcia',
  'TOLEDO':          'Castilla-La Mancha',
  'ALBACETE':        'Castilla-La Mancha',
  'CIUDAD REAL':     'Castilla-La Mancha',
  'CUENCA':          'Castilla-La Mancha',
  'GUADALAJARA':     'Castilla-La Mancha',
  'PALMA':           'Islas Baleares',
  'IBIZA':           'Islas Baleares',
  'LAS PALMAS':      'Canarias',
  'SANTA CRUZ':      'Canarias',
  'TENERIFE':        'Canarias',
  'BADAJOZ':         'Extremadura',
  'CACERES':         'Extremadura',
  'CÁCERES':         'Extremadura',
  'OVIEDO':          'Principado de Asturias',
  'GIJON':           'Principado de Asturias',
  'GIJÓN':           'Principado de Asturias',
  'SANTANDER':       'Cantabria',
  'LOGROÑO':         'La Rioja',
  'LOGRONO':         'La Rioja',
  'PAMPLONA':        'C. Foral de Navarra',
};

function formatFecha(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Returns list of weekday dates (BOE publishes Mon–Sat) going back `dias` publishing days
function getPublishingDates(dias) {
  const dates = [];
  const hoy = new Date();
  let i = 0;
  while (dates.length < dias && i < dias + 30) {
    const d = new Date(hoy - i * 86400000);
    if (d.getDay() !== 0) dates.push(formatFecha(d)); // skip Sundays
    i++;
  }
  return dates;
}

function extractCCAA(departamentoNombre) {
  if (!departamentoNombre) return null;
  const upper = departamentoNombre.toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip accents for matching
  for (const [key, ccaa] of Object.entries(PROVINCE_TO_CCAA)) {
    const keyNorm = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (upper.includes(keyNorm)) return ccaa;
  }
  return null;
}

function extractEmpresa(titulo) {
  // Common BOE patterns for concurso announcements
  const patterns = [
    // "...concurso de acreedores de EMPRESA SL"
    /concurso[^,]{0,30}?acreedores\s+(?:de\s+(?:la\s+)?(?:empresa\s+)?)?(.+?)(?:\.|,|;|\s+con\s+NIF|\s+NIF\b|$)/i,
    // "declaración de concurso de EMPRESA"
    /declaraci[oó]n\s+de\s+concurso\s+(?:de\s+)?(?:la\s+)?(.+?)(?:\.|,|;|$)/i,
    // "deudora?: EMPRESA"
    /deudora?[:\s]+(.+?)(?:\.|,|;|$)/i,
  ];

  for (const p of patterns) {
    const m = titulo.match(p);
    if (m && m[1]) {
      const name = m[1].trim().replace(/^[\s,;.]+|[\s,;.]+$/g, '');
      if (name.length > 2 && name.length < 120) return name;
    }
  }

  // Fallback: strip known legal boilerplate from the title
  return titulo
    .replace(/^(auto|decreto|providencia|edicto|anuncio)\s+/i, '')
    .replace(/concurso\s+(?:voluntario\s+)?(?:necesario\s+)?(?:de\s+)?acreedores\s+(?:de\s+)?/i, '')
    .replace(/declaraci[oó]n\s+de\s+concurso\s+(?:de\s+)?/i, '')
    .trim()
    .slice(0, 100);
}

function extractTipo(titulo) {
  const t = titulo.toLowerCase();
  if (t.includes('liquidaci')) return 'Liquidación';
  if (t.includes('necesario') || t.includes('forzoso')) return 'Necesario';
  return 'Voluntario'; // majority of concursos are voluntary
}

function isConcursoDeAcreedores(titulo) {
  const t = titulo.toLowerCase();
  return (
    t.includes('concurso de acreedores') ||
    t.includes('concurso voluntario de acreedores') ||
    t.includes('concurso necesario') ||
    (t.includes('concurso') && t.includes('deudor')) ||
    (t.includes('declaraci') && t.includes('concurso') && !t.includes('oposici'))
  );
}

// Recursively collect all item objects from a departamento node
function collectItems(node) {
  const items = [];
  if (!node) return items;

  if (Array.isArray(node.item)) {
    items.push(...node.item);
  } else if (node.item && typeof node.item === 'object') {
    items.push(node.item);
  }

  const epigrafes = Array.isArray(node.epigrafe)
    ? node.epigrafe
    : node.epigrafe
    ? [node.epigrafe]
    : [];

  for (const ep of epigrafes) {
    items.push(...collectItems(ep));
  }

  return items;
}

function parseSumario(json, fechaStr) {
  const results = [];
  const diario = json?.data?.sumario?.diario;
  if (!diario) return results;

  const diarios = Array.isArray(diario) ? diario : [diario];

  for (const d of diarios) {
    const secciones = Array.isArray(d.seccion) ? d.seccion : d.seccion ? [d.seccion] : [];

    for (const sec of secciones) {
      // Section 4: Administración de Justicia (declaraciones de concurso)
      // Section 5B: Otros anuncios oficiales (registral announcements)
      if (!['4', '5B'].includes(sec.codigo)) continue;

      const depts = Array.isArray(sec.departamento)
        ? sec.departamento
        : sec.departamento
        ? [sec.departamento]
        : [];

      for (const dept of depts) {
        if (!dept) continue;
        const ccaa = extractCCAA(dept.nombre || '');
        const items = collectItems(dept);

        for (const item of items) {
          if (!item?.identificador || !item?.titulo) continue;
          if (!isConcursoDeAcreedores(item.titulo)) continue;

          results.push({
            id:       results.length + 1,
            boe:      item.identificador,
            empresa:  extractEmpresa(item.titulo),
            ccaa:     ccaa || 'Sin determinar',
            fecha:    fechaStr, // YYYYMMDD
            tipo:     extractTipo(item.titulo),
            juzgado:  dept.nombre || '',
            url_boe:  item.url_html || `https://www.boe.es/diario_boe/txt.php?id=${item.identificador}`,
          });
        }
      }
    }
  }

  return results;
}

async function fetchSumario(fecha) {
  const url = `https://www.boe.es/datosabiertos/api/boe/sumario/${fecha}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return parseSumario(json, fecha);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const dias = Math.min(parseInt(req.query.dias || '30'), 60);
  const fechas = getPublishingDates(dias);

  // Fetch in batches of 5 to be respectful to BOE servers
  const BATCH = 5;
  const allConcursos = [];

  for (let i = 0; i < fechas.length; i += BATCH) {
    const batch = fechas.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(fetchSumario));
    for (const r of results) {
      if (r.status === 'fulfilled') allConcursos.push(...r.value);
    }
  }

  allConcursos.forEach((c, i) => { c.id = i + 1; });

  res.json({
    concursos:  allConcursos,
    total:      allConcursos.length,
    fuente:     'BOE – Boletín Oficial del Estado',
    periodo:    `últimos ${dias} días hábiles`,
    actualizado: new Date().toISOString(),
  });
};
