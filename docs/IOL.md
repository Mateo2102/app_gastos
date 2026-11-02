# Cartera de InvertirOnline (IOL) — solo lectura

La app puede mostrar tu cartera de IOL en **Ahorro** (tenencias, saldos) y su evolución en **Gráficos → Cartera**.
**Solo consulta**: el código no tiene ninguna función para comprar, vender ni cancelar órdenes (un test lo verifica).
Si no cargás las credenciales, la integración queda apagada y el resto de la app no cambia.

## Cómo activarla

1. **Pedile a IOL que active la API** desde tu cuenta: *Mi cuenta* → contacto, motivo **API**. Cuando te confirmen, aceptá los
   términos en *Mi Cuenta → Personalización → APIs*.
2. **Confirmá si tiene costo** antes de pedirla. La página oficial no lo aclara ("conocé todo desde tarifas"); un tarifario de
   terceros menciona hasta 25.000 llamadas por mes sin costo y después $500 + IVA, **sin verificar**. La app hace muy pocas
   llamadas: la cartera se guarda en memoria 10 minutos y se consulta como mucho una vez cada vez que abrís Ahorro o el
   evolutivo.
3. En Vercel → *Settings → Environment Variables* (entorno **Production**) cargá:

   | Variable | Valor |
   |---|---|
   | `IOL_USUARIO` | tu usuario de IOL |
   | `IOL_CLAVE` | tu contraseña de IOL |

4. **Redeploy**. Abrí **Ahorro**: tiene que aparecer "Inversiones en IOL" con tu cartera.

## Qué consulta

| Qué | Llamada |
|---|---|
| Entrar | `POST https://api.invertironline.com/token` (usuario y contraseña; el acceso dura 15 minutos y se renueva) |
| Saldos | `GET /api/v2/estadocuenta` |
| Tenencias | `GET /api/v2/portafolio/argentina` |

**Pendiente de verificar con una cuenta real:** la forma exacta de las respuestas se armó con la documentación pública y guías de
terceros (la ruta del portafolio no figura en la página oficial). La lectura es tolerante a campos que falten, pero conviene
revisar los números contra la web de IOL al activarla y ajustar `lib/iol.js` (`normalizarCartera`) si algo no coincide.

## Seguridad

- La contraseña vive solo en las variables de Vercel: no se escribe en la planilla ni viaja al navegador, y los mensajes de error
  nunca la incluyen.
- **Riesgo a tener presente:** IOL no ofrece claves limitadas a lectura; la misma contraseña sirve para operar. Quien accediera a
  la configuración de tu Vercel podría usarla. La app ya exige tu login de Google (`docs/AUTENTICACION.md`).
- Si dejás de usarla, borrá las dos variables y la integración se apaga sola.

## Evolutivo

Se guarda **una foto por día** (la primera vez que abrís Ahorro o Gráficos → Cartera ese día) en la hoja `ConfigTablero`
(`IOL_FOTOS`: total en pesos y en dólares, sin convertir). El historial arranca desde que conectás IOL. Los depósitos y retiros
de plata también mueven la línea.
