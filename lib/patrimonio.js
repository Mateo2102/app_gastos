// "Todo lo que tengo": lo ahorrado a mano (cada movimiento con su lugar) más la cartera de IOL, por lugar y en total.
// Es puro (sin Sheets ni red) para poder probarlo. Lo de IOL llega solo desde la API: no se carga a mano, así no se cuenta dos veces.

export const LUGARES = ['Efectivo', 'Caja de seguridad', 'Cuenta bancaria', 'Billetera virtual', 'Otro'];
export const SIN_LUGAR = 'Sin ubicar';
export const LUGAR_IOL = 'IOL';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// movs: [{ monto, moneda: 'ARS' | 'USD', lugar? }]; cartera: la normalizada de IOL ({ total: { ars, usd } }) o null.
export function resumenPatrimonio(movs, cartera, dolarBlue = 0) {
  const porLugar = new Map();
  const sumar = (clave, nombre, ars, usd, automatico) => {
    if (!porLugar.has(clave)) porLugar.set(clave, { lugar: nombre, ars: 0, usd: 0, automatico });
    const fila = porLugar.get(clave);
    fila.ars += ars;
    fila.usd += usd;
  };

  (movs || []).forEach((m) => {
    const nombre = String((m && m.lugar) || '').trim() || SIN_LUGAR;
    const esUsd = String((m && m.moneda) || '').toUpperCase() === 'USD';
    sumar(nombre.toLowerCase(), nombre, esUsd ? 0 : num(m && m.monto), esUsd ? num(m && m.monto) : 0, false);
  });

  const incluyeIol = Boolean(cartera && cartera.total);
  if (incluyeIol) sumar('\u0000iol', LUGAR_IOL, num(cartera.total.ars), num(cartera.total.usd), true);

  const equiv = (f) => f.ars + f.usd * dolarBlue;
  const filas = [...porLugar.values()].filter((f) => f.ars !== 0 || f.usd !== 0 || f.automatico);
  const total = filas.reduce((acc, f) => ({ ars: acc.ars + f.ars, usd: acc.usd + f.usd }), { ars: 0, usd: 0 });
  const equivArs = total.ars + total.usd * dolarBlue;
  const lugares = filas
    .map((f) => ({ ...f, equivArs: equiv(f), parte: equivArs > 0 ? equiv(f) / equivArs : 0 }))
    .sort((a, b) => b.equivArs - a.equivArs);
  return {
    lugares, total, equivArs,
    equivUsd: total.usd + (dolarBlue ? total.ars / dolarBlue : 0),
    incluyeIol
  };
}

// ---------- Cartera de IOL en el evolutivo del ahorro ----------
// IOL guarda una foto por día de lo que vale la cartera ({ "2026-11-02": { ars, usd } }). Para el gráfico de ahorro acumulado se
// toma el valor al CIERRE de cada mes: la última foto hasta el último día de ese mes (si ese mes no se abrió la app, rige la
// última conocida). Los dólares se pasan a pesos con el `dolarBlue` indicado: IOL no guarda cotizaciones históricas.
// Devuelve null si todavía no hay ninguna foto (antes de conectar IOL).
export function valorIolAlCierre(fotos, year, month, dolarBlue = 0) {
  const ultimoDia = new Date(year, month + 1, 0).getDate();
  const fin = `${year}-${String(month + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  const dias = Object.keys(fotos || {}).filter((d) => d <= fin).sort();
  if (!dias.length) return null;
  const f = fotos[dias[dias.length - 1]] || {};
  return num(f.ars) + num(f.usd) * (dolarBlue || 0);
}

// A cada mes ({ year, month, ahorroReal, accReal }) le suma lo de IOL. `ahorroReal` / `accReal` son lo ahorrado a mano en el mes y
// acumulado (null en los meses futuros, que no tienen ahorro real: ahí tampoco hay IOL).
//  - iol: valor de la cartera al cierre del mes.
//  - iolMes: cuánto cambió ese valor en el mes (depósitos + ganancia o pérdida del mercado: IOL no los separa). En el primer mes con
//    foto es la cartera completa, porque entra entera desde que se conectó IOL. Así los meses suman exactamente el acumulado.
//  - ahorroRealTotal / accRealTotal: lo de a mano más lo de IOL, en el mes y acumulado.
export function acumuladoConIol(filas, fotos, dolarBlue = 0) {
  let previo = 0; // valor de IOL del mes anterior (0 antes de conectarlo)
  return (filas || []).map((m) => {
    const sinReal = m.accReal === null || m.accReal === undefined;
    const iol = sinReal ? null : valorIolAlCierre(fotos, m.year, m.month, dolarBlue);
    const iolMes = iol === null ? null : iol - previo;
    if (iol !== null) previo = iol;
    const ahorroManual = m.ahorroReal === null || m.ahorroReal === undefined ? null : m.ahorroReal;
    return {
      ...m, iol, iolMes,
      accRealTotal: sinReal ? null : m.accReal + (iol || 0),
      ahorroRealTotal: ahorroManual === null ? null : ahorroManual + (iolMes || 0)
    };
  });
}
