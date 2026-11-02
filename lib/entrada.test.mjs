// Pruebas de sanitización, validación e identidad de registros. Correr con: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { textoSeguro, validarGasto, leerFecha, huellaDeFila, nuevoId, MAX_CUOTAS } from './entrada.js';
import { ErrorValidacion } from './errores.js';

const base = { gasto: 'Gasto variable', desc: 'Zapatillas', monto: 1000, moneda: 'ARS', cuotas: 3, fecha: '2026-10-25', formaPago: 'Tarjeta de Crédito', banco: 'Santander', marca: 'VISA', categoria: 'Indumentaria y calzado', tipo: 'Compra' };

test('textoSeguro: lo que Sheets leería como fórmula va con apóstrofo', () => {
  for (const peligroso of ['=1+1', '=HYPERLINK("http://x","y")', '+5', '-5', '@SUM(A1)', '=IMPORTDATA("http://x")', '+cmd|calc']) {
    assert.equal(textoSeguro(peligroso), "'" + peligroso, peligroso);
  }
});

test('textoSeguro: espacios y saltos antes del signo no esquivan la protección', () => {
  assert.equal(textoSeguro('   =1+1'), "'=1+1");
  assert.equal(textoSeguro('\t=1+1'), "'=1+1");
  assert.equal(textoSeguro('\n+1'), "'+1");
  assert.equal(textoSeguro('\r\n@x'), "'@x");
});

test('textoSeguro: un texto normal no se modifica', () => {
  for (const ok of ['Zapatillas', 'Café con leche', '50% off', 'a=b', 'x-y', 'Mp gasto kala', 'ñandú 100%', '12345', '3 x 2']) {
    assert.equal(textoSeguro(ok), ok);
  }
});

test('textoSeguro: caracteres de control, largo y valores raros', () => {
  assert.equal(textoSeguro('a\u0000b\u0007c'), 'abc');
  assert.equal(textoSeguro('a\tb\nc'), 'a b c');
  assert.equal(textoSeguro('x'.repeat(500), 50).length, 50);
  assert.equal(textoSeguro(null), '');
  assert.equal(textoSeguro(undefined), '');
  assert.equal(textoSeguro(12), '12');
  assert.equal(textoSeguro('=' + 'x'.repeat(500), 20).length, 21, 'el apóstrofo se suma después de acotar');
});

test('leerFecha: fechas reales sí, imposibles no (no se corren a otro mes)', () => {
  const f = leerFecha('2026-10-25');
  assert.deepEqual([f.getFullYear(), f.getMonth(), f.getDate()], [2026, 9, 25]);
  assert.equal(leerFecha('25/10/2026').getDate(), 25);
  assert.equal(leerFecha('29/02/2028').getDate(), 29, 'bisiesto');
  for (const mala of ['2026-13-45', '2026-02-30', '31/04/2026', '29/02/2027', '2026-00-10', 'ayer', '', null]) {
    assert.equal(leerFecha(mala), null, String(mala));
  }
});

test('validarGasto: devuelve una copia limpia y normalizada', () => {
  const g = validarGasto({ ...base, desc: '  =cmd  ', categoria: '+x', banco: '@b' });
  assert.equal(g.desc, "'=cmd");
  assert.equal(g.categoria, "'+x");
  assert.equal(g.banco, "'@b");
  assert.equal(g.cuotas, 3);
  assert.equal(g.monto, 1000);
  assert.deepEqual([g.fecha.getMonth(), g.fecha.getDate()], [9, 25], 'la fecha de compra queda como se indicó');
});

test('validarGasto: efectivo e ingreso no llevan banco; solo tarjeta lleva marca', () => {
  assert.equal(validarGasto({ ...base, formaPago: 'Efectivo' }).banco, '');
  assert.equal(validarGasto({ ...base, formaPago: 'Efectivo' }).marca, '');
  assert.equal(validarGasto({ ...base, formaPago: 'Transferencia' }).banco, 'Santander');
  assert.equal(validarGasto({ ...base, formaPago: 'Transferencia' }).marca, '');
  const ing = validarGasto({ ...base, gasto: 'Ingreso extra', cuotas: 7 });
  assert.equal(ing.banco, '');
  assert.equal(ing.formaPago, '');
  assert.equal(ing.cuotas, 1, 'un ingreso no tiene cuotas');
});

