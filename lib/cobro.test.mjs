// Fecha de cobro (último día hábil) y capacidad de gasto diaria.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ultimoDiaHabil, periodoDeCobro, calcularCapacidad, hoyEnZona } from './cobro.js';

const d = (y, m, dia) => new Date(y, m - 1, dia);
const iso = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;

test('último día hábil: si el mes termina en fin de semana se retrocede al viernes', () => {
  assert.equal(iso(ultimoDiaHabil(2026, 9)), '2026-10-30', 'octubre 2026 termina sábado 31 -> viernes 30');
  assert.equal(iso(ultimoDiaHabil(2026, 10)), '2026-11-30', 'noviembre 2026 termina lunes 30');
  assert.equal(iso(ultimoDiaHabil(2026, 11)), '2026-12-31', 'diciembre 2026 termina jueves 31');
  assert.equal(iso(ultimoDiaHabil(2027, 0)), '2027-01-29', 'enero 2027 termina domingo 31 -> viernes 29');
  assert.equal(iso(ultimoDiaHabil(2028, 1)), '2028-02-29', 'año bisiesto: 29/02/2028 es martes');
});

test('el período va del último cobro al próximo y paga el mes del próximo cobro', () => {
  const p = periodoDeCobro(d(2026, 11, 2));
  assert.equal(iso(p.desde), '2026-10-30');
  assert.equal(iso(p.hasta), '2026-11-30');
  assert.equal(p.mesKey, '2026-10', 'el sueldo cobrado a fin de octubre paga noviembre');
  assert.equal(p.diasTotales, 31);
  assert.equal(p.diasRestantes, 28, 'del 2/11 al 30/11');
});

test('el mismo día del cobro ya empieza el período nuevo (paga el mes siguiente)', () => {
  const p = periodoDeCobro(d(2026, 11, 30));
  assert.equal(iso(p.desde), '2026-11-30');
  assert.equal(iso(p.hasta), '2026-12-31');
  assert.equal(p.mesKey, '2026-11');
  assert.equal(p.diasRestantes, p.diasTotales);
  assert.equal(periodoDeCobro(d(2026, 11, 29)).mesKey, '2026-10', 'el día anterior todavía es el período de noviembre');
});

test('el aguinaldo de fin de diciembre cae en el período que paga enero', () => {
  const p = periodoDeCobro(d(2026, 12, 31));
  assert.equal(p.mesKey, '2027-0');
  assert.equal(iso(p.hasta), '2027-01-29');
});

test('cambio de año: en enero todavía rige el cobro de fin de diciembre', () => {
  const p = periodoDeCobro(d(2027, 1, 10));
  assert.equal(iso(p.desde), '2026-12-31');
  assert.equal(p.mesKey, '2027-0');
});

test('capacidad: libre = ingresos - comprometido - piso, repartido en los días que faltan', () => {
  const meses = [{ key: '2026-10', ingresos: 2000000, gastos: 1300000 }, { key: '2026-11', ingresos: 1, gastos: 1 }];
  const c = calcularCapacidad(meses, 400000, d(2026, 11, 2));
  assert.equal(c.libre, 300000);
  assert.equal(c.diasRestantes, 28);
  assert.equal(c.porDia, 300000 / 28);
  assert.equal(c.enDeficit, false);
});

test('capacidad: en déficit no se ofrece gasto por día', () => {
  const c = calcularCapacidad([{ key: '2026-10', ingresos: 1000000, gastos: 1500000 }], 400000, d(2026, 11, 2));
  assert.equal(c.porDia, 0);
  assert.equal(c.enDeficit, true);
  assert.equal(c.libre, -900000);
});

test('capacidad: si la proyección no incluye el mes del período devuelve null', () => {
  assert.equal(calcularCapacidad([{ key: '2030-0', ingresos: 1, gastos: 1 }], 0, d(2026, 11, 2)), null);
});

test('hoyEnZona: de noche en UTC ya es el día siguiente, pero en Argentina todavía es el mismo', () => {
  const f = hoyEnZona('America/Argentina/Buenos_Aires', new Date('2026-11-03T01:30:00Z'));
  assert.equal(iso(f), '2026-11-02');
});

