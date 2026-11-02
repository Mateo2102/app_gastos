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
