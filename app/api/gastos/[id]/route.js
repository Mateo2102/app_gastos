import { NextResponse } from 'next/server';
import { eliminarGasto, actualizarVigenciaFijo, getGastosFijos } from '@/lib/data';
import { getDolarBlue } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

async function respuesta() {
  const [dashboard, dolarBlue] = await Promise.all([getDashboardData(), getDolarBlue()]);
  const gastosFijos = await getGastosFijos(dolarBlue);
  return NextResponse.json({ dashboard, gastosFijos });
}

// El segmento es la referencia estable del registro: su id (o "h:<huella>" para filas viejas sin id).
// "?fila=" es solo una pista para desempatar; nunca se borra "esa fila" sin comprobar que sea la misma.
export const DELETE = protegido(async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const filaSugerida = new URL(req.url).searchParams.get('fila');
    await eliminarGasto({ ref: id, filaSugerida });
    return await respuesta();
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});

// Pausar, terminar, reanudar o reactivar un gasto fijo: { accion, mes? } (mes = "YYYY-MM", opcional).
export const PATCH = protegido(async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const filaSugerida = new URL(req.url).searchParams.get('fila');
    const cuerpo = await req.json().catch(() => ({}));
    await actualizarVigenciaFijo({ ref: id, filaSugerida, accion: cuerpo.accion, mes: cuerpo.mes });
    return await respuesta();
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
