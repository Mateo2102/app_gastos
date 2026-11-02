# Diagnóstico y propuesta de evolución — Tablero de gastos

Estado: **solo diagnóstico, no se implementó nada.** Fecha de la auditoría: 2026-11-01 (sobre `main`, commit `797e2cf`).

**Qué se revisó:** `lib/closing.js`, `lib/logic.js`, `lib/data.js`, `lib/dashboard.js`, `lib/sheetsClient.js`, las 11 rutas `app/api/*`, `app/page.js` (2.544 líneas), `app/globals.css` (1.132), `package.json`, `npm audit`, y los datos reales de tu planilla (55 filas: 5 fijos, 48 compras, 2 ingresos).

**Qué se verificó ejecutando código** (no solo leyendo): el cierre con días 1 a 31 durante 2026–2027, el bisiesto de febrero 2028, los gastos en efectivo, las cuotas absurdas y `npm audit`. El resto del análisis es por lectura de código.

**Skills:** apliqué sus criterios a mano (revisión de código, seguridad, simplificación, validación de datos). No las invoqué como comandos porque trabajan sobre un diff y acá la tarea era auditar el sistema entero. `break-ui`, `review-animations` y `animate` quedan para después de resolver arquitectura y UX, como pediste.

---

## 0. Resumen ejecutivo

1. **La lógica de cierres y cuotas es lo mejor de la app.** Está aislada en `lib/closing.js`, es pura y tiene tests. La fecha real de la compra no se modifica nunca.
2. **El modelo es de flujo mensual, sin saldo.** Cada gasto cae en un "mes de sueldo" y el ahorro se calcula como `ingresos − gastos − piso`. No existe "dinero disponible hoy" ni "fecha de cobro". Por eso "¿cuánto puedo gastar por día?" necesita datos nuevos; no es una cuenta sobre lo que ya hay.
3. **Hay 4 problemas P0, ninguno de lógica de cierres.** Son de seguridad y de integridad de datos (sección 1.2). Dos de ellos los agravé yo en esta sesión (sección 1.3).
4. **Buena noticia:** el motor del simulador ya existe en el backend (`buildProjection(..., hipotetico)` y `POST /api/dashboard`), pero no tiene ninguna pantalla. El simulador es de las funciones más baratas del pedido.
5. **Sheets alcanza para esta etapa**, si se arreglan las escrituras y se agrega una capa de datos que aísle la planilla.

---

## 1. Estado actual

### 1.1 Qué está bien
- `closing.js` es pura, sin dependencias, con tests (incluye 4 casos de cierre el 24, el caso día 1–31 y la fecha real intacta). Los meses de 28, 29, 30 y 31 días están cubiertos: `fechaCierreDia` recorta al último día del mes.
- La regla "el día del cierre ya entra en el período siguiente" está implementada una sola vez y la usan el servidor y el formulario.
- El sueldo se guarda por tramos con vigencia. Un aumento futuro no pisa el pasado.
- Piso y ahorro son explicables: `ahorro = max(0, ingresos − gastos − piso)`. El piso mostrado es el remanente real.
- Caché de lectura con consulta compartida (`getRawGrid`) y migraciones suaves de formatos viejos (`SUELDO_MENSUAL`, `AHORRO_REAL`).
- Interfaz ya con sidebar, estados de carga, errores con reintento y colores con sentido.

### 1.2 Qué está mal (P0)

| # | Problema | Evidencia | Consecuencia |
|---|---|---|---|
| A | **Sin autenticación.** Ninguna ruta valida quién llama. | Abrí `app-gastos-olive.vercel.app` sin credenciales y cargó todos tus datos. `DELETE /api/gastos/{fila}` borra cualquier fila. | Cualquiera con la URL lee tu situación financiera, agrega gastos o borra filas. Bloqueante para un producto comercial. |
| B | **Inyección de fórmulas.** `agregarGasto` escribe con `USER_ENTERED` el texto libre `desc` y `categoria`. | `lib/data.js` (`values.update … USER_ENTERED`). | Una descripción que empiece con `=` se ejecuta como fórmula (por ejemplo `=IMPORTDATA(...)` puede sacar datos de la planilla). Combinado con A, lo puede hacer cualquiera. |
| C | **Sobrescritura de filas al agregar.** La fila nueva se calcula como `values.length + 1` sobre una grilla **cacheada** (30 s). | `agregarGasto`, `lib/data.js`. En Vercel cada instancia tiene su propia caché. | Dos cargas seguidas que caigan en instancias distintas pueden escribir en la **misma fila** y pisar un gasto. |
| D | **Borrado por número de fila.** `eliminarFila(row)` borra por posición, y las filas se corren al borrar. | `DELETE /api/gastos/[row]` + lista cacheada en el cliente. | Con la lista desactualizada (otra pestaña, otra instancia) se puede borrar **otro** gasto. |

