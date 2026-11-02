// Pruebas de la regla de pago: en qué mes cae cada compra. Correr con: npm test
// Regla provisoria: efectivo, transferencia y toda forma de pago SIN regla de cierre -> mes de la compra.
// Solo una tarjeta de crédito CON regla de cierre desplaza el mes. La fecha real nunca se modifica.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describirPago, getPaymentMonths, mesesDesdeFecha, esCompraCredito, fechaAplicacion } from './closing.js';
import { buildProjection } from './logic.js';

const d = (y, m, dia) => new Date(y, m - 1, dia);
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const lbl = (k) => { const [y, m] = k.split('-').map(Number); return `${MES[m]} ${y}`; };
const meses = (fila) => describirPago(fila).meses.map(lbl);

test('efectivo sin banco ni regla: cae en el mes de la compra (antes desaparecía)', () => {
  assert.deepEqual(meses({ formaPago: 'Efectivo', fecha: d(2026, 11, 10), cuotas: 1, n: 0 }), ['nov 2026']);
  assert.equal(describirPago({ formaPago: 'Efectivo', fecha: d(2026, 11, 10), cuotas: 1, n: 0 }).regla, 'mes-de-compra');
});

test('efectivo en cuotas: meses consecutivos desde el mes de la compra, también cruzando de año', () => {
  assert.deepEqual(meses({ formaPago: 'Efectivo', fecha: d(2026, 11, 30), cuotas: 3, n: 0 }), ['nov 2026', 'dic 2026', 'ene 2027']);
});

test('transferencia: mes de la compra aunque el banco tenga regla de jueves en la planilla', () => {
  const t = describirPago({ formaPago: 'Transferencia', banco: 'Santander', fecha: d(2026, 10, 25), cuotas: 2, n: 4, cierreDia: 20 });
  assert.equal(t.regla, 'mes-de-compra');
  assert.deepEqual(t.meses.map(lbl), ['oct 2026', 'nov 2026']);
});

test('cualquier forma de pago sin regla de cierre: mes de la compra (débito, desconocida, vacía)', () => {
  for (const formaPago of ['Débito', 'Cheque', 'Mercado Pago', 'Otra']) {
    assert.deepEqual(meses({ formaPago, fecha: d(2026, 3, 31), cuotas: 1, n: 0 }), ['mar 2026'], formaPago);
  }
  assert.deepEqual(meses({ formaPago: '', fecha: d(2026, 3, 31), cuotas: 1, n: 0 }), ['mar 2026'], 'fila vieja sin forma de pago y sin regla');
});

test('tarjeta de crédito sin día de cierre ni regla en la planilla: mes de la compra (antes desaparecía)', () => {
  const t = describirPago({ formaPago: 'Tarjeta de Crédito', banco: 'NuevaTarjeta', fecha: d(2026, 10, 25), cuotas: 3, n: 0, cierreDia: null });
  assert.equal(t.regla, 'mes-de-compra');
  assert.deepEqual(t.meses.map(lbl), ['oct 2026', 'nov 2026', 'dic 2026']);
});

test('tarjeta con día de cierre: se desplaza (cierre 24: 23/10 -> nov, 24/10 -> dic, 25/10 -> dic)', () => {
  const f = (dia) => describirPago({ formaPago: 'Tarjeta de Crédito', fecha: d(2026, 10, dia), cuotas: 1, n: 0, cierreDia: 24 });
  assert.deepEqual([f(23).regla, f(23).meses.map(lbl)], ['cierre-dia', ['nov 2026']]);
  assert.deepEqual(f(24).meses.map(lbl), ['dic 2026']);
  assert.deepEqual(f(25).meses.map(lbl), ['dic 2026']);
});

test('cierre el 5 y compra el 5/11: entra en el cierre de diciembre y se paga en enero; la fecha real sigue siendo 5/11', () => {
  const fecha = d(2026, 11, 5);
  const antes = fecha.getTime();
  const fila = { formaPago: 'Tarjeta de Crédito', fecha, cuotas: 1, n: 0, cierreDia: 5 };
  assert.deepEqual(meses(fila), ['ene 2027']);
  assert.equal(fila.fecha, fecha, 'la fila conserva el mismo objeto');
  assert.equal(fecha.getTime(), antes, 'la fecha de compra no se modificó');
  assert.deepEqual([fechaAplicacion(fecha, 5).getMonth(), fechaAplicacion(fecha, 5).getDate()], [11, 1], 'solo la fecha de aplicación se desplaza');
});

test('tarjeta sin día configurado pero con regla de jueves de la planilla: se usa esa regla', () => {
  const t = describirPago({ formaPago: 'Tarjeta de Crédito', fecha: d(2026, 10, 1), cuotas: 1, n: 1, cierreDia: null });
  assert.equal(t.regla, 'cierre-jueves');
  assert.deepEqual(t.meses.map(lbl), ['dic 2026'], 'compra el mismo día del primer jueves: ya cerró');
});

test('fecha de cierre manual: manda sobre el día configurado', () => {
  const t = describirPago({ formaPago: 'Tarjeta de Crédito', fecha: d(2026, 10, 15), cuotas: 1, n: 4, cierreDia: 20, fechaCierre: d(2026, 10, 22) });
  assert.equal(t.regla, 'cierre-manual');
  assert.deepEqual(t.meses.map(lbl), ['nov 2026']);
});

