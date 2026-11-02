import { CONFIG } from './config.js';
import { getSheetsApi, getDataSheetTitle, exclusivo } from './sheetsClient.js';
import { parseFecha, getCardKeyAndN, convertirMontos, getCierreDias, getPaymentMonths } from './logic.js';
import { ErrorValidacion, ErrorNoEncontrado, ErrorConflicto } from './errores.js';
import { validarGasto, nuevoId, huellaDeFila, COLUMNA_ID, FORMAS_PAGO, MARCAS_TARJETA } from './entrada.js';

export { FORMAS_PAGO, MARCAS_TARJETA };

const NTEXT = { 'Primer jueves': 1, 'Segundo jueves': 2, 'Tercer jueves': 3, 'Cuarto jueves': 4 };

// ---------- Lectura de la planilla: caché / lectura fresca / invalidación ----------
// Son tres cosas distintas:
//   1. LECTURA CON CACHÉ (getRawGrid()): para mostrar datos. Puede tener hasta GRID_CACHE_MS de
//      antigüedad, y las lecturas simultáneas comparten una sola llamada a Sheets (la cuota es de
//      60 lecturas por minuto).
//   2. LECTURA FRESCA (getRawGrid({ fresco: true })): se saltea el caché. Es obligatoria antes de
//      cualquier operación que dependa de la posición o del contenido actual de las filas (borrar).
//   3. INVALIDACIÓN (invalidarGrilla()): toda escritura descarta el caché y además hace "avanzar la
//      generación" para que una lectura que ya estaba en vuelo (con datos anteriores a la escritura)
//      no vuelva a llenar el caché con información vieja.
const GRID_CACHE_MS = 30000;
const grilla = { cache: null, cacheAt: 0, enCurso: null, gen: 0 };

export function invalidarGrilla() {
  grilla.cache = null;
  grilla.cacheAt = 0;
  grilla.enCurso = null;
  grilla.gen++;
}

async function leerDeSheets() {
  const sheets = getSheetsApi();
  const title = await getDataSheetTitle();
  // Los datos usan A:O (+ el id en AA); la tabla de referencia "Tarjeta/Cierre" puede estar en
  // cualquier columna intermedia (hoy P:Q), así que se lee todo hasta AA y se la busca por contenido.
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${title}!A1:AA2000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return { title, values: resp.data.values || [] };
}

export async function getRawGrid({ fresco = false } = {}) {
  if (fresco) {
    const gen = grilla.gen;
    const g = await leerDeSheets();
    if (gen === grilla.gen) { grilla.cache = g; grilla.cacheAt = Date.now(); }
    return g;
  }
  if (grilla.cache && (Date.now() - grilla.cacheAt) < GRID_CACHE_MS) return grilla.cache;
  if (!grilla.enCurso) {
    const gen = grilla.gen;
    const lectura = leerDeSheets().then((g) => {
      if (gen === grilla.gen) { grilla.cache = g; grilla.cacheAt = Date.now(); }
      return g;
    });
    grilla.enCurso = lectura;
    const limpiar = () => { if (grilla.enCurso === lectura) grilla.enCurso = null; };
    lectura.then(limpiar, limpiar);
  }
  return grilla.enCurso;
}

// Busca la celda "Tarjeta" dentro de la grilla y arma el mapa Banco -> n° de jueves de cierre
function getCierreMapFromGrid(values) {
  const map = {};
  let cardRow = -1, cardCol = -1;
  outer:
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] || '').trim() === 'Tarjeta') { cardRow = r; cardCol = c; break outer; }
    }
  }
  if (cardRow === -1) return map;
  const cierreCol = cardCol + 1;
  let r = cardRow + 1;
  let safety = 0;
  while (safety < 20 && r < values.length) {
    const row = values[r] || [];
    const cardVal = row[cardCol];
    const cierreVal = row[cierreCol];
    // La tabla Tarjeta/Cierre comparte columnas con los datos de Moneda/Monto más abajo en la
    // hoja, así que además de cortar en la primera fila vacía, cortamos apenas el valor de
    // "cierre" deja de ser uno de los cuatro jueves válidos (evita leer filas de datos como si
    // fueran tarjetas nuevas).
    if (!cardVal || !NTEXT[String(cierreVal).trim()]) break;
    map[String(cardVal).trim()] = NTEXT[String(cierreVal).trim()];
    r++; safety++;
  }
  return map;
}

