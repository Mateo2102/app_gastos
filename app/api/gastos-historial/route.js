import { NextResponse } from 'next/server';
import { readRows } from '@/lib/data';
import { getDolarBlue, getGastosPorMes } from '@/lib/logic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));
    const count = Math.min(Number(searchParams.get('count')) || 18, 36);
    const dolarBlue = await getDolarBlue();
    const rows = await readRows(dolarBlue);
    return NextResponse.json({ meses: getGastosPorMes(rows, { year, month }, count) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
