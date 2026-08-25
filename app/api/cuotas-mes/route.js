import { NextResponse } from 'next/server';
import { readRows } from '@/lib/data';
import { getDolarBlue, getCuotasPorMes } from '@/lib/logic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));
    const dolarBlue = await getDolarBlue();
    const rows = await readRows(dolarBlue);
    const detalle = getCuotasPorMes(rows, `${year}-${month}`);
    return NextResponse.json({ detalle, dolarBlue });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
