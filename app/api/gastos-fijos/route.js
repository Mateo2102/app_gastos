import { NextResponse } from 'next/server';
import { getGastosFijos } from '@/lib/data';
import { getDolarBlue } from '@/lib/logic';

export async function GET() {
  try {
    const dolarBlue = await getDolarBlue();
    const data = await getGastosFijos(dolarBlue);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
