import { NextResponse } from 'next/server';
import { eliminarAhorroMov, cambiarLugarAhorro } from '@/lib/logic';
import { getDashboardData } from '@/lib/dashboard';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

export const DELETE = protegido(async function DELETE(req, { params }) {
  try {
    const { key } = await params;
    await eliminarAhorroMov(decodeURIComponent(key));
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});

// Cambia dónde está guardado un ahorro: { lugar } ('' = sin ubicar).
export const PATCH = protegido(async function PATCH(req, { params }) {
  try {
    const { key } = await params;
    const body = await req.json().catch(() => ({}));
    await cambiarLugarAhorro(decodeURIComponent(key), body.lugar);
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: statusDe(e) });
  }
});
