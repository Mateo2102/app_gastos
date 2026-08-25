import { NextResponse } from 'next/server';
import { eliminarFila, getGastosFijos } from '@/lib/data';
import { getDolarBlue } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';

export async function DELETE(req, { params }) {
  try {
    const { row } = await params;
    await eliminarFila(row);
    const [dashboard, dolarBlue] = await Promise.all([getDashboardData(), getDolarBlue()]);
    const gastosFijos = await getGastosFijos(dolarBlue);
    return NextResponse.json({ dashboard, gastosFijos });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
