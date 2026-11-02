import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/dashboard';
import { protegido } from '@/lib/guardia';

export const GET = protegido(async function GET() {
  try {
    const data = await getDashboardData(null, null);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});

export const POST = protegido(async function POST(req) {
  try {
    const body = await req.json();
    const data = await getDashboardData(body.hipotetico || null, body.anchor || null);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
