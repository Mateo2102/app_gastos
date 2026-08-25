import { NextResponse } from 'next/server';
import { agregarGasto, getGastosFijos } from '@/lib/data';
import { getDolarBlue } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';

export async function POST(req) {
  try {
    const body = await req.json();
    await agregarGasto(body);
    const [dashboard, dolarBlue] = await Promise.all([getDashboardData(), getDolarBlue()]);
    const gastosFijos = await getGastosFijos(dolarBlue);
    return NextResponse.json({ dashboard, gastosFijos });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