### 1.3 Errores míos de esta sesión que hay que corregir

1. **Gastos en efectivo desaparecen de la proyección** (regresión mía). Antes, al elegir "Efectivo" el banco seleccionado antes se guardaba igual (campo oculto), y por casualidad el gasto se contaba. Cuando cambié el formulario para guardar `banco = ""` con efectivo, una compra sin banco ni regla de cierre devuelve `[]` meses de pago (verificado con `getInstallmentMonths(fecha, 0, 1)` → `[]`). Hoy no tenés filas en efectivo, así que todavía no pasó, pero el formulario las ofrece.
2. **Subí el caché de Sheets de 4 s a 30 s** para ahorrar lecturas. Eso **agranda la ventana** de los problemas C y D, y la de la pérdida de actualizaciones en `ConfigTablero` (`setProps` reescribe toda la tabla de configuración partiendo de un caché que puede tener hasta 30 s).
3. **El texto del formulario para compras que no son con tarjeta** dice "en el mes de la compra". Lo escribí sin verificarlo y es **incorrecto**: la lógica real no lo hace así (ver 1.2/2).

### 1.4 Qué es frágil
- **Dólar:** si la API del dólar falla y no hay valor en caché, `convertirMontos` trata los USD como pesos (con cotización 0 devuelve el monto sin convertir). Un gasto de US$20 pasaría a valer $20. No hay aviso.
- **Dólar histórico:** todo se convierte con la cotización de hoy, también los meses pasados. Un mes cerrado cambia de valor cada día.
- **La fórmula de `Estado` de la planilla** referencia `$D$38:$D$40` y los textos "Santander", "ICBC" y "MercadoPago". Agregar un banco nuevo no se refleja ahí.
- **Configuración como JSON en celdas** (`ConfigTablero`): una celda de Sheets admite hasta 50.000 caracteres. `AHORRO_MOVS` y `SUELDO_SCHEDULE` crecen sin tope.
- **Lectura fija `A1:Z2000`:** a partir de la fila 2000 los datos se ignoran en silencio.
- **Cuotas sin tope:** `cuotas = 1000000` genera un millón de meses (432 ms en mi prueba). Sin autenticación, es un vector de denegación de servicio.
- **Dependencias:** `npm audit` informa 11 vulnerabilidades en producción (1 crítica en `next`, solo para servidores **Windows**, no aplica a Vercel/Linux; 3 altas en dependencias transitivas). Conviene actualizar, no es urgente.
- **Aguinaldo fijo:** 50 % en enero y julio, escrito en `buildProjection` (`m === 0 || m === 6`). No es configurable.

### 1.5 Qué es "subdiseñado" (no sobrediseñado)
- `app/page.js` es **un solo componente de 2.544 líneas con 44 `useState`**. Funciona, pero cualquier cambio toca todo.
- La lógica financiera tiene **un único test** (`closing.test.mjs`, que se corre a mano; no hay script `npm test`). La proyección, el piso y los cálculos de cuenta no tienen pruebas.
- Hay **dos rutas** para el dashboard (`GET` y `POST` con ancla) y varias vistas que se solapan: Gastos tiene 4 vistas (Detalle, Dashboard, Compras, Fijos) y Tarjetas 2.
- CSS muerto del formulario viejo (`clase-picker`, `step-num`, etc.).

