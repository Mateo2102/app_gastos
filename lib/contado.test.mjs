// Gastos al contado (el día a día): un solo pago, en transferencia o efectivo. Se ven aparte y cuentan en el mes anotado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { esPagoAlContado, getGastosPorMes } from './logic.js';

const d = (y, m, dia) => new Date(y, m - 1, dia);
const fila = (extra) => ({
  gasto: 'Gasto variable', desc: 'X', medio: '', tipo: 'Compra', categoria: 'Super', moneda: 'ARS',
  montoARS: 1000, montoUSD: null, monto: 1000, cuotas: 1, n: 0, cierreDia: null, banco: '', marca: '',
  formaPago: 'Transferencia', fecha: d(2026, 11, 4), ...extra
});

test('es "al contado" un solo pago en transferencia o efectivo; no la tarjeta, ni las cuotas, ni los fijos', () => {
  assert.equal(esPagoAlContado(fila({ formaPago: 'Transferencia' })), true);
  assert.equal(esPagoAlContado(fila({ formaPago: 'Efectivo' })), true);
  assert.equal(esPagoAlContado(fila({ formaPago: 'Tarjeta de Crédito', banco: 'ICBC', marca: 'VISA' })), false);
  assert.equal(esPagoAlContado(fila({ cuotas: 10 })), false, 'una transferencia en cuotas (la moto) no es del día a día');
  assert.equal(esPagoAlContado(fila({ gasto: 'Gasto fijo' })), false);
  assert.equal(esPagoAlContado(fila({ formaPago: '' })), false, 'filas viejas sin forma de pago: no se asumen al contado');
});

test('cada gasto al contado cuenta en el MES en que está anotado, ni antes ni después', () => {
  const rows = [
    fila({ desc: 'Fin de mes', fecha: d(2026, 11, 30), montoARS: 100 }),
    fila({ desc: 'Inicio de mes', fecha: d(2026, 12, 1), formaPago: 'Efectivo', montoARS: 200 })
  ];
  const meses = getGastosPorMes(rows, { year: 2026, month: 10 }, 3); // nov, dic, ene
  const descs = (m) => m.items.map((i) => i.desc);
  assert.deepEqual(descs(meses[0]), ['Fin de mes']);
  assert.deepEqual(descs(meses[1]), ['Inicio de mes']);
  assert.deepEqual(descs(meses[2]), []);
});

test('el detalle distingue: al contado, un pago (tarjeta) y cuotas; y marca alContado', () => {
  const rows = [
    fila({ desc: 'Super', formaPago: 'Efectivo' }),
    fila({ desc: 'Con tarjeta', formaPago: 'Tarjeta de Crédito', banco: 'ICBC', marca: 'VISA', fecha: d(2026, 11, 4) }),
    fila({ desc: 'Moto', cuotas: 10, fecha: d(2026, 11, 1) })
  ];
  const [nov] = getGastosPorMes(rows, { year: 2026, month: 10 }, 2);
  const porDesc = Object.fromEntries(nov.items.map((i) => [i.desc, i]));
  assert.deepEqual([porDesc.Super.detalle, porDesc.Super.alContado], ['Al contado', true]);
  assert.equal(porDesc['Con tarjeta'].alContado, false);
  assert.match(porDesc['Con tarjeta'].detalle, /^Un pago$/);
  assert.deepEqual([porDesc.Moto.detalle, porDesc.Moto.alContado], ['Cuota 1 de 10', false]);
});

test('un pago al contado en dólares cuenta en pesos en su mes y conserva la moneda original', () => {
  const [nov] = getGastosPorMes([fila({ desc: 'Extra moto', moneda: 'USD', montoARS: 975000, montoUSD: 650, fecha: d(2026, 11, 10) })], { year: 2026, month: 10 }, 1);
  assert.equal(nov.items[0].montoARS, 975000);
  assert.equal(nov.items[0].montoUSD, 650);
  assert.equal(nov.items[0].alContado, true);
});
