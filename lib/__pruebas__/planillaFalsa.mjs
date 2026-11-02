// Planilla de Google Sheets simulada en memoria, con la misma superficie de API que usa la app.
// Sirve para probar concurrencia, caché y borrado sin tocar datos reales. Simula:
//  - values.get / append / update / batchUpdate / clear, y spreadsheets.get / batchUpdate (addSheet, deleteDimension);
//  - append atómico (INSERT_ROWS después de la última fila con datos de las columnas pedidas);
//  - latencia configurable y una lectura que devuelve la FOTO tomada al empezar (como un servidor lento);
//  - USER_ENTERED: un texto que empieza con apóstrofo se guarda como texto (sin el apóstrofo) y uno que
//    empieza con "=" queda registrado como FÓRMULA en `formulas` (lo que se quiere evitar con datos del usuario);
//  - ganchos para que "otra instancia" modifique la planilla en medio de una operación.

const colAIndice = (letras) => letras.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
export const indiceACol = (i) => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

function parsearRango(rango) {
  const m = String(rango).match(/^(?:'([^']+)'|([^!]+))!(.+)$/);
  if (!m) throw new Error('rango inválido: ' + rango);
  const hoja = m[1] || m[2];
  const partes = m[3].split(':');
  const celda = (t) => { const x = t.match(/^([A-Z]+)(\d*)$/); if (!x) throw new Error('rango inválido: ' + rango); return { col: colAIndice(x[1]), fila: x[2] ? Number(x[2]) - 1 : null }; };
  const a = celda(partes[0]);
  const b = partes[1] ? celda(partes[1]) : a;
  return { hoja, c0: a.col, c1: b.col, r0: a.fila ?? 0, r1: b.fila ?? Infinity };
}

const vacio = (v) => v === '' || v === undefined || v === null;

export function crearPlanillaFalsa({ base = [], config = [], sinHojaConfig = false } = {}) {
  const hojas = { Base: base.map((f) => [...f]) };
  if (!sinHojaConfig) hojas.ConfigTablero = config.map((f) => [...f]);
  const ids = { Base: 111, ConfigTablero: 222 };
  const p = {
    hojas,
    llamadas: [],     // { tipo, rango? } de cada llamada a la API
    formulas: [],     // celdas escritas con USER_ENTERED que Sheets interpretaría como fórmula
    latencia: () => 0,
    alLlamar: null,   // (tipo, args, planilla) => void | Promise; se ejecuta antes de resolver la llamada
    fotoPrevia: null, // (args) => boolean
    cuenta(tipo, hoja) { return p.llamadas.filter((l) => l.tipo === tipo && (!hoja || (l.rango || '').startsWith(hoja + '!'))).length; }
  };

  async function entrar(tipo, args) {
    p.llamadas.push({ tipo, rango: args.range, args });
    const ms = typeof p.latencia === 'function' ? p.latencia(tipo, args) : p.latencia;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    else await Promise.resolve();
    if (p.alLlamar) await p.alLlamar(tipo, args, p);
  }

  function escribirCelda(hoja, fila, col, valor, userEntered) {
    if (valor === null) return; // como la API real: los null se saltean
    const h = hojas[hoja];
    while (h.length <= fila) h.push([]);
    while (h[fila].length <= col) h[fila].push('');
    let v = valor;
    if (userEntered && typeof v === 'string') {
      if (v.startsWith("'")) v = v.slice(1);
      else if (v.startsWith('=')) p.formulas.push({ hoja, celda: indiceACol(col) + (fila + 1), valor: v });
    }
    h[fila][col] = v;
  }

  function escribirBloque(hoja, filaIni, colIni, valores, userEntered) {
    valores.forEach((fila, i) => fila.forEach((v, j) => escribirCelda(hoja, filaIni + i, colIni + j, v, userEntered)));
  }

  function leer(rango) {
    const { hoja, c0, c1, r0, r1 } = parsearRango(rango);
    const h = hojas[hoja];
    if (!h) throw new Error('Unable to parse range: ' + rango);
    const ult = Math.min(r1, h.length - 1);
    const filas = [];
    for (let r = r0; r <= ult; r++) {
      const fila = (h[r] || []).slice(c0, Math.min(c1, (h[r] || []).length - 1) + 1).map((v) => (v === undefined ? '' : v));
      while (fila.length && vacio(fila[fila.length - 1])) fila.pop();
      filas.push(fila);
    }
    while (filas.length && filas[filas.length - 1].length === 0) filas.pop();
    return filas;
  }

  p.api = {
    spreadsheets: {
      async get(args) {
        await entrar('spreadsheets.get', args);
        return { data: { sheets: Object.keys(hojas).map((t) => ({ properties: { title: t, sheetId: ids[t] } })) } };
      },
      async batchUpdate(args) {
        await entrar('spreadsheets.batchUpdate', args);
        for (const req of args.requestBody.requests) {
          if (req.addSheet) {
            const t = req.addSheet.properties.title;
            if (hojas[t]) throw new Error('A sheet with the name "' + t + '" already exists.');
            hojas[t] = []; ids[t] = 300 + Object.keys(hojas).length;
          }
          if (req.deleteRange) {
            const d = req.deleteRange.range;
            const t = Object.keys(ids).find((k) => ids[k] === d.sheetId);
            const h = hojas[t];
            for (let r = d.startRowIndex; r < h.length; r++) {
              for (let c = d.startColumnIndex; c < d.endColumnIndex; c++) {
                const desde = r + (d.endRowIndex - d.startRowIndex);
                const v = desde < h.length && c < (h[desde] || []).length ? h[desde][c] : '';
                while (h[r].length <= c) h[r].push('');
                h[r][c] = v === undefined ? '' : v;
              }
            }
            while (h.length && h[h.length - 1].every(vacio)) h.pop();
          }
          if (req.deleteDimension) {
            const d = req.deleteDimension.range;
            const t = Object.keys(ids).find((k) => ids[k] === d.sheetId);
            hojas[t].splice(d.startIndex, d.endIndex - d.startIndex);
          }
        }
        return { data: {} };
      },
      values: {
        async get(args) {
          // Por defecto la lectura refleja el estado al RESPONDER. Con fotoPrevia(args) === true toma la foto
          // al EMPEZAR y la entrega después (un servidor lento): sirve para probar lecturas en vuelo.
          const previa = p.fotoPrevia && p.fotoPrevia(args);
          const foto = previa ? leer(args.range) : null;
          await entrar('values.get', args);
          return { data: { values: previa ? foto : leer(args.range) } };
        },
        async append(args) {
          await entrar('values.append', args);
          const { hoja, c0, c1 } = parsearRango(args.range);
          const h = hojas[hoja];
          let ultima = -1;
          h.forEach((fila, i) => { for (let c = c0; c <= Math.min(c1, fila.length - 1); c++) if (!vacio(fila[c])) { ultima = i; break; } });
          const destino = ultima + 1;
          if (args.insertDataOption === 'INSERT_ROWS') h.splice(destino, 0, []);
          escribirBloque(hoja, destino, c0, args.requestBody.values, args.valueInputOption === 'USER_ENTERED');
          const ancho = args.requestBody.values[0].length;
          return { data: { updates: { updatedRange: `${hoja}!${indiceACol(c0)}${destino + 1}:${indiceACol(c0 + ancho - 1)}${destino + 1}` } } };
        },
        async update(args) {
          await entrar('values.update', args);
          const { hoja, c0, r0 } = parsearRango(args.range);
          escribirBloque(hoja, r0, c0, args.requestBody.values, args.valueInputOption === 'USER_ENTERED');
          return { data: {} };
        },
        async batchUpdate(args) {
          await entrar('values.batchUpdate', { ...args, range: args.requestBody.data.map((d) => d.range).join(',') });
          for (const d of args.requestBody.data) {
            const { hoja, c0, r0 } = parsearRango(d.range);
            escribirBloque(hoja, r0, c0, d.values, args.requestBody.valueInputOption === 'USER_ENTERED');
          }
          return { data: {} };
        },
        async clear(args) {
          await entrar('values.clear', args);
          const { hoja, c0, c1, r0, r1 } = parsearRango(args.range);
          const h = hojas[hoja];
          for (let r = r0; r <= Math.min(r1, h.length - 1); r++) for (let c = c0; c <= c1; c++) if (h[r] && c < h[r].length) h[r][c] = '';
          while (h.length && h[h.length - 1].every(vacio)) h.pop();
          return { data: {} };
        }
      }
    }
  };

  // --- Lo que hace "otra instancia" de la app (u otra persona) directamente sobre la planilla ---
  p.otraInstanciaAgrega = (fila) => { hojas.Base.push([...fila]); return hojas.Base.length; };
  p.otraInstanciaBorra = (nroFila) => { hojas.Base.splice(nroFila - 1, 1); };
  p.otraInstanciaInserta = (nroFila, fila) => { hojas.Base.splice(nroFila - 1, 0, [...fila]); };
  p.config = () => Object.fromEntries((hojas.ConfigTablero || []).filter((f) => f[0]).map((f) => [f[0], f[1]]));
  p.otraInstanciaFijaConfig = (clave, valor) => {
    const h = hojas.ConfigTablero;
    const i = h.findIndex((f) => f[0] === clave);
    if (i >= 0) h[i] = [clave, valor]; else h.push([clave, valor]);
  };
  return p;
}