### 1.6 Qué falta
Autenticación, saldo o dinero disponible, fecha de cobro, vigencia de gastos fijos, presupuestos, objetivos, deudas, límites de tarjeta, identificador estable por fila, deshacer/auditoría, histórico del dólar, tests del cálculo de proyección, soporte para más de un usuario.

---

## 2. Modelo financiero actual (cómo entiende hoy la app)

**Mes de sueldo.** Todo se asigna a una clave `"YYYY-M"` (mes en base 0). El "mes de sueldo" es el mes en cuyo cobro se paga algo. Una compra con tarjeta que cierra en octubre se paga con el sueldo de noviembre.

| Concepto | Regla actual |
|---|---|
| **Ingresos** | Sueldo por tramos + aguinaldo 50 % en ene y jul (fijo en código) + ingresos extra en el mes de su fecha. |
| **Gasto fijo** | Se suma a **todos** los meses de la ventana. Ignora su fecha de alta y no tiene baja: para "terminarlo" hay que borrarlo, y eso lo borra también del pasado. |
| **Compra** | `monto` = valor de **cada cuota**; total = `monto × cuotas`. Las cuotas caen en meses consecutivos desde el primer mes de pago. |
| **Tarjeta de crédito** | Día de cierre fijo por banco (`CIERRE_DIAS`), o regla legacy (n-ésimo jueves de la planilla), o fecha de cierre manual por compra. Mes de pago = mes de cierre + 1. **Si la compra es del día del cierre o posterior, ya cerró** (verificado: cierre 24 → 25/10 se paga en diciembre, 23/10 en noviembre, 24/10 en diciembre). |
| **No tarjeta** (transferencia, efectivo) | Usa el jueves de cierre del **banco** si existe; si no hay regla (n = 0) devuelve **sin meses** y el gasto no entra en la proyección. |
| **Piso** | Reserva mensual fija. `ahorro = max(0, ingresos − gastos − piso)`; `piso mostrado = ingresos − gastos − ahorro`; `margen = ingresos − gastos`. |
| **Ahorro** | Dos cosas separadas: el *ahorro proyectado* (calculado) y el *ahorro real* (movimientos cargados a mano). No se conectan. |
| **Proyección** | 12 meses desde el mes siguiente al actual (o un ancla elegida). No arrastra saldo entre meses. |
| **Dólar** | Blue venta actual para todos los montos, cacheado 30 min en `ConfigTablero`. |

### Inconsistencias detectadas
1. **No tarjeta sin regla de banco desaparece** (efectivo, o un banco que no está en la tabla Tarjeta/Cierre).
2. **Dos "hoy":** Inicio usa el mes siguiente (mes de sueldo), Tarjetas usa el mes calendario actual. Conviven sin explicación.
3. **Fijos sin vigencia:** cargar hoy un fijo cambia retroactivamente los meses pasados en la vista de Gastos.
4. **USD con dólar en 0** se cuenta como pesos sin aviso.
5. **Aguinaldo** asume cobro en el "mes de sueldo" de enero y julio; el supuesto es implícito y no editable.
6. **Alertas ruidosas:** "Gastos 133 % por encima del promedio" compara contra el promedio de la ventana de 12 meses, que incluye picos de cuotas. No es una referencia significativa.
7. **Deudas = compras en cuotas.** "Préstamo 1" es un `Gasto variable` con categoría Préstamos: no tiene saldo, interés ni fecha de fin explícitos.
8. **Categoría y Tipo se pisan** (ya lo simplifiqué en el formulario, pero la planilla conserva ambas columnas).

---

## 3. Modelo financiero propuesto

**Idea central: un solo concepto de _compromiso_.** Todo lo que obliga a pagar en un mes de sueldo es un compromiso:

```
Compromiso { origen: fijo | cuota | pago_unico | deuda | objetivo,
             mesDePago, monto (ARS), moneda original, referencia (fila / deuda / objetivo) }
```

Un único generador `compromisos(mes)` lee las filas, las deudas y los objetivos. **La proyección, la capacidad diaria, el simulador y las alertas consumen ese mismo resultado**, así los números no pueden contradecirse.