test('filas viejas sin forma de pago: con regla de banco son tarjeta; sin regla, mes de la compra', () => {
  assert.equal(esCompraCredito({ formaPago: '', n: 3 }), true);
  assert.equal(esCompraCredito({ formaPago: '', n: 0 }), false);
  assert.equal(describirPago({ formaPago: '', fecha: d(2026, 10, 5), cuotas: 1, n: 3, cierreDia: null }).regla, 'cierre-jueves');
  assert.equal(describirPago({ formaPago: '', fecha: d(2026, 10, 5), cuotas: 1, n: 0 }).regla, 'mes-de-compra');
});

test('entradas inválidas: sin meses (no inventa nada)', () => {
  for (const fila of [
    { formaPago: 'Efectivo', fecha: null, cuotas: 1 }, { formaPago: 'Efectivo', fecha: new Date('x'), cuotas: 1 },
    { formaPago: 'Efectivo', fecha: d(2026, 1, 1), cuotas: 0 }, { formaPago: 'Efectivo', fecha: d(2026, 1, 1), cuotas: -2 },
    { formaPago: 'Efectivo', fecha: d(2026, 1, 1), cuotas: NaN }, { formaPago: 'Efectivo', fecha: '2026-01-01', cuotas: 1 }
  ]) assert.deepEqual(getPaymentMonths(fila), [], JSON.stringify(fila));
  assert.deepEqual(mesesDesdeFecha(d(2026, 1, 31), 2.9).map(lbl), ['ene 2026', 'feb 2026'], 'cuotas fraccionarias se truncan');
});

test('meses de 28, 29, 30 y 31 días: el mes de la compra es el del calendario', () => {
  for (const [fecha, esperado] of [[d(2027, 2, 28), 'feb 2027'], [d(2028, 2, 29), 'feb 2028'], [d(2026, 4, 30), 'abr 2026'], [d(2026, 12, 31), 'dic 2026']]) {
    assert.deepEqual(meses({ formaPago: 'Efectivo', fecha, cuotas: 1, n: 0 }), [esperado]);
  }
  assert.deepEqual(meses({ formaPago: 'Efectivo', fecha: d(2026, 1, 31), cuotas: 3, n: 0 }), ['ene 2026', 'feb 2026', 'mar 2026'], 'sin saltearse febrero');
});

// ---- La proyección usa exactamente esta regla ----

const PROY = { sueldo: [{ key: '2026-0', monto: 0 }], piso: 0, ancla: { year: 2026, month: 0 } };
function mesesEnProyeccion(fila) {
  const proy = buildProjection([{ gasto: 'Gasto variable', monto: 1000, ...fila }], 36, PROY.sueldo, PROY.piso, null, PROY.ancla);
  return proy.filter((m) => m.gastoVariable > 0).map((m) => m.key);
}

test('un gasto en efectivo aparece en la proyección, en el mes de la compra', () => {
  const fila = { formaPago: 'Efectivo', fecha: d(2026, 11, 10), cuotas: 1, n: 0 };
  assert.deepEqual(mesesEnProyeccion(fila), ['2026-10']);
  const proy = buildProjection([{ gasto: 'Gasto variable', monto: 4500, ...fila }], 12, PROY.sueldo, 0, null, PROY.ancla);
  assert.equal(proy[10].gastoVariable, 4500);
  assert.equal(proy[10].gastos, 4500);
});

test('una transferencia en 3 cuotas aparece en 3 meses consecutivos desde el mes de la compra', () => {
  assert.deepEqual(mesesEnProyeccion({ formaPago: 'Transferencia', banco: 'Santander', fecha: d(2026, 10, 14), cuotas: 3, n: 4 }), ['2026-9', '2026-10', '2026-11']);
});

test('la proyección y describirPago coinciden en todas las combinaciones (el formulario usa describirPago)', () => {
  let casos = 0;
  for (const formaPago of ['Efectivo', 'Transferencia', 'Tarjeta de Crédito', '', 'Débito']) {
    for (const n of [0, 1, 4]) {
      for (const cierreDia of [null, 5, 20, 31]) {
        for (const fecha of [d(2026, 1, 1), d(2026, 2, 28), d(2026, 4, 30), d(2026, 10, 24), d(2026, 12, 31), d(2028, 2, 29)]) {
          for (const cuotas of [1, 3, 12]) {
            const fila = { formaPago, n, cierreDia, fecha, cuotas };
            const esperado = describirPago(fila).meses.filter((k) => {
              const [y, m] = k.split('-').map(Number);
              return (y * 12 + m) >= 2026 * 12 && (y * 12 + m) < 2026 * 12 + 36;
            });
            assert.deepEqual(mesesEnProyeccion(fila), esperado, JSON.stringify({ formaPago, n, cierreDia, fecha: fecha.toISOString(), cuotas }));
            casos++;
          }
        }
      }
    }
  }
  assert.ok(casos > 800);
});

test('ninguna compra con fecha y cuotas válidas desaparece de la proyección', () => {
  for (const formaPago of ['Efectivo', 'Transferencia', 'Tarjeta de Crédito', '', 'Débito', 'Otra']) {
    for (const n of [0, 2]) {
      for (const cierreDia of [null, 15]) {
        const m = describirPago({ formaPago, n, cierreDia, fecha: d(2026, 6, 15), cuotas: 2 }).meses;
        assert.equal(m.length, 2, `${formaPago} n=${n} dia=${cierreDia}`);
      }
    }
  }
});
