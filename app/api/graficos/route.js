import { NextResponse } from 'next/server';
import { getGraficosData } from '@/lib/dashboard';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

// Evolutivo contra proyectado, mes a mes (ingresos, gastos, ahorro proyectado y ahorro real).
export const GET = protegido(async function GET() {
  try {
    return NextResponse.json(await getGraficosData());
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
