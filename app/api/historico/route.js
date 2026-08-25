import { NextResponse } from 'next/server';
import { getHistorico } from '@/lib/data';
import { getDolarBlue } from '@/lib/logic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const desde = searchParams.get('desde') || '';
    const hasta = searchParams.get('hasta') || '';
    const dolarBlue = await getDolarBlue();
    const data = await getHistorico(desde, hasta, dolarBlue);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
