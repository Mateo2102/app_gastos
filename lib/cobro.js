// Fecha de cobro y capacidad de gasto diaria. Todo es puro (sin Sheets ni red) para poder probarlo.
//
// Regla del usuario: el sueldo se cobra el último día hábil de cada mes y paga el MES SIGUIENTE
// (el que cobró a fin de octubre paga noviembre). El aguinaldo se cobra el último día hábil de
// diciembre y de junio, y por lo mismo paga enero y julio. "Día hábil" = lunes a viernes: los
// feriados nacionales no se consideran (casi nunca caen en el último día del mes).
//
// "Período" = desde el último cobro hasta el próximo. Sus gastos son los compromisos del mes que
// ese sueldo paga, que es el mes del próximo cobro.

// Último día hábil (lunes a viernes) del mes `month` (0-11) del año `year`.
export function ultimoDiaHabil(year, month) {
  const d = new Date(year, month + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

// "Hoy" como fecha local (sin hora) según una zona horaria; el servidor corre en UTC y de noche
// ya sería "mañana" en Argentina.
export function hoyEnZona(zona, ahora = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(ahora).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const DIA_MS = 24 * 60 * 60 * 1000;
const diasEntre = (a, b) => Math.round((b - a) / DIA_MS);

// Período de cobro que contiene a `hoy`. El mismo día del cobro ya empieza el período nuevo.
//  - desde / hasta: último cobro y próximo cobro
//  - mesKey: clave "YYYY-M" (mes en base 0) del mes que este sueldo paga (= el mes del próximo cobro)
//  - diasTotales / diasRestantes: días del período y días que faltan hasta el próximo cobro (hoy incluido)
export function periodoDeCobro(hoy) {
  const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const cobroEsteMes = ultimoDiaHabil(h.getFullYear(), h.getMonth());
  let desde, hasta;
  if (h < cobroEsteMes) {
    desde = ultimoDiaHabil(h.getFullYear(), h.getMonth() - 1);
    hasta = cobroEsteMes;
  } else {
    desde = cobroEsteMes;
    hasta = ultimoDiaHabil(h.getFullYear(), h.getMonth() + 1);
  }
  return {
    desde, hasta,
    mesKey: hasta.getFullYear() + '-' + hasta.getMonth(),
    diasTotales: diasEntre(desde, hasta),
    diasRestantes: diasEntre(h, hasta)
  };
}

// Capacidad de gasto del período.
//   libre         = ingresos del mes - comprometido - piso   (puede ser negativo: déficit)
//   porDia        = max(0, libre) / días que faltan hasta cobrar
// `meses` es la proyección (cada mes con key, ingresos, gastos). Es una ESTIMACIÓN: no conoce el saldo
// de la cuenta, solo lo que está cargado en la planilla.
export function calcularCapacidad(meses, piso, hoy) {
  const periodo = periodoDeCobro(hoy);
  const mes = (meses || []).find((m) => m.key === periodo.mesKey);
  if (!mes) return null;
  const libre = mes.ingresos - mes.gastos - piso;
  return {
    desde: periodo.desde, hasta: periodo.hasta,
    diasRestantes: periodo.diasRestantes, diasTotales: periodo.diasTotales,
    mesKey: periodo.mesKey,
    ingresos: mes.ingresos,
    comprometido: mes.gastos,
    piso,
    libre,
    porDia: libre > 0 ? libre / periodo.diasRestantes : 0,
    enDeficit: libre < 0
  };
}