test('validarGasto: solo la compra lleva cuotas; un gasto fijo siempre 1', () => {
  assert.equal(validarGasto({ ...base, gasto: 'Gasto fijo', cuotas: 12 }).cuotas, 1);
  assert.equal(validarGasto({ ...base, cuotas: '' }).cuotas, 1);
  assert.equal(validarGasto({ ...base, cuotas: undefined }).cuotas, 1);
  assert.equal(validarGasto({ ...base, cuotas: MAX_CUOTAS }).cuotas, MAX_CUOTAS);
});

test('validarGasto: rechaza lo inválido con un mensaje claro', () => {
  const casos = [
    [{ ...base, monto: 0 }, /monto/], [{ ...base, monto: -1 }, /monto/], [{ ...base, monto: NaN }, /monto/], [{ ...base, monto: Infinity }, /monto/],
    [{ ...base, monto: 1e13 }, /grande/], [{ ...base, cuotas: MAX_CUOTAS + 1 }, /superar/], [{ ...base, cuotas: 0 }, /entero/], [{ ...base, cuotas: 1.5 }, /entero/],
    [{ ...base, desc: '' }, /descripción/], [{ ...base, desc: '   ' }, /descripción/], [{ ...base, gasto: 'x' }, /tipo/], [{ ...base, moneda: 'EUR' }, /moneda/],
    [{ ...base, formaPago: 'Cheque' }, /forma de pago/], [{ ...base, marca: 'DINERS' }, /marca/], [{ ...base, fecha: '2026-02-30' }, /fecha/],
    [{ ...base, fechaCierre: '2026-99-99' }, /cierre/], [null, /tipo/], ['x', /tipo/], [undefined, /tipo/]
  ];
  for (const [entrada, patron] of casos) {
    assert.throws(() => validarGasto(entrada), (e) => e instanceof ErrorValidacion && e.status === 400 && patron.test(e.message), JSON.stringify(entrada));
  }
});

test('validarGasto: la fecha vacía usa "hoy" que se le pasa', () => {
  const hoy = new Date(2026, 10, 1);
  assert.equal(validarGasto({ ...base, fecha: '' }, hoy).fecha, hoy);
  assert.equal(validarGasto({ ...base, fecha: undefined }, hoy).fecha, hoy);
});

test('validarGasto: la fecha de cierre solo cuenta en compras con tarjeta', () => {
  assert.ok(validarGasto({ ...base, fechaCierre: '2026-10-24' }).fechaCierre instanceof Date);
  assert.equal(validarGasto({ ...base, formaPago: 'Efectivo', fechaCierre: '2026-10-24' }).fechaCierre, null);
  assert.equal(validarGasto({ ...base, gasto: 'Gasto fijo', fechaCierre: '2026-10-24' }).fechaCierre, null);
});

test('nuevoId: formato estable y sin repetidos', () => {
  const ids = new Set(Array.from({ length: 2000 }, nuevoId));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^g_[0-9a-f]{16}$/);
});

test('huellaDeFila: determinística, sensible al contenido y sin depender del id ni de la posición', () => {
  const fila = ['Gasto variable', 'Compra', 'x', 'Moto', '01/10/2026', 10, 'ARS', 46950, 469500, '', 'Transferencia', 'Santander', '', '', 'Transporte'];
  assert.equal(huellaDeFila(fila), huellaDeFila([...fila]));
  assert.equal(huellaDeFila(fila), huellaDeFila([...fila, ...new Array(11).fill(''), 'g_con_id']));
  assert.notEqual(huellaDeFila(fila), huellaDeFila([...fila.slice(0, 7), 46951, ...fila.slice(8)]));
  assert.notEqual(huellaDeFila(fila), huellaDeFila([...fila.slice(0, 3), 'Moto2', ...fila.slice(4)]));
  assert.equal(huellaDeFila(fila), huellaDeFila(fila.map((x) => (typeof x === 'string' ? '  ' + x + ' ' : x))), 'ignora espacios');
});
