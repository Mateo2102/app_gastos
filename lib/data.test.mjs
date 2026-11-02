// Pruebas de la capa de datos contra una planilla simulada. Correr con: npm test
process.env.SPREADSHEET_ID = 'planilla-de-prueba';
process.env.SHEET_NAME = 'Base';

import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPlanillaFalsa, filaGasto, conTablaCierres, ENCABEZADO } from './__pruebas__/planillaFalsa.mjs';
import { ErrorValidacion, ErrorConflicto, ErrorNoEncontrado } from './errores.js';

const cliente = await import('./sheetsClient.js');
const data = await import('./data.js');
const logic = await import('./logic.js');

function nueva(opciones) {
  const p = crearPlanillaFalsa(opciones);
  cliente.__prueba.reiniciar();
  cliente.__prueba.usarSheets(p.api);
  data.__prueba.reiniciar();
  return p;
}

const compra = (desc, extra = {}) => ({
  gasto: 'Gasto variable', desc, monto: 100, moneda: 'ARS', cuotas: 1, fecha: '2026-11-02',
  formaPago: 'Efectivo', categoria: 'Supermercado', tipo: 'Compra', ...extra
});
const descs = (p) => p.hojas.Base.slice(1).map((f) => f[3]);

// ---------------------------------------------------------------- escritura: no pisar registros

test('dos cargas consecutivas: ambas quedan, en filas distintas y con id distinto', async () => {
  const p = nueva({ base: [ENCABEZADO] });
  const a = await data.agregarGasto(compra('Uno'));
  const b = await data.agregarGasto(compra('Dos'));
  assert.equal(a.row, 2);
  assert.equal(b.row, 3);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(descs(p), ['Uno', 'Dos']);
  assert.equal(p.hojas.Base[1][26], a.id, 'el id queda escrito en la misma fila');
  assert.equal(p.hojas.Base[2][26], b.id);
});

test('dos cargas concurrentes (con latencia variable): no se pierde ninguna', async () => {
  const p = nueva({ base: [ENCABEZADO] });
  p.latencia = () => Math.floor(Math.random() * 6);
  const nombres = Array.from({ length: 8 }, (_, i) => 'C' + i);
  const res = await Promise.all(nombres.map((n) => data.agregarGasto(compra(n))));
  assert.deepEqual([...descs(p)].sort(), [...nombres].sort());
  assert.equal(new Set(res.map((r) => r.row)).size, 8, 'cada carga tiene su fila');
  assert.equal(new Set(res.map((r) => r.id)).size, 8, 'cada carga tiene su id');
});

test('lectura cacheada seguida de escritura: no pisa lo que otra instancia agregó mientras tanto', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'Viejo', id: 'g_viejo' })] });
  await data.readRows(1500); // deja la grilla en caché (2 filas)
  p.otraInstanciaAgrega(filaGasto({ desc: 'DeOtraInstancia', id: 'g_otra' })); // el caché no se entera
  await data.agregarGasto(compra('Nuevo'));
  assert.deepEqual(descs(p), ['Viejo', 'DeOtraInstancia', 'Nuevo']);
});

test('después de una escritura la próxima lectura ve el cambio (invalidación)', async () => {
  const p = nueva({ base: [ENCABEZADO] });
  assert.equal((await data.readRows(1500)).length, 0);
  await data.agregarGasto(compra('Nuevo'));
  const filas = await data.readRows(1500);
  assert.deepEqual(filas.map((r) => r.desc), ['Nuevo']);
  assert.ok(p.cuenta('values.get', 'Base') >= 2);
});

test('las filas viejas sin id reciben su id (y el encabezado) al cargar un registro nuevo', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'Vieja1' }), filaGasto({ desc: 'Vieja2', monto: 5 })] });
  await data.agregarGasto(compra('Nuevo'));
  const ids = p.hojas.Base.slice(1).map((f) => f[26]);
  assert.ok(ids.every((x) => /^g_[0-9a-f]{16}$/.test(x)), 'todas las filas tienen id: ' + ids);
  assert.equal(new Set(ids).size, 3);
  assert.equal(p.hojas.Base[0][26], 'id');
});

// ---------------------------------------------------------------- sanitización y validación

