import { CONFIG } from './config';
import { readRows, getCierreMap } from './data';
import {
  getDolarBlue, getConfiguracion, buildProjection, getComprasActivas,
  convertirMontos, getCardKeyAndN
} from './logic';

export async function getDashboardData(hipoteticoInput, anchorInput) {
  const dolarBlue = await getDolarBlue();
  const rows = await readRows(dolarBlue);
  const config = await getConfiguracion();

  let hipotetico = null;
  if (hipoteticoInput && hipoteticoInput.monto) {
    const cierreMap = await getCierreMap();
    const moneda = hipoteticoInput.moneda || 'ARS';
    const montoOriginal = Number(hipoteticoInput.monto) || 0;
    const { montoARS, montoUSD } = convertirMontos(montoOriginal, moneda, dolarBlue);
    hipotetico = {
      gasto: 'Gasto variable',
      medio: hipoteticoInput.medio,
      desc: 'Simulación',
      fecha: new Date(hipoteticoInput.fecha),
      cuotas: Number(hipoteticoInput.cuotas) || 1,
      moneda, montoOriginal, monto: montoARS, montoARS, montoUSD,
      n: getCardKeyAndN(hipoteticoInput.medio, cierreMap)
    };
  }

  const anchor = (anchorInput && anchorInput.year !== undefined && anchorInput.month !== undefined && anchorInput.year !== '' && anchorInput.month !== '')
    ? { year: Number(anchorInput.year), month: Number(anchorInput.month) }
    : null;

  const meses = buildProjection(rows, CONFIG.MESES_PROYECCION, config.historico, config.sueldoMensual, config.piso, hipotetico, anchor);
  const detalle = getComprasActivas(rows);
  return { meses, detalle, config, dolarBlue };
}
