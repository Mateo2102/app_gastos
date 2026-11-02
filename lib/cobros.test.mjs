// Cobros reales: lo que de verdad se cobró (sueldo y extra). Registro aparte de la proyección.

import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPlanillaFalsa, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';
import { ErrorValidacion } from './errores.js';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const logic = await import('./logic.js');
const dashboard = await import('./dashboard.js');

function nueva(config = []) {
  const p = crearPlanillaFalsa({ base: [ENCABEZADO], config });
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}

test('se anotan cobros de sueldo y de extra, y la lista vuelve del más nuevo al más viejo', async () => {
  nueva();
  await logic.agregarCobro({ fecha: '2026-09-30', monto: 1800000, tipo: 'sueldo' });
  await logic.agregarCobro({ fecha: '2026-10-30', monto: 1877000, tipo: 'sueldo', nota: 'Octubre' });
  const lista = await logic.agregarCobro({ fecha: '2026-10-15', monto: 120000, tipo: 'extra', nota: 'Turnos' });
  assert.deepEqual(lista.map((c) => [c.fecha, c.tipo, c.monto, c.nota]), [
    ['2026-10-30', 'sueldo', 1877000, 'Octubre'],
    ['2026-10-15', 'extra', 120000, 'Turnos'],
    ['2026-09-30', 'sueldo', 1800000, '']
  ]);
  assert.deepEqual((await logic.getCobros()).map((c) => c.id), lista.map((c) => c.id), 'lo guardado es lo mismo');
});

test('la fecha puede venir como día/mes/año y se valida todo antes de guardar', async () => {
  nueva();
  const l = await logic.agregarCobro({ fecha: '30/10/2026', monto: '1500000', tipo: 'sueldo' });
  assert.equal(l[0].fecha, '2026-10-30');
  for (const mala of [
    { fecha: '2026-13-45', monto: 1, tipo: 'sueldo' }, { fecha: 'ayer', monto: 1, tipo: 'sueldo' }, { monto: 1, tipo: 'sueldo' },
    { fecha: '2026-10-30', monto: 0, tipo: 'sueldo' }, { fecha: '2026-10-30', monto: -5, tipo: 'sueldo' },
    { fecha: '2026-10-30', monto: 'abc', tipo: 'sueldo' }, { fecha: '2026-10-30', monto: 1e15, tipo: 'sueldo' },
    { fecha: '2026-10-30', monto: 1, tipo: 'aguinaldo' }, { fecha: '2026-10-30', monto: 1 }
  ]) {
    await assert.rejects(() => logic.agregarCobro(mala), ErrorValidacion, JSON.stringify(mala));
  }
  assert.equal((await logic.getCobros()).length, 1, 'los inválidos no se guardaron');
});

test('una nota que Sheets leería como fórmula se guarda como texto', async () => {
  nueva();
  const l = await logic.agregarCobro({ fecha: '2026-10-30', monto: 1, tipo: 'extra', nota: '=SUMA(1;1)' });
  assert.equal(l[0].nota, "'=SUMA(1;1)");
});

test('eliminar quita solo ese cobro', async () => {
  nueva();
  await logic.agregarCobro({ fecha: '2026-09-30', monto: 1, tipo: 'sueldo' });
  const lista = await logic.agregarCobro({ fecha: '2026-10-30', monto: 2, tipo: 'sueldo' });
  const resto = await logic.eliminarCobro(lista[0].id);
  assert.deepEqual(resto.map((c) => c.monto), [1]);
  assert.deepEqual((await logic.eliminarCobro('no-existe')).map((c) => c.monto), [1], 'un id que no existe no cambia nada');
});

test('cobros guardados con datos rotos se ignoran en vez de romper la lectura', async () => {
  nueva([['SUELDO_COBROS', JSON.stringify([{ id: 'a', fecha: '2026-10-30', monto: 5, tipo: 'sueldo' }, { id: 'b', fecha: 'mal', monto: 5, tipo: 'sueldo' }, { id: 'c', fecha: '2026-10-30', monto: 5, tipo: 'raro' }, null])]]);
  assert.deepEqual((await logic.getCobros()).map((c) => c.id), ['a']);
});

test('los datos de Gráficos traen los cobros, y anotarlos NO cambia la proyección', async () => {
  const cfg = [['DOLAR_BLUE_CACHE', '1500'], ['DOLAR_BLUE_CACHE_TS', String(Date.now())], ['SUELDO_SCHEDULE', JSON.stringify([{ key: '2026-8', monto: 1000000 }])], ['PISO_DISPONIBLE', '100000']];
  nueva(cfg);
  const antes = await dashboard.getGraficosData(new Date('2026-11-10T15:00:00Z'));
  await logic.agregarCobro({ fecha: '2026-10-30', monto: 9999999, tipo: 'sueldo' });
  const despues = await dashboard.getGraficosData(new Date('2026-11-10T15:00:00Z'));
  assert.equal(despues.cobros.length, 1);
  const proyectado = (g) => g.meses.map((m) => [m.key, m.ingresos, m.gastos, m.ahorroProyectado]);
  assert.deepEqual(proyectado(despues), proyectado(antes), 'ingresos, gastos y ahorro proyectado no se tocan');
  assert.equal(despues.meses.find((m) => m.key === '2026-9').ingresosReal, 9999999, 'lo cobrado sí aparece como ingreso real de ese mes');
});
