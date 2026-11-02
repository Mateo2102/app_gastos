# Decisiones pendientes antes del commit

Estado: **solo análisis. No se modificó código desde el reporte de la etapa P0.** El árbol de trabajo sigue sin commitear y producción (`app-gastos-olive.vercel.app`) sigue corriendo la versión anterior.

Orden acordado: **modelo de pago → seguridad → integridad → commit.**

---

## 1. Las 5 transferencias que cambiaron de mes

Datos leídos de tu planilla real (solo lectura), el 2026-11-02.

| Fila | Fecha de compra | Descripción | Monto | Banco | Antes (mes de pago) | Ahora | ¿Afecta de diciembre 2026 en adelante? |
|---|---|---|---|---|---|---|---|
| 5 | 01/09/2024 | Prestamo 1 | $85.000 × 24 cuotas (total $2.040.000) | Santander | oct 2024 → sep 2026 | sep 2024 → ago 2026 | **No** (ya terminó con ambas reglas) |
| 6 | 01/10/2025 | Prestamo 2 | $133.000 × 12 cuotas (total $1.596.000) | Santander | nov 2025 → oct 2026 | oct 2025 → sep 2026 | **No** (ya terminó con ambas reglas) |
| 14 | 01/08/2026 | MOTO | **US$300** × 10 cuotas (total US$3.000) | Santander | sep 2026 → jun 2027 | ago 2026 → may 2027 | Sí: la última cuota pasa de jun a may 2027 |
| 15 | 15/12/2026 | MOTO | **US$650** × 1 pago | Santander | **ene 2027** | **dic 2026** | **Sí: es el cambio grande** |
| 16 | 01/06/2027 | MOTO | **US$650** × 1 pago | Santander | **jul 2027** | **jun 2027** | Sí |

**Aclaración sobre el monto:** los $1.017.250 que mencioné antes son **US$650 convertidos al dólar blue de hoy ($1.565)**. Los tres movimientos MOTO están en dólares; su valor en pesos cambia con la cotización.

Efecto sobre la proyección (gasto variable):

| Mes | Antes | Ahora | Diferencia | Por qué |
|---|---|---|---|---|
| dic 2026 | $986.043 | $2.003.293 | +$1.017.250 | entra la MOTO del 15/12 |
| ene 2027 | $1.811.736 | $794.486 | −$1.017.250 | sale la MOTO del 15/12 |
| jun 2027 | $643.609 | $1.191.359 | +$547.750 | entra la MOTO del 01/06 y sale una cuota de $469.500 |
| jul 2027 | $1.191.359 | $174.109 | −$1.017.250 | sale la MOTO del 01/06 |

Con la regla nueva, el ahorro proyectado de diciembre pasa de $759.121 a **$0** (piso ajustado a $141.871).

### Por qué la lógica anterior las desplazaba un mes
1. La tabla **Tarjeta/Cierre** de tu planilla (en `P:Q`) incluye `Santander → Cuarto jueves`.
2. Para filas que no eran tarjeta de crédito, el código buscaba el banco en esa tabla y aplicaba su regla (`n = 4`): *si la compra es anterior o igual al cuarto jueves del mes, el cierre es ese mes; el pago es el mes siguiente.*
3. **Las 5 compras son anteriores al cuarto jueves de su mes** (01/09/2024 vs 26/09; 01/10/2025 vs 23/10; 01/08/2026 vs 27/08; 15/12/2026 vs 24/12; 01/06/2027 vs 24/06). Por eso las 5 salían un mes después, siempre.
4. Tu propia fórmula de `Estado` en la planilla usa la misma regla (por eso ves "En curso" / "Gasto Fijo" en esas filas).
5. El código tenía un comentario explícito: *"Efectivo, transferencias, débito y préstamos conservan exactamente la regla anterior"*. Es decir: fue una decisión de **no romper** la planilla original, donde Santander figuraba como una cuenta con cierre. **No fue una decisión tomada fila por fila.**

### Qué debería representar financieramente cada una
Lo que **los datos permiten afirmar** y lo que **no permiten decidir**:

- **Prestamo 1 y 2** (categoría *Préstamos*, tipo *Prestamos*, cuotas fijas): son cuotas mensuales de un préstamo debitadas desde Santander. La "fecha" es el día 1 de inicio. La regla anterior ubicaba la primera cuota **un mes después** del inicio, lo que coincide con cómo suelen arrancar los préstamos, pero la planilla no dice cuándo fue el primer débito real. **No cambia nada hacia adelante** (ambos terminaron antes de diciembre 2026 con cualquiera de las dos reglas); solo cambia el historial.
- **MOTO 01/08/2026 (10 × US$300):** diez transferencias mensuales en dólares. Hoy es 02/11/2026, así que vos sabés si la de agosto ya se pagó en agosto o recién en septiembre.
- **MOTO 15/12/2026 y 01/06/2027 (1 × US$650 cada una):** dos pagos únicos **futuros** en dólares. Financieramente son una salida de dinero en esa fecha. La planilla **no dice** si son refuerzos, un anticipo o el cierre de la financiación, ni con qué sueldo pensás pagarlos. Ese es justamente el "criterio de impacto explícito" que falta.

