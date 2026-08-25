import { NextResponse } from 'next/server';
import { eliminarTramoSueldo } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';

export async function DELETE(req, { params }) {
  try {
    const { key } = await params;
    await eliminarTramoSueldo(decodeURIComponent(key));
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
