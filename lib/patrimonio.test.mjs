// "Todo lo que tengo": ahorro a mano por lugar + cartera de IOL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resumenPatrimonio, valorIolAlCierre, acumuladoConIol, SIN_LUGAR, LUGAR_IOL } from './patrimonio.js';
import { crearPlanillaFalsa, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';
import { ErrorValidacion } from './errores.js';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const logic = await import('./logic.js');

const MOVS = [
  { monto: 100, moneda: 'USD', lugar: 'Caja de seguridad' },
  { monto: 50, moneda: 'USD', lugar: 'caja de seguridad' }, // mismo lugar escrito distinto
  { monto: 300000, moneda: 'ARS', lugar: 'Cuenta bancaria' },
  { monto: 20, moneda: 'USD' } // sin lugar
];
const CARTERA = { total: { ars: 1250000, usd: 400 } };

test('suma por lugar y moneda; "Caja de seguridad" y "caja de seguridad" son el mismo lugar', () => {
  const r = resumenPatrimonio(MOVS, null, 1500);
  const caja = r.lugares.find((l) => l.lugar === 'Caja de seguridad');
  assert.deepEqual([caja.ars, caja.usd], [0, 150]);
  assert.deepEqual([r.lugares.find((l) => l.lugar === 'Cuenta bancaria').ars, r.lugares.find((l) => l.lugar === SIN_LUGAR).usd], [300000, 20]);
  assert.deepEqual(r.total, { ars: 300000, usd: 170 });
  assert.equal(r.incluyeIol, false);
});

test('la cartera de IOL entra como un lugar más, automático, y se suma al total', () => {
  const r = resumenPatrimonio(MOVS, CARTERA, 1500);
  const iol = r.lugares.find((l) => l.lugar === LUGAR_IOL);
  assert.equal(iol.automatico, true);
  assert.deepEqual([iol.ars, iol.usd], [1250000, 400]);
  assert.deepEqual(r.total, { ars: 1550000, usd: 570 });
  assert.equal(r.equivArs, 1550000 + 570 * 1500, 'todo en pesos al dólar indicado');
  assert.equal(r.equivUsd, 570 + 1550000 / 1500);
  assert.equal(r.incluyeIol, true);
});

test('las partes por lugar suman 100% y vienen ordenadas de más a menos', () => {
  const r = resumenPatrimonio(MOVS, CARTERA, 1500);
  assert.ok(Math.abs(r.lugares.reduce((acc, l) => acc + l.parte, 0) - 1) < 1e-9);
  assert.deepEqual(r.lugares.map((l) => l.equivArs), [...r.lugares.map((l) => l.equivArs)].sort((a, b) => b - a));
});

test('sin datos o con datos raros no rompe', () => {
  assert.deepEqual(resumenPatrimonio([], null, 1500).lugares, []);
  const r = resumenPatrimonio([null, { monto: 'x', moneda: 'USD' }, {}], null, 0);
  assert.deepEqual(r.total, { ars: 0, usd: 0 });
  assert.equal(r.equivUsd, 0, 'sin dólar no se divide por cero');
});

// ---------------------------------------------------------------- lugar en los ahorros cargados

function nueva() {
  const p = crearPlanillaFalsa({ base: [ENCABEZADO], config: [] });
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}

test('un ahorro se guarda con su lugar (sanitizado) y se puede cambiar después', async () => {
  nueva();
  const lista = await logic.agregarAhorroMov({ fecha: '2026-11-02', monto: 100, moneda: 'USD', lugar: '  Caja de seguridad ' });
  assert.equal(lista[0].lugar, 'Caja de seguridad');
  const sin = await logic.agregarAhorroMov({ fecha: '2026-11-03', monto: 5, moneda: 'ARS' });
  assert.equal(sin.find((m) => m.monto === 5).lugar, undefined, 'sin lugar no se guarda el campo');
  const formula = await logic.agregarAhorroMov({ fecha: '2026-11-04', monto: 6, moneda: 'ARS', lugar: '=SUMA(1;1)' });
  assert.equal(formula.find((m) => m.monto === 6).lugar, '=SUMA(1;1)', 'se guarda como texto, sin el apóstrofo de seguridad');
  const id = lista[0].id;
  const cambiada = await logic.cambiarLugarAhorro(id, 'Billetera virtual');
  assert.equal(cambiada.find((m) => m.id === id).lugar, 'Billetera virtual');
  const borrada = await logic.cambiarLugarAhorro(id, '');
  assert.equal(borrada.find((m) => m.id === id).lugar, undefined);
  await assert.rejects(() => logic.cambiarLugarAhorro('no-existe', 'X'), /ya no está/);
});

test('con IOL conectada no se puede cargar a mano un ahorro "en IOL" (se contaría dos veces)', async () => {
  nueva();
  const antes = { u: process.env.IOL_USUARIO, c: process.env.IOL_CLAVE };
  try {
    delete process.env.IOL_USUARIO; delete process.env.IOL_CLAVE;
    const l = await logic.agregarAhorroMov({ fecha: '2026-11-02', monto: 1, moneda: 'ARS', lugar: 'IOL' });
    assert.equal(l[0].lugar, 'IOL', 'sin IOL conectada sí se puede anotar a mano');
    process.env.IOL_USUARIO = 'u'; process.env.IOL_CLAVE = 'c';
    for (const lugar of ['IOL', 'iol', 'Invertir Online', 'Mi cuenta en IOL']) {
      await assert.rejects(() => logic.agregarAhorroMov({ fecha: '2026-11-02', monto: 1, moneda: 'ARS', lugar }), ErrorValidacion, lugar);
    }
    await logic.agregarAhorroMov({ fecha: '2026-11-02', monto: 1, moneda: 'ARS', lugar: 'Violín' }); // "iol" dentro de otra palabra no cuenta
  } finally {
    if (antes.u === undefined) delete process.env.IOL_USUARIO; else process.env.IOL_USUARIO = antes.u;
    if (antes.c === undefined) delete process.env.IOL_CLAVE; else process.env.IOL_CLAVE = antes.c;
  }
});

// ---------------------------------------------------------------- IOL en el evolutivo del ahorro

const FOTOS = {
  '2026-10-30': { ars: 1000000, usd: 300 },
  '2026-11-02': { ars: 1250000, usd: 400 },
  '2026-11-04': { ars: 1300000, usd: 400 }
};

test('valorIolAlCierre: toma la última foto hasta el fin del mes y pasa los dólares a pesos', () => {
  assert.equal(valorIolAlCierre(FOTOS, 2026, 9, 1500), 1000000 + 300 * 1500, 'octubre: la foto del 30/10');
  assert.equal(valorIolAlCierre(FOTOS, 2026, 10, 1500), 1300000 + 400 * 1500, 'noviembre: la última (04/11)');
});

test('valorIolAlCierre: antes de la primera foto no hay valor; sin fotos tampoco; un mes sin fotos usa la última conocida', () => {
  assert.equal(valorIolAlCierre(FOTOS, 2026, 8, 1500), null, 'septiembre: IOL todavía no estaba conectado');
  assert.equal(valorIolAlCierre({}, 2026, 10, 1500), null);
  assert.equal(valorIolAlCierre(null, 2026, 10, 1500), null);
  assert.equal(valorIolAlCierre(FOTOS, 2026, 11, 1500), 1300000 + 400 * 1500, 'diciembre sin fotos: rige la última conocida');
  assert.equal(valorIolAlCierre(FOTOS, 2026, 10, 0), 1300000, 'sin dólar no se inventan pesos con los dólares');
});

test('acumuladoConIol: suma la cartera completa al ahorro acumulado a mano, solo en meses con ahorro real', () => {
  const filas = [
    { year: 2026, month: 8, ahorroReal: 50000, accReal: 50000 }, // septiembre, antes de IOL
    { year: 2026, month: 9, ahorroReal: 70000, accReal: 120000 }, // octubre
    { year: 2026, month: 10, ahorroReal: 150000, accReal: 270000 }, // noviembre (en curso)
    { year: 2026, month: 11, ahorroReal: null, accReal: null } // diciembre: futuro
  ];
  const r = acumuladoConIol(filas, FOTOS, 1500);
  assert.deepEqual(r.map((m) => m.iol), [null, 1450000, 1900000, null]);
  assert.deepEqual(r.map((m) => m.accRealTotal), [50000, 120000 + 1450000, 270000 + 1900000, null]);
});

test('acumuladoConIol: en el mes real suma lo que cambió IOL (el primer mes, la cartera completa) y los meses suman el acumulado', () => {
  const filas = [
    { year: 2026, month: 8, ahorroReal: 50000, accReal: 50000 },
    { year: 2026, month: 9, ahorroReal: 70000, accReal: 120000 },
    { year: 2026, month: 10, ahorroReal: 150000, accReal: 270000 },
    { year: 2026, month: 11, ahorroReal: null, accReal: null }
  ];
  const r = acumuladoConIol(filas, FOTOS, 1500);
  assert.deepEqual(r.map((m) => m.iolMes), [null, 1450000, 450000, null], 'octubre: la cartera completa; noviembre: 1.900.000 - 1.450.000');
  assert.deepEqual(r.map((m) => m.ahorroRealTotal), [50000, 70000 + 1450000, 150000 + 450000, null]);
  const suma = r.filter((m) => m.ahorroRealTotal !== null).reduce((acc, m) => acc + m.ahorroRealTotal, 0);
  assert.equal(suma, r[2].accRealTotal, 'la suma de los meses es exactamente el acumulado con IOL');
});

test('acumuladoConIol: si la cartera baja en el mes, el aporte de IOL es negativo', () => {
  const fotos = { '2026-10-30': { ars: 2000000, usd: 0 }, '2026-11-04': { ars: 1700000, usd: 0 } };
  const r = acumuladoConIol([
    { year: 2026, month: 9, ahorroReal: 0, accReal: 0 },
    { year: 2026, month: 10, ahorroReal: 0, accReal: 0 }
  ], fotos, 1500);
  assert.deepEqual(r.map((m) => m.iolMes), [2000000, -300000]);
});

test('acumuladoConIol sin IOL conectado deja el acumulado como estaba', () => {
  const r = acumuladoConIol([{ year: 2026, month: 10, ahorroReal: 150000, accReal: 270000 }], null, 1500);
  assert.deepEqual([r[0].iol, r[0].iolMes, r[0].accRealTotal, r[0].ahorroRealTotal], [null, null, 270000, 150000]);
});