**Conclusión:** no hay dato en la planilla que justifique "+1 mes" ni "mes de la compra" para estas cinco filas. Lo único que había era un efecto lateral de que Santander figurara en la tabla de cierres. **No se inventa una regla para acomodar la MOTO.**

### Cómo resolverlo sin inventar (propuesta, sin implementar)
La regla conceptual que pediste:

| Forma de pago | Regla |
|---|---|
| Tarjeta de crédito con cierre configurado | lógica de cierre |
| Efectivo | mes de la compra |
| Transferencia | mes de la compra, **salvo** que exista explícitamente una fecha/criterio de impacto distinto |
| Cualquier forma de pago sin regla de desplazamiento | mes de la compra |

Para que el "salvo" exista de forma explícita hace falta **un dato por fila**, no una regla por banco:

- **Campo opcional "mes de impacto"** (por fila, cualquier forma de pago que no sea tarjeta). Vacío = mes de la compra. Si tiene valor, manda.
- Se puede guardar en una columna libre de la planilla (por ejemplo `R`; `P:Q` tiene la tabla de cierres y `AA` el id). Hoy ya existe una columna de "fecha de cierre manual" (`N`), pero solo se usa en tarjetas.
- La tabla Tarjeta/Cierre deja de aplicarse a transferencias (Santander no es una tarjeta).

**Opciones para tus 5 filas:**
1. **Revertir a la lógica anterior para transferencias** → tus números no cambian, pero queda implícito que Santander "cierra" el cuarto jueves (lo que dijiste que no es).
2. **Mes de la compra por defecto + campo explícito** (recomendada) → vos indicás el mes de impacto de las filas donde corresponda. Solo importan las **tres MOTO**; los préstamos ya terminaron.
3. **Mes de la compra por defecto y nada más** → es lo que está hoy en el árbol de trabajo; mueve diciembre a déficit sin que sepamos si es real.

**No hay urgencia:** producción sigue con la lógica anterior, así que ningún número publicado cambió.

**Lo que necesito de vos:** para cada MOTO (01/08/2026, 15/12/2026, 01/06/2027), ¿en qué mes sale realmente la plata de tu cuenta y con qué sueldo la cubrís?

---

## 2. Problemas del modelo y de la plataforma (documentados, sin implementar)

| # | Problema | Clase | Por qué esa clase |
|---|---|---|---|
| 1 | **Autenticación**: toda la app y la API son públicas | **P0** | Cualquiera con la URL lee datos financieros. Producción **hoy** corre la versión anterior (incluye el borrado por número de fila). Bloquea publicar. |
| 2 | **Concurrencia entre instancias** | **P1** (P0 si hay varios usuarios) | Dentro de una instancia está resuelto. Entre instancias distintas queda una ventana de menos de un segundo porque Sheets no tiene transacciones; para un solo usuario es muy improbable. |
| 3 | **Dólar con valor 0** | **P1** | Si la API del dólar falla y no hay cotización guardada, los USD se cuentan como pesos **sin aviso**. Con tus datos hay 5 filas en USD (incluida la MOTO): el error sería de millones. Probabilidad baja (la cotización se guarda 30 min en la planilla), pero es silencioso. |
| 4 | **Vulnerabilidades de npm** (11) | **P1** el de `next`; **P2** el resto | `next` tiene un aviso crítico (RCE) **solo para servidores Windows**; producción en Vercel (Linux) no está expuesta, pero hay arreglo sin cambio mayor (`16.4.3`). El resto son dependencias de herramientas/transitivas (DoS de bajo riesgo); `sharp` no se usa porque la app no usa `next/image`. |
| 5 | **Gastos fijos sin fecha de inicio ni de fin** | **P1** | Se suman a **todos** los meses: cargar uno hoy cambia el pasado, y para "terminarlo" hay que borrarlo. Es prerrequisito del modelo de compromisos. |
| 6 | **Filas antiguas sin `id`** | **P2** | Reciben su id la próxima vez que se carga un gasto. Mientras tanto se borran por huella de contenido, y si hay dos filas idénticas no se borra nada. Pasa a P1 si se agrega edición de registros. |
| 7 | **Compras con cuotas vacías o 0 no aparecen** | **P2** | La carga ya lo impide (cuotas ≥ 1, con tests) y en tu planilla hay **0** casos hoy. Solo lo puede reintroducir una edición manual de la planilla. A futuro conviene una alerta de calidad de datos. |
| 8 | Hoja duplicada `ConfigTablero_conflict…` en tu planilla | **P2** | Resto de una carrera al crear la hoja de configuración (ya corregida para una instancia). Se puede borrar a mano. |
| 9 | Valores futuros en USD se calculan con el dólar de hoy | **P2** | Es una simplificación coherente, pero hay que tenerla presente: la MOTO de diciembre cambia de valor si cambia el dólar. |