// Filas de datos (desde FIRST_DATA_ROW) ya tipadas.
// Columnas: A Gasto | B Tipo | C Medio de pago (legado, texto compuesto) | D Descripcion |
// E Fecha de compra | F Cantidad de cuotas | G Moneda | H Monto | I Total | J Estado |
// K Forma de pago | L Banco | M Marca | N Fecha de cierre (solo compras nuevas en tarjeta) |
// O Categoría | AA id estable del registro (las filas viejas no lo tienen hasta completarlo)
function parseDataRows(values, dolarBlue) {
  const cierreMap = getCierreMapFromGrid(values);
  const start = CONFIG.FIRST_DATA_ROW - 1; // índice 0-based
  const rows = [];
  for (let i = start; i < values.length; i++) {
    const r = values[i] || [];
    const gasto = String(r[0] || '').trim();
    if (!gasto) continue;
    const medio = r[2], desc = r[3], fecha = r[4];
    const cuotas = Number(r[5]) || 0;
    const moneda = String(r[6] || 'ARS').trim();
    const montoOriginal = Number(r[7]) || 0;
    const totalOriginal = Number(r[8]) || 0;
    const fechaCompra = parseFecha(fecha);
    const formaPago = String(r[10] || '').trim();
    const banco = String(r[11] || '').trim();
    const marca = String(r[12] || '').trim();
    const fechaCierre = parseFecha(r[13]);
    const categoria = String(r[14] || '').trim(); // columna O: categoría de gasto (la define el usuario)
    const id = String(r[COLUMNA_ID] || '').trim();
    const huella = huellaDeFila(r);
    const n = getCardKeyAndN(banco, cierreMap);
    const { montoARS, montoUSD } = convertirMontos(montoOriginal, moneda, dolarBlue);
    rows.push({
      rowIndex: CONFIG.FIRST_DATA_ROW + (i - start),
      id, huella, ref: id || ('h:' + huella),
      gasto, tipo: r[1], medio, desc, fecha: fechaCompra, cuotas, n,
      formaPago, banco, marca, fechaCierre, categoria,
      moneda, montoOriginal, monto: montoARS, montoARS, montoUSD,
      totalOriginal, estado: r[9]
    });
  }
  return { rows, cierreMap };
}

// Solo Gasto fijo / Gasto variable / Ingreso extra, con monto > 0 (equivalente a readRows_ original)
export async function readRows(dolarBlue) {
  const { values } = await getRawGrid();
  const { rows } = parseDataRows(values, dolarBlue);
  const cierreDias = await getCierreDias();
  return rows
    .filter(r =>
      (r.gasto === 'Gasto fijo' || r.gasto === 'Gasto variable' || r.gasto === 'Ingreso extra') &&
      r.montoOriginal
    )
    // Día de cierre configurado para el banco de cada compra (si hay): el mes de pago se calcula
    // en getPaymentMonths a partir de la fecha de compra, que nunca se modifica.
    .map(r => ({ ...r, cierreDia: cierreDias[r.banco] || null }));
}

// Mapa Banco -> n° de jueves de cierre (para armar la fila "hipotética" del simulador)
export async function getCierreMap() {
  const { values } = await getRawGrid();
  return getCierreMapFromGrid(values);
}

export async function getOpciones() {
  const { values } = await getRawGrid();
  const cierreMap = getCierreMapFromGrid(values);
  const start = CONFIG.FIRST_DATA_ROW - 1;
  const tipos = new Set();
  const categorias = new Set();
  for (let i = start; i < values.length; i++) {
    const v = String((values[i] || [])[1] || '').trim();
    if (v) tipos.add(v);
    const c = String((values[i] || [])[14] || '').trim();
    if (c) categorias.add(c);
  }
  return {
    bancos: Object.keys(cierreMap),
    // Regla de cierre "jueves" de la planilla por banco: el formulario la necesita para calcular el
    // mismo mes de pago que la proyección cuando el banco no tiene día de cierre configurado.
    cierreN: cierreMap,
    formasPago: FORMAS_PAGO,
    marcas: MARCAS_TARJETA,
    tipos: tipos.size ? [...tipos] : ['Suscripcion', 'Compra', 'Comisiones', 'Prestamos', 'Seguros'],
    categorias: [...categorias].sort(),
    gastos: ['Gasto fijo', 'Gasto variable', 'Ingreso extra'],
    monedas: ['ARS', 'USD']
  };
}