test('textos que empiezan con = + - @ se escriben como texto: ninguna celda del usuario es fórmula', async () => {
  const p = nueva({ base: [ENCABEZADO] });
  await data.agregarGasto(compra('=HYPERLINK("http://malo","x")', { categoria: '+cmd|calc', banco: '@SUM(1)', tipo: '-2+3', formaPago: 'Transferencia' }));
  const f = p.hojas.Base[1];
  // lo que Sheets guarda y devuelve es el texto original (el apóstrofo no forma parte del valor)
  assert.equal(f[3], '=HYPERLINK("http://malo","x")');
  assert.equal(f[14], '+cmd|calc');
  assert.equal(f[11], '@SUM(1)');
  // las únicas fórmulas escritas son las propias de Total (I) y Estado (J)
  assert.ok(p.formulas.length > 0);
  assert.ok(p.formulas.every((x) => /^[IJ]\d+$/.test(x.celda)), 'fórmulas inesperadas: ' + JSON.stringify(p.formulas.map((x) => x.celda)));
  // y en el pedido a la API esos textos viajaron con apóstrofo delante
  const append = p.llamadas.find((l) => l.tipo === 'values.append').args.requestBody.values[0];
  assert.ok(append[3].startsWith("'="));
  assert.ok(append[14].startsWith("'+"));
  assert.ok(append[11].startsWith("'@"));
});

test('entradas inválidas se rechazan sin escribir nada', async () => {
  const p = nueva({ base: [ENCABEZADO] });
  const malas = [
    compra('x', { monto: 0 }), compra('x', { monto: -5 }), compra('x', { monto: 'abc' }), compra('x', { monto: 1e15 }),
    compra('x', { cuotas: 1000000 }), compra('x', { cuotas: 121 }), compra('x', { cuotas: 0 }), compra('x', { cuotas: 2.5 }),
    compra('x', { fecha: '2026-13-45' }), compra('x', { fecha: '2026-02-30' }), compra('x', { fecha: '31/04/2026' }), compra('x', { fecha: 'mañana' }), compra('x', { gasto: 'Otra cosa' }),
    compra('x', { formaPago: 'Bitcoin' }), compra('x', { moneda: 'EUR' }), compra('x', { marca: 'DINERS', formaPago: 'Tarjeta de Crédito' }),
    compra('   '), compra(''), null, 'texto'
  ];
  for (const m of malas) {
    await assert.rejects(() => data.agregarGasto(m), ErrorValidacion, 'debió rechazar ' + JSON.stringify(m));
  }
  assert.equal(p.cuenta('values.append'), 0);
  assert.equal(p.hojas.Base.length, 1);
});

test('el tope de cuotas permite el máximo y la fecha real se escribe tal cual', async () => {
  const p = nueva({ base: [ENCABEZADO] });
  await data.agregarGasto(compra('Largo', { cuotas: 120, fecha: '2026-10-25', formaPago: 'Tarjeta de Crédito', banco: 'Santander', marca: 'VISA' }));
  const f = p.hojas.Base[1];
  assert.equal(f[5], 120);
  assert.equal(f[4], '25/10/2026', 'la fecha de compra no se desplaza');
  assert.equal(f[11], 'Santander');
});

// ---------------------------------------------------------------- borrado por id

test('borrar por id después de que cambió el orden de las filas borra la correcta', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' }), filaGasto({ desc: 'B', id: 'g_b' }), filaGasto({ desc: 'C', id: 'g_c' })] });
  const antes = await data.readRows(1500);
  const b = antes.find((r) => r.desc === 'B');
  assert.equal(b.rowIndex, 3);
  p.otraInstanciaBorra(2); // otra pestaña borró "A": B pasa a la fila 2
  await data.eliminarGasto({ ref: b.ref, filaSugerida: b.rowIndex }); // la pista (3) ya es de "C"
  assert.deepEqual(descs(p), ['C']);
  assert.deepEqual((await data.readRows(1500)).map((r) => r.desc), ['C']);
});

test('borrar por id después de que otra instancia insertó una fila arriba', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' }), filaGasto({ desc: 'B', id: 'g_b' })] });
  await data.readRows(1500);
  p.otraInstanciaInserta(2, filaGasto({ desc: 'Insertada', id: 'g_i' }));
  await data.eliminarGasto({ ref: 'g_a', filaSugerida: 2 }); // la fila 2 ahora es "Insertada"
  assert.deepEqual(descs(p), ['Insertada', 'B']);
});

