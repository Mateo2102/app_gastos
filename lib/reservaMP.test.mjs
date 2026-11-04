// Reserva automática de MercadoPago: por cada gasto al contado en MP por transferencia se aparta un % o un monto fijo.
// Solo se descuenta de lo disponible.

import test from 'node:test';
import assert from 'node:assert/strict';
import { reservaDeGasto, guardarReservaMP, getConfiguracion } from './logic.js';
import { calcularCapacidad } from './cobro.js';
import { crearPlanillaFalsa, filaGasto, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';
import { ErrorValidacion } from './errores.js';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const dashboard = await import('./dashboard.js');

const d = (y, m, dia) => new Date(y, m - 1, dia);
const T0 = 1793800000000;
const REGLA = { activa: true, tipo: 'porcentaje', valor: 2, desde: '2026-11-04', en: T0 };
const gasto = (extra) => ({
  gasto: 'Gasto variable', cuotas: 1, formaPago: 'Transferencia', banco: 'MercadoPago', monto: 10000,
  fecha: d(2026, 11, 4), creado: T0 + 1000, ...extra
});

test('porcentaje: reserva el % del gasto; monto fijo: el mismo monto por cada gasto', () => {
  assert.equal(reservaDeGasto(gasto(), REGLA), 200);
  assert.equal(reservaDeGasto(gasto({ monto: 35000 }), REGLA), 700);
  assert.equal(reservaDeGasto(gasto(), { ...REGLA, tipo: 'fijo', valor: 150 }), 150);
  assert.equal(reservaDeGasto(gasto({ monto: 1 }), { ...REGLA, tipo: 'fijo', valor: 150 }), 150, 'el fijo no depende del monto');
});

test('solo cuenta MercadoPago por transferencia, en un pago (escrito como se escriba)', () => {
  assert.equal(reservaDeGasto(gasto({ banco: 'Mercado Pago' }), REGLA), 200);
  assert.equal(reservaDeGasto(gasto({ banco: 'MERCADOPAGO' }), REGLA), 200);
  assert.equal(reservaDeGasto(gasto({ banco: 'Santander' }), REGLA), 0, 'otro banco');
  assert.equal(reservaDeGasto(gasto({ formaPago: 'Efectivo' }), REGLA), 0, 'efectivo no');
  assert.equal(reservaDeGasto(gasto({ formaPago: 'Tarjeta de Crédito', marca: 'MASTERCARD' }), REGLA), 0, 'la tarjeta de MP tampoco');
  assert.equal(reservaDeGasto(gasto({ cuotas: 6 }), REGLA), 0, 'en cuotas no');
  assert.equal(reservaDeGasto(gasto({ gasto: 'Gasto fijo' }), REGLA), 0);
});

test('regla apagada o inexistente no reserva nada', () => {
  assert.equal(reservaDeGasto(gasto(), { ...REGLA, activa: false }), 0);
  assert.equal(reservaDeGasto(gasto(), null), 0);
});

test('solo vale DESDE que se activa: por hora de carga, o por fecha si el gasto es viejo', () => {
  assert.equal(reservaDeGasto(gasto({ creado: T0 - 1000 }), REGLA), 0, 'cargado antes de activar');
  assert.equal(reservaDeGasto(gasto({ creado: null, fecha: d(2026, 11, 3) }), REGLA), 0, 'sin hora: fecha anterior a la activación');
  assert.equal(reservaDeGasto(gasto({ creado: null, fecha: d(2026, 11, 4) }), REGLA), 200, 'sin hora: desde el día de activación');
});

// ---------------------------------------------------------------- descuento en lo disponible

const MESES = [{ key: '2026-10', ingresos: 2000000, gastos: 1300000 }];
const HOY = d(2026, 11, 4);
const GRUPOS = [{ id: 'x', nombre: 'X', tipo: 'otro', total: 0 }];

test('con saldo: se descuenta el gasto Y su reserva si se cargó después de lo que tengo', () => {
  const saldo = { monto: 100000, pagados: [], fecha: '2026-11-04', en: T0 };
  const hechos = [{ fecha: '2026-11-04', montoARS: 10000, creado: T0 + 1000, reserva: 200 }];
  const c = calcularCapacidad(MESES, HOY, saldo, [], GRUPOS, hechos);
  assert.equal(c.gastado, 10000);
  assert.equal(c.reservado, 200);
  assert.equal(c.libre, 100000 - 10000 - 200);
});

test('con saldo: lo cargado ANTES de poner lo que tengo no descuenta ni gasto ni reserva (ya está en el saldo)', () => {
  const saldo = { monto: 100000, pagados: [], fecha: '2026-11-04', en: T0 };
  const hechos = [{ fecha: '2026-11-04', montoARS: 10000, creado: T0 - 1000, reserva: 200 }];
  const c = calcularCapacidad(MESES, HOY, saldo, [], GRUPOS, hechos);
  assert.equal(c.reservado, 0);
  assert.equal(c.libre, 100000);
});

test('sin saldo (estimado): se descuentan las reservas del período', () => {
  const hechos = [
    { fecha: '2026-11-02', montoARS: 5000, creado: T0, reserva: 100 },
    { fecha: '2026-11-04', montoARS: 10000, creado: T0, reserva: 200 }
  ];
  const c = calcularCapacidad(MESES, HOY, null, [], null, hechos);
  assert.equal(c.reservado, 300);
  assert.equal(c.libre, 700000 - 300);
});

// ---------------------------------------------------------------- guardado y de punta a punta

function nueva(base, config = []) {
  const p = crearPlanillaFalsa({ base, config });
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}
const AHORA = new Date('2026-11-04T15:00:00Z');

test('guardarReservaMP valida y guarda; activar fija el arranque y cambiar el valor lo conserva', async () => {
  nueva([ENCABEZADO]);
  for (const mala of [{ activa: true, tipo: 'otro', valor: 1 }, { activa: true, tipo: 'fijo', valor: 0 }, { activa: true, tipo: 'fijo', valor: 'x' },
    { activa: true, tipo: 'porcentaje', valor: 101 }, { activa: true, tipo: 'fijo', valor: 1e12 }]) {
    await assert.rejects(() => guardarReservaMP(mala, { ahora: AHORA }), ErrorValidacion, JSON.stringify(mala));
  }
  assert.equal((await getConfiguracion()).reservaMP, null, 'lo inválido no se guardó');
  await guardarReservaMP({ activa: true, tipo: 'porcentaje', valor: 2 }, { ahora: AHORA });
  let r = (await getConfiguracion()).reservaMP;
  assert.deepEqual([r.activa, r.tipo, r.valor, r.desde, r.en], [true, 'porcentaje', 2, '2026-11-04', AHORA.getTime()]);
  await guardarReservaMP({ activa: true, tipo: 'fijo', valor: 100 }, { ahora: new Date('2026-11-10T15:00:00Z') });
  r = (await getConfiguracion()).reservaMP;
  assert.deepEqual([r.tipo, r.valor, r.desde, r.en], ['fijo', 100, '2026-11-04', AHORA.getTime()], 'cambiar el valor no cambia desde cuándo rige');
  await guardarReservaMP({ activa: false, tipo: 'fijo', valor: 100 }, { ahora: new Date('2026-11-11T15:00:00Z') });
  assert.equal((await getConfiguracion()).reservaMP.activa, false);
  await guardarReservaMP({ activa: true, tipo: 'fijo', valor: 100 }, { ahora: new Date('2026-11-12T15:00:00Z') });
  assert.equal((await getConfiguracion()).reservaMP.desde, '2026-11-12', 'al volver a activarla arranca de nuevo desde ahí');
});

test('de punta a punta: la reserva de un gasto de MP de hoy baja lo que podés gastar', async () => {
  const mp = filaGasto({ desc: 'Compra MP', monto: 10000, formaPago: 'Transferencia', banco: 'MercadoPago', fecha: '04/11/2026', id: 'g_mp' });
  mp[30] = T0 + 5000;
  nueva([ENCABEZADO, mp], [
    ['DOLAR_BLUE_CACHE', '1500'], ['DOLAR_BLUE_CACHE_TS', String(Date.now())],
    ['SUELDO_SCHEDULE', JSON.stringify([{ key: '2026-8', monto: 1000000 }])], ['PISO_DISPONIBLE', '0'],
    ['SALDO_ACTUAL', JSON.stringify({ monto: 100000, pagados: [], fecha: '2026-11-04', en: T0 })],
    ['RESERVA_MP', JSON.stringify({ activa: true, tipo: 'porcentaje', valor: 2, desde: '2026-11-04', en: T0 })]
  ]);
  const { capacidad: c } = await dashboard.getDashboardData(null, null, AHORA);
  assert.equal(c.gastado, 10000);
  assert.equal(c.reservado, 200);
  assert.equal(c.libre, 100000 - 10000 - 200);
});
