import { CONFIG } from './config';
import { getSheetsApi, getDataSheetTitle } from './sheetsClient';
import { parseFecha, getCardKeyAndN, convertirMontos } from './logic';

const NTEXT = { 'Primer jueves': 1, 'Segundo jueves': 2, 'Tercer jueves': 3, 'Cuarto jueves': 4 };

// Marcas de tarjeta soportadas por el formulario, en el orden en que se muestran.
export const MARCAS_TARJETA = ['VISA', 'AMEX', 'MASTERCARD'];
export const FORMAS_PAGO = ['Tarjeta de Crédito', 'Transferencia', 'Efectivo'];

// Trae toda el área de datos (A1:N) de la hoja principal en una sola llamada.
async function getRawGrid() {
  const sheets = getSheetsApi();
  const title = await getDataSheetTitle();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${title}!A1:N2000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return { title, values: resp.data.values || [] };
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
// K Forma de pago | L Banco | M Marca | N Fecha de cierre (solo compras nuevas en tarjeta)
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
    const n = getCardKeyAndN(banco, cierreMap);
    const { montoARS, montoUSD } = convertirMontos(montoOriginal, moneda, dolarBlue);
    rows.push({
      rowIndex: CONFIG.FIRST_DATA_ROW + (i - start),
      gasto, tipo: r[1], medio, desc, fecha: fechaCompra, cuotas, n,
      formaPago, banco, marca, fechaCierre,
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
  return rows.filter(r =>
    (r.gasto === 'Gasto fijo' || r.gasto === 'Gasto variable' || r.gasto === 'Ingreso extra') &&
    r.montoOriginal
  );
}

// Mapa Banco -> n° de jueves de cierre (para armar la fila "hipotética" del simulador)
export async function getCierreMap() {
  const { values } = await getRawGrid();
  return getCierreMapFromGrid(values);
}

export async function getOpciones() {
  const { values } = await getRawGrid();
  const { cierreMap } = parseDataRows(values, 0);
  const start = CONFIG.FIRST_DATA_ROW - 1;
  const tipos = new Set();
  for (let i = start; i < values.length; i++) {
    const v = String((values[i] || [])[1] || '').trim();
    if (v) tipos.add(v);
  }
  return {
    bancos: Object.keys(cierreMap),
    formasPago: FORMAS_PAGO,
    marcas: MARCAS_TARJETA,
    tipos: tipos.size ? [...tipos] : ['Suscripcion', 'Compra', 'Comisiones', 'Prestamos', 'Seguros'],
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
      row: r.rowIndex, tipo: r.tipo, medio: r.medio, desc: r.desc,
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
      return {
        row: r.rowIndex, gasto: r.gasto, tipo: r.tipo, medio: r.medio, desc: r.desc,
        formaPago: r.formaPago, banco: r.banco, marca: r.marca,
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

export async function agregarGasto(data) {
  const sheets = getSheetsApi();
  const title = await getDataSheetTitle();
  const { values } = await getRawGrid();
  const row = values.length + 1 < CONFIG.FIRST_DATA_ROW ? CONFIG.FIRST_DATA_ROW : values.length + 1;

  const fecha = data.fecha ? new Date(data.fecha) : new Date();
  const fechaStr = fmtFecha(fecha);
  const cuotas = Number(data.cuotas) || 1;
  const monto = Number(data.monto) || 0;
  const formaPago = data.formaPago || '';
  const banco = data.banco || '';
  const marca = formaPago === 'Tarjeta de Crédito' ? (data.marca || '') : '';
  const fechaCierreStr = (formaPago === 'Tarjeta de Crédito' && data.fechaCierre) ? fmtFecha(new Date(data.fechaCierre)) : '';
  const medio = medioLegado({ formaPago, banco, marca });

  const estadoFormula = `=LET(pDate;SI(E${row}="";HOY();E${row});card;C${row};cuotas;F${row};tipo;B${row};` +
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

  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${title}!A${row}:N${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data.gasto, data.tipo, medio, data.desc,
        fechaStr, cuotas, data.moneda || 'ARS', monto,
        `=H${row}*F${row}`, estadoFormula,
        formaPago, banco, marca, fechaCierreStr
      ]]
    }
  });

  return row;
}

export async function eliminarFila(rowNumber) {
  const sheets = getSheetsApi();
  const title = await getDataSheetTitle();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID });
  const sheetInfo = meta.data.sheets.find(s => s.properties.title === title);
  const sheetId = sheetInfo.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: Number(rowNumber) - 1,
            endIndex: Number(rowNumber)
          }
        }
      }]
    }
  });
}
