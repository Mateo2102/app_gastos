# Tablero de Control de Gastos

Versión Next.js del tablero que antes vivía como Google Apps Script (Web App), lista para
deployar en Vercel. Sigue usando tu Google Sheet como base de datos — no hace falta cambiar
cómo cargás los gastos en la planilla, y además podés cargar/editar desde el tablero.

## 1. Crear la Service Account de Google (una sola vez)

Apps Script podía leer/escribir tu planilla porque corría "como vos". Una app en Vercel no
tiene esa identidad, así que necesita una **cuenta de servicio** de Google con permiso sobre
la planilla.

1. Andá a [Google Cloud Console](https://console.cloud.google.com/) y creá un proyecto (o
   usá uno existente).
2. Habilitá la **Google Sheets API**: menú "APIs y servicios" → "Biblioteca" → buscar
   "Google Sheets API" → Habilitar.
3. Andá a "APIs y servicios" → "Credenciales" → "Crear credenciales" → **Cuenta de servicio**.
   Ponele un nombre (ej. `tablero-gastos`) y creala (no hace falta asignarle roles de proyecto).
4. Entrá a la cuenta de servicio creada → pestaña "Claves" → "Agregar clave" → "Crear clave
   nueva" → tipo **JSON**. Se descarga un archivo `.json`: ahí adentro están `client_email`
   (= `GOOGLE_SERVICE_ACCOUNT_EMAIL`) y `private_key` (= `GOOGLE_PRIVATE_KEY`).
5. Abrí tu Google Sheet, tocá "Compartir" y agregá el email de la cuenta de servicio
   (`...@...iam.gserviceaccount.com`) como **Editor**. Sin este paso la app no va a poder
   leer ni escribir nada.

## 2. Configurar variables de entorno

Copiá `.env.local.example` a `.env.local` y completá:

- `SPREADSHEET_ID`: el ID de la planilla (está en la URL).
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: el `client_email` del JSON descargado.
- `GOOGLE_PRIVATE_KEY`: el `private_key` del JSON, **entre comillas dobles**, tal cual (con
  los `\n` literales — no hace falta convertirlos a saltos de línea reales).
- `SHEET_NAME`: dejalo vacío salvo que tus datos NO estén en la primera pestaña.

La app crea automáticamente, la primera vez que corre, una pestaña oculta llamada
`ConfigTablero` dentro de la misma planilla — ahí persiste el sueldo, el piso de ahorro, el
histórico de sueldos por mes y el cache de la cotización del dólar blue (equivalente a lo que
antes guardaba `PropertiesService` en Apps Script). No la borres ni la edites a mano.

## 3. Correr en local

```bash
npm install
npm run dev
```

Abrí http://localhost:3000

## 4. Deploy en Vercel

1. Subí este proyecto a un repo de GitHub.
2. En [vercel.com](https://vercel.com), "Add New..." → "Project" → importá el repo.
3. En la sección "Environment Variables" del proyecto en Vercel, cargá las mismas variables
   que en `.env.local` (`SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`,
   y `SHEET_NAME` si aplica).
4. Deploy. Cada vez que hagas push a la rama principal, Vercel redeploya solo.

## Estructura

- `app/page.js`: el tablero (antes `Index.html`), ahora un componente de React que llama a
  las API routes en vez de `google.script.run`.
- `app/api/*`: reemplazan cada función expuesta del `Code.gs` original (`getDashboardData`,
  `guardarConfiguracion`, `getOpciones`, `agregarGasto`, `eliminarFila`, `getGastosFijos`,
  `getHistorico`).
- `lib/logic.js`: toda la lógica de fechas de cierre, proyección mensual, dólar blue —
  portada 1:1 desde las funciones `_` del Apps Script original.
- `lib/data.js`: lectura/escritura de la planilla vía Google Sheets API.
- `lib/sheetsClient.js`: cliente autenticado + el almacén clave/valor en la pestaña
  `ConfigTablero` (reemplaza `PropertiesService`).