export async function getGastosFijos(dolarBlue) {
  const { values } = await getRawGrid();
  const { rows } = parseDataRows(values, dolarBlue);
  return rows
    .filter(r => r.gasto === 'Gasto fijo')
    .map(r => ({
      row: r.rowIndex, id: r.id, ref: r.ref, tipo: r.tipo, medio: r.medio, desc: r.desc,
      formaPago: r.formaPago, banco: r.banco, marca: r.marca,
      moneda: r.moneda, monto: r.montoOriginal, montoARS: r.montoARS, montoUSD: r.montoUSD
    }));
}

function fmtFecha(d) {
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export async function getHistorico(desde, hasta, dolarBlue) {
  const { values } = await getRawGrid();
  const { rows } = parseDataRows(values, dolarBlue);
  const cierreDias = await getCierreDias();
  const dDesde = desde ? parseFecha(desde) : null;
  const dHasta = hasta ? parseFecha(hasta) : null;

  const lista = rows
    .filter(r => {
      if (dDesde && (!r.fecha || r.fecha < dDesde)) return false;
      if (dHasta && (!r.fecha || r.fecha > dHasta)) return false;
      return true;
    })
    .map(r => {
      const totalConv = convertirMontos(r.totalOriginal, r.moneda, dolarBlue);
      // Mes en que se paga (primera y última cuota) con el sueldo: derivado de la fecha de
      // compra + cierre de la tarjeta, aparte de la fecha real del gasto.
      const pagos = r.gasto === 'Gasto variable' ? getPaymentMonths({ ...r, cierreDia: cierreDias[r.banco] || null }) : [];
      return {
        mesPago: pagos[0] || null, ultimoMesPago: pagos[pagos.length - 1] || null,
        row: r.rowIndex, id: r.id, ref: r.ref, gasto: r.gasto, tipo: r.tipo, medio: r.medio, desc: r.desc,
        formaPago: r.formaPago, banco: r.banco, marca: r.marca, categoria: r.categoria,
        fecha: fmtFecha(r.fecha),
        cuotas: r.cuotas, moneda: r.moneda,
        monto: r.montoOriginal, montoARS: r.montoARS, montoUSD: r.montoUSD,
        total: r.totalOriginal, totalARS: totalConv.montoARS, totalUSD: totalConv.montoUSD,
        estado: r.estado
      };
    });
  lista.sort((a, b) => a.row - b.row);
  return lista;
}

// Arma el texto de "Medio de pago" (columna C, legado) a partir de los campos nuevos, para que
// la planilla siga siendo legible a simple vista y la fórmula de Estado (que busca "Santander"/
// "ICBC"/"MercadoPago" dentro de esa celda) siga funcionando sin cambios.
function medioLegado({ formaPago, banco, marca }) {
  if (formaPago === 'Tarjeta de Crédito') return [marca, banco].filter(Boolean).join(' ');
  return banco || formaPago || '';
}

function formulaEstado(row) {
  return `=LET(pDate;SI(E${row}="";HOY();E${row});card;C${row};cuotas;F${row};tipo;B${row};` +
    `cardKey;IFS(ESNUMERO(HALLAR("Santander";card));"Santander";ESNUMERO(HALLAR("ICBC";card));"ICBC";` +
    `ESNUMERO(HALLAR("MercadoPago";card));"MercadoPago";VERDADERO;"");` +
    `nText;BUSCARX(cardKey;$D$38:$D$40;$E$38:$E$40;"");` +
    `n;SWITCH(nText;"Primer jueves";1;"Segundo jueves";2;"Tercer jueves";3;"Cuarto jueves";4;0);` +
    `mDate;FECHA(AÑO(pDate);MES(pDate);1);` +
    `firstClosing;mDate+RESIDUO(4-DIASEM(mDate;2);7)+(n-1)*7;` +
    `startClosing;SI(pDate<=firstClosing;firstClosing;FECHA.MES(mDate;1)+RESIDUO(4-DIASEM(FECHA.MES(mDate;1);2);7)+(n-1)*7);` +
    `targetMonth;FECHA(AÑO(FECHA.MES(startClosing;cuotas-1));MES(FECHA.MES(startClosing;cuotas-1));1);` +
    `targetClosing;targetMonth+RESIDUO(4-DIASEM(targetMonth;2);7)+(n-1)*7;` +
    `estadoBase;SI(n=0;"N/A";SI(targetClosing>=HOY();"En curso";"Cerrado"));` +
    `SI(Y(estadoBase="Cerrado";NO(O(tipo="Compra";tipo="Comisiones")));"Gasto Fijo";estadoBase))`;
}

// "Base!A57:AA57" o "'Mi hoja'!A57:AA57" -> 57
export function filaDeRango(rango) {
  const m = String(rango || '').match(/!\$?[A-Z]+\$?(\d+)(?::|$)/);
  return m ? Number(m[1]) : null;
}

// ---------- Escritura ----------

// Agrega un registro. Garantías:
//  - La entrada se valida y se sanitiza (los textos que Sheets leería como fórmula van como texto).
//  - La fila NO se calcula a partir de una lectura (podría estar vieja y pisar otro registro): se usa
//    values.append, que Sheets resuelve de forma atómica en el servidor.
//  - Cada registro nace con un id estable (columna AA) escrito en la misma operación.
//  - Dentro de esta instancia las escrituras se ejecutan de a una.
export async function agregarGasto(entrada) {
  const g = validarGasto(entrada);
  return exclusivo(async () => {
    try {
      const sheets = getSheetsApi();
      const title = await getDataSheetTitle();
      const id = nuevoId();

      // A..O llevan texto ('' = vacío); P..Z van en null: Sheets los SALTEA (no escribe ni borra), así la
      // tabla Tarjeta/Cierre u otro contenido de esas columnas nunca se pisa. El id va en AA.
      const fila = new Array(COLUMNA_ID + 1).fill(null);
      for (let i = 0; i < 15; i++) fila[i] = '';
      fila[0] = g.gasto;
      fila[1] = g.tipo;
      fila[2] = medioLegado(g);
      fila[3] = g.desc;
      fila[4] = fmtFecha(g.fecha);
      fila[5] = g.cuotas;
      fila[6] = g.moneda;
      fila[7] = g.monto;
      // I (Total) y J (Estado) son fórmulas que llevan el número de fila: se escriben recién cuando se conoce.
      fila[10] = g.formaPago;
      fila[11] = g.banco;
      fila[12] = g.marca;
      fila[13] = g.fechaCierre ? fmtFecha(g.fechaCierre) : '';
      fila[14] = g.categoria;
      fila[COLUMNA_ID] = id;

      const resp = await sheets.spreadsheets.values.append({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: `${title}!A:O`,
        valueInputOption: 'USER_ENTERED',
        // Sin insertDataOption (OVERWRITE): escribe en la primera fila libre de la tabla A:O y no desplaza
        // nada de otras columnas (INSERT_ROWS insertaría una fila entera y movería lo que haya debajo).
        requestBody: { values: [fila] }
      });

      let row = filaDeRango(resp && resp.data && resp.data.updates && resp.data.updates.updatedRange);
      if (!row) {
        // Si Sheets no informó el rango, el id recién escrito permite ubicar la fila.
        const fresca = await getRawGrid({ fresco: true });
        const i = fresca.values.findIndex((v) => String((v || [])[COLUMNA_ID] || '').trim() === id);
        row = i >= 0 ? i + 1 : null;
      }

      if (row) {
        try {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: CONFIG.SPREADSHEET_ID,
            requestBody: {
              valueInputOption: 'USER_ENTERED',
              data: [{ range: `${title}!I${row}:J${row}`, values: [[`=H${row}*F${row}`, formulaEstado(row)]] }]
            }
          });
        } catch (e) {
          // El registro ya está guardado; solo faltan las fórmulas de Total/Estado. No se reintenta la carga.
          console.error('Registro guardado sin fórmulas de Total/Estado (fila ' + row + '):', e);
        }
      }

      await completarIdsFaltantes(title);
      return { row, id };
    } finally {
      invalidarGrilla();
    }
  });
}