test('borrar un registro al lado de la tabla de cierres no la mueve ni le borra ninguna tarjeta', async () => {
  const filas = [ENCABEZADO];
  for (let i = 0; i < 30; i++) filas.push(filaGasto({ desc: 'F' + i, id: 'g_' + i, monto: 10 + i }));
  const p = nueva({ base: conTablaCierres(filas) }); // la tabla ocupa P22:Q25, junto a filas de datos
  const tabla = () => JSON.stringify(p.hojas.Base.slice(21, 25).map((f) => f.slice(15, 17)));
  const antes = tabla();
  const r23 = (await data.readRows(1500)).find((r) => r.rowIndex === 23); // un registro dentro de las filas de la tabla
  await data.eliminarGasto({ ref: r23.ref, filaSugerida: 23 });
  assert.equal(tabla(), antes, 'la tabla Tarjeta/Cierre quedó exactamente igual');
  assert.equal(p.hojas.Base.length, 30, 'un registro menos (eran 31 filas con el encabezado)');
  assert.ok(!descs(p).includes(r23.desc));
  assert.equal(p.hojas.Base[22][3], 'F22', 'lo que estaba debajo subió una fila');
  assert.equal(p.hojas.Base[22][26], 'g_22', 'y su id subió con él');
  assert.deepEqual((await data.getOpciones()).bancos, ['Santander', 'ICBC', 'MercadoPago']);
});

test('un id que ya no existe no borra nada', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' })] });
  await assert.rejects(() => data.eliminarGasto({ ref: 'g_fantasma', filaSugerida: 2 }), ErrorNoEncontrado);
  assert.deepEqual(descs(p), ['A']);
});

test('sin referencia no se borra nada', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' })] });
  await assert.rejects(() => data.eliminarGasto({}), ErrorValidacion);
  await assert.rejects(() => data.eliminarGasto({ ref: 42 }), ErrorValidacion);
  assert.deepEqual(descs(p), ['A']);
});

test('fila vieja sin id: se borra por huella de contenido aunque se haya movido', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A' }), filaGasto({ desc: 'B', monto: 777 }), filaGasto({ desc: 'C', monto: 3 })] });
  const b = (await data.readRows(1500)).find((r) => r.desc === 'B');
  assert.ok(b.ref.startsWith('h:'));
  p.otraInstanciaBorra(2);
  await data.eliminarGasto({ ref: b.ref, filaSugerida: 3 });
  assert.deepEqual(descs(p), ['C']);
});

test('dos filas idénticas sin id: sin pista no se borra nada; con la pista correcta, solo esa', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'Igual' }), filaGasto({ desc: 'Igual' })] });
  const r = (await data.readRows(1500))[0];
  await assert.rejects(() => data.eliminarGasto({ ref: r.ref }), ErrorConflicto);
  assert.equal(descs(p).length, 2);
  await data.eliminarGasto({ ref: r.ref, filaSugerida: 3 });
  assert.equal(descs(p).length, 1);
});

test('si la planilla cambia entre la lectura y el borrado, no se borra nada', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' }), filaGasto({ desc: 'B', id: 'g_b' }), filaGasto({ desc: 'C', id: 'g_c' })] });
  let disparado = false;
  p.alLlamar = (tipo, args, pl) => {
    // la comprobación puntual de la fila (A3:AD3) es la segunda lectura; en ese momento otra persona borra "A"
    if (tipo === 'values.get' && /^Base!A\d+:AD\d+$/.test(args.range) && args.range !== 'Base!A1:AD2000' && !disparado) {
      disparado = true;
      pl.otraInstanciaBorra(2);
    }
  };
  await assert.rejects(() => data.eliminarGasto({ ref: 'g_b' }), ErrorConflicto);
  assert.equal(disparado, true);
  assert.deepEqual(descs(p), ['B', 'C'], 'solo desapareció lo que borró la otra persona; B y C siguen');
  assert.equal(p.cuenta('spreadsheets.batchUpdate'), 0, 'nunca se pidió borrar');
});

