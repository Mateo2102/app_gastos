import { NextResponse } from 'next/server';
import { agregarAhorroMov } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';
import { protegido } from '@/lib/guardia';

export const POST = protegido(async function POST(req) {
  try {
    const body = await req.json();
    await agregarAhorroMov({ fecha: body.fecha, monto: body.monto, moneda: body.moneda });
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