### Entidades nuevas (todas pequeñas)
- **Ingreso:** sueldo por tramos (existe), **día habitual de cobro**, aguinaldo configurable (porcentaje y meses).
- **Tarjeta:** nombre, banco, regla de cierre, día de pago opcional, límite opcional, presupuesto opcional.
- **Presupuesto:** categoría, monto, vigencia (un mes o "desde este mes"), umbrales de alerta. Una categoría sin presupuesto simplemente no tiene fila.
- **Objetivo:** nombre, meta, fecha objetivo, aporte mensual previsto, ahorrado (se enlaza con los movimientos de Ahorro).
- **Deuda:** nombre, monto original, saldo, cuota, cuotas totales/restantes, inicio, fin, interés. Genera compromisos mensuales.
- **Regla de alerta:** ver sección 6.

### Fórmulas (definiciones explícitas, para que sean explicables)
- `Comprometido(mes) = fijos + cuotas + pagos únicos de tarjeta + deudas + aporte a objetivos`
- `Libre sin comprometer(mes) = ingresos − Comprometido(mes) − piso`
- `Capacidad diaria = max(0, Libre del período − gastado variable ya registrado en el período) / días hasta el próximo cobro`
- `Simulación = proyección con la compra hipotética − proyección base` (diferencia en ahorro, piso, comprometido y capacidad diaria).

### La pregunta difícil: "dinero disponible"
Hoy la app **no tiene saldo**. Propongo no pedir el saldo bancario de entrada. La capacidad diaria se **estima** con lo que ya existe (ingresos, compromisos, piso y gastos del período) y se documenta como estimación. Más adelante se puede agregar un **saldo manual opcional** para calibrarla. Esa decisión es tuya (ver preguntas al final).

### Salud financiera sin puntaje
Un panel de **indicadores con su regla visible**, sin número arbitrario:
- Ahorro proyectado vs. tu objetivo mensual.
- % del ingreso comprometido en el próximo sueldo.
- Distancia al piso.
- Cumplimiento de presupuestos (cuántos en verde/ámbar/rojo).
- Deuda pendiente y fecha estimada de salida.
- Avance de cada objetivo.

Cada indicador muestra *de dónde sale* (por ejemplo "comprometido 62 % = $1.240.000 de $2.000.000") y una frase de una línea con semáforo (🟢/🟡/🔴).

---

## 4. Arquitectura propuesta

**Mantener:** Next.js + Vercel, Google Sheets como fuente de datos, `closing.js` puro, las propiedades en `ConfigTablero`, el sistema de diseño actual.

**Cambiar:**
1. **Capa de dominio pura** (`lib/domain/…`): compromisos, proyección, capacidad, presupuestos, objetivos, deudas, simulador. Sin entrada/salida y con tests. Es lo que sobrevive a cualquier migración.
2. **Capa de repositorio** (`lib/repo/…`): la **única** que habla con Sheets (`leerMovimientos`, `agregar`, `eliminar(id)`, `getConfig`, `setConfig`). Al migrar a Postgres solo cambia esta capa.
3. **Identificador estable por fila** (columna nueva `id`) y escritura con `values.append` en lugar de calcular la fila. El borrado pasa a ser por `id`.
4. **Un endpoint de estado** (`/api/estado`) que devuelve todo lo calculado con **una** lectura, en lugar de 6 llamadas. Reduce el riesgo de cuota.
5. **Autenticación** (ver P0) antes de cualquier función nueva.
6. **Dividir `page.js`** por sección y mover el estado a hooks por módulo. Es un cambio mecánico y de bajo riesgo si se hace con los tests de dominio ya escritos.
7. **Configuración nueva en pestañas ocultas** (`Presupuestos`, `Objetivos`, `Deudas`, `Tarjetas`, `Preferencias`), no como JSON en una celda.

### Límites de Google Sheets a tener presentes
| Límite | Efecto |
|---|---|
| 60 lecturas/min por usuario (300 por proyecto) | Ya se agotó una vez en producción. Cada pantalla debe costar 1 lectura. |
| Sin transacciones ni bloqueos | Dos escrituras simultáneas pueden pisarse; hace falta `append` y `id`. |
| Latencia de 0,3–1,5 s por llamada | Las acciones necesitan feedback inmediato (optimista). |
| 50.000 caracteres por celda | La configuración como JSON no escala. |
| Lectura fija `A1:Z2000` | Tope silencioso de filas. |
| `setProps` reescribe toda la tabla | Pérdida de cambios concurrentes. Debe leer fresco antes de escribir. |

