import { NextResponse } from 'next/server';
import { guardarAhorroReal } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';

export async function POST(req) {
  try {
    const body = await req.json();
    await guardarAhorroReal({ year: Number(body.year), month: Number(body.month), monto: body.monto });
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
