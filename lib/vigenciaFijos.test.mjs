// Vigencia de los gastos fijos: inicio (fecha), fin y pausa. Los meses cuentan completos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPlanillaFalsa, filaGasto, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';
import { ErrorValidacion } from './errores.js';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const logic = await import('./logic.js');

const d = (y, m, dia = 1) => new Date(y, m - 1, dia);
const fijo = (extra = {}) => ({ gasto: 'Gasto fijo', monto: 1000, fecha: d(1999, 1), fechaFin: null, pausaDesde: null, pausaHasta: null, ...extra });

function nueva(base) {
  const p = crearPlanillaFalsa({ base });
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}
const AHORA = d(2026, 11, 2);

test('sin fecha de fin ni pausa un fijo cuenta en todos los meses desde su inicio', () => {
  const r = fijo({ fecha: d(2026, 8) });
  assert.equal(logic.fijoVigenteEn(r, 2026, 6), false, 'antes del inicio no cuenta (jul)');
  assert.equal(logic.fijoVigenteEn(r, 2026, 7), true, 'el mes de inicio sí');
  assert.equal(logic.fijoVigenteEn(r, 2030, 0), true);
  assert.equal(logic.fijoVigenteEn(fijo(), 2020, 0), true, 'el 1999 de la planilla significa "desde siempre"');
});

test('el mes de fin cuenta completo y después no', () => {
  const r = fijo({ fechaFin: d(2026, 11, 30) });
  assert.equal(logic.fijoVigenteEn(r, 2026, 10), true);
  assert.equal(logic.fijoVigenteEn(r, 2026, 11), false);
});

test('la pausa excluye sus meses (ambos extremos) y vuelve a contar después', () => {
  const r = fijo({ pausaDesde: d(2026, 12, 1), pausaHasta: d(2027, 2, 28) });
  assert.deepEqual([2026, 2027].flatMap((y) => [...Array(12).keys()].map((m) => [y, m]))
    .filter(([y, m]) => !logic.fijoVigenteEn(r, y, m)).map(([y, m]) => `${y}-${m}`), ['2026-11', '2027-0', '2027-1']);
  assert.equal(logic.fijoVigenteEn(fijo({ pausaDesde: d(2026, 12, 1) }), 2035, 5), false, 'sin "hasta" sigue pausado');
});

test('la proyección, los gastos por mes y la proyección por cuenta respetan la vigencia', () => {
  const rows = [fijo({ desc: 'A', banco: 'Santander', formaPago: 'Tarjeta de Crédito', fecha: d(2026, 8), fechaFin: d(2026, 11, 30) })];
  const meses = logic.buildProjection(rows, 4, [{ key: '2026-9', monto: 5000 }], 0, null, { year: 2026, month: 9 });
  assert.deepEqual(meses.map((m) => m.gastoFijo), [1000, 1000, 0, 0], 'oct y nov sí, dic y ene no');
  const porMes = logic.getGastosPorMes(rows, { year: 2026, month: 9 }, 4);
  assert.deepEqual(porMes.map((m) => m.items.length), [1, 1, 0, 0]);
  const porCuenta = logic.getProyeccionPorCuenta(rows, 4, { year: 2026, month: 9 });
  assert.deepEqual(porCuenta.meses.map((m) => m.total), [1000, 1000, 0, 0]);
});

test('calcularVigencia: terminar, pausar, reanudar y reactivar con sus meses por defecto', () => {
  const vacio = { fin: null, pausaDesde: null, pausaHasta: null };
  const t = data.calcularVigencia(vacio, 'terminar', undefined, AHORA);
  assert.deepEqual([t.fin.getFullYear(), t.fin.getMonth(), t.fin.getDate()], [2026, 10, 30], 'noviembre es el último mes que se paga');
  const p = data.calcularVigencia(vacio, 'pausar', undefined, AHORA);
  assert.deepEqual([p.pausaDesde.getFullYear(), p.pausaDesde.getMonth()], [2026, 11], 'se pausa desde diciembre');
  const r = data.calcularVigencia(p, 'reanudar', '2027-02', AHORA);
  assert.deepEqual([r.pausaHasta.getFullYear(), r.pausaHasta.getMonth(), r.pausaHasta.getDate()], [2027, 1, 28]);
  assert.equal(data.calcularVigencia(p, 'reanudar', undefined, AHORA).pausaDesde, null, 'una pausa que todavía no empezó se anula');
  assert.equal(data.calcularVigencia(t, 'reactivar', undefined, AHORA).fin, null);
  assert.throws(() => data.calcularVigencia(vacio, 'reanudar', undefined, AHORA), ErrorValidacion);
  assert.throws(() => data.calcularVigencia(vacio, 'terminar', '2026-13', AHORA), ErrorValidacion);
});

test('terminar y pausar escriben solo AB:AD de ese registro; los demás no cambian', async () => {
  const p = nueva([ENCABEZADO, filaGasto({ gasto: 'Gasto fijo', desc: 'Spotify', id: 'g_s', fecha: '01/01/2025' }), filaGasto({ gasto: 'Gasto fijo', desc: 'Vercel', id: 'g_v', fecha: '01/08/2026' })]);
  const antes = JSON.stringify(p.hojas.Base[2]);
  await data.actualizarVigenciaFijo({ ref: 'g_s', filaSugerida: 2, accion: 'terminar' }, AHORA);
  assert.equal(p.hojas.Base[1][27], '30/11/2026');
  assert.equal(JSON.stringify(p.hojas.Base[2]), antes, 'Vercel intacto');
  await data.actualizarVigenciaFijo({ ref: 'g_v', accion: 'pausar' }, AHORA);
  assert.equal(p.hojas.Base[2][28], '01/12/2026');
  const fijos = await data.getGastosFijos(1500);
  const sp = fijos.find((f) => f.desc === 'Spotify');
  assert.equal(sp.hasta, '2026-11-30');
  assert.equal(sp.desde, '2025-01-01');
  await data.actualizarVigenciaFijo({ ref: 'g_s', accion: 'reactivar' }, AHORA);
  assert.equal(p.hojas.Base[1][27], '');
});

test('no se puede pausar ni terminar una compra, ni terminar antes del inicio', async () => {
  nueva([ENCABEZADO, filaGasto({ desc: 'Compra', id: 'g_c' }), filaGasto({ gasto: 'Gasto fijo', desc: 'F', id: 'g_f', fecha: '01/12/2026' })]);
  await assert.rejects(() => data.actualizarVigenciaFijo({ ref: 'g_c', accion: 'terminar' }, AHORA), ErrorValidacion);
  await assert.rejects(() => data.actualizarVigenciaFijo({ ref: 'g_f', accion: 'terminar' }, AHORA), ErrorValidacion);
  await assert.rejects(() => data.actualizarVigenciaFijo({ ref: 'g_f', accion: 'cancelar' }, AHORA), ErrorValidacion);
});

test('borrar un fijo con vigencia limpia también AB:AD y lo de abajo sube con su vigencia', async () => {
  const f = (desc, id, fin) => { const r = filaGasto({ gasto: 'Gasto fijo', desc, id }); r[27] = fin; return r; };
  const p = nueva([ENCABEZADO, f('A', 'g_a', '30/11/2026'), f('B', 'g_b', '30/06/2027')]);
  await data.eliminarGasto({ ref: 'g_a', filaSugerida: 2 });
  assert.equal(p.hojas.Base[1][3], 'B');
  assert.equal(p.hojas.Base[1][27], '30/06/2027', 'la vigencia de B subió con B');
});
