// Entrada de datos hacia la planilla: sanitización, validación e identidad de los registros.
// Todo es puro (sin Sheets ni red) para poder probarlo.

import { ErrorValidacion } from './errores.js';

export const CLASES_GASTO = ['Gasto fijo', 'Gasto variable', 'Ingreso extra'];
export const FORMAS_PAGO = ['Tarjeta de Crédito', 'Transferencia', 'Efectivo'];
export const MARCAS_TARJETA = ['VISA', 'AMEX', 'MASTERCARD'];
export const MONEDAS = ['ARS', 'USD'];

// Tope de cuotas aceptado al CARGAR (evita entradas absurdas que generarían millones de meses).
export const MAX_CUOTAS = 120;
const MAX_MONTO = 1e12;

// ---------- Sanitización ----------

// Google Sheets interpreta como FÓRMULA un texto que empiece con = + - @ (cuando se escribe con
// USER_ENTERED). Un texto así, venga de quien venga, se escribe con un apóstrofo delante: Sheets lo
// guarda como texto y no muestra el apóstrofo. También se sacan caracteres de control y se acota el largo.
export function textoSeguro(valor, max = 200) {
  let s = String(valor === null || valor === undefined ? '' : valor)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // sin control (se conserva solo \t y \n al medio)
    .replace(/[\t\n\r]+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max).trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// ---------- Fechas ----------

function fechaValida(d) {
  return d instanceof Date && !isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100;
}

// Fecha LOCAL real o null: "2026-13-45" no es una fecha (new Date la correría a otro mes sin avisar).
function fechaExacta(y, m, d) {
  const f = new Date(y, m - 1, d);
  return f.getFullYear() === y && f.getMonth() === m - 1 && f.getDate() === d ? f : null;
}

// "YYYY-MM-DD" o "DD/MM/YYYY" como fecha LOCAL (nunca UTC: correría la compra un día).
export function leerFecha(valor) {
  if (valor instanceof Date) return valor;
  const s = String(valor || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return fechaExacta(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return fechaExacta(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// ---------- Validación ----------

// Devuelve una copia limpia lista para escribir. Lanza ErrorValidacion con un mensaje claro.
export function validarGasto(entrada, ahora = new Date()) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};

  const gasto = String(e.gasto || '').trim();
  if (!CLASES_GASTO.includes(gasto)) throw new ErrorValidacion('El tipo de movimiento no es válido (gasto fijo, compra o ingreso).');

  const desc = textoSeguro(e.desc, 200);
  if (!desc || desc === "'") throw new ErrorValidacion('Escribí una descripción.');

  const monto = Number(e.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new ErrorValidacion('El monto tiene que ser mayor a 0.');
  if (monto > MAX_MONTO) throw new ErrorValidacion('El monto es demasiado grande.');

  const moneda = String(e.moneda || 'ARS').trim().toUpperCase();
  if (!MONEDAS.includes(moneda)) throw new ErrorValidacion('La moneda tiene que ser ARS o USD.');

  let cuotas = 1;
  if (gasto === 'Gasto variable') {
    const n = Number(e.cuotas === '' || e.cuotas === undefined || e.cuotas === null ? 1 : e.cuotas);
    if (!Number.isInteger(n) || n < 1) throw new ErrorValidacion('Las cuotas tienen que ser un número entero desde 1.');
    if (n > MAX_CUOTAS) throw new ErrorValidacion(`Las cuotas no pueden superar ${MAX_CUOTAS}.`);
    cuotas = n;
  }

  let fecha = ahora;
  if (e.fecha !== undefined && e.fecha !== null && String(e.fecha).trim() !== '') {
    fecha = leerFecha(e.fecha);
    if (!fechaValida(fecha)) throw new ErrorValidacion('La fecha no es válida.');
  }

  const formaPago = gasto === 'Ingreso extra' ? '' : String(e.formaPago || '').trim();
  if (formaPago && !FORMAS_PAGO.includes(formaPago)) throw new ErrorValidacion('La forma de pago no es válida.');

  const esTarjeta = formaPago === 'Tarjeta de Crédito';
  const marca = esTarjeta ? String(e.marca || '').trim().toUpperCase() : '';
  if (marca && !MARCAS_TARJETA.includes(marca)) throw new ErrorValidacion('La marca de la tarjeta no es válida.');

  let fechaCierre = null;
  if (esTarjeta && gasto === 'Gasto variable' && e.fechaCierre) {
    fechaCierre = leerFecha(e.fechaCierre);
    if (!fechaValida(fechaCierre)) throw new ErrorValidacion('La fecha de cierre no es válida.');
  }

  return {
    gasto,
    tipo: textoSeguro(e.tipo || 'Compra', 40),
    desc,
    fecha,
    cuotas,
    moneda,
    monto,
    formaPago,
    banco: (formaPago === 'Efectivo' || gasto === 'Ingreso extra') ? '' : textoSeguro(e.banco, 60),
    marca,
    fechaCierre,
    categoria: textoSeguro(e.categoria, 60)
  };
}

// ---------- Identidad de los registros ----------

export function nuevoId() {
  const c = globalThis.crypto;
  const base = c && c.randomUUID ? c.randomUUID().replace(/-/g, '') : (Date.now().toString(16) + Math.random().toString(16).slice(2));
  return 'g_' + base.slice(0, 16);
}

// Huella de contenido de una fila (columnas A..M de la planilla). Solo identifica filas VIEJAS que
// todavía no tienen id; si hay dos filas idénticas la huella no distingue (y se pide confirmar por fila).
export function huellaDeFila(r) {
  const campos = [r[0], r[3], r[4], r[5], r[6], r[7], r[10], r[11], r[12]].map((x) => String(x === undefined || x === null ? '' : x).trim());
  const texto = campos.join('|');
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const COLUMNA_ID = 26; // índice (0) de la columna AA: id estable del registro
// Vigencia de un gasto fijo (opcionales; vacío = sin límite):
export const COLUMNA_FIN = 27; // AB: último mes en que se paga
export const COLUMNA_PAUSA_DESDE = 28; // AC: primer mes pausado
export const COLUMNA_PAUSA_HASTA = 29; // AD: último mes pausado (vacío = sigue pausado)
// Cuándo se cargó el gasto en la app (milisegundos). Sirve para saber si un gasto se anotó antes o después de
// "lo que tengo" y no descontarlo dos veces. Las filas viejas no lo tienen.
export const COLUMNA_CREADO = 30; // AE
