// Datos de la sección Gráficos: evolutivo contra proyectado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPlanillaFalsa, filaGasto, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const dashboard = await import('./dashboard.js');

const AHORA = new Date('2026-11-10T15:00:00Z');

function nueva(base, config) {
  const p = crearPlanillaFalsa({ base, config });
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}
const config = (extra = []) => [
  ['DOLAR_BLUE_CACHE', '1500'], ['DOLAR_BLUE_CACHE_TS', String(Date.now())], // sin salir a la red
  ['SUELDO_SCHEDULE', JSON.stringify([{ key: '2026-8', monto: 1000000 }])], // desde septiembre 2026
  ['PISO_DISPONIBLE', '100000'],
  ...extra
];

test('la ventana arranca en el primer sueldo y marca pasado / actual / futuro', async () => {
  nueva([ENCABEZADO], config());
  const g = await dashboard.getGraficosData(AHORA);
  assert.equal(g.hoy, '2026-10');
  assert.equal(g.meses[0].key, '2026-8', 'septiembre 2026 es el primer mes con sueldo (no hay datos antes)');
  assert.deepEqual(g.meses.slice(0, 4).map((m) => m.estado), ['pasado', 'pasado', 'actual', 'futuro']);
  assert.equal(g.meses.length, 2 + 12, 'sep y oct más los 12 meses de proyección (el mes en curso es el primero)');
});

test('ahorro real: suma lo de cada mes (USD al dólar), 0 si no hubo y null en los meses futuros', async () => {
  nueva([ENCABEZADO], config([['AHORRO_MOVS', JSON.stringify([
    { id: 'a', fecha: '2026-10-05', monto: 50000, moneda: 'ARS' },
    { id: 'b', fecha: '2026-10-20', monto: 10, moneda: 'USD' }
  ])]]));
  const g = await dashboard.getGraficosData(AHORA);
  const por = Object.fromEntries(g.meses.map((m) => [m.key, m]));
  assert.equal(por['2026-9'].ahorroReal, 65000, '50.000 + US$10 a $1.500');
  assert.equal(por['2026-8'].ahorroReal, 0, 'un mes pasado sin ahorro es 0, no vacío');
  assert.equal(por['2026-10'].ahorroReal, 0, 'el mes en curso cuenta lo que va (nada todavía)');
  assert.equal(por['2026-11'].ahorroReal, null, 'los meses futuros no tienen ahorro real');
});

test('ingresos, gastos y ahorro proyectado vienen del mismo modelo que la proyección', async () => {
  nueva([ENCABEZADO, filaGasto({ gasto: 'Gasto fijo', desc: 'Fijo', monto: 200000, fecha: '01/01/1999', id: 'g_1' })], config());
  const g = await dashboard.getGraficosData(AHORA);
  const sep = g.meses[0];
  assert.equal(sep.ingresos, 1000000);
  assert.equal(sep.gastos, 200000);
  assert.equal(sep.ahorroProyectado, 700000, '1.000.000 - 200.000 - piso 100.000');
});

test('sin sueldo cargado la ventana arranca en el mes en curso', async () => {
  nueva([ENCABEZADO], [['DOLAR_BLUE_CACHE', '1500'], ['DOLAR_BLUE_CACHE_TS', String(Date.now())], ['SUELDO_SCHEDULE', '[]']]);
  const g = await dashboard.getGraficosData(AHORA);
  assert.equal(g.meses[0].estado, 'actual');
});