**Operaciones costosas hoy:** cada request recalcula proyección completa desde cero (12 meses × todas las filas). Con cientos de filas es barato; con miles hay que cachear el resultado calculado, no solo la lectura.

---

## 5. UX propuesta (sin navegación nueva innecesaria)

**Navegación (5 ítems, igual que hoy):** Inicio · Gastos · Tarjetas · Planes · Ajustes.
- **Planes** reúne Proyección, Objetivos y Deudas como subvistas (lo "futuro"). Reemplaza a Proyección y Ahorro.
- **Presupuestos** vive como una vista dentro de **Gastos** (es "qué pasó vs. el límite").
- **Ajustes** es la configuración financiera (una sola pantalla, secciones plegables).
- **Simulador** no es una sección: es la acción **"¿Puedo comprarlo?"**, disponible desde Inicio y como primer paso de **Cargar**.

**Inicio** responde en pocos segundos las 4 preguntas del criterio de éxito:
1. **¿Cómo estoy?** Una frase con semáforo ("Tu ahorro proyectado está por encima de tu objetivo").
2. **¿Cuánto puedo gastar?** Cifra grande: *$X por día hasta cobrar* (con "cómo se calcula").
3. **¿Cuánto tengo comprometido?** Una barra segmentada del próximo sueldo (fijos · cuotas · tarjetas · deudas · ahorro) y el *libre sin comprometer*.
4. **¿Qué viene?** Los próximos 3 eventos (cierre de tarjeta, cuota que termina, cobro) y **máximo 3 señales para vigilar**.

**Cargar:** antes de guardar muestra el impacto *antes → después* en capacidad diaria y ahorro, y el aviso de compromiso futuro ("agrega $75.000 durante 6 meses"). Un botón secundario "Simular sin guardar".

**Tarjetas:** cada tarjeta con límite/presupuesto opcional, barra de uso, próximos cierres y el **compromiso futuro por mes** (cuotas / fijos / pagos únicos) como una mini tabla.

**Principios visuales:** se mantiene el lenguaje actual (claro, tipografía con cifras en monoespaciada, colores con sentido). Animaciones solo para confirmar, indicar progreso o transición; se revisan al final con `review-animations`.

---

## 6. Sistema de alertas

**Una regla** tiene: tipo, umbral, nivel (`info` / `atención` / `advertencia` / `crítico`), activa sí/no, frecuencia (`cada vez` / `una vez por mes` / `una vez por evento`).

**Catálogo inicial (todas desactivables y con umbrales editables):**
| Regla | Se dispara cuando | Nivel por defecto |
|---|---|---|
| Presupuesto de categoría | consumo ≥ 70 / 90 / 100 % | info / atención / crítico |
| Cerca del piso | el margen del mes baja de piso + X | advertencia |
| Déficit | gastos > ingresos en algún mes futuro | crítico |
| Compromiso alto | % del próximo sueldo comprometido ≥ umbral | atención |
| Cuota por terminar | termina este mes o el próximo | info (positiva) |
| Compra que cambia la proyección | una carga cambia el ahorro mensual > X % | atención |
| Objetivo atrasado | ritmo actual < ritmo necesario | atención |
| Cierre de tarjeta cercano | faltan ≤ N días | info |

**Contra el ruido:**
- **Deduplicación:** cada alerta tiene clave estable (regla + período + nivel) y no se repite.
- **Máximo 3 visibles** en Inicio, ordenadas por prioridad; el resto en un listado.
- **Descartar o posponer** persistente (guardado en `ConfigTablero`).
- **Solo cambios materiales** (umbral absoluto o relativo), no cada pequeño movimiento.
- Las "reacciones" posteriores a una acción (por ejemplo capacidad diaria $18.000 → $14.500) son **un aviso único** al guardar, no una notificación permanente.
- Etapa 1 solo **dentro de la app**; sin correo ni notificaciones push.

---

## 7. Priorización