test('dos borrados concurrentes se aplican de a uno y cada uno borra lo suyo', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' }), filaGasto({ desc: 'B', id: 'g_b' }), filaGasto({ desc: 'C', id: 'g_c' }), filaGasto({ desc: 'D', id: 'g_d' })] });
  p.latencia = () => Math.floor(Math.random() * 4);
  await Promise.all([data.eliminarGasto({ ref: 'g_a' }), data.eliminarGasto({ ref: 'g_c' })]);
  assert.deepEqual(descs(p), ['B', 'D']);
});

test('cargar y borrar a la vez no se pisan', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' }), filaGasto({ desc: 'B', id: 'g_b' })] });
  p.latencia = () => Math.floor(Math.random() * 4);
  await Promise.all([data.agregarGasto(compra('N1')), data.eliminarGasto({ ref: 'g_a' }), data.agregarGasto(compra('N2'))]);
  assert.deepEqual([...descs(p)].sort(), ['B', 'N1', 'N2']);
});

// ---------------------------------------------------------------- caché / lectura fresca / invalidación

test('lecturas simultáneas comparten una sola llamada y dentro del TTL no hay otra', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' })] });
  p.latencia = () => 5;
  await Promise.all([data.readRows(1500), data.readRows(1500), data.readRows(1500), data.getOpciones()]);
  assert.equal(p.cuenta('values.get', 'Base'), 1);
  await data.readRows(1500);
  assert.equal(p.cuenta('values.get', 'Base'), 1, 'dentro del TTL se usa el caché');
  await data.getRawGrid({ fresco: true });
  assert.equal(p.cuenta('values.get', 'Base'), 2, 'la lectura fresca se saltea el caché');
});

test('una lectura que estaba en vuelo cuando se escribió no vuelve a llenar el caché con datos viejos', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' })] });
  p.fotoPrevia = (args) => args.range === 'Base!A1:AD2000';
  p.latencia = (tipo) => (tipo === 'values.get' ? 40 : 0);
  const lenta = data.getRawGrid();                 // en vuelo, con la foto de antes de escribir
  await new Promise((r) => setTimeout(r, 5));
  p.latencia = () => 0;
  await data.agregarGasto(compra('Nueva'));
  const vieja = await lenta;
  assert.ok(!vieja.values.some((f) => f[3] === 'Nueva'), 'a quien la pidió antes se le entrega su foto');
  const despues = await data.getRawGrid();
  assert.ok(despues.values.some((f) => f[3] === 'Nueva'), 'pero el caché no quedó con la foto vieja');
});

