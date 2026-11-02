import { NextResponse } from 'next/server';
import { getOpciones } from '@/lib/data';
import { protegido } from '@/lib/guardia';

export const GET = protegido(async function GET() {
  try {
    const data = await getOpciones();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
