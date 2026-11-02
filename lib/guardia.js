// Defensa en profundidad: cada ruta de la API verifica el acceso ella misma, sin depender solo de proxy.js
// (la documentación de Next pide verificar cerca de los datos). Usa la misma decisión que el proxy.

import { leerConfig, decidirAcceso } from './auth.js';

export function verificarSolicitud(req, env = process.env) {
  const url = new URL(req.url);
  return decidirAcceso({
    pathname: url.pathname,
    method: req.method,
    cookie: req.headers.get('cookie'),
    origin: req.headers.get('origin'),
    host: req.headers.get('host')
  }, leerConfig(env));
}

// Envuelve un handler de ruta: sin acceso responde 401/403/503 y el handler ni se ejecuta.
export function protegido(handler) {
  return async function rutaProtegida(req, ctx) {
    const d = verificarSolicitud(req);
    if (!d.permitir) {
      return Response.json({ error: d.mensaje }, { status: d.status, headers: { 'Cache-Control': 'no-store' } });
    }
    return handler(req, ctx);
  };
}