test('un error de escritura también invalida el caché', async () => {
  const p = nueva({ base: [ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' })] });
  await data.readRows(1500);
  p.alLlamar = (tipo) => { if (tipo === 'values.append') throw new Error('Sheets caído'); };
  await assert.rejects(() => data.agregarGasto(compra('X')), /Sheets caído/);
  p.alLlamar = null;
  p.otraInstanciaAgrega(filaGasto({ desc: 'Otra', id: 'g_o' }));
  assert.deepEqual((await data.readRows(1500)).map((r) => r.desc), ['A', 'Otra']);
});

test('la tabla de cierres en P:Q no interfiere con el append ni se mueve', async () => {
  const p = nueva({ base: conTablaCierres([ENCABEZADO, filaGasto({ desc: 'A', id: 'g_a' })]) });
  const antes = JSON.stringify(p.hojas.Base.slice(20, 25).map((f) => f.slice(15, 17)));
  await data.agregarGasto(compra('B'));
  assert.equal(p.hojas.Base[2][3], 'B');
  assert.equal(JSON.stringify(p.hojas.Base.slice(20, 25).map((f) => f.slice(15, 17))), antes);
  const op = await data.getOpciones();
  assert.deepEqual(op.bancos, ['Santander', 'ICBC', 'MercadoPago']);
  assert.equal(op.cierreN.Santander, 4);
});

test('si los datos llegan hasta la altura de la tabla de cierres, el append no la pisa', async () => {
  // 20 filas de datos: la fila nueva cae en la 22, donde P:Q tiene "Tarjeta/Cierre"
  const filas = [ENCABEZADO];
  for (let i = 0; i < 20; i++) filas.push(filaGasto({ desc: 'F' + i, id: 'g_' + i }));
  const p = nueva({ base: conTablaCierres(filas) });
  const antes = JSON.stringify(p.hojas.Base.slice(21, 25).map((f) => f.slice(15, 17)));
  const r = await data.agregarGasto(compra('NuevaAlturaTabla'));
  assert.equal(r.row, 22);
  assert.equal(p.hojas.Base[21][3], 'NuevaAlturaTabla');
  assert.equal(JSON.stringify(p.hojas.Base.slice(21, 25).map((f) => f.slice(15, 17))), antes, 'la tabla Tarjeta/Cierre quedó intacta');
  assert.deepEqual((await data.getOpciones()).bancos, ['Santander', 'ICBC', 'MercadoPago']);
});

test('filaDeRango entiende los rangos que devuelve Sheets', () => {
  assert.equal(data.filaDeRango('Base!A57:AA57'), 57);
  assert.equal(data.filaDeRango("'Mi hoja'!A12:O12"), 12);
  assert.equal(data.filaDeRango('Base!A9'), 9);
  assert.equal(data.filaDeRango(undefined), null);
  assert.equal(data.filaDeRango('basura'), null);
});

// ---------------------------------------------------------------- configuración (ConfigTablero)

test('configuración modificada hace poco: guardar un cierre conserva lo que otra instancia acaba de guardar', async () => {
  const p = nueva({ base: [ENCABEZADO], config: [['CIERRE_DIAS', '{"Santander":15}']] });
  await cliente.getProps(); // el caché ve solo Santander
  p.otraInstanciaFijaConfig('CIERRE_DIAS', '{"Santander":15,"MercadoPago":5}');
  const r = await logic.guardarCierreDia('ICBC', 20);
  assert.deepEqual(r, { Santander: 15, MercadoPago: 5, ICBC: 20 });
  assert.deepEqual(JSON.parse(p.config().CIERRE_DIAS), { Santander: 15, MercadoPago: 5, ICBC: 20 });
});

test('claves que escribió otra instancia (otro valor) tampoco se pierden al guardar el piso', async () => {
  const p = nueva({ base: [ENCABEZADO], config: [['PISO_DISPONIBLE', '400000']] });
  await cliente.getProps();
  p.otraInstanciaFijaConfig('SUELDO_SCHEDULE', '[{"key":"2026-10","monto":2000000}]');
  await logic.guardarPiso(500000);
  const c = p.config();
  assert.equal(c.PISO_DISPONIBLE, '500000');
  assert.equal(c.SUELDO_SCHEDULE, '[{"key":"2026-10","monto":2000000}]');
});

test('dos cambios de configuración simultáneos se conservan los dos', async () => {
  const p = nueva({ base: [ENCABEZADO], config: [] });
  p.latencia = () => Math.floor(Math.random() * 4);
  await Promise.all([logic.guardarCierreDia('A', 1), logic.guardarCierreDia('B', 2), logic.agregarTramoSueldo({ year: 2026, month: 10, monto: 123 })]);
  const c = p.config();
  assert.deepEqual(JSON.parse(c.CIERRE_DIAS), { A: 1, B: 2 });
  assert.deepEqual(JSON.parse(c.SUELDO_SCHEDULE), [{ key: '2026-10', monto: 123 }]);
});

test('los movimientos de ahorro parten de lo último guardado', async () => {
  const p = nueva({ base: [ENCABEZADO], config: [['AHORRO_MOVS', JSON.stringify([{ id: 'a1', fecha: '2026-10-01', monto: 10, moneda: 'ARS' }])]] });
  await cliente.getProps();
  p.otraInstanciaFijaConfig('AHORRO_MOVS', JSON.stringify([{ id: 'a1', fecha: '2026-10-01', monto: 10, moneda: 'ARS' }, { id: 'a2', fecha: '2026-10-02', monto: 20, moneda: 'USD' }]));
  const r = await logic.agregarAhorroMov({ fecha: '2026-10-03', monto: 30, moneda: 'ARS' });
  assert.deepEqual(r.map((m) => m.id).slice(0, 2), ['a1', 'a2']);
  assert.equal(r.length, 3);
  const borrado = await logic.eliminarAhorroMov('a2');
  assert.deepEqual(borrado.map((m) => m.monto), [10, 30]);
});

test('guardar configuración escribe la tabla en una sola llamada, sin borrarla antes', async () => {
  const p = nueva({ base: [ENCABEZADO], config: [['A', '1'], ['B', '2']] });
  await cliente.setProps({ C: '3' });
  assert.equal(p.cuenta('values.clear'), 0, 'no hay clear: nunca queda la tabla vacía entre dos llamadas');
  const escritas = p.llamadas.filter((l) => l.tipo === 'values.update' && l.rango.startsWith('ConfigTablero'));
  assert.equal(escritas.length, 1);
  assert.equal(escritas[0].rango, 'ConfigTablero!A1:B3');
  assert.deepEqual(p.config(), { A: '1', B: '2', C: '3' });
});

test('después de guardar, getProps devuelve lo escrito sin releer la planilla', async () => {
  const p = nueva({ base: [ENCABEZADO], config: [['A', '1']] });
  await cliente.setProps({ B: '2' });
  const lecturas = p.cuenta('values.get', 'ConfigTablero');
  const props = await cliente.getProps();
  assert.deepEqual(props, { A: '1', B: '2' });
  assert.equal(p.cuenta('values.get', 'ConfigTablero'), lecturas);
});

test('getProps con caché + lectura fresca: la fresca ve el cambio externo y actualiza el caché', async () => {
  const p = nueva({ base: [ENCABEZADO], config: [['A', '1']] });
  assert.deepEqual(await cliente.getProps(), { A: '1' });
  p.otraInstanciaFijaConfig('A', '9');
  assert.deepEqual(await cliente.getProps(), { A: '1' }, 'con caché: dato anterior (aceptable para mostrar)');
  assert.deepEqual(await cliente.getProps({ fresco: true }), { A: '9' });
  assert.deepEqual(await cliente.getProps(), { A: '9' });
});

test('la hoja de configuración se crea una sola vez aunque haya lecturas simultáneas', async () => {
  const p = nueva({ base: [ENCABEZADO], sinHojaConfig: true });
  p.latencia = () => 3;
  await Promise.all([cliente.getProps(), cliente.getProps({ fresco: true }), cliente.getProps({ fresco: true })]);
  const altas = p.llamadas.filter((l) => l.tipo === 'spreadsheets.batchUpdate').length;
  assert.equal(altas, 1);
  assert.ok(p.hojas.ConfigTablero);
});

test('convertirMontos: un monto en USD sin cotización falla en vez de contarse como pesos', () => {
  assert.throws(() => logic.convertirMontos(650, 'USD', 0), (e) => e.status === 503);
  assert.deepEqual(logic.convertirMontos(650, 'USD', 1500), { montoARS: 975000, montoUSD: 650 });
  assert.deepEqual(logic.convertirMontos(1000, 'ARS', 0), { montoARS: 1000, montoUSD: null });
});

test('getOpciones no necesita la cotización: una planilla con filas en USD sigue cargando', async () => {
  nueva({ base: conTablaCierres([ENCABEZADO, filaGasto({ desc: 'MOTO', moneda: 'USD', monto: 650, formaPago: 'Transferencia', banco: 'Santander' })]) });
  const op = await data.getOpciones();
  assert.deepEqual(op.bancos, ['Santander', 'ICBC', 'MercadoPago']);
});

// ---------------------------------------------------------------- saldo actual

test('guardarSaldo guarda lo que tengo hoy con la fecha de hoy, valida y borra con monto vacío', async () => {
  nueva({ base: [ENCABEZADO] });
  await logic.guardarSaldo({ monto: '650000', pagado: '120000' }, new Date('2026-11-02T15:00:00Z'));
  let cfg = await logic.getConfiguracion();
  assert.deepEqual(cfg.saldoActual, { monto: 650000, pagado: 120000, fecha: '2026-11-02' });
  await assert.rejects(() => logic.guardarSaldo({ monto: '-5' }), ErrorValidacion);
  await assert.rejects(() => logic.guardarSaldo({ monto: 'abc' }), ErrorValidacion);
  await assert.rejects(() => logic.guardarSaldo({ monto: '10', pagado: '-1' }), ErrorValidacion);
  assert.equal((await logic.getConfiguracion()).saldoActual.monto, 650000, 'un valor inválido no pisa el anterior');
  await logic.guardarSaldo({ monto: '' });
  cfg = await logic.getConfiguracion();
  assert.equal(cfg.saldoActual, null);
});
