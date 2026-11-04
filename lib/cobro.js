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

export function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Capacidad de gasto del período. Dos modos:
//  - "saldo": el usuario cargó lo que tiene hoy (`saldo` = { monto, pagado, fecha }). Se usa mientras
//    esa carga sea de este período (un cobro nuevo la deja vieja: la plata ya es otra).
//      libre = lo que tengo - lo comprometido que falta pagar - lo ahorrado después
//      (falta pagar = los grupos comprometidos que NO están tildados como pagados)
//  - "estimado": sin saldo, con lo cargado en la planilla: libre = ingresos del mes - comprometido - lo ahorrado.
//    No conoce el saldo real de la cuenta.
// El ahorro que se apartó en el período (`ahorros` = [{ fecha: "YYYY-MM-DD", montoARS }]) se descuenta de lo
// disponible: en modo estimado, todo lo apartado desde el último cobro; en modo saldo, solo lo apartado
// DESPUÉS de la fecha en que se cargó el saldo (lo anterior ya está reflejado en ese saldo).
// `hechos` = pagos únicos en transferencia o efectivo que YA se hicieron ([{ fecha, montoARS, creado, reserva }]): no son
// "falta pagar" (la plata ya salió). En modo saldo se descuentan los cargados DESPUÉS de cargar lo que se tiene
// (por hora de carga; sin hora, por fecha); los cargados antes ya están en ese saldo. El saldo es siempre
// lo que realmente hay en todas las cuentas. En modo estimado ya están dentro de lo comprometido.
// `reserva` (opcional) es lo que la regla de reserva aparta por ese gasto: se descuenta del disponible igual que el gasto
// (en modo saldo, solo si se cargó después de lo que se tiene; en modo estimado, todas las del período).
// En los dos: porDia = max(0, libre) / días que faltan hasta cobrar (hoy incluido).
// El piso NO se descuenta: es la plata para vivir, que es justo lo que se reparte por día.
// `meses` es la proyección (cada mes con key, ingresos, gastos).
export function calcularCapacidad(meses, hoy, saldo = null, ahorros = [], grupos = null, hechos = []) {
  const periodo = periodoDeCobro(hoy);
  const mes = (meses || []).find((m) => m.key === periodo.mesKey);
  if (!mes) return null;

  const desde = fechaISO(periodo.desde);
  const saldoValido = saldo && Number.isFinite(saldo.monto) && typeof saldo.fecha === 'string';
  const vigente = saldoValido && saldo.fecha >= desde && saldo.fecha <= fechaISO(hoy);

  const hoyISO = fechaISO(hoy);
  const sumarAhorros = (desdeISO, incluyeDesde) => (ahorros || [])
    .filter((a) => typeof a.fecha === 'string' && a.fecha <= hoyISO && (incluyeDesde ? a.fecha >= desdeISO : a.fecha > desdeISO))
    .reduce((acc, a) => acc + (Number(a.montoARS) || 0), 0);

  // Grupos comprometidos del mes (cada tarjeta, transferencias, efectivo). Sin detalle, todo es un solo grupo.
  // Una lista vacía significa "no queda nada por pagar"; solo la falta de lista (null) significa "sin detalle".
  const detalle = (Array.isArray(grupos) ? grupos : [{ id: '*', nombre: 'Lo comprometido', tipo: 'otro', total: mes.gastos }]);
  const idsPagados = new Set(vigente ? (saldo.pagados || []) : []);
  const gruposMarcados = detalle.map((g) => ({ ...g, pagado: idsPagados.has(g.id) }));

  let libre, pendiente = null, pagado = null, ahorrado = 0, gastado = 0, reservado = 0;
  const sumarReservas = (lista) => lista.reduce((acc, h) => acc + (Number(h.reserva) || 0), 0);
  const delPeriodo = (hechos || []).filter((h) => typeof h.fecha === 'string' && h.fecha >= desde && h.fecha <= hoyISO);
  if (vigente) {
    pagado = gruposMarcados.filter((g) => g.pagado).reduce((acc, g) => acc + g.total, 0);
    pendiente = gruposMarcados.filter((g) => !g.pagado).reduce((acc, g) => acc + g.total, 0);
    ahorrado = sumarAhorros(saldo.fecha, false);
    const despues = delPeriodo.filter((h) => (saldo.en && h.creado ? h.creado > saldo.en : h.fecha > saldo.fecha));
    gastado = despues.reduce((acc, h) => acc + (Number(h.montoARS) || 0), 0);
    reservado = sumarReservas(despues);
    libre = saldo.monto - pendiente - ahorrado - gastado - reservado;
  } else {
    ahorrado = sumarAhorros(desde, true);
    reservado = sumarReservas(delPeriodo);
    libre = mes.ingresos - mes.gastos - ahorrado - reservado;
  }
  return {
    modo: vigente ? 'saldo' : 'estimado',
    saldo: saldoValido ? { monto: saldo.monto, pagados: saldo.pagados || [], fecha: saldo.fecha, en: saldo.en || null } : null,
    grupos: gruposMarcados,
    ahorradoPeriodo: sumarAhorros(desde, true),
    saldoVencido: Boolean(saldoValido && !vigente),
    desde: periodo.desde, hasta: periodo.hasta,
    diasRestantes: periodo.diasRestantes, diasTotales: periodo.diasTotales,
    mesKey: periodo.mesKey,
    ingresos: mes.ingresos,
    comprometido: mes.gastos,
    pagado, pendiente, ahorrado, gastado, reservado,
    libre,
    porDia: libre > 0 ? libre / periodo.diasRestantes : 0,
    enDeficit: libre < 0
  };
}
