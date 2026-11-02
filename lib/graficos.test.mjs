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

// ---------------------------------------------------------------- fotos de la proyección

const props = (p) => Object.fromEntries((p.hojas.ConfigTablero || []).map((f) => [f[0], f[1]]));

test('la primera vez que se piden los gráficos se guarda la foto del mes en curso y la de los pasados (aproximada)', async () => {
  const p = nueva([ENCABEZADO], config());
  const g = await dashboard.getGraficosData(AHORA); // nov 2026; el primer sueldo es septiembre
  const fotos = JSON.parse(props(p).PROYECCION_FOTOS);
  assert.deepEqual(Object.keys(fotos).sort(), ['2026-10', '2026-8', '2026-9']);
  assert.equal(fotos['2026-10'].aprox, false, 'la del mes en curso es real: se tomó al abrir en ese mes');
  assert.equal(fotos['2026-8'].aprox, true, 'las anteriores son aproximadas');
  assert.deepEqual(g.meses.slice(0, 3).map((m) => [m.fijo, m.aprox]), [[true, true], [true, true], [true, false]]);
  assert.equal(g.meses[3].fijo, false, 'los meses que vienen no se congelan');
});

test('el proyectado de un mes que ya empezó queda FIJO aunque cambie lo cargado; el real sigue', async () => {
  const p = nueva([ENCABEZADO, filaGasto({ gasto: 'Gasto fijo', desc: 'Fijo', monto: 200000, fecha: '01/01/1999', id: 'g_1' })], config());
  const antes = await dashboard.getGraficosData(AHORA);
  const nov = (g) => g.meses.find((m) => m.key === '2026-10');
  assert.equal(nov(antes).gastos, 200000);
  // durante el mes se carga otro fijo: el modelo de hoy cambia
  p.hojas.Base.push(filaGasto({ gasto: 'Gasto fijo', desc: 'Nuevo', monto: 50000, fecha: '01/01/1999', id: 'g_2' }));
  cliente.__prueba.reiniciar(); cliente.__prueba.usarSheets(p.api); data.__prueba.reiniciar();
  const despues = await dashboard.getGraficosData(AHORA);
  assert.equal(nov(despues).gastos, 200000, 'lo proyectado al empezar el mes no se mueve');
  assert.equal(nov(despues).gastosReal, 250000, 'lo real sí: refleja lo que se cargó después');
  const dic = (g) => g.meses.find((m) => m.key === '2026-11');
  assert.equal(dic(despues).gastos, 250000, 'un mes futuro se proyecta con lo de hoy');
  assert.equal(dic(antes).gastos, 200000);
});

test('pedir los gráficos de nuevo no vuelve a escribir las fotos', async () => {
  const p = nueva([ENCABEZADO], config());
  await dashboard.getGraficosData(AHORA);
  const antes = props(p).PROYECCION_FOTOS;
  await dashboard.getGraficosData(AHORA);
  assert.equal(props(p).PROYECCION_FOTOS, antes);
});

test('al empezar un mes nuevo se congela su foto sin tocar las anteriores', async () => {
  const p = nueva([ENCABEZADO], config());
  await dashboard.getGraficosData(AHORA); // noviembre
  const antes = JSON.parse(props(p).PROYECCION_FOTOS);
  await dashboard.getGraficosData(new Date('2026-12-02T15:00:00Z'));
  const despues = JSON.parse(props(p).PROYECCION_FOTOS);
  assert.deepEqual(Object.keys(despues).sort(), ['2026-10', '2026-11', '2026-8', '2026-9']);
  assert.deepEqual(despues['2026-10'], antes['2026-10'], 'la de noviembre quedó como estaba');
  assert.equal(despues['2026-11'].aprox, false);
});
