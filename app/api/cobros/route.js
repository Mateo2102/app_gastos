import { NextResponse } from 'next/server';
import { getCobros, agregarCobro } from '@/lib/logic';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

// Cobros reales: lo que de verdad se cobró, sueldo y extra. Es un registro aparte de la proyección.
export const GET = protegido(async function GET() {
  try {
    return NextResponse.json({ cobros: await getCobros() });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});

export const POST = protegido(async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const cobros = await agregarCobro({ fecha: body.fecha, monto: body.monto, tipo: body.tipo, nota: body.nota });
    return NextResponse.json({ cobros });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
