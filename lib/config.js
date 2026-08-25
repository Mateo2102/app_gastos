export const CONFIG = {
  SPREADSHEET_ID: process.env.SPREADSHEET_ID,
  SHEET_NAME: process.env.SHEET_NAME || '', // vacío = primera pestaña
  CONFIG_SHEET_NAME: 'ConfigTablero', // pestaña auxiliar para persistir sueldo/piso/histórico/cache dólar
  FIRST_DATA_ROW: 2,
  MESES_PROYECCION: 12,
  PISO_DEFAULT: 300000,
  DOLAR_CACHE_MINUTOS: 30,
  TZ: process.env.TZ_APP || 'America/Argentina/Buenos_Aires'
};
