import { NextResponse } from 'next/server';
import { guardarPiso, guardarCierreDia } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';

export async function POST(req) {
  try {
    const body = await req.json();
    if (body.cierre) await guardarCierreDia(body.cierre.banco, body.cierre.dia);
    if (body.piso !== undefined) await guardarPiso(body.piso);
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