---

## 3. Autenticación: opciones (sin implementar)

Contexto técnico:
- Next.js **16** en Vercel. En esta versión `middleware` se llama **`proxy`**, y la documentación indica que el proxy es un filtro previo y **no debe ser la única defensa**: la verificación tiene que repetirse cerca de los datos (cada ruta de la API).
- Los datos viven en Google Sheets accedido con **una cuenta de servicio**: esa credencial ve todo. La seguridad por usuario **no la da Sheets**; hay que construirla en la app.

### Opción A — protección privada rápida (uso personal)
Tres variantes. Todas protegen toda la app y la API.

| Variante | Qué es | Detalle |
|---|---|---|
| **A1 — Protección de despliegue de Vercel** | Vercel exige iniciar sesión antes de servir la app | Sin código. Modos documentados: *Standard* (previews + URL única de producción), *All Deployments* y *Preview only*. **No pude verificar tu plan ni cómo está configurado tu proyecto** (mi conector de Vercel no ve tus proyectos); hay que mirar *Settings → Deployment Protection*. La protección por contraseña requiere un plan elegible y puede tener costo. |
| **A2 — Contraseña propia en la app** | `proxy` + cookie firmada + una contraseña en variable de entorno | Gratis, independiente del plan. Una sola clave compartida, sin identidad de usuario. Necesita límite de intentos, cookie `HttpOnly`/`Secure`/`SameSite` y verificación también en cada ruta de la API. |
| **A3 — Inicio de sesión con Google restringido a un email** | Auth.js (o similar) con lista permitida de un solo correo | Identidad y sesiones reales, gratis, y es el primer paso natural hacia B. Necesita una credencial de Google OAuth (tenés un proyecto de Google Cloud por la cuenta de servicio). **Hay que verificar la compatibilidad de la librería con Next 16 antes de elegirla.** |

### Opción B — autenticación preparada para producto
Usuarios, sesiones y **separación de datos por usuario**. Con Sheets hay dos caminos:
- **B1:** una planilla por usuario, conectada con su propia cuenta de Google. El permiso para leer/escribir planillas es "sensible" y exige un proceso de verificación de Google, y la cuota de lecturas es por usuario.
- **B2:** migrar a una base de datos (Postgres con reglas de acceso por fila). Es el camino limpio, pero **es la migración que pediste postergar**.

### Comparación

| | A1 Vercel | A2 Contraseña propia | A3 Google + 1 email | B (usuarios) |
|---|---|---|---|---|
| **Seguridad** | Alta (se aplica antes de tu código), atada a tu cuenta de Vercel | Media: una clave compartida, sin identidad | Alta para uso personal: identidad real, sesión revocable | La más alta si hay aislamiento por usuario (con base de datos) |
| **Complejidad** | Mínima | Baja | Media-baja | Alta |
| **Costo** | Gratis o con costo según el plan (verificar) | Gratis | Gratis | Gratis al inicio; luego base de datos y/o proveedor de identidad |
| **Tiempo** | Minutos | ~½ día | ~1 día | Semanas |
| **Impacto en la arquitectura** | Ninguno | Un `proxy` + una verificación común en las rutas | Igual que A2 + proveedor de sesión | Capa de datos con `userId`, migración de datos, rediseño de configuración |
| **Migrar a B después** | Se descarta y se rehace | Se rehace la parte de identidad | **La más fácil**: se sustituye la lista permitida por usuarios | — |

### Recomendación
1. **Hoy, sin código:** mirar en el panel de Vercel si **A1** cubre el dominio de producción; si es así, activarlo ya como parche.
2. **A implementar:** **A3** (Google restringido a tu correo). Cuesta casi lo mismo que A2, da identidad y sesiones reales y es el paso previo a B.
3. **Dejar preparado el "asiento" de B sin construirlo:** toda lectura/escritura pasa por una sola capa que recibe un `userId` (hoy una constante, "propietario"). Así, pasar a B es cambiar de dónde sale ese valor y dónde se guardan los datos.

---

## 4. Decisiones tomadas

1. **Transferencias — resuelto.** Confirmado: una transferencia no es tarjeta de crédito y la primera cuota se paga en el mes de la fecha de compra. La regla implementada (mes de la compra) es la correcta; **no hace falta el campo "mes de impacto"** (queda solo como opción futura si aparece un caso con otro criterio). Efecto sobre tus datos: diciembre 2026 queda con ahorro proyectado $0 y piso ajustado, y es el valor correcto.
2. **Autenticación — resuelto.** A1 como parche inmediato (a cargo tuyo en el panel de Vercel) y **A3 implementado** (ver docs/AUTENTICACION.md).

## 5. (Histórico) Lo que faltaba decidir
1. **Transferencias:** mes de impacto de cada MOTO (y si querés el campo explícito de la opción 2).
2. **Autenticación:** ¿A1 como parche inmediato y A3 como implementación? (Con tu plan de Vercel a la vista.)
3. **Commit:** recién después de cerrar 1 y 2, como indicaste.