### P0 — críticos
| Propuesta | Solución | Beneficio | Complejidad | Riesgo | Dependencia | Sheets / Arquitectura / UX |
|---|---|---|---|---|---|---|
| **Autenticación** (A) | Acceso protegido (contraseña/enlace mágico o protección de Vercel como primer paso) y verificación en cada ruta | Datos privados | Media | Bajo | Ninguna | No toca Sheets / middleware / pantalla de acceso |
| **Escritura segura** (C, D) | `append` atómico + columna `id` + borrar por `id` verificando el contenido | Sin pérdida de datos | Media | Medio (migrar filas existentes con id) | Ninguna | Columna nueva / repo de datos / sin cambio visible |
| **No tarjeta sin regla** (1.3.1) | Si no hay cierre, la cuota cae en el mes de la fecha de compra (cuotas consecutivas) | Ningún gasto desaparece | Baja | Bajo (con tests) | Ninguna | Ninguno / dominio / corrige el texto del formulario |
| **Inyección de fórmulas** (B) y **topes** (cuotas ≤ 60, monto > 0, fechas válidas) | Anteponer `'` a textos que empiecen con `= + - @` y validar entradas | Seguridad | Baja | Bajo | Ninguna | Ninguno / validación en rutas / mensajes de error |
| **Dólar sin valor** | Si no hay cotización, avisar y no convertir en silencio | Cifras confiables | Baja | Bajo | Ninguna | Ninguno / dominio / aviso visible |
| **`setProps` con lectura fresca** | Leer sin caché antes de escribir | Evita perder cambios | Baja | Bajo | Ninguna | Ninguno / repo / ninguno |

### P1 — alto impacto
| Propuesta | Solución | Beneficio | Complejidad | Riesgo | Dependencia | Sheets / Arquitectura / UX |
|---|---|---|---|---|---|---|
| **Compromisos + capacidad diaria** | Generador único de compromisos; fecha de cobro en Ajustes; capacidad como estimación explicada | Responde "¿cuánto puedo gastar?" y "¿qué está comprometido?" | Media | Medio (definir "gastado variable") | P0, fecha de cobro | Pestaña `Preferencias` / dominio nuevo / Inicio |
| **Simulador "¿Puedo comprarlo?"** | UI sobre `buildProjection(..., hipotetico)` y diferencias | Decisión antes de comprar | Baja–media | Bajo | Compromisos | Ninguno / reutiliza el backend / hoja de simulación |
| **Presupuestos + alertas configurables** | Pestaña `Presupuestos`, vista en Gastos, catálogo de reglas | Control del gasto | Media | Medio (ruido) | Compromisos | Pestaña nueva / dominio / vista de Gastos |
| **Un solo endpoint de estado + dividir `page.js`** | `/api/estado`, módulos por sección | Menos cuota, mantenibilidad | Media | Medio (regresión de UI) | Tests de dominio | Reduce lecturas / repo+dominio / sin cambio visible |

### P2 — importante, no esencial
- **Objetivos de ahorro** integrados a la proyección (aporte mensual como compromiso).
- **Deudas** como entidad (saldo, interés, fin) que genera compromisos.
- **Tarjetas inteligentes:** más reglas de cierre (n-ésimo jueves hasta el quinto, primer día hábil), límite y presupuesto por tarjeta.
- **Vigencia de gastos fijos** (alta y baja) y **aguinaldo configurable**.
- **Cuotas por terminar** con "capacidad que se libera" y compromiso por mes de cada tarjeta.

### P3 — nice-to-have
- Histórico del dólar para fijar el valor de meses cerrados.
- Salud financiera como panel de indicadores completo.
- Deshacer/auditoría de cambios; exportar a CSV.
- Preparar migración a base de datos (la capa de repositorio ya deja el camino).

---

## 8. Roadmap corto (5 hitos)

0. **Seguridad e integridad (P0).** Autenticación, escritura segura con `id`, no-tarjeta sin regla, sanitizar fórmulas y topes, dólar sin valor, `setProps` fresco. Sin esto no conviene construir encima.
1. **Compromisos + capacidad diaria + Ajustes mínimos** (fecha de cobro). Es lo que más cambia la sensación de la app: pasa de "qué gasté" a "cuánto puedo gastar".
2. **Simulador "¿Puedo comprarlo?"** (el backend ya está).
3. **Presupuestos + alertas configurables.**
4. **Objetivos, deudas y tarjetas inteligentes** (todos alimentan compromisos). Animaciones y revisión de casos extremos con `break-ui` al final.

