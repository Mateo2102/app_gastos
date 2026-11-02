import { NextResponse } from 'next/server';
import { guardarSaldo } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

// Lo que tengo hoy (y lo que ya pagué de lo comprometido). Con `monto` vacío se borra.
export const POST = protegido(async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    await guardarSaldo({ monto: body.monto, pagado: body.pagado });
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
