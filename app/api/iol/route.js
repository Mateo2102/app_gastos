import { NextResponse } from 'next/server';
import { getCartera, getFotosCartera, registrarFotoDiaria, iolConfigurado } from '@/lib/iol';
import { hoyEnZona } from '@/lib/cobro';
import { CONFIG } from '@/lib/config';
import { statusDe } from '@/lib/errores';
import { protegido } from '@/lib/guardia';

// Cartera de IOL (solo lectura) y la evolución de su valor. Si IOL no está configurado responde
// { configurado: false } y el resto de la app sigue igual. ?forzar=1 salta la caché de 10 minutos.
export const GET = protegido(async function GET(req) {
  try {
    if (!iolConfigurado()) return NextResponse.json({ configurado: false });
    const forzar = new URL(req.url).searchParams.get('forzar') === '1';
    const cartera = await getCartera({ forzar });
    await registrarFotoDiaria(cartera, hoyEnZona(CONFIG.TZ)).catch((e) => console.error('No se pudo guardar la foto de la cartera:', e));
    return NextResponse.json({ configurado: true, cartera, fotos: await getFotosCartera() });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ configurado: true, error: e.message }, { status: statusDe(e) });
  }
});