---

## 9. Reglas financieras actuales (documentadas antes de tocarlas)

- **Fecha de compra:** es la fecha real y no se modifica. El período financiero se calcula aparte (`fechaAplicacion` en `closing.js`).
- **Cierre por día fijo `d`:** si `compra ≥ cierre del mes de la compra` (el día del cierre cuenta como cerrado), el cierre es el del mes siguiente; mes de pago = mes de cierre + 1.
  - Cierre 24: compra 23/10 → noviembre; 24/10 → diciembre; 25/10 → diciembre.
  - Cierre 5: compra 5/11 → entra en el cierre de diciembre (el del 5/12) y se paga con el sueldo de enero; la fecha sigue siendo 5/11.
  - Meses cortos: cierre 30 en febrero 2028 (29 días) cierra el día 29; compra 28/02 → marzo, 29/02 → abril.
- **Cierre manual por compra** (columna N): se usa esa fecha tal cual; una compra posterior entra en el cierre siguiente.
- **Legacy (jueves):** n-ésimo jueves del mes, según la tabla Tarjeta/Cierre de la planilla. Se mantiene para filas viejas.
- **Cuotas:** `monto` es el valor de cada cuota; cae una por mes desde el primer mes de pago.
- **Gasto fijo:** todos los meses, sin vigencia.
- **Piso/ahorro:** ver sección 2.

## 10. Preguntas que necesito que decidas

1. **Autenticación:** ¿querés empezar por la protección de Vercel (rápido, solo para vos) o directamente un acceso con cuentas (necesario si esto va a ser comercial)?
2. **Dinero disponible:** ¿la capacidad diaria se **estima** con ingresos, compromisos y gastos del período (sin pedir saldo), o querés ingresar un **saldo manual** para calibrarla?
3. **Fecha de cobro:** ¿qué día cobrás habitualmente? Es el dato base de "hasta cobrar".
4. **Efectivo y transferencias sin regla de cierre:** propongo que el gasto caiga en el mes de la fecha de compra. ¿Es lo correcto para vos?
5. **Aguinaldo:** hoy está en enero y julio al 50 %. ¿Es así como lo cobrás (y en qué mes de sueldo entra)?
6. **Gastos fijos:** ¿querés poder marcar su fecha de fin para que no cambien el pasado?

---

## 11. Actualización — etapa P0 (seguridad e integridad), sin commitear

**Regla de pago provisoria (reemplaza la del punto 9 para lo que no es tarjeta):** una compra con tarjeta de crédito **con** regla de cierre (día fijo, jueves de la planilla o fecha manual) se desplaza como antes. **Todo lo demás cae en el mes de la compra**, con cuotas en meses consecutivos: efectivo, transferencia, cualquier forma de pago sin regla de cierre y también una tarjeta sin regla. La fecha real de la compra no se modifica. La regla vive en `describirPago` (`lib/closing.js`) y la usan la proyección, los gastos por mes y el texto de Cargar.

**Efecto sobre tus datos (medido sobre la planilla real):** 5 filas, todas transferencias de Santander, se corren **un mes antes** (antes se desplazaban con el jueves de cierre de Santander, que no corresponde a una transferencia). Diciembre 2026 pasa de $986.043 a $2.003.293 de gasto variable (+$1.017.250 por la MOTO del 15/12/2026) y enero 2027 baja lo mismo.

**Escritura:** `values.append` atómico + `id` estable en la columna AA + borrado por id (nunca por número de fila) verificando justo antes de borrar; el borrado quita solo las celdas del registro (A:O y AA) para no llevarse la tabla de cierres de P:Q.
**Caché:** lectura con caché (30 s, compartida), lectura fresca antes de escribir o borrar, e invalidación (con "generación") después de cada escritura.
**Configuración:** toda modificación de `ConfigTablero` parte de lo último guardado y se escribe en una sola llamada.
