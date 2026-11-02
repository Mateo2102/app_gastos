# Acceso privado (Opción A3: Google restringido a tus correos)

Toda la aplicación (páginas y las 14 rutas de la API) exige iniciar sesión con una cuenta de Google que esté en la lista `AUTH_ALLOWED_EMAILS`. Si falta cualquier variable en **producción**, **nadie** puede entrar (la pantalla de acceso lo explica): falla cerrado.

## Qué protege
- `proxy.js` filtra páginas y API antes de renderizar (solo lee la cookie firmada).
- Cada ruta de la API repite la verificación (`lib/guardia.js`); un test falla si alguien agrega una ruta sin `protegido()`.
- Sesión: cookie `__Host-sesion` (HttpOnly, Secure, SameSite=Lax), firmada con HMAC-SHA256, dura 14 días.
- Login: OAuth con Google (código + PKCE S256 + `state` + `nonce`), verificando el `id_token` y que el correo esté **verificado** y permitido.
- Quitar un correo de la lista revoca sus sesiones al instante; cambiar `AUTH_SECRET` cierra todas las sesiones.
- Los pedidos que modifican datos desde otro origen se rechazan (403).

## Lo que tenés que hacer vos (no puedo crear cuentas ni credenciales)

### 1) Credenciales de Google (una sola vez)
1. Entrá a <https://console.cloud.google.com> y elegí el **mismo proyecto** de tu cuenta de servicio.
2. *APIs y servicios → Pantalla de consentimiento de OAuth*: tipo **Externo**, poné un nombre y tu correo. En *Usuarios de prueba* agregá **tu correo**. Dejalo en estado "Testing" (solo esos correos pueden entrar; Google puede mostrar un aviso de "app no verificada", es normal).
3. *APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*. En **URIs de redireccionamiento autorizados** agregá:
   - `https://app-gastos-olive.vercel.app/api/auth/callback`
   - `http://localhost:3000/api/auth/callback` (solo si querés probar el login en tu computadora)
4. Copiá el **ID de cliente** y el **Secreto del cliente**. No los pegues en ningún chat ni los subas al repositorio.

### 2) Variables en Vercel
*Proyecto → Settings → Environment Variables* (entorno **Production**):

| Variable | Valor |
|---|---|
| `AUTH_SECRET` | un secreto aleatorio de 32+ caracteres. Generalo con: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `GOOGLE_OAUTH_CLIENT_ID` | el ID de cliente |
| `GOOGLE_OAUTH_CLIENT_SECRET` | el secreto del cliente |
| `AUTH_ALLOWED_EMAILS` | tu correo (varios, separados por coma) |
| `APP_URL` | `https://app-gastos-olive.vercel.app` (sin barra final) |

Después hay que **volver a desplegar** (las variables nuevas solo se aplican a deploys nuevos): *Deployments → ⋯ → Redeploy*.

### 3) Parche inmediato (A1): protección de despliegue de Vercel
*Proyecto → Settings → Deployment Protection → Vercel Authentication*. Activalo y, si tu plan lo permite, elegí el alcance que incluya **producción** (en "Standard Protection" el dominio de producción puede seguir público). Verificá abriendo `https://app-gastos-olive.vercel.app` en una ventana de incógnito: debe pedir iniciar sesión. Con el acceso propio ya configurado esto es una capa extra, no un requisito.

## Si te quedás afuera
- Pantalla "El acceso todavía no está configurado…": falta una variable en Vercel (o no se hizo el *Redeploy*).
- "Esa cuenta no tiene permiso": el correo no está en `AUTH_ALLOWED_EMAILS` o no está como usuario de prueba en la pantalla de consentimiento.
- Error al volver de Google (`redirect_uri_mismatch`): la URI de redireccionamiento de Google no coincide exactamente con `APP_URL` + `/api/auth/callback`.

## Desarrollo local
Si **no** definís ninguna variable de acceso, la app queda abierta en `http://localhost:3000` (solo con `next dev`; en producción nunca). Si definís alguna, tenés que definir todas.

## Límites conocidos
- Es un acceso para **un usuario** (o pocos correos de confianza): todos ven los mismos datos. La separación por usuario (opción B) requiere migrar la base.
- Hay que cuidar el secreto de OAuth y `AUTH_SECRET`; cualquiera que tenga `AUTH_SECRET` podría fabricar una sesión.