// ---- Construcción de filas con el mismo esquema de la planilla (A..O + id en AA) ----
export const ENCABEZADO = ['Gasto', 'Tipo', 'Medio de pago', 'Descripcion', 'Fecha de compra', 'Cantidad de cuotas', 'Moneda', 'Monto', 'Total', 'Estado', 'Forma de pago', 'Banco', 'Marca', 'Fecha de cierre', 'Categoria de gasto'];

export function filaGasto({ gasto = 'Gasto variable', tipo = 'Compra', desc = 'X', fecha = '01/11/2026', cuotas = 1, moneda = 'ARS', monto = 1000, formaPago = 'Efectivo', banco = '', marca = '', categoria = 'Supermercado', id = '' } = {}) {
  const f = new Array(27).fill('');
  f[0] = gasto; f[1] = tipo; f[2] = banco || formaPago; f[3] = desc; f[4] = fecha; f[5] = cuotas; f[6] = moneda; f[7] = monto; f[8] = monto * cuotas;
  f[10] = formaPago; f[11] = banco; f[12] = marca; f[14] = categoria; f[26] = id;
  return f;
}

// Tabla Tarjeta/Cierre en P:Q (como en la planilla real) a partir de la fila 22.
export function conTablaCierres(base, tabla = { Santander: 'Cuarto jueves', ICBC: 'Tercer jueves', MercadoPago: 'Primer jueves' }) {
  const filas = base.map((f) => [...f]);
  while (filas.length < 25) filas.push([]);
  const poner = (r, c, v) => { while (filas[r].length <= c) filas[r].push(''); filas[r][c] = v; };
  poner(21, 15, 'Tarjeta'); poner(21, 16, 'Cierre');
  Object.entries(tabla).forEach(([b, n], i) => { poner(22 + i, 15, b); poner(22 + i, 16, n); });
  return filas;
}
