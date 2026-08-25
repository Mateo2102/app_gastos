import { CONFIG } from './config';
import { readRows, getCierreMap } from './data';
import {
  getDolarBlue, getConfiguracion, buildProjection, getComprasActivas,
  convertirMontos, getCardKeyAndN, getAhorroReal
} from './logic';

export async function getDashboardData(hipoteticoInput, anchorInput) {
  const dolarBlue = await getDolarBlue();
  const rows = await readRows(dolarBlue);
  const config = await getConfiguracion();
  const ahorroReal = await getAhorroReal();

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
  meses.forEach(mo => {
    const entry = ahorroReal[mo.key];
    if (!entry) { mo.ahorroReal = null; return; }
    const { montoARS, montoUSD } = convertirMontos(entry.monto, entry.moneda, dolarBlue);
    mo.ahorroReal = { montoOriginal: entry.monto, moneda: entry.moneda, montoARS, montoUSD };
  });
  const detalle = getComprasActivas(rows);
  return { meses, detalle, config: { ...config, ahorroReal }, dolarBlue };
}
