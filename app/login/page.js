const MENSAJES = {
  config: 'El acceso todavía no está configurado en el servidor. Faltan las variables de acceso (ver docs/AUTENTICACION.md).',
  estado: 'La sesión de ingreso no coincide o se interrumpió. Probá de nuevo.',
  expirado: 'El intento de ingreso venció. Probá de nuevo.',
  google: 'Google no pudo completar el ingreso. Probá de nuevo en un momento.',
  'no-permitido': 'Esa cuenta de Google no tiene permiso para entrar a esta aplicación.',
  cancelado: 'Cancelaste el ingreso con Google.'
};

export const metadata = { title: 'Acceso privado' };

export default async function Login({ searchParams }) {
  const { e } = await searchParams;
  const mensaje = typeof e === 'string' ? MENSAJES[e] : null;
  return (
    <main className="login-wrap">
      <div className="login-card">
        <span className="brand-icon">$</span>
        <h1>Acceso privado</h1>
        <p className="login-sub">Esta aplicación contiene información financiera personal.</p>
        {mensaje && <p className="login-error" role="alert">{mensaje}</p>}
        <a className="login-btn" href="/api/auth/google">Entrar con Google</a>
      </div>
    </main>
  );
}
