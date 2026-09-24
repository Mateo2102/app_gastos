import { CONFIG } from './config';
import { readRows, getCierreMap } from './data';
import {
  getDolarBlue, getConfiguracion, buildProjection, getComprasActivas,
  convertirMontos, getCardKeyAndN, getAhorroMovs, getProyeccionPorCuenta
} from './logic';

export async function getDashboardData(hipoteticoInput, anchorInput) {
  const dolarBlue = await getDolarBlue();
  const rows = await readRows(dolarBlue);
  const config = await getConfiguracion();
  const ahorroMovs = await getAhorroMovs();

  let hipotetico = null;
  if (hipoteticoInput && hipoteticoInput.monto) {
    const cierreMap = await getCierreMap();
    const moneda = hipoteticoInput.moneda || 'ARS';
    const montoOriginal = Number(hipoteticoInput.monto) || 0;
    const { montoARS, montoUSD } = convertirMontos(montoOriginal, moneda, dolarBlue);
    const formaPago = hipoteticoInput.formaPago || 'Tarjeta de Crédito';
    const banco = hipoteticoInput.banco || '';
    hipotetico = {
      gasto: 'Gasto variable',
      medio: [hipoteticoInput.marca, banco].filter(Boolean).join(' ') || banco || formaPago,
      formaPago, banco, marca: hipoteticoInput.marca || '',
      desc: 'Simulación',
      fecha: new Date(hipoteticoInput.fecha),
      fechaCierre: hipoteticoInput.fechaCierre ? new Date(hipoteticoInput.fechaCierre) : null,
      cuotas: Number(hipoteticoInput.cuotas) || 1,
      moneda, montoOriginal, monto: montoARS, montoARS, montoUSD,
      n: getCardKeyAndN(banco, cierreMap)
    };
  }

  const anchor = (anchorInput && anchorInput.year !== undefined && anchorInput.month !== undefined && anchorInput.year !== '' && anchorInput.month !== '')
    ? { year: Number(anchorInput.year), month: Number(anchorInput.month) }
    : null;

  const meses = buildProjection(rows, CONFIG.MESES_PROYECCION, config.sueldoSchedule, config.piso, hipotetico, anchor);
  // Lo ahorrado de verdad en cada mes (suma de los movimientos de ese mes, en equivalente ARS/USD),
  // para superponerlo en el gráfico de Resumen.
  meses.forEach(mo => {
    const prefijo = `${mo.year}-${String(mo.month + 1).padStart(2, '0')}`;
    const delMes = ahorroMovs.filter(m => String(m.fecha).startsWith(prefijo));
    if (!delMes.length) { mo.ahorroReal = null; return; }
    let montoARS = 0, montoUSD = 0;
    delMes.forEach(m => {
      const conv = convertirMontos(m.monto, m.moneda, dolarBlue);
      montoARS += conv.montoARS;
      montoUSD += conv.montoUSD || 0;
    });
    mo.ahorroReal = { montoARS, montoUSD };
  });
  const detalle = getComprasActivas(rows);
  const porCuenta = getProyeccionPorCuenta(rows, CONFIG.MESES_PROYECCION, null);
  return { meses, detalle, porCuenta, config: { ...config, ahorroMovs }, dolarBlue };
}
