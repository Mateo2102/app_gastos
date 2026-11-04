import { NextResponse } from 'next/server';
import { guardarReservaMP } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

// Reserva automática de MercadoPago: { activa, tipo: 'porcentaje' | 'fijo', valor }.
export const POST = protegido(async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    await guardarReservaMP({ activa: body.activa, tipo: body.tipo, valor: body.valor });
    return NextResponse.json(await getDashboardData());
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