// Las filas cargadas antes de existir el id se completan (solo la columna AA), con lectura fresca.
// Debe correr dentro de una escritura exclusiva.
async function completarIdsFaltantes(title) {
  const sheets = getSheetsApi();
  const g = await getRawGrid({ fresco: true });
  const start = CONFIG.FIRST_DATA_ROW - 1;
  const data = [];
  for (let i = start; i < g.values.length; i++) {
    const r = g.values[i] || [];
    if (!String(r[0] || '').trim()) continue;
    if (!String(r[COLUMNA_ID] || '').trim()) data.push({ range: `${title}!AA${i + 1}`, values: [[nuevoId()]] });
  }
  if (!data.length) return 0;
  const encabezado = String(((g.values[0] || [])[COLUMNA_ID]) || '').trim();
  if (!encabezado) data.push({ range: `${title}!AA1`, values: [['id']] });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data }
  });
  return data.length;
}

// Posición (índice 0) de la fila a la que apunta `ref` dentro de `values`. `ref` es un id estable o,
// para filas viejas sin id, 'h:' + huella de contenido. `filaSugerida` (n° de fila que vio el usuario)
// solo sirve para desempatar; nunca se borra "esa fila" sin comprobar que sea la misma.
export function ubicarFila(values, ref, filaSugerida) {
  const esHuella = String(ref).startsWith('h:');
  const clave = esHuella ? String(ref).slice(2) : String(ref);
  const start = CONFIG.FIRST_DATA_ROW - 1;
  const coincidencias = [];
  for (let i = start; i < values.length; i++) {
    const r = values[i] || [];
    if (!String(r[0] || '').trim()) continue;
    const valor = esHuella ? huellaDeFila(r) : String(r[COLUMNA_ID] || '').trim();
    if (valor === clave) coincidencias.push(i);
  }
  if (coincidencias.length === 0) {
    throw new ErrorNoEncontrado('Ese registro ya no está en la planilla (se borró o cambió). Recargá la página.');
  }
  if (coincidencias.length === 1) return coincidencias[0];
  const sugerida = Number(filaSugerida);
  const elegida = coincidencias.find((i) => i + 1 === sugerida);
  if (elegida === undefined) {
    throw new ErrorConflicto('Hay más de un registro igual y no se puede saber cuál querés borrar. No se borró nada.');
  }
  return elegida;
}

