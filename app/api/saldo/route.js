import { NextResponse } from 'next/server';
import { guardarSaldo, getDolarBlue } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

// Cierre del período: lo que ya pagué (ids de grupos), lo que tengo hoy y, opcionalmente, lo que ahorré
// (que también se carga solo en la pestaña Ahorro). Con `monto` vacío se borra el saldo.
export const POST = protegido(async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    await guardarSaldo(
      { monto: body.monto, pagados: body.pagados, ahorrado: body.ahorrado },
      { dolarBlue: await getDolarBlue() }
    );
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
