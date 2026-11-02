import { NextResponse } from 'next/server';
import { eliminarCobro } from '@/lib/logic';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

export const DELETE = protegido(async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    return NextResponse.json({ cobros: await eliminarCobro(id) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
