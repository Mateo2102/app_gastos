// Pagos únicos ya hechos (transferencia / efectivo): no son "falta pagar" y, si se cargaron después de
// "lo que tengo", se descuentan del disponible. La idea: lo que ves es siempre la suma de todas tus cuentas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularCapacidad } from './cobro.js';
import { crearPlanillaFalsa, filaGasto, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const logic = await import('./logic.js');
const dashboard = await import('./dashboard.js');

const d = (y, m, dia) => new Date(y, m - 1, dia);
const MESES = [{ key: '2026-10', ingresos: 2000000, gastos: 1300000 }]; // período 30/10 -> 30/11
const HOY = d(2026, 11, 4);
const T0 = 1793800000000; // cuándo se cargó "lo que tengo"

test('un pago único hecho DESPUÉS de cargar lo que tengo se descuenta del disponible', () => {
  const saldo = { monto: 212468, pagados: [], fecha: '2026-11-04', en: T0 };
  const c = calcularCapacidad(MESES, HOY, saldo, [], null, [{ fecha: '2026-11-04', montoARS: 10000, creado: T0 + 60000 }]);
  assert.equal(c.gastado, 10000);
  assert.equal(c.libre, 212468 - 1300000 - 10000, 'sin grupos todo lo comprometido es pendiente; lo hecho se resta aparte');
});

test('un pago único cargado ANTES de lo que tengo ya está en ese saldo: no se descuenta dos veces', () => {
  const saldo = { monto: 212468, pagados: [], fecha: '2026-11-04', en: T0 };
  const c = calcularCapacidad(MESES, HOY, saldo, [], [{ id: 'x', nombre: 'X', tipo: 'otro', total: 0 }], [{ fecha: '2026-11-04', montoARS: 10000, creado: T0 - 60000 }]);
  assert.equal(c.gastado, 0);
  assert.equal(c.libre, 212468);
});

test('sin hora de carga (filas viejas) se decide por fecha: el mismo día del saldo se da por incluido', () => {
  const saldo = { monto: 100000, pagados: [], fecha: '2026-11-04', en: T0 };
  const grupos = [{ id: 'x', nombre: 'X', tipo: 'otro', total: 0 }];
  const mismoDia = calcularCapacidad(MESES, HOY, saldo, [], grupos, [{ fecha: '2026-11-04', montoARS: 5000, creado: null }]);
  assert.equal(mismoDia.gastado, 0);
  const despues = calcularCapacidad(MESES, d(2026, 11, 6), saldo, [], grupos, [{ fecha: '2026-11-05', montoARS: 5000, creado: null }]);
  assert.equal(despues.gastado, 5000, 'un gasto de un día posterior al saldo sí se descuenta');
});

test('un saldo viejo sin hora (guardado antes de esta versión) también decide por fecha', () => {
  const saldo = { monto: 100000, pagados: [], fecha: '2026-11-03' }; // sin `en`
  const grupos = [{ id: 'x', nombre: 'X', tipo: 'otro', total: 0 }];
  const c = calcularCapacidad(MESES, HOY, saldo, [], grupos, [{ fecha: '2026-11-04', montoARS: 7000, creado: T0 }]);
  assert.equal(c.gastado, 7000);
});

test('en modo estimado no se descuenta aparte: ya está dentro de lo comprometido', () => {
  const c = calcularCapacidad(MESES, HOY, null, [], null, [{ fecha: '2026-11-04', montoARS: 10000, creado: T0 }]);
  assert.equal(c.gastado, 0);
  assert.equal(c.libre, 700000);
});

// ---------------------------------------------------------------- de punta a punta, con la planilla de mentira

function nueva(base, saldo) {
  const p = crearPlanillaFalsa({
    base,
    config: [
      ['DOLAR_BLUE_CACHE', '1500'], ['DOLAR_BLUE_CACHE_TS', String(Date.now())],
      ['SUELDO_SCHEDULE', JSON.stringify([{ key: '2026-8', monto: 1000000 }])], ['PISO_DISPONIBLE', '0'],
      ['SALDO_ACTUAL', JSON.stringify(saldo)]
    ]
  });
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}
const AHORA = new Date('2026-11-04T15:00:00Z'); // 04/11 en Argentina
const unico = (id, creado) => { const f = filaGasto({ desc: 'Transferencia de hoy', monto: 10000, formaPago: 'Transferencia', banco: 'Santander', fecha: '04/11/2026', id }); f[30] = creado; return f; };
const cuota = () => filaGasto({ desc: 'Cuota moto', monto: 5000, cuotas: 10, formaPago: 'Transferencia', banco: 'Santander', fecha: '01/11/2026', id: 'g_c' });

test('el caso real: el pago único de hoy NO figura como "falta pagar" y se descuenta si se cargó después', async () => {
  nueva([ENCABEZADO, unico('g_u', T0 + 1000), cuota()], { monto: 212468, pagados: [], fecha: '2026-11-04', en: T0 });
  const { capacidad: c } = await dashboard.getDashboardData(null, null, AHORA);
  assert.equal(c.modo, 'saldo');
  assert.equal(c.pendiente, 5000, 'solo la cuota que falta pagar: los $10.000 ya salieron');
  assert.equal(c.gastado, 10000);
  assert.equal(c.libre, 212468 - 5000 - 10000);
  assert.deepEqual(c.grupos.map((g) => g.total), [5000], 'el grupo de transferencias no incluye el pago único hecho');
});

test('el mismo pago único cargado ANTES de poner lo que tengo no se descuenta', async () => {
  nueva([ENCABEZADO, unico('g_u', T0 - 1000), cuota()], { monto: 212468, pagados: [], fecha: '2026-11-04', en: T0 });
  const { capacidad: c } = await dashboard.getDashboardData(null, null, AHORA);
  assert.equal(c.gastado, 0);
  assert.equal(c.pendiente, 5000);
  assert.equal(c.libre, 212468 - 5000);
});

test('un pago único con fecha futura sí sigue como "falta pagar" (todavía no salió)', async () => {
  const futuro = filaGasto({ desc: 'Futuro', monto: 8000, formaPago: 'Transferencia', banco: 'Santander', fecha: '20/11/2026', id: 'g_f' });
  nueva([ENCABEZADO, futuro], { monto: 100000, pagados: [], fecha: '2026-11-04', en: T0 });
  const { capacidad: c } = await dashboard.getDashboardData(null, null, AHORA);
  assert.equal(c.pendiente, 8000);
  assert.equal(c.gastado, 0);
});

test('con tarjeta de crédito un pago único NO cuenta como hecho: se paga con el resumen', async () => {
  const tarjeta = filaGasto({ desc: 'Con tarjeta', monto: 9000, formaPago: 'Tarjeta de Crédito', banco: 'ICBC', marca: 'VISA', fecha: '04/11/2026', id: 'g_t' });
  tarjeta[30] = T0 + 1000;
  nueva([ENCABEZADO, tarjeta], { monto: 100000, pagados: [], fecha: '2026-11-04', en: T0 });
  const { capacidad: c } = await dashboard.getDashboardData(null, null, AHORA);
  assert.equal(c.gastado, 0);
});

test('cargar un gasto guarda la hora de carga en la columna AE; guardar lo que tengo guarda su hora', async () => {
  const p = nueva([ENCABEZADO], null);
  await data.agregarGasto({ gasto: 'Gasto variable', desc: 'X', monto: 1000, moneda: 'ARS', cuotas: 1, fecha: '2026-11-04', formaPago: 'Transferencia', banco: 'Santander', categoria: 'Otro' }, 1793800123456);
  assert.equal(p.hojas.Base[1][30], 1793800123456);
  const filas = await data.readRows(1500);
  assert.equal(filas[0].creado, 1793800123456);
  await logic.guardarSaldo({ monto: '5000', pagados: [] }, { ahora: new Date(1793800999000) });
  assert.equal((await logic.getConfiguracion()).saldoActual.en, 1793800999000);
});

test('compromisosPorCuenta con `hoy` deja afuera los pagos únicos hechos; sin `hoy` suma todo', () => {
  const rows = [
    { gasto: 'Gasto variable', monto: 10000, cuotas: 1, formaPago: 'Transferencia', banco: 'Santander', fecha: d(2026, 11, 4) },
    { gasto: 'Gasto variable', monto: 5000, cuotas: 10, formaPago: 'Transferencia', banco: 'Santander', fecha: d(2026, 11, 1) },
    { gasto: 'Gasto variable', monto: 700, cuotas: 1, formaPago: 'Efectivo', fecha: d(2026, 11, 2) }
  ];
  const todos = logic.compromisosPorCuenta(rows, 2026, 10);
  assert.equal(todos.reduce((acc, g) => acc + g.total, 0), 15700);
  const faltan = logic.compromisosPorCuenta(rows, 2026, 10, { hoy: d(2026, 11, 4) });
  assert.deepEqual(faltan.map((g) => [g.id, g.total]), [['t:Santander', 5000]]);
});

test('si no queda nada por pagar (lista de pendientes vacía) NO se vuelve a contar todo el mes como pendiente', () => {
  const saldo = { monto: 50000, pagados: [], fecha: '2026-11-04', en: T0 };
  const c = calcularCapacidad(MESES, HOY, saldo, [], []);
  assert.equal(c.pendiente, 0);
  assert.equal(c.libre, 50000);
  const sinDetalle = calcularCapacidad(MESES, HOY, saldo, [], null);
  assert.equal(sinDetalle.pendiente, 1300000, 'sin lista (null) sí se asume todo el comprometido');
});

// ---------------------------------------------------------------- guardado automático: la hora de "lo que tengo"

test('tildar o cambiar el ahorro (mismo monto) NO renueva la hora de "lo que tengo"; cambiar el monto sí', async () => {
  nueva([ENCABEZADO], null);
  const t1 = new Date('2026-11-04T15:00:00Z');
  const t2 = new Date('2026-11-04T18:00:00Z');
  const t3 = new Date('2026-11-04T21:00:00Z');
  await logic.guardarSaldo({ monto: '212468', pagados: [] }, { ahora: t1 });
  assert.equal((await logic.getConfiguracion()).saldoActual.en, t1.getTime());
  // más tarde se tilda una tarjeta: el guardado automático manda el mismo monto y actualizarHora: false
  await logic.guardarSaldo({ monto: '212468', pagados: ['c:VISA ICBC'], actualizarHora: false }, { ahora: t2 });
  let s = (await logic.getConfiguracion()).saldoActual;
  assert.deepEqual(s.pagados, ['c:VISA ICBC'], 'el tilde se guardó');
  assert.equal(s.en, t1.getTime(), 'la hora sigue siendo la de cuando se puso el monto');
  // el usuario cambia el monto: ahí sí es una nueva afirmación de lo que tiene
  await logic.guardarSaldo({ monto: '200000', pagados: ['c:VISA ICBC'] }, { ahora: t3 });
  s = (await logic.getConfiguracion()).saldoActual;
  assert.equal(s.en, t3.getTime());
  assert.equal(s.monto, 200000);
});

test('con actualizarHora: false pero un monto distinto (o sin saldo previo) igual toma la hora nueva', async () => {
  nueva([ENCABEZADO], null);
  const t1 = new Date('2026-11-04T15:00:00Z');
  const t2 = new Date('2026-11-04T18:00:00Z');
  await logic.guardarSaldo({ monto: '100', pagados: [], actualizarHora: false }, { ahora: t1 });
  assert.equal((await logic.getConfiguracion()).saldoActual.en, t1.getTime(), 'sin saldo previo no hay hora que conservar');
  await logic.guardarSaldo({ monto: '150', pagados: [], actualizarHora: false }, { ahora: t2 });
  assert.equal((await logic.getConfiguracion()).saldoActual.en, t2.getTime(), 'si el monto cambió, es un saldo nuevo');
});

test('un saldo de un período anterior no se conserva aunque el monto coincida', async () => {
  nueva([ENCABEZADO], { monto: 500, pagados: [], fecha: '2026-10-20', en: 1790000000000 });
  const t = new Date('2026-11-04T15:00:00Z');
  await logic.guardarSaldo({ monto: '500', pagados: ['x'], actualizarHora: false }, { ahora: t });
  const s = (await logic.getConfiguracion()).saldoActual;
  assert.equal(s.fecha, '2026-11-04');
  assert.equal(s.en, t.getTime());
});

test('el efecto real: tildar después de cargar un gasto no hace que el gasto se dé por incluido', async () => {
  const t0 = new Date('2026-11-04T15:00:00Z').getTime();
  const gasto = filaGasto({ desc: 'Después', monto: 10000, formaPago: 'Transferencia', banco: 'Santander', fecha: '04/11/2026', id: 'g_d' });
  gasto[30] = t0 + 3600000; // se cargó 1 hora después de poner lo que tengo
  nueva([ENCABEZADO, gasto], { monto: 100000, pagados: [], fecha: '2026-11-04', en: t0 });
  // un tilde automático más tarde (misma cifra) no debe mover la hora
  await logic.guardarSaldo({ monto: '100000', pagados: [], actualizarHora: false }, { ahora: new Date(t0 + 7200000) });
  const { capacidad: c } = await dashboard.getDashboardData(null, null, new Date(t0 + 7200000));
  assert.equal(c.gastado, 10000, 'el gasto cargado después de "lo que tengo" sigue descontándose');
});