// ---------------------------------------------------------------- saldo y ahorro

const MESES = [{ key: '2026-10', ingresos: 2000000, gastos: 1300000 }];
const HOY = d(2026, 11, 2); // período 30/10 -> 30/11: 28 días

const GRUPOS = [
  { id: 'c:VISA Santander', nombre: 'VISA Santander', tipo: 'tarjeta', total: 700000 },
  { id: 'c:VISA ICBC', nombre: 'VISA ICBC', tipo: 'tarjeta', total: 300000 },
  { id: 't:Santander', nombre: 'Transferencias Santander', tipo: 'transferencia', total: 300000 }
]; // suman 1.300.000, el comprometido de MESES

test('con saldo: falta pagar = lo que NO está tildado (lo tildado no se descuenta otra vez)', () => {
  const c = calcularCapacidad(MESES, 400000, HOY, { monto: 900000, pagados: ['c:VISA Santander'], fecha: '2026-11-01' }, [], GRUPOS);
  assert.equal(c.modo, 'saldo');
  assert.equal(c.pagado, 700000);
  assert.equal(c.pendiente, 600000);
  assert.equal(c.libre, 900000 - 600000 - 400000);
  assert.deepEqual(c.grupos.map((g) => g.pagado), [true, false, false], 'la lista marca cuáles están pagados');
  const c2 = calcularCapacidad(MESES, 400000, HOY, { monto: 2000000, pagados: [], fecha: '2026-11-02' }, [], GRUPOS);
  assert.equal(c2.pendiente, 1300000, 'sin tildes falta pagar todo');
  assert.equal(c2.libre, 2000000 - 1300000 - 400000);
  assert.equal(c2.porDia, 300000 / 28);
});

test('con todo tildado no falta pagar nada; un id que no existe no cambia nada', () => {
  const todos = GRUPOS.map((g) => g.id);
  const c = calcularCapacidad(MESES, 0, HOY, { monto: 100, pagados: [...todos, 'c:Inventada'], fecha: '2026-11-01' }, [], GRUPOS);
  assert.equal(c.pendiente, 0);
  assert.equal(c.pagado, 1300000);
});

test('sin detalle de grupos todo el comprometido es un solo pendiente', () => {
  const c = calcularCapacidad(MESES, 0, HOY, { monto: 2000000, pagados: [], fecha: '2026-11-01' });
  assert.equal(c.pendiente, 1300000);
});

test('un saldo de un período anterior se ignora y se avisa (ya hubo otro cobro)', () => {
  const c = calcularCapacidad(MESES, 400000, HOY, { monto: 5000000, pagados: [], fecha: '2026-10-15' });
  assert.equal(c.modo, 'estimado');
  assert.equal(c.saldoVencido, true);
  assert.equal(c.libre, 300000);
});

test('el ahorro apartado desde el último cobro se descuenta de lo disponible (modo estimado)', () => {
  const ahorros = [
    { fecha: '2026-10-31', montoARS: 50000 }, // ya en este período (cobró el 30/10)
    { fecha: '2026-11-01', montoARS: 20000 },
    { fecha: '2026-10-20', montoARS: 999999 }, // período anterior: no cuenta
    { fecha: '2026-11-05', montoARS: 777777 }  // futuro: no cuenta
  ];
  const c = calcularCapacidad(MESES, 400000, HOY, null, ahorros);
  assert.equal(c.ahorrado, 70000);
  assert.equal(c.libre, 300000 - 70000);
});

test('con saldo solo se descuenta el ahorro hecho DESPUÉS de cargarlo (antes ya está en el saldo)', () => {
  const ahorros = [{ fecha: '2026-11-01', montoARS: 20000 }, { fecha: '2026-11-02', montoARS: 30000 }];
  const c = calcularCapacidad(MESES, 0, HOY, { monto: 1500000, pagados: [], fecha: '2026-11-01' }, ahorros);
  assert.equal(c.ahorrado, 30000, 'el del 01/11 es del mismo día del saldo: ya está incluido');
  assert.equal(c.libre, 1500000 - 1300000 - 30000);
});
