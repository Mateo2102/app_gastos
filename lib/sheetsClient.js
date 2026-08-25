import { google } from 'googleapis';
import { CONFIG } from './config';

let _sheetsApi = null;

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
  if (_sheetsApi) return _sheetsApi;
  const auth = getAuth();
  _sheetsApi = google.sheets({ version: 'v4', auth });
  return _sheetsApi;
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

// Asegura que exista la pestaña auxiliar donde se persisten sueldo/piso/histórico/cache dólar
export async function ensureConfigSheet() {
  const sheets = getSheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === CONFIG.CONFIG_SHEET_NAME);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: CONFIG.CONFIG_SHEET_NAME, hidden: true } } }]
    }
  });
}

// ---- Almacén clave/valor simple en la pestaña ConfigTablero (equivalente a PropertiesService) ----

export async function getProps() {
  await ensureConfigSheet();
  const sheets = getSheetsApi();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${CONFIG.CONFIG_SHEET_NAME}!A:B`
  });
  const rows = resp.data.values || [];
  const props = {};
  rows.forEach(r => {
    if (r[0]) props[r[0]] = r[1] !== undefined ? r[1] : '';
  });
  return props;
}

export async function setProps(updates) {
  await ensureConfigSheet();
  const sheets = getSheetsApi();
  const current = await getProps();
  const merged = { ...current, ...updates };
  const values = Object.entries(merged).map(([k, v]) => [k, String(v)]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${CONFIG.CONFIG_SHEET_NAME}!A:B`
  });
  if (values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.SPREADSHEET_ID,
      range: `${CONFIG.CONFIG_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values }
    });
  }
}