function mismaFila(valores, ref) {
  const r = valores || [];
  if (String(ref).startsWith('h:')) return huellaDeFila(r) === String(ref).slice(2);
  return String(r[COLUMNA_ID] || '').trim() === String(ref);
}

let _sheetId = null;
async function getSheetId(title) {
  if (_sheetId && _sheetId.title === title) return _sheetId.id;
  const sheets = getSheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID });
  const hoja = meta.data.sheets.find((s) => s.properties.title === title);
  if (!hoja) throw new ErrorNoEncontrado('No se encontró la hoja de datos.');
  _sheetId = { title, id: hoja.properties.sheetId };
  return _sheetId.id;
}

// Elimina un registro por su referencia (id estable, o huella de contenido para filas viejas).
// NUNCA borra por número de fila: la posición se calcula con una lectura FRESCA y se vuelve a
// comprobar (una lectura mínima de esa fila) justo antes de borrar. Si algo cambió o es ambiguo, no se
// borra nada y se informa.
export async function eliminarGasto({ ref, filaSugerida } = {}) {
  if (!ref || typeof ref !== 'string') throw new ErrorValidacion('Falta indicar qué registro eliminar.');
  return exclusivo(async () => {
    try {
      const sheets = getSheetsApi();
      const fresca = await getRawGrid({ fresco: true });
      const title = fresca.title;
      const i = ubicarFila(fresca.values, ref, filaSugerida);

      const chequeo = await sheets.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: `${title}!A${i + 1}:AA${i + 1}`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });
      const actual = (chequeo.data.values || [[]])[0] || [];
      if (!mismaFila(actual, ref)) {
        throw new ErrorConflicto('La planilla cambió mientras se eliminaba. No se borró nada; recargá y probá de nuevo.');
      }

      const sheetId = await getSheetId(title);
      // Se borran solo las celdas del registro (datos A:O + id AA) y lo de abajo sube. NO se borra la fila
      // entera: la tabla Tarjeta/Cierre (P:Q) vive en las mismas filas y se llevaría puesta una tarjeta.
      const celdas = (c0, c1) => ({ deleteRange: { range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: c0, endColumnIndex: c1 }, shiftDimension: 'ROWS' } });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        requestBody: { requests: [celdas(0, 15), celdas(COLUMNA_ID, COLUMNA_ID + 1)] }
      });
      return { fila: i + 1 };
    } finally {
      invalidarGrilla();
    }
  });
}

// ---------- Solo para tests ----------
export const __prueba = {
  reiniciar() { invalidarGrilla(); grilla.gen = 0; _sheetId = null; }
};
