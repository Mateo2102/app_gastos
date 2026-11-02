import { NextResponse } from 'next/server';
import { decidirAcceso, leerConfig } from './lib/auth.js';

// Filtro previo (optimista): lee solo la cookie firmada. La verificación definitiva se repite en cada ruta
// de la API (lib/guardia.js), porque el proxy no debe ser la única defensa.
export function proxy(request) {
  const d = decidirAcceso({
    pathname: request.nextUrl.pathname,
    method: request.method,
    cookie: request.headers.get('cookie'),
    origin: request.headers.get('origin'),
    host: request.headers.get('host')
  }, leerConfig());

  if (d.permitir) return NextResponse.next();
  if (d.api) return NextResponse.json({ error: d.mensaje }, { status: d.status, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.redirect(new URL(d.destino, request.url));
}

export const config = {
  // Todo menos los archivos estáticos de Next y el ícono.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
