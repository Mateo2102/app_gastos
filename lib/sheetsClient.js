import { google } from 'googleapis';
import { CONFIG } from './config.js';

let _sheetsApi = null;
let _sheetsApiPrueba = null; // en los tests se inyecta una planilla simulada

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error('Faltan las credenciales GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY en las variables de entorno.');
  }
  // En .env / Vercel las claves privadas suelen guardarse con \n escapados
  key = key.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

export function getSheetsApi() {
  if (_sheetsApiPrueba) return _sheetsApiPrueba;
  if (_sheetsApi) return _sheetsApi;
  const auth = getAuth();
  _sheetsApi = google.sheets({ version: 'v4', auth });
  return _sheetsApi;
}

// ---------- Escrituras: una por vez dentro de esta instancia ----------
// Google Sheets no tiene transacciones. Dentro de una instancia, las escrituras (que leen fresco
// y después escriben) se ejecutan en fila para que no se pisen entre sí. Entre instancias distintas
// quedan las protecciones de cada operación (append atómico, ids, verificación antes de borrar).
let _cola = Promise.resolve();
export function exclusivo(fn) {
  const corrida = _cola.then(() => fn());
  _cola = corrida.then(() => {}, () => {});
  return corrida;
}

let _dataSheetTitleCache = null;

// Nombre real de la pestaña de datos (la primera, salvo que se fije SHEET_NAME en config)
export async function getDataSheetTitle() {
  if (CONFIG.SHEET_NAME) return CONFIG.SHEET_NAME;
  if (_dataSheetTitleCache) return _dataSheetTitleCache;
  const sheets = getSheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID });
  _dataSheetTitleCache = meta.data.sheets[0].properties.title;
  return _dataSheetTitleCache;
}

// Asegura que exista la pestaña auxiliar donde se persisten sueldo/piso/histórico/cache dólar.
// La creación en curso se comparte: dos requests simultáneas de esta instancia no crean dos hojas.
let _configSheetEnsured = false;
let _configSheetEnCurso = null;
export async function ensureConfigSheet() {
  if (_configSheetEnsured) return;
  if (!_configSheetEnCurso) {
    _configSheetEnCurso = (async () => {
      const sheets = getSheetsApi();
      const meta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID });
      const exists = meta.data.sheets.some(s => s.properties.title === CONFIG.CONFIG_SHEET_NAME);
      if (!exists) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: CONFIG.SPREADSHEET_ID,
          requestBody: {
            requests: [{ addSheet: { properties: { title: CONFIG.CONFIG_SHEET_NAME, hidden: true } } }]
          }
        });
      }
      _configSheetEnsured = true;
    })().finally(() => { _configSheetEnCurso = null; });
  }
  return _configSheetEnCurso;
}

// ---------- Almacén clave/valor simple en la pestaña ConfigTablero (equivalente a PropertiesService) ----------
// Tres conceptos separados:
//   - lectura con caché (getProps): para mostrar datos; puede tener hasta PROPS_CACHE_MS de antigüedad;
//   - lectura fresca (getProps({ fresco: true }) / dentro de setProps): imprescindible antes de ESCRIBIR,
//     porque se reescribe la tabla completa y una base vieja pisaría cambios recientes;
//   - invalidación: toda escritura deja el caché con lo que acaba de escribir.
let _propsCache = null;
let _propsCacheAt = 0;
let _propsEnCurso = null;
let _propsGen = 0;
const PROPS_CACHE_MS = 30000;

function propsDeFilas(rows) {
  const props = {};
  rows.forEach(r => {
    if (r[0]) props[r[0]] = r[1] !== undefined ? r[1] : '';
  });
  return props;
}

async function leerFilasProps() {
  await ensureConfigSheet();
  const sheets = getSheetsApi();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${CONFIG.CONFIG_SHEET_NAME}!A:B`
  });
  return resp.data.values || [];
}

export async function getProps({ fresco = false } = {}) {
  if (fresco) {
    const gen = _propsGen;
    const props = propsDeFilas(await leerFilasProps());
    if (gen === _propsGen) { _propsCache = props; _propsCacheAt = Date.now(); }
    return props;
  }
  if (_propsCache && (Date.now() - _propsCacheAt) < PROPS_CACHE_MS) return _propsCache;
  // Las requests simultáneas comparten una sola lectura.
  if (!_propsEnCurso) {
    const gen = _propsGen;
    const lectura = leerFilasProps().then((rows) => {
      const props = propsDeFilas(rows);
      if (gen === _propsGen) { _propsCache = props; _propsCacheAt = Date.now(); }
      return props;
    });
    _propsEnCurso = lectura;
    const limpiar = () => { if (_propsEnCurso === lectura) _propsEnCurso = null; };
    lectura.then(limpiar, limpiar);
  }
  return _propsEnCurso;
}

// Lee FRESCO, calcula los cambios a partir de lo que HAY en la planilla y escribe la tabla completa en
// UNA sola llamada (antes: clear + update; entre las dos, otra lectura veía la configuración vacía).
// `fn(props)` recibe la configuración fresca y devuelve { clave: valor }: así una modificación de un
// valor JSON (lista de sueldos, ahorros, cierres) parte de lo último guardado, no de un caché viejo.
// Si la tabla nueva es más corta que la anterior, recién después se borra la cola sobrante.
export function actualizarProps(fn) {
  return exclusivo(async () => {
    _propsGen++; // una lectura en curso con datos viejos no debe volver a llenar el caché
    _propsEnCurso = null;
    try {
      const filas = await leerFilasProps();
      const actuales = propsDeFilas(filas);
      const cambios = await fn(actuales);
      const merged = { ...actuales, ...cambios };
      const values = Object.entries(merged).map(([k, v]) => [k, String(v)]);
      const sheets = getSheetsApi();
      if (values.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: CONFIG.SPREADSHEET_ID,
          range: `${CONFIG.CONFIG_SHEET_NAME}!A1:B${values.length}`,
          valueInputOption: 'RAW',
          requestBody: { values }
        });
      }
      if (filas.length > values.length) {
        await sheets.spreadsheets.values.clear({
          spreadsheetId: CONFIG.SPREADSHEET_ID,
          range: `${CONFIG.CONFIG_SHEET_NAME}!A${values.length + 1}:B${filas.length}`
        });
      }
      _propsCache = merged;
      _propsCacheAt = Date.now();
      return merged;
    } catch (e) {
      _propsCache = null;
      _propsCacheAt = 0;
      throw e;
    }
  });
}

export function setProps(updates) {
  return actualizarProps(() => updates);
}

// ---------- Solo para tests ----------
export const __prueba = {
  usarSheets(api) { _sheetsApiPrueba = api; },
  reiniciar() {
    _sheetsApi = null; _sheetsApiPrueba = null; _dataSheetTitleCache = null;
    _configSheetEnsured = false; _configSheetEnCurso = null;
    _propsCache = null; _propsCacheAt = 0; _propsEnCurso = null; _propsGen = 0;
    _cola = Promise.resolve();
  }
};
