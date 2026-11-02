"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { fechaCierreDia, fechaAplicacion, describirPago } from "@/lib/closing";

const MESES_NOMBRE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const TABS = [
  { id: "inicio", label: "Inicio", icon: "home", sub: "" },
  { id: "gastos", label: "Gastos", icon: "receipt", sub: "Qué pasó con la plata, mes a mes." },
  { id: "tarjetas", label: "Tarjetas", icon: "card", sub: "Cierres, cuotas y gastos fijos de cada tarjeta." },
  { id: "proyeccion", label: "Proyección", icon: "chart", sub: "Cómo vas a estar los próximos meses." },
  { id: "ahorro", label: "Ahorro", icon: "wallet", sub: "Tu ahorro acumulado, en pesos y dólares." }
];

// Qué se carga en el formulario: define la "clase" de fila en la planilla (columna A).
const CLASES_CARGA = [
  { gasto: "Gasto variable", titulo: "Compra", ayuda: "Un pago o en cuotas" },
  { gasto: "Gasto fijo", titulo: "Gasto fijo", ayuda: "Se repite todos los meses" },
  { gasto: "Ingreso extra", titulo: "Ingreso extra", ayuda: "Plata que entra una vez" }
];

const FORMA_TARJETA = "Tarjeta de Crédito";

// Paleta de los gráficos y las barras (tonos afines a los tokens de globals.css; el canvas no lee CSS).
const PAL = {
  gasto: "#d6402b", gastoSuave: "#efb6ab", ingreso: "#9fd6b8", ahorro: "#0a7040", piso: "#8a8576",
  libre: "#c9c1ae", variable: "#d98a12", cuota: "#2b44d6", grid: "#e6e0d3", texto: "#5a554a"
};
Chart.defaults.color = PAL.texto;
Chart.defaults.borderColor = PAL.grid;

// Categorías que se ofrecen al cargar. El Tipo de la planilla (columna B) se deduce de la categoría.
const CATEGORIAS_GASTO = [
  "Supermercado", "Entretenimiento", "Indumentaria y calzado", "Salud y belleza", "Deporte", "Tecnología",
  "Transporte y apps", "Suscripciones y servicios", "Mascotas", "Seguros", "Préstamos", "Comisiones bancarias"
];
const CATEGORIAS_INGRESO = ["Sueldo extra", "Venta", "Reintegro", "Otro"];
// Nombres anteriores que ya no se ofrecen (las filas viejas se recategorizaron en la planilla).
const CATEGORIAS_VIEJAS = ["Aplicaciones", "Vehículo", "Servicios", "Suscripciones", "Prestamos", "Ingresos extraordinarios"];
const TIPO_POR_CATEGORIA = {
  "Suscripciones y servicios": "Suscripcion", "Seguros": "Seguros", "Préstamos": "Prestamos", "Comisiones bancarias": "Comisiones"
};
function tipoDeCategoria(categoria, esFijo) {
  const tipo = TIPO_POR_CATEGORIA[categoria] || "Compra";
  // La fórmula de Estado de la planilla trata como "Gasto Fijo" todo lo que no sea Compra/Comisiones.
  return esFijo && tipo === "Compra" ? "Suscripcion" : tipo;
}

const fmt = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("es-AR");
const fmtUSD = (n) =>
  n === null || n === undefined ? "—" : (n < 0 ? "-US$" : "US$") + Math.abs(Math.round(n)).toLocaleString("en-US");

const fmtUSD2 = (n) => (n < 0 ? "-US$" : "US$") + Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// "2026-09-24" -> "24/09/2026" (sin pasar por Date, para no depender de la zona horaria)
function fechaLarga(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

function celdaEquivalencia(moneda, montoARS, montoUSD) {
  const esUSD = String(moneda || "").toUpperCase() === "USD";
  const principal = esUSD ? fmtUSD(montoUSD) : fmt(montoARS);
  const equivalente = esUSD ? fmt(montoARS) : fmtUSD(montoUSD);
  return (
    <>
      {principal}
      <span className="usd-inline">≈ {equivalente}</span>
    </>
  );
}

function estadoBadge(estado) {
  const s = String(estado || "").toLowerCase();
  let cls = "badge-neutral";
  if (s.includes("curso")) cls = "badge-info";
  else if (s.includes("cerrado") || s.includes("fijo")) cls = "badge-ok";
  else if (s === "n/a") cls = "badge-neutral";
  return <span className={`badge ${cls}`}>{estado || "—"}</span>;
}

function labelTramo(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MESES_NOMBRE[m]} ${y}`;
}

// Vigencia de un gasto fijo (fechas ISO "YYYY-MM-DD" que manda la API; los meses cuentan completos).
const mesDeISO = (iso) => { const [y, m] = String(iso).split("-").map(Number); return y * 12 + (m - 1); };
function fijoVigenteMes(g, year, month) {
  const n = year * 12 + month;
  if (g.desde && n < mesDeISO(g.desde)) return false;
  if (g.hasta && n > mesDeISO(g.hasta)) return false;
  if (g.pausaDesde && n >= mesDeISO(g.pausaDesde) && (!g.pausaHasta || n <= mesDeISO(g.pausaHasta))) return false;
  return true;
}
function mesDeFecha(iso) {
  const [y, m] = String(iso).split("-").map(Number);
  return `${MESES_NOMBRE[m - 1].slice(0, 3)} ${y}`;
}
// Texto corto de la vigencia de un fijo para la lista.
function vigenciaTexto(g) {
  const partes = [g.desde ? `desde ${mesDeFecha(g.desde)}` : "desde siempre"];
  if (g.hasta) partes.push(`hasta ${mesDeFecha(g.hasta)}`);
  if (g.pausaDesde) partes.push(g.pausaHasta ? `pausado ${mesDeFecha(g.pausaDesde)} a ${mesDeFecha(g.pausaHasta)}` : `pausado desde ${mesDeFecha(g.pausaDesde)}`);
  return partes.join(" · ");
}
const ESTADO_FIJO = {
  activo: ["Activo", "badge-ok"], pausado: ["Pausado", "badge-neutral"],
  terminado: ["Terminado", "badge-neutral"], programado: ["Programado", "badge-info"]
};

function iniciales(nombre) {
  return String(nombre || "?").trim().slice(0, 2).toUpperCase();
}

// Tema visual de la tarjeta bancaria según el banco (solo estética, no cambia datos).
function cardTheme(banco) {
  const s = String(banco || "").toLowerCase();
  if (s.includes("santander")) return "bankcard-theme-santander";
  if (s.includes("icbc")) return "bankcard-theme-icbc";
  if (s.includes("mercadopago") || s.includes("mercado pago")) return "bankcard-theme-mercadopago";
  return "bankcard-theme-neutral";
}

function shiftMes(month, year, delta) {
  const total = year * 12 + month + delta;
  return { month: ((total % 12) + 12) % 12, year: Math.floor(total / 12) };
}

// Próximo cierre de una tarjeta con día fijo: cuántos días faltan desde hoy.
function proximoCierre(dia, hoy) {
  const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let c = fechaCierreDia(h.getFullYear(), h.getMonth(), dia);
  if (c < h) c = fechaCierreDia(h.getFullYear(), h.getMonth() + 1, dia);
  return { dias: Math.round((c - h) / 86400000), fecha: c };
}

// Color de una variación según LO QUE cambia: en algo positivo (ingreso, ahorro) subir es bueno y bajar
// es malo; en algo negativo (gasto, deuda) subir es malo y bajar es bueno.
function claseVariacion(delta, tipo) {
  if (!delta) return "muted";
  const bueno = tipo === "gasto" ? delta < 0 : delta > 0;
  return bueno ? "var-bien" : "var-mal";
}

function agruparPor(lista, keyFn) {
  if (!lista) return [];
  const grupos = new Map();
  lista.forEach((c) => {
    const key = keyFn(c) || "Sin especificar";
    if (!grupos.has(key)) grupos.set(key, { nombre: key, cuotas: [], totalARS: 0 });
    const g = grupos.get(key);
    g.cuotas.push(c);
    g.totalARS += Number(c.montoCuotaARS) || 0;
  });
  return [...grupos.values()].sort((a, b) => b.totalARS - a.totalARS);
}

async function fetchJSON(url, opts) {
  const resp = await fetch(url, opts);
  if (resp.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga completa a propósito: descarta los datos en memoria
    window.location.href = "/login";
    throw new Error("Tu sesión venció. Volvé a iniciar sesión.");
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Error ${resp.status}`);
  }
  return resp.json();
}

// Control segmentado: una fila de opciones excluyentes (reemplaza selects de pocas opciones).
function Segmented({ value, onChange, options, className = "" }) {
  return (
    <div className={`segmented ${className}`}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        return (
          <button key={v} type="button" className={`seg ${value === v ? "active" : ""}`} onClick={() => onChange(v)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Íconos SVG de trazo (un solo set), en lugar de emojis: heredan el color del texto.
const ICONOS = {
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  "check-circle": <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  "x-circle": <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  bank: <path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M3 10l9-6 9 6" />,
  home: <path d="M3 11 12 3l9 8M5 10v10h14V10M10 20v-6h4v6" />,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  chart: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  wallet: <><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /><circle cx="16" cy="13.5" r="1" /></>,
  "arrow-down-left": <path d="M17 7 7 17M17 17H7V7" />,
  "arrow-up-right": <path d="M7 17 17 7M7 7h10v10" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>
};

function Icon({ name, size = 18 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONOS[name]}
    </svg>
  );
}

// Mensaje de resultado de una acción (guardar, etc.). Acepta el texto con prefijo ✅/❌ y lo muestra con ícono.
function StatusMsg({ texto }) {
  const t = String(texto || "");
  const ok = t.startsWith("✅");
  const error = t.startsWith("❌");
  const limpio = t.replace(/^(✅|❌)\s*/, "");
  return (
    <div className={`status ${ok ? "status-ok" : ""} ${error ? "status-error" : ""}`} role={error ? "alert" : "status"}>
      {(ok || error) && <Icon name={ok ? "check-circle" : "x-circle"} size={15} />}
      <span>{limpio}</span>
    </div>
  );
}

// Esqueleto de carga: ocupa el lugar del contenido para que la página no salte al llegar los datos.
function Skeleton({ filas = 3 }) {
  return (
    <div className="skeleton" role="status" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, i) => <span className="skeleton-bar" key={i} style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  );
}

// Alertas objetivas, calculadas solo con los números de la proyección que se le pase.
function calcAlertas(meses) {
  const lista = [];
  if (meses.length < 2) return lista;
  const promG = meses.reduce((acc, m) => acc + m.gastos, 0) / meses.length;
  meses.forEach((m, i) => {
    const prev = i > 0 ? meses[i - 1] : null;
    if (m.margen < 0) {
      lista.push({ nivel: "crit", mes: m.label, texto: `Los gastos superan a los ingresos por ${fmt(-m.margen)}.` });
    } else if (m.piso < m.pisoConfigurado) {
      lista.push({ nivel: "warn", mes: m.label, texto: `No se alcanza el piso: quedan ${fmt(m.margen)} de los ${fmt(m.pisoConfigurado)} configurados.` });
    }
    if (promG && m.gastos > promG * 1.15) {
      lista.push({ nivel: "warn", mes: m.label, texto: `Gastos ${Math.round((m.gastos / promG - 1) * 100)}% por encima del promedio de estos meses (${fmt(promG)}).` });
    }
    if (prev && prev.gastos - m.gastos >= 100000 && (prev.gastos - m.gastos) / prev.gastos >= 0.15) {
      lista.push({ nivel: "ok", mes: m.label, texto: `Bajan los gastos ${fmt(prev.gastos - m.gastos)} respecto de ${prev.label}: terminan cuotas.` });
    }
    if (prev && m.ahorroProyectado - prev.ahorroProyectado >= 100000) {
      lista.push({ nivel: "ok", mes: m.label, texto: `Sube el ahorro proyectado ${fmt(m.ahorroProyectado - prev.ahorroProyectado)} respecto de ${prev.label}.` });
    }
    if (m.aguinaldo > 0) {
      lista.push({ nivel: "ok", mes: m.label, texto: `Ingresa aguinaldo (${fmt(m.aguinaldo)}).` });
    }
  });
  return lista;
}

export default function Home() {
  const hoy = new Date();
  // El mes "vigente" a mostrar por defecto en todas las pestañas es siempre el mes calendario
  // siguiente al actual, y cambia justo el día 1 de cada mes (ej. el 08/09 se ve octubre; recién
  // el 01/10 pasa a verse noviembre).
  const mesObjetivo = shiftMes(hoy.getMonth(), hoy.getFullYear(), 1);

  const [tab, setTabRaw] = useState("inicio");

  // Cambiar de sección: queda en la URL (#gastos), vuelve arriba y mueve el foco al contenido.
  function setTab(id) {
    setTabRaw(id);
    if (window.location.hash.replace("#", "") !== id) window.history.pushState(null, "", "#" + id);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => document.getElementById("contenido")?.focus({ preventScroll: true }));
  }
  // Sub-vistas de cada pestaña agrupada.
  const [proyVista, setProyVista] = useState("proyeccion"); // proyeccion | sueldo
  const [tarjetasVista, setTarjetasVista] = useState("tarjeta"); // tarjeta | cuotas
  const [inicioIdx, setInicioIdx] = useState(0); // posición dentro de mesesBase

  const [dolarBlue, setDolarBlue] = useState(0);
  const [meses, setMeses] = useState([]);
  // Copia de "meses" que NO se pisa cuando el usuario navega a otro período con "Ver otro
  // período" — sirve para que el balance del header siempre refleje el mes real siguiente al
  // que ya se paga (no el período que se esté mirando en la tabla de proyección).
  const [mesesBase, setMesesBase] = useState([]);
  const [porCuenta, setPorCuenta] = useState(null);
  const [gastosFijos, setGastosFijos] = useState([]);
  const [historico, setHistorico] = useState(null);
  const [opciones, setOpciones] = useState({ bancos: [], formasPago: [], marcas: [], tipos: [], categorias: [], gastos: [], monedas: [] });
  const [tarjetaActiva, setTarjetaActiva] = useState(null);

  // Día de cierre de cada tarjeta (por banco) y borrador de lo que se está editando.
  const [cierreDias, setCierreDias] = useState({});
  const [cierreForm, setCierreForm] = useState({});
  const [cierreStatus, setCierreStatus] = useState("");

  const [cfgPiso, setCfgPiso] = useState("");
  const [cfgStatus, setCfgStatus] = useState("");

  const [sueldoSchedule, setSueldoSchedule] = useState([]);
  const [sueldoForm, setSueldoForm] = useState({ month: mesObjetivo.month, year: mesObjetivo.year, monto: "" });
  const [sueldoStatus, setSueldoStatus] = useState("");

  const [ahorroMovs, setAhorroMovs] = useState([]);
  // El ahorro real se carga para un mes ya transcurrido (o en curso), no para el mes de
  // referencia futuro — por defecto el mes calendario actual, no mesObjetivo.
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  const [ahorroForm, setAhorroForm] = useState({ fecha: hoyISO, monto: "", moneda: "ARS" });
  const [ahorroStatus, setAhorroStatus] = useState("");

  const [filtroMes, setFiltroMes] = useState(mesObjetivo.month);
  const [filtroAnio, setFiltroAnio] = useState(mesObjetivo.year);

  const pagoInicial = { formaPago: FORMA_TARJETA, banco: "", marca: "VISA", fechaCierre: "" };

  const [gForm, setGForm] = useState({
    gasto: "Gasto variable", tipo: "", categoria: "", ...pagoInicial, desc: "", fecha: hoyISO, cuotas: 1, moneda: "ARS", monto: ""
  });
  const [addStatus, setAddStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [erroresForm, setErroresForm] = useState({});
  const [cargarAbierto, setCargarAbierto] = useState(false);

  const [histDesde, setHistDesde] = useState("");
  const [histHasta, setHistHasta] = useState("");

  const [cuotasMesFiltro, setCuotasMesFiltro] = useState({ month: mesObjetivo.month, year: mesObjetivo.year });
  const [cuotasMes, setCuotasMes] = useState(null);

  // Pestaña "Gastos": mes elegido y cuotas de ese mes (los gastos fijos se suman aparte).
  const [gastosMesFiltro, setGastosMesFiltro] = useState({ month: mesObjetivo.month, year: mesObjetivo.year });
  const [gastosHist, setGastosHist] = useState(null);
  const [gastosCat, setGastosCat] = useState("");
  const [gastosVista, setGastosVista] = useState("detalle");

  // Pestaña "Histórico": mes de compra elegido y categoría.
  const [histMes, setHistMes] = useState({ month: hoy.getMonth(), year: hoy.getFullYear() });
  const [histCat, setHistCat] = useState("");

  // Navegador de meses independiente para el detalle de una tarjeta puntual (estilo Mercado Pago).
  const mesActual = { month: hoy.getMonth(), year: hoy.getFullYear() };
  const [tarjetaMesFiltro, setTarjetaMesFiltro] = useState(mesActual);
  const [tarjetaSubtab, setTarjetaSubtab] = useState("consumos"); // consumos | fijos
  const [tarjetaMesCuotas, setTarjetaMesCuotas] = useState(null);

  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const ahorroCanvasRef = useRef(null);
  const ahorroChartRef = useRef(null);
  const gastosCanvasRef = useRef(null);
  const gastosChartRef = useRef(null);
  const gastosDashRef = useRef(null);
  const gastosDashChart = useRef(null);
  const histCanvasRef = useRef(null);
  const histChartRef = useRef(null);

  function render(payload, opts = {}) {
    if (!opts.onlyBase) setMeses(payload.meses || []);
    if (!opts.anchored) setMesesBase(payload.meses || []);
    if (payload.porCuenta) setPorCuenta(payload.porCuenta);
    if (payload.config) {
      setCfgPiso(payload.config.piso || "");
      setSueldoSchedule(payload.config.sueldoSchedule || []);
      setAhorroMovs(payload.config.ahorroMovs || []);
      if (payload.config.cierreDias) setCierreDias(payload.config.cierreDias);
    }
    if (payload.dolarBlue) setDolarBlue(payload.dolarBlue);
    else setDolarBlue(0);
  }

  async function cargarTablero() {
    const data = await fetchJSON("/api/dashboard");
    render(data, { onlyBase: true });
  }

  async function cargarOpciones() {
    const op = await fetchJSON("/api/opciones");
    setOpciones(op);
    const formaPago = op.formasPago[0] || FORMA_TARJETA;
    const banco = op.bancos[0] || "";
    const marca = op.marcas[0] || "VISA";
    const tipo = op.tipos.includes("Compra") ? "Compra" : (op.tipos[0] || "");
    setGForm((f) => ({ ...f, tipo, formaPago, banco, marca, moneda: op.monedas[0] || "ARS" }));
  }

  async function cargarGastosFijos() {
    const lista = await fetchJSON("/api/gastos-fijos");
    setGastosFijos(lista);
  }

  async function buscarHistorico(desde = histDesde, hasta = histHasta) {
    const params = new URLSearchParams();
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const lista = await fetchJSON(`/api/historico?${params.toString()}`);
    setHistorico(lista);
  }

  async function cargarCuotasMes(month = cuotasMesFiltro.month, year = cuotasMesFiltro.year) {
    const params = new URLSearchParams({ month: String(month), year: String(year) });
    const payload = await fetchJSON(`/api/cuotas-mes?${params.toString()}`);
    setCuotasMes(payload.detalle || []);
  }

  async function cargarTarjetaMes(month = tarjetaMesFiltro.month, year = tarjetaMesFiltro.year) {
    const params = new URLSearchParams({ month: String(month), year: String(year) });
    const payload = await fetchJSON(`/api/cuotas-mes?${params.toString()}`);
    setTarjetaMesCuotas(payload.detalle || []);
  }

  // Historial de gastos: 24 meses hacia atrás y 11 hacia adelante del mes de referencia.
  const gastosVentanaInicio = shiftMes(mesObjetivo.month, mesObjetivo.year, -24);

  async function cargarGastosMes() {
    const params = new URLSearchParams({
      month: String(gastosVentanaInicio.month), year: String(gastosVentanaInicio.year), count: "36"
    });
    const payload = await fetchJSON(`/api/gastos-historial?${params.toString()}`);
    setGastosHist(payload.meses || []);
  }

  function elegirMesGastos(month, year) {
    setGastosMesFiltro({ month, year });
  }

  // La pestaña "Gastos" se carga recién al abrirla, para no gastar lecturas de Sheets de más.
  function abrirTab(id) {
    setTab(id);
  }

  async function salir() {
    try { await fetch("/api/auth/salir", { method: "POST" }); } finally {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga completa a propósito: descarta los datos en memoria
      window.location.href = "/login";
    }
  }

  function abrirCargar(clase) {
    if (clase) setGForm((f) => ({ ...f, gasto: clase, categoria: "" }));
    setAddStatus("");
    setErroresForm({});
    setCargarAbierto(true);
  }

  // Cerrar Cargar: si hay datos escritos sin guardar, pide confirmación para no perderlos.
  function cerrarCargar() {
    const sinGuardar = String(gForm.desc).trim() !== "" || Number(gForm.monto) > 0;
    if (sinGuardar && !confirm("Tenés datos sin guardar. ¿Cerrar igual?")) return;
    setErroresForm({});
    setCargarAbierto(false);
  }

  useEffect(() => {
    if (!cargarAbierto) return undefined;
    const onKey = (e) => { if (e.key === "Escape") cerrarCargar(); };
    window.addEventListener("keydown", onKey);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // el fondo no se desplaza detrás de la ventana
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflowPrevio;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargarAbierto, gForm]);

  useEffect(() => {
    cargarInicial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al abrir la app (o con Atrás/Adelante) la sección sale de la URL.
  useEffect(() => {
    const leer = () => {
      const id = window.location.hash.replace("#", "");
      if (TABS.some((t) => t.id === id)) setTabRaw(id);
    };
    leer();
    window.addEventListener("popstate", leer);
    return () => window.removeEventListener("popstate", leer);
  }, []);

  // "Cuotas del mes" se trae recién al abrir Tarjetas (una lectura menos en la carga inicial).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga bajo demanda vía fetch
    if (tab === "tarjetas" && cuotasMes === null) cargarCuotasMes().catch((e) => setLoadError(mensajeDeError(e)));
    if (tab === "gastos" && gastosHist === null) cargarGastosMes().catch((e) => setLoadError(mensajeDeError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!canvasRef.current || tab !== "proyeccion" || proyVista !== "proyeccion") return;
    if (chartRef.current) chartRef.current.destroy();
    if (!meses.length) return;
    const fmtCorto = (n) => "$" + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k");
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      data: {
        labels: meses.map((m) => m.label),
        datasets: [
          { type: "bar", label: "Ingresos", data: meses.map((m) => m.ingresos), backgroundColor: PAL.ingreso, borderRadius: 6, barPercentage: 0.7 },
          { type: "bar", label: "Gastos", data: meses.map((m) => m.gastos), backgroundColor: PAL.gasto, borderRadius: 6, barPercentage: 0.7 },
          { type: "line", label: "Ahorro proyectado", data: meses.map((m) => m.ahorroProyectado), borderColor: PAL.ahorro, backgroundColor: PAL.ahorro, tension: 0.3, borderWidth: 3, pointRadius: 4 },
          { type: "line", label: "Piso configurado", data: meses.map((m) => m.pisoConfigurado), borderColor: PAL.piso, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { font: { size: 12.5, family: "inherit" }, usePointStyle: true, padding: 16, boxHeight: 8 } },
          tooltip: {
            padding: 12, cornerRadius: 8,
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12, family: "inherit" } } },
          y: { grid: { color: PAL.grid }, border: { display: false }, ticks: { font: { size: 12, family: "inherit" }, callback: (v) => fmtCorto(v) } }
        }
      }
    });
  }, [meses, tab, proyVista]);

  async function guardarConfig() {
    setCfgStatus("Guardando...");
    try {
      const payload = await fetchJSON("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ piso: cfgPiso })
      });
      render(payload);
      setCfgStatus("✅ Guardado");
    } catch (e) {
      setCfgStatus("❌ " + e.message);
    }
  }

  async function guardarCierre(banco) {
    const dia = String(cierreForm[banco] ?? cierreDias[banco] ?? "").trim();
    setCierreStatus("Guardando...");
    try {
      const payload = await fetchJSON("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cierre: { banco, dia } })
      });
      render(payload);
      setCierreForm((f) => { const n = { ...f }; delete n[banco]; return n; });
      setCierreStatus(dia ? `✅ ${banco}: cierra el día ${dia}. Los gastos se reubicaron.` : `✅ ${banco}: sin día fijo (se usa el jueves de cierre).`);
      if (gastosHist !== null) cargarGastosMes();
      cargarCuotasMes();
      cargarTarjetaMes();
      buscarHistorico();
    } catch (e) {
      setCierreStatus("❌ " + e.message);
    }
  }

  async function agregarTramoSueldo() {
    setSueldoStatus("Guardando...");
    try {
      const payload = await fetchJSON("/api/sueldo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sueldoForm)
      });
      render(payload);
      setSueldoStatus("✅ Guardado");
      setSueldoForm((f) => ({ ...f, monto: "" }));
    } catch (e) {
      setSueldoStatus("❌ " + e.message);
    }
  }

  async function eliminarTramoSueldo(key) {
    if (!confirm("¿Eliminar este tramo de sueldo?")) return;
    const payload = await fetchJSON(`/api/sueldo/${encodeURIComponent(key)}`, { method: "DELETE" });
    render(payload);
  }

  async function guardarAhorro() {
    setAhorroStatus("Guardando...");
    try {
      const payload = await fetchJSON("/api/ahorro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ahorroForm)
      });
      render(payload);
      setAhorroStatus("✅ Guardado");
      setAhorroForm((f) => ({ ...f, monto: "" }));
    } catch (e) {
      setAhorroStatus("❌ " + e.message);
    }
  }

  async function eliminarAhorro(id) {
    if (!confirm("¿Eliminar este movimiento de ahorro?")) return;
    const payload = await fetchJSON(`/api/ahorro/${encodeURIComponent(id)}`, { method: "DELETE" });
    render(payload);
  }

  async function verPeriodo(month = filtroMes, year = filtroAnio) {
    const data = await fetchJSON("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchor: { month, year } })
    });
    render(data, { anchored: true });
  }

  // "Hoy" vuelve al mes de referencia (el que ya no está resuelto), no al mes calendario real.
  async function verHoy() {
    setFiltroMes(mesObjetivo.month);
    setFiltroAnio(mesObjetivo.year);
    await verPeriodo(mesObjetivo.month, mesObjetivo.year);
  }

  // Mensaje entendible para el error más común: el límite de lecturas por minuto de Google Sheets.
  function mensajeDeError(e) {
    const m = String((e && e.message) || e || "");
    if (/quota|rate limit|429/i.test(m)) return "Google Sheets limitó las lecturas por un momento. Esperá un minuto y reintentá.";
    return m || "No se pudieron cargar los datos.";
  }

  async function cargarInicial() {
    setLoadError("");
    setCargandoInicial(true);
    // Primero UNA consulta sola: lee la planilla y deja la caché del servidor lista. Si salieran todas
    // juntas, en Vercel cada una caería en una instancia distinta y leería Sheets por su cuenta
    // (límite: 60 lecturas por minuto). Después, el resto en paralelo aprovecha esa caché.
    const primera = await Promise.allSettled([
      cargarTablero() // fija mesesBase (siempre relativo a hoy, para el header y por-cuenta)
    ]);
    const resto = await Promise.allSettled([
      cargarOpciones(),
      verPeriodo(mesObjetivo.month, mesObjetivo.year), // la tabla/gráfico arrancan en el mes de referencia
      cargarGastosFijos(),
      buscarHistorico("", ""),
      cargarTarjetaMes()
    ]);
    const resultados = [...primera, ...resto];
    const fallo = resultados.find((r) => r.status === "rejected");
    if (fallo) setLoadError(mensajeDeError(fallo.reason));
    setCargandoInicial(false);
  }

  async function agregar() {
    const errores = {};
    if (!String(gForm.desc).trim()) errores.desc = "Escribí qué es (por ejemplo: Zapatillas).";
    if (!(Number(gForm.monto) > 0)) errores.monto = "Ingresá un monto mayor a 0.";
    if (gForm.gasto !== "Ingreso extra" && !gForm.categoria) errores.categoria = "Elegí una categoría.";
    setErroresForm(errores);
    const primero = Object.keys(errores)[0];
    if (primero) {
      setAddStatus("");
      const el = document.getElementById("cargar-" + primero);
      if (el) el.focus();
      return;
    }
    setAddStatus("Guardando...");
    try {
      const esIngreso = gForm.gasto === "Ingreso extra";
      const esCompra = gForm.gasto === "Gasto variable";
      // Un ingreso no tiene medio de pago y un fijo no tiene cuotas ni fecha de cierre.
      const payload = {
        ...gForm,
        tipo: tipoDeCategoria(gForm.categoria, gForm.gasto === "Gasto fijo"),
        cuotas: esCompra ? gForm.cuotas : 1,
        fechaCierre: esCompra ? gForm.fechaCierre : "",
        ...(esIngreso ? { formaPago: "", banco: "", marca: "" } : {}),
        ...(gForm.formaPago === "Efectivo" ? { banco: "", marca: "" } : {})
      };
      const res = await fetchJSON("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      render(res.dashboard);
      setGastosFijos(res.gastosFijos);
      setAddStatus("✅ Guardado en la planilla");
      setGForm((f) => ({ ...f, desc: "", monto: "", cuotas: 1 }));
      buscarHistorico();
      cargarCuotasMes();
      cargarTarjetaMes();
      if (gastosHist !== null) cargarGastosMes();
    } catch (e) {
      setAddStatus("❌ " + e.message);
    }
  }

  async function eliminarFijo(g) {
    if (!confirm("¿Eliminar este gasto fijo de la planilla?")) return;
    const res = await fetchJSON(`/api/gastos/${encodeURIComponent(g.ref)}?fila=${g.row}`, { method: "DELETE" });
    render(res.dashboard);
    setGastosFijos(res.gastosFijos);
    buscarHistorico();
  }

  // Pausar / terminar / reanudar / reactivar un gasto fijo (la API escribe solo su vigencia).
  async function vigenciaFijo(g, accion) {
    const aviso = {
      terminar: `¿Terminar "${g.desc}"? Se sigue contando este mes y deja de contarse desde el mes siguiente.`,
      pausar: `¿Pausar "${g.desc}"? Deja de contarse desde el mes siguiente hasta que lo reanudes.`
    }[accion];
    if (aviso && !confirm(aviso)) return;
    try {
      const res = await fetchJSON(`/api/gastos/${encodeURIComponent(g.ref)}?fila=${g.row}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion })
      });
      render(res.dashboard);
      setGastosFijos(res.gastosFijos);
      buscarHistorico();
      cargarTarjetaMes();
      if (gastosHist !== null) cargarGastosMes();
    } catch (e) {
      alert(e.message);
    }
  }

  function irATarjeta(nombre) {
    setTarjetaActiva(nombre);
    setTarjetasVista("tarjeta");
    setTab("tarjetas");
  }

  // Agrupa el histórico (ya traído del server, sin tocar la lógica) por tarjeta, dejando afuera
  // todo lo que no sea "Tarjeta de Crédito" (préstamos, transferencias) — eso va en "El Banco".
  const porTarjeta = useMemo(() => {
    if (!historico) return [];
    const grupos = new Map();
    historico
      .filter((h) => h.formaPago === FORMA_TARJETA && h.gasto !== "Ingreso extra")
      .forEach((h) => {
        const key = [h.marca, h.banco].filter(Boolean).join(" ") || h.medio || "Sin especificar";
        if (!grupos.has(key)) grupos.set(key, { medio: key, banco: h.banco, gastos: [], totalARS: 0, totalUSD: 0 });
        const g = grupos.get(key);
        g.gastos.push(h);
        g.totalARS += Number(h.montoARS) || 0;
        g.totalUSD += Number(h.montoUSD) || 0;
      });
    return [...grupos.values()].sort((a, b) => b.totalARS - a.totalARS);
  }, [historico]);

  const grupoActivo = porTarjeta.find((g) => g.medio === tarjetaActiva) || porTarjeta[0] || null;

  const cuotasMesCombinado = useMemo(() => agruparPor(cuotasMes, (c) => c.medio), [cuotasMes]);
  const cuotasMesTotal = cuotasMesCombinado.reduce((acc, g) => acc + g.totalARS, 0);

  const cuotasMesTarjetas = useMemo(
    () => agruparPor((cuotasMes || []).filter((c) => c.formaPago === FORMA_TARJETA), (c) => [c.marca, c.banco].filter(Boolean).join(" ")),
    [cuotasMes]
  );
  const cuotasMesBanco = useMemo(
    () => agruparPor((cuotasMes || []).filter((c) => c.formaPago !== FORMA_TARJETA), (c) => c.banco || c.formaPago),
    [cuotasMes]
  );

  // Gastos del mes navegado de CADA tarjeta: las cuotas que caen en ese mes más los gastos
  // fijos (suscripciones, seguros) cargados con esa tarjeta, que se repiten todos los meses.
  const itemsMesPorTarjeta = useMemo(() => {
    const items = {};
    const agregar = (key, item) => {
      if (!items[key]) items[key] = [];
      items[key].push(item);
    };
    (tarjetaMesCuotas || [])
      .filter((c) => c.formaPago === FORMA_TARJETA)
      .forEach((c) => agregar([c.marca, c.banco].filter(Boolean).join(" "), {
        desc: c.desc, moneda: c.moneda, montoARS: c.montoCuotaARS, montoUSD: c.montoCuotaUSD,
        cuota: `${c.cuotaNumero} de ${c.cuotasTotales}`
      }));
    gastosFijos
      .filter((g) => g.formaPago === FORMA_TARJETA && fijoVigenteMes(g, tarjetaMesFiltro.year, tarjetaMesFiltro.month))
      .forEach((g) => agregar([g.marca, g.banco].filter(Boolean).join(" "), {
        desc: g.desc, moneda: g.moneda, montoARS: g.montoARS, montoUSD: g.montoUSD, cuota: "Fijo"
      }));
    return items;
  }, [tarjetaMesCuotas, gastosFijos, tarjetaMesFiltro]);

  const tarjetaMesItems = itemsMesPorTarjeta[grupoActivo?.medio] || [];
  // Los fijos no tienen cuota: se muestran aparte de las cuotas del mes.
  const tarjetaMesCuotasItems = tarjetaMesItems.filter((c) => c.cuota !== "Fijo");
  const tarjetaMesFijosItems = tarjetaMesItems.filter((c) => c.cuota === "Fijo");
  const tarjetaMesTotal = tarjetaMesItems.reduce((acc, c) => acc + (Number(c.montoARS) || 0), 0);
  const tarjetaConsumosTotal = tarjetaMesCuotasItems.reduce((acc, c) => acc + (Number(c.montoARS) || 0), 0);
  const tarjetaFijosTotal = tarjetaMesFijosItems.reduce((acc, c) => acc + (Number(c.montoARS) || 0), 0);
  const tarjetaItemsVista = tarjetaSubtab === "consumos" ? tarjetaMesCuotasItems : tarjetaMesFijosItems;
  const tarjetaEnMesActual = tarjetaMesFiltro.month === mesActual.month && tarjetaMesFiltro.year === mesActual.year;
  const tarjetaMesTotalUSD = tarjetaMesItems.reduce((acc, c) => acc + (Number(c.montoUSD) || 0), 0);

  // Total del mes navegado para CADA tarjeta (mismo criterio que "Total del mes"), para que el
  // número de la tarjetita coincida con el detalle.
  const totalesMesPorTarjeta = useMemo(() => {
    const totales = {};
    Object.entries(itemsMesPorTarjeta).forEach(([key, lista]) => {
      totales[key] = {
        total: lista.reduce((acc, c) => acc + (Number(c.montoARS) || 0), 0),
        cuotas: lista.filter((c) => c.cuota !== "Fijo").length,
        fijos: lista.filter((c) => c.cuota === "Fijo").length
      };
    });
    return totales;
  }, [itemsMesPorTarjeta]);

  // ---- Pestaña "Gastos": desglose del mes por categoría (Tipo) + evolutivo ----
  const gastosItemsMes = useMemo(() => {
    if (gastosHist === null) return null;
    const mo = gastosHist.find((m) => m.key === `${gastosMesFiltro.year}-${gastosMesFiltro.month}`);
    return mo ? mo.items : [];
  }, [gastosHist, gastosMesFiltro]);

  const gastosCategorias = useMemo(() => {
    const totales = {};
    (gastosItemsMes || []).forEach((g) => { totales[g.categoria] = (totales[g.categoria] || 0) + (Number(g.montoARS) || 0); });
    return Object.entries(totales).sort((a, b) => b[1] - a[1]);
  }, [gastosItemsMes]);
  const gastosCatActiva = gastosCategorias.some(([t]) => t === gastosCat) ? gastosCat : "";

  const gastosGrupos = useMemo(() => {
    const grupos = {};
    (gastosItemsMes || [])
      .filter((g) => !gastosCatActiva || g.categoria === gastosCatActiva)
      .forEach((g) => {
        if (!grupos[g.categoria]) grupos[g.categoria] = { tipo: g.categoria, total: 0, items: [] };
        grupos[g.categoria].total += Number(g.montoARS) || 0;
        grupos[g.categoria].items.push(g);
      });
    return Object.values(grupos)
      .sort((a, b) => b.total - a.total)
      .map((gr) => ({ ...gr, items: [...gr.items].sort((a, b) => b.montoARS - a.montoARS) }));
  }, [gastosItemsMes, gastosCatActiva]);
  const gastosTotalMes = gastosGrupos.reduce((acc, gr) => acc + gr.total, 0);
  const gastosCantidadMes = gastosGrupos.reduce((acc, gr) => acc + gr.items.length, 0);

  // Evolutivo: 12 meses hacia atrás y 6 hacia adelante del mes de referencia, con la categoría
  // y el gasto individual más grande de cada mes.
  const objY = mesObjetivo.year, objM = mesObjetivo.month;
  const evolutivo = useMemo(() => {
    if (gastosHist === null) return [];
    const iniNum = objY * 12 + objM - 11, finNum = objY * 12 + objM + 6;
    return gastosHist
      .filter((m) => { const n = m.year * 12 + m.month; return n >= iniNum && n <= finNum; })
      .map((m) => {
        const porCat = {};
        m.items.forEach((g) => { porCat[g.categoria] = (porCat[g.categoria] || 0) + (Number(g.montoARS) || 0); });
        const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
        const topItem = [...m.items].sort((a, b) => b.montoARS - a.montoARS)[0] || null;
        return {
          key: m.key, label: m.label,
          total: m.items.reduce((acc, g) => acc + (Number(g.montoARS) || 0), 0),
          topCat: cats[0] || null, topItem
        };
      });
  }, [gastosHist, objY, objM]);

  useEffect(() => {
    if (!gastosCanvasRef.current || tab !== "gastos" || gastosVista !== "detalle") return;
    if (gastosChartRef.current) gastosChartRef.current.destroy();
    if (!evolutivo.length) return;
    gastosChartRef.current = new Chart(gastosCanvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: evolutivo.map((m) => m.label),
        datasets: [
          { label: "Total de gastos", data: evolutivo.map((m) => m.total), borderColor: PAL.gasto, backgroundColor: PAL.gasto, tension: 0.3, borderWidth: 3, pointRadius: 4 },
          { label: "Categoría en la que más gasté", data: evolutivo.map((m) => (m.topCat ? m.topCat[1] : 0)), borderColor: PAL.variable, backgroundColor: PAL.variable, borderDash: [6, 4], tension: 0.3, borderWidth: 3, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { usePointStyle: true, padding: 16, boxHeight: 8 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: PAL.grid }, border: { display: false }, ticks: { callback: (v) => fmt(v) } }
        }
      }
    });
  }, [evolutivo, tab, gastosVista]);

  // ---- Pestaña "Histórico": compras por fecha de compra, por categoría, más evolutivo ----
  const histRegistros = useMemo(() => {
    if (!historico) return null;
    return historico
      .filter((h) => h.gasto === "Gasto variable")
      .map((h) => {
        const [d, m, y] = String(h.fecha).split("/").map(Number);
        return { ...h, dia: d, y, m: m - 1, categoriaG: h.categoria || "Sin categorizar", total: Number(h.montoARS) || 0 }; // valor de la cuota (= total si es un solo pago)
      })
      .filter((h) => h.y);
  }, [historico]);

  const histItemsMes = useMemo(
    () => (histRegistros === null ? null : histRegistros.filter((h) => h.y === histMes.year && h.m === histMes.month)),
    [histRegistros, histMes]
  );
  const histCategorias = useMemo(() => {
    const totales = {};
    (histItemsMes || []).forEach((h) => { totales[h.categoriaG] = (totales[h.categoriaG] || 0) + h.total; });
    return Object.entries(totales).sort((a, b) => b[1] - a[1]);
  }, [histItemsMes]);
  const histCatActiva = histCategorias.some(([c]) => c === histCat) ? histCat : "";
  const histGrupos = useMemo(() => {
    const grupos = {};
    (histItemsMes || [])
      .filter((h) => !histCatActiva || h.categoriaG === histCatActiva)
      .forEach((h) => {
        if (!grupos[h.categoriaG]) grupos[h.categoriaG] = { cat: h.categoriaG, total: 0, items: [] };
        grupos[h.categoriaG].total += h.total;
        grupos[h.categoriaG].items.push(h);
      });
    return Object.values(grupos)
      .sort((a, b) => b.total - a.total)
      .map((g) => ({ ...g, items: [...g.items].sort((a, b) => b.total - a.total) }));
  }, [histItemsMes, histCatActiva]);
  const histTotalMes = histGrupos.reduce((acc, g) => acc + g.total, 0);
  const histCantidadMes = histGrupos.reduce((acc, g) => acc + g.items.length, 0);
  const histAnios = useMemo(() => {
    const anios = new Set([hoy.getFullYear()]);
    (histRegistros || []).forEach((h) => anios.add(h.y));
    return [...anios].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histRegistros]);

  // Evolutivo: lo comprado en cada mes (por fecha de compra), últimos 18 meses con movimientos.
  const histEvolutivo = useMemo(() => {
    if (!histRegistros) return [];
    const porMes = {};
    histRegistros.forEach((h) => {
      const n = h.y * 12 + h.m;
      if (!porMes[n]) porMes[n] = { y: h.y, m: h.m, items: [] };
      porMes[n].items.push(h);
    });
    return Object.keys(porMes).map(Number).sort((a, b) => a - b).slice(-18).map((n) => {
      const { y, m, items } = porMes[n];
      const porCat = {};
      items.forEach((h) => { porCat[h.categoriaG] = (porCat[h.categoriaG] || 0) + h.total; });
      const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
      const topItem = [...items].sort((a, b) => b.total - a.total)[0];
      return {
        key: `${y}-${m}`, label: `${MESES_NOMBRE[m].slice(0, 3)} ${y}`,
        total: items.reduce((acc, h) => acc + h.total, 0), topCat: cats[0] || null, topItem
      };
    });
  }, [histRegistros]);

  useEffect(() => {
    if (!histCanvasRef.current || tab !== "gastos" || gastosVista !== "historico") return;
    if (histChartRef.current) histChartRef.current.destroy();
    if (!histEvolutivo.length) return;
    histChartRef.current = new Chart(histCanvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: histEvolutivo.map((m) => m.label),
        datasets: [
          { label: "Total (valor de cuota)", data: histEvolutivo.map((m) => m.total), borderColor: PAL.gasto, backgroundColor: PAL.gasto, tension: 0.3, borderWidth: 3, pointRadius: 4 },
          { label: "Categoría en la que más gasté", data: histEvolutivo.map((m) => (m.topCat ? m.topCat[1] : 0)), borderColor: PAL.variable, backgroundColor: PAL.variable, borderDash: [6, 4], tension: 0.3, borderWidth: 3, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { usePointStyle: true, padding: 16, boxHeight: 8 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: PAL.grid }, border: { display: false }, ticks: { callback: (v) => fmt(v) } }
        }
      }
    });
  }, [histEvolutivo, tab, gastosVista]);

  // ---- Dashboard de gastos: ¿qué pasó con mi plata en el mes elegido? (solo histórico/corriente) ----
  const gastosKpis = useMemo(() => {
    if (gastosHist === null) return null;
    const idx = gastosHist.findIndex((m) => m.key === `${gastosMesFiltro.year}-${gastosMesFiltro.month}`);
    if (idx < 0) return null;
    const suma = (items) => items.reduce((acc, g) => acc + (Number(g.montoARS) || 0), 0);
    // Los fijos se repiten todos los meses, así que antes de la primera compra real no hay historia.
    const primero = Math.max(0, gastosHist.findIndex((m) => m.items.some((g) => g.detalle !== "Fijo")));
    const mo = gastosHist[idx];
    const total = suma(mo.items);
    const hayPrev = idx - 1 >= primero;
    const prevItems = hayPrev ? gastosHist[idx - 1].items : null;
    const prev = hayPrev ? suma(prevItems) : null;

    // fijo / variable (pago único) / cuotas (más de una cuota)
    const clase = (g) => (g.detalle === "Fijo" ? "fijo" : (Number(g.cuotasTotales) > 1 ? "cuotas" : "variable"));
    const porClase = (items) => {
      const r = { fijo: 0, variable: 0, cuotas: 0 };
      items.forEach((g) => { r[clase(g)] += Number(g.montoARS) || 0; });
      return r;
    };
    const cur = porClase(mo.items);
    const ant = prevItems ? porClase(prevItems) : null;

    // categorías: top 5 + Otros
    const t = {};
    mo.items.forEach((g) => { t[g.categoria] = (t[g.categoria] || 0) + (Number(g.montoARS) || 0); });
    const cats = Object.entries(t).sort((a, b) => b[1] - a[1]);
    const ranking = cats.slice(0, 5);
    const resto = cats.slice(5);
    if (resto.length) ranking.push([`Otros (${resto.length})`, resto.reduce((acc, [, v]) => acc + v, 0)]);

    const m = {};
    mo.items.forEach((g) => { m[g.medio] = (m[g.medio] || 0) + (Number(g.montoARS) || 0); });

    // evolución: hasta 6 meses terminando en el elegido
    const serie = gastosHist.slice(Math.max(primero, idx - 5), idx + 1).map((x) => ({ label: x.label, total: suma(x.items) }));
    const promedio = serie.reduce((acc, x) => acc + x.total, 0) / serie.length;
    let tendencia = null;
    if (serie.length >= 4) {
      const ult = serie.slice(-3), ant3 = serie.slice(-6, -3);
      const avg = (arr) => arr.reduce((acc, x) => acc + x.total, 0) / arr.length;
      const dif = avg(ant3) ? (avg(ult) - avg(ant3)) / avg(ant3) : 0;
      tendencia = { dif, texto: dif > 0.05 ? "en alza" : (dif < -0.05 ? "en baja" : "estable") };
    }

    const ing = (meses.find((x) => x.key === mo.key) || mesesBase.find((x) => x.key === mo.key))?.ingresos ?? null;
    const top = [...mo.items].sort((a, b) => b.montoARS - a.montoARS);
    return {
      total, prev, cur, ant, ranking, medios: Object.entries(m).sort((a, b) => b[1] - a[1]),
      serie, promedio, tendencia, ingresos: ing, top5: top.slice(0, 5), cantidad: mo.items.length
    };
  }, [gastosHist, gastosMesFiltro, meses, mesesBase]);

  useEffect(() => {
    if (!gastosDashRef.current || tab !== "gastos" || gastosVista !== "dashboard") return;
    if (gastosDashChart.current) gastosDashChart.current.destroy();
    if (!gastosKpis || !gastosKpis.serie.length) return;
    const s = gastosKpis.serie;
    gastosDashChart.current = new Chart(gastosDashRef.current.getContext("2d"), {
      type: "bar",
      data: {
        labels: s.map((x) => x.label),
        datasets: [
          { type: "bar", label: "Gasto del mes", data: s.map((x) => x.total), borderRadius: 6, barPercentage: 0.6,
            backgroundColor: s.map((_, i) => (i === s.length - 1 ? PAL.gasto : PAL.gastoSuave)) },
          { type: "line", label: "Promedio", data: s.map(() => gastosKpis.promedio), borderColor: PAL.texto, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: PAL.grid }, border: { display: false }, ticks: { callback: (v) => fmt(v) } }
        }
      }
    });
  }, [gastosKpis, tab, gastosVista]);

  // Tenencia de ahorro: cada movimiento con su acumulado en la moneda en que se ahorró, y los
  // totales en pesos y en dólares (más su equivalente con el dólar blue vigente).
  const tenencia = useMemo(() => {
    const asc = [...ahorroMovs].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const acc = { ars: 0, usd: 0 };
    const filas = [];
    for (const m of asc) {
      if (m.moneda === "USD") acc.usd += Number(m.monto) || 0;
      else acc.ars += Number(m.monto) || 0;
      filas.push({ ...m, accARS: acc.ars, accUSD: acc.usd });
    }
    const accARS = acc.ars, accUSD = acc.usd;
    const equivARS = accARS + accUSD * (dolarBlue || 0);
    const equivUSD = accUSD + (dolarBlue ? accARS / dolarBlue : 0);
    return { filas, totalARS: accARS, totalUSD: accUSD, equivARS, equivUSD };
  }, [ahorroMovs, dolarBlue]);

  useEffect(() => {
    if (!ahorroCanvasRef.current || tab !== "ahorro") return;
    const filas = tenencia.filas;
    if (ahorroChartRef.current) ahorroChartRef.current.destroy();
    if (!filas.length) return;
    const hayARS = filas.some((f) => f.moneda !== "USD");
    const hayUSD = filas.some((f) => f.moneda === "USD");
    ahorroChartRef.current = new Chart(ahorroCanvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: filas.map((f) => fechaLarga(f.fecha)),
        datasets: [
          ...(hayARS ? [{ label: "Pesos acumulados", data: filas.map((f) => f.accARS), yAxisID: "y", borderColor: PAL.gasto, backgroundColor: PAL.gasto, stepped: true, borderWidth: 3, pointRadius: 4 }] : []),
          ...(hayUSD ? [{ label: "Dólares acumulados", data: filas.map((f) => f.accUSD), yAxisID: "y2", borderColor: PAL.ahorro, backgroundColor: PAL.ahorro, stepped: true, borderWidth: 3, pointRadius: 4 }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { usePointStyle: true, padding: 16, boxHeight: 8 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === "y2" ? fmtUSD2(ctx.parsed.y) : fmt(ctx.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { display: hayARS, position: "left", grid: { color: PAL.grid }, border: { display: false }, ticks: { callback: (v) => fmt(v) } },
          y2: { display: hayUSD, position: "right", grid: { display: false }, border: { display: false }, ticks: { callback: (v) => fmtUSD2(v) } }
        }
      }
    });
  }, [tenencia, tab]);

  function irMesActualTarjeta() {
    setTarjetaMesFiltro(mesActual);
    cargarTarjetaMes(mesActual.month, mesActual.year);
  }

  function irMesTarjeta(delta) {
    const nuevo = shiftMes(tarjetaMesFiltro.month, tarjetaMesFiltro.year, delta);
    setTarjetaMesFiltro(nuevo);
    cargarTarjetaMes(nuevo.month, nuevo.year);
  }

  // mesesBase[0] es siempre el mes calendario siguiente al de hoy (mismo criterio que mesObjetivo).
  const mesActualData = mesesBase[0] || null;
  // ---- Proyección: mes de resumen = primer mes de la proyección mostrada ----
  const mesSel = meses[0] || null;
  const porCuentaMesActual = (porCuenta && mesSel)
    ? porCuenta.meses.find((m) => m.key === mesSel.key) || null
    : null;
  const estadoMes = (m) => {
    if (m.margen < 0) return { id: "deficit", texto: "Déficit" };
    if (m.piso < m.pisoConfigurado) return { id: "ajustado", texto: "Piso ajustado" };
    if (m.ahorroProyectado > 0) return { id: "ok", texto: "Piso cubierto" };
    return { id: "justo", texto: "Justo en el piso" };
  };

  const alertasProy = useMemo(() => calcAlertas(meses), [meses]);
  const alertasInicio = useMemo(() => calcAlertas(mesesBase), [mesesBase]);

  // Inicio: mes elegido dentro de la proyección base y lo que se paga de cada cuenta ese mes.
  const mesInicio = mesesBase[Math.min(inicioIdx, Math.max(mesesBase.length - 1, 0))] || null;
  const cuentasInicio = useMemo(() => {
    if (!mesInicio || !porCuenta) return [];
    const mo = porCuenta.meses.find((m) => m.key === mesInicio.key);
    if (!mo) return [];
    return Object.entries(mo.cuentas).sort((a, b) => b[1] - a[1]);
  }, [mesInicio, porCuenta]);

  const renderFijos = () => (
    <div className="table-scroll">
      <table>
        {gastosFijos.length === 0 ? (
          <tbody><tr><td className="empty-hint">No tenés gastos fijos cargados.</td></tr></tbody>
        ) : (
          <>
            <thead>
              <tr><th>Descripción</th><th>Tipo</th><th>Medio</th><th>Vigencia</th><th className="num">Monto por mes</th><th></th></tr>
            </thead>
            <tbody>
              {gastosFijos.map((g) => {
                const [estadoTxt, estadoCls] = ESTADO_FIJO[g.estado] || ESTADO_FIJO.activo;
                return (
                  <tr key={g.row}>
                    <td className="strong">{g.desc}</td>
                    <td>{g.tipo}</td>
                    <td>{g.medio}</td>
                    <td><span className={`badge ${estadoCls}`}>{estadoTxt}</span> <span className="muted">{vigenciaTexto(g)}</span></td>
                    <td className="num">{celdaEquivalencia(g.moneda, g.montoARS, g.montoUSD)}</td>
                    <td className="col-action">
                      <div className="acciones-fijo">
                        {g.estado === "activo" && <button className="btn-ghost-sm" onClick={() => vigenciaFijo(g, "pausar")}>Pausar</button>}
                        {g.estado === "pausado" && <button className="btn-ghost-sm" onClick={() => vigenciaFijo(g, "reanudar")}>Reanudar</button>}
                        {g.estado === "terminado"
                          ? <button className="btn-ghost-sm" onClick={() => vigenciaFijo(g, "reactivar")}>Reactivar</button>
                          : <button className="btn-ghost-sm" onClick={() => vigenciaFijo(g, "terminar")}>Terminar</button>}
                        <button className="btn-danger-ghost" onClick={() => eliminarFijo(g)}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </>
        )}
      </table>
    </div>
  );

  return (
    <div className="app-shell">
      <a href="#contenido" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById("contenido")?.focus(); }}>Saltar al contenido</a>

      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">$</span>
          <div className="sidebar-brand-text">
            <strong>Mis gastos</strong>
            <small>Tablero personal</small>
          </div>
        </div>

        <button className={`btn-cargar btn-cargar-side ${cargarAbierto ? "active" : ""}`} onClick={() => abrirCargar()}>
          <Icon name="plus" size={18} /> Cargar
        </button>

        <nav className="sidenav" aria-label="Secciones">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`sidelink ${tab === t.id ? "active" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => abrirTab(t.id)}
            >
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="dolar-chip">
            {dolarBlue ? <>Dólar blue <b>{fmt(dolarBlue)}</b></> : "Dólar blue no disponible"}
          </span>
          <button className="btn-salir" onClick={salir}><Icon name="logout" size={16} /> Salir</button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="mobilebar">
          <div className="brand">
            <span className="brand-icon">$</span>
            <strong>Mis gastos</strong>
          </div>
          <span className="dolar-chip">
            {dolarBlue ? <>Dólar blue <b>{fmt(dolarBlue)}</b></> : "Dólar blue no disponible"}
          </span>
          <button className="btn-icon" aria-label="Salir" onClick={salir}><Icon name="logout" size={18} /></button>
        </header>

      <main className="content" id="contenido" tabIndex={-1}>
        {loadError && (
          <div className="load-error" role="alert">
            <Icon name="alert" size={18} />
            <span>{loadError}</span>
            <button className="btn-secondary" onClick={cargarInicial} disabled={cargandoInicial}>{cargandoInicial ? "Reintentando..." : "Reintentar"}</button>
          </div>
        )}
        {tab !== "inicio" && (
          <div className="page-head">
            <div>
              <h1 className="page-title">{TABS.find((t) => t.id === tab)?.label}</h1>
              <p className="page-sub">{TABS.find((t) => t.id === tab)?.sub}</p>
            </div>
          </div>
        )}
        {tab === "inicio" && (
          <div className="stack">
            {!mesInicio ? (
              <section className="card"><Skeleton /></section>
            ) : (() => {
              const mo = mesInicio;
              const est = estadoMes(mo);
              const base = Math.max(mo.ingresos, mo.gastos, 1);
              const ancho = (v) => `${Math.max(0, Math.min(100, (v / base) * 100))}%`;
              // Solo tarjetas de crédito: transferencias y efectivo cuentan en los gastos del mes, pero no son una tarjeta.
              const tarjetasInicio = cuentasInicio.filter(([nombre]) => porTarjeta.some((g) => g.medio === nombre));
              const totalTarjetas = tarjetasInicio.reduce((acc, [, v]) => acc + v, 0);
              const mirar = [...alertasInicio.filter((a) => a.nivel !== "info"), ...alertasInicio.filter((a) => a.nivel === "info")].slice(0, 4);
              const ultimo = Math.max(mesesBase.length - 1, 0);
              const textoEstado = {
                deficit: `Los gastos superan a los ingresos por ${fmt(-mo.margen)}.`,
                ajustado: `No alcanza para el piso de ${fmt(mo.pisoConfigurado)}: el piso se ajusta a ${fmt(mo.piso)}.`,
                ok: `Es lo que queda por encima de tu piso de ${fmt(mo.pisoConfigurado)}.`,
                justo: `Queda exactamente tu piso de ${fmt(mo.pisoConfigurado)}.`
              }[est.id];
              const recientes = historico ? [...historico].sort((a, b) => b.row - a.row).slice(0, 7) : null;
              return (
                <>
                  <div className="page-head">
                    <div>
                      <h1 className="page-title">{MESES_NOMBRE[mo.month]} {mo.year}</h1>
                      <p className="page-sub">Cómo viene el mes, de un vistazo.</p>
                    </div>
                    <div className="month-nav">
                      <button className="btn-icon" aria-label="Mes anterior" disabled={inicioIdx <= 0} onClick={() => setInicioIdx(Math.max(0, inicioIdx - 1))}>‹</button>
                      <span className="month-nav-label">{mo.label}</span>
                      <button className="btn-icon" aria-label="Mes siguiente" disabled={inicioIdx >= ultimo} onClick={() => setInicioIdx(Math.min(ultimo, inicioIdx + 1))}>›</button>
                    </div>
                  </div>

                  <div className="home-grid">
                    <div className="home-main">
                      <section className={`hero-card hero-${est.id}`} aria-labelledby="hero-titulo">
                        <div className="hero-top">
                          <span className="hero-label" id="hero-titulo">Ahorro proyectado</span>
                          <span className="estado-chip">{est.texto}</span>
                        </div>
                        <div className="hero-value">{fmt(mo.ahorroProyectado)}</div>
                        <p className="hero-sub">{textoEstado}</p>

                        <div className="flow-bar on-hero" role="img" aria-label={`De ${fmt(mo.ingresos)} de ingresos: gastos ${fmt(mo.gastos)}, piso ${fmt(mo.piso)}, ahorro ${fmt(mo.ahorroProyectado)}`}>
                          <span className="f-gasto" style={{ width: ancho(Math.min(mo.gastos, base)) }}></span>
                          <span className="f-libre" style={{ width: ancho(mo.piso) }}></span>
                          <span className="f-ahorro" style={{ width: ancho(mo.ahorroProyectado) }}></span>
                        </div>
                        <div className="flow-legend on-hero">
                          <span><i className="f-gasto"></i>Gastos</span>
                          <span><i className="f-libre"></i>Piso</span>
                          <span><i className="f-ahorro"></i>Ahorro</span>
                        </div>

                        <div className="hero-stats">
                          <div>
                            <span className="hero-stat-label">Ingresos</span>
                            <strong>{fmt(mo.ingresos)}</strong>
                            <small>
                              {mo.aguinaldo > 0 || mo.ingresoExtra > 0
                                ? [mo.aguinaldo > 0 ? `aguinaldo ${fmt(mo.aguinaldo)}` : "", mo.ingresoExtra > 0 ? `extra ${fmt(mo.ingresoExtra)}` : ""].filter(Boolean).join(" · ")
                                : "Lo que entra"}
                            </small>
                          </div>
                          <button className="hero-stat-link" onClick={() => { setGastosMesFiltro({ month: mo.month, year: mo.year }); setGastosVista("detalle"); abrirTab("gastos"); }}>
                            <span className="hero-stat-label">Gastos</span>
                            <strong>{fmt(mo.gastos)}</strong>
                            <small>Fijos {fmt(mo.gastoFijo)} · Cuotas {fmt(mo.gastoVariable)}</small>
                          </button>
                          <div>
                            <span className="hero-stat-label">Piso</span>
                            <strong>{fmt(mo.piso)}</strong>
                            <small>{mo.piso < mo.pisoConfigurado ? `Ajustado (config. ${fmt(mo.pisoConfigurado)})` : "Siempre disponible"}</small>
                          </div>
                        </div>
                      </section>

                      <div className="quick-actions" role="group" aria-label="Acciones rápidas">
                        <button onClick={() => abrirCargar("Gasto variable")}>
                          <span className="qa-icon qa-out"><Icon name="arrow-up-right" size={20} /></span>Cargar gasto
                        </button>
                        <button onClick={() => abrirCargar("Ingreso extra")}>
                          <span className="qa-icon qa-in"><Icon name="arrow-down-left" size={20} /></span>Cargar ingreso
                        </button>
                        <button onClick={() => abrirTab("tarjetas")}>
                          <span className="qa-icon"><Icon name="card" size={20} /></span>Tarjetas
                        </button>
                        <button onClick={() => abrirTab("proyeccion")}>
                          <span className="qa-icon"><Icon name="chart" size={20} /></span>Proyección
                        </button>
                      </div>

                      <section className="card">
                        <div className="card-head-row">
                          <h2>Últimos movimientos</h2>
                          <button className="section-link" onClick={() => abrirTab("gastos")}>Ver gastos →</button>
                        </div>
                        {recientes === null ? (
                          <Skeleton />
                        ) : recientes.length === 0 ? (
                          <div className="empty-hint">Todavía no cargaste movimientos. Tocá “Cargar” para empezar.</div>
                        ) : recientes.map((h) => {
                          const esIngreso = h.gasto === "Ingreso extra";
                          const esFijo = h.gasto === "Gasto fijo";
                          return (
                            <div className="tx-row" key={h.row}>
                              <span className={`tx-icon ${esIngreso ? "in" : "out"}`}>
                                <Icon name={esIngreso ? "arrow-down-left" : (esFijo ? "calendar" : "arrow-up-right")} size={18} />
                              </span>
                              <div className="tx-main">
                                <span className="tx-title">{h.desc}</span>
                                <span className="tx-sub">{[h.fecha, h.categoria, h.medio].filter(Boolean).join(" · ")}</span>
                              </div>
                              <div className="tx-side">
                                <span className={`tx-monto ${esIngreso ? "in" : "out"}`}>{esIngreso ? "+" : "−"} {celdaEquivalencia(h.moneda, h.montoARS, h.montoUSD)}</span>
                                <span className="tx-tag">{esIngreso ? "Ingreso" : (esFijo ? "Fijo mensual" : (Number(h.cuotas) > 1 ? `${h.cuotas} cuotas` : "Un pago"))}</span>
                              </div>
                            </div>
                          );
                        })}
                      </section>
                    </div>

                    <aside className="home-aside">
                      <section className="card">
                        <div className="card-head-row">
                          <h2>Tarjetas de {MESES_NOMBRE[mo.month].toLowerCase()}</h2>
                          <button className="section-link" onClick={() => abrirTab("tarjetas")}>Ver todas →</button>
                        </div>
                        {historico === null ? (
                          <Skeleton />
                        ) : tarjetasInicio.length === 0 ? (
                          <div className="empty-hint">No hay gastos con tarjeta este mes.</div>
                        ) : (
                          <>
                            <div className="mini-cards">
                              {tarjetasInicio.map(([nombre, monto]) => {
                                const bancoCierre = Object.keys(cierreDias).find((b) => nombre.includes(b));
                                const cierre = bancoCierre ? proximoCierre(cierreDias[bancoCierre], hoy) : null;
                                const textoCierre = cierre
                                  ? (cierre.dias === 0 ? "Cierra hoy" : cierre.dias === 1 ? "Cierra mañana" : `Cierra en ${cierre.dias} días`)
                                  : "Sin día de cierre";
                                return (
                                  <button key={nombre} className={`mini-card ${cardTheme(nombre)}`} onClick={() => irATarjeta(nombre)}>
                                    <span className="mini-card-name">{nombre}</span>
                                    <span className="mini-card-amount">{fmt(monto)}</span>
                                    <span className="mini-card-foot">
                                      <span>{totalTarjetas ? Math.round((monto / totalTarjetas) * 100) : 0}% de tarjetas</span>
                                      <span>{textoCierre}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="cuenta-total"><span>Total en tarjetas</span><strong>{fmt(totalTarjetas)}</strong></div>
                          </>
                        )}
                      </section>

                      {mirar.length > 0 && (
                        <section className="card">
                          <div className="card-head-row">
                            <h2>Para tener en cuenta</h2>
                            <button className="section-link" onClick={() => { setProyVista("proyeccion"); abrirTab("proyeccion"); }}>Proyección →</button>
                          </div>
                          {mirar.map((a, i) => (
                            <div className={`alerta-row alerta-${a.nivel}`} key={i}>
                              <span className="alerta-icon"><Icon name={a.nivel === "ok" ? "check-circle" : (a.nivel === "info" ? "info" : "alert")} size={16} /></span>
                              <div><strong>{a.mes}</strong> — {a.texto}</div>
                            </div>
                          ))}
                        </section>
                      )}
                    </aside>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {tab === "proyeccion" && (
          <div className="stack">
            <Segmented value={proyVista} onChange={setProyVista} options={[{ value: "proyeccion", label: "Proyección" }, { value: "sueldo", label: "Sueldo" }]} />
            {proyVista === "proyeccion" && (
              <>
            <section className="card">
              <div className="card-head-row" style={{ marginBottom: 0 }}>
                <div>
                  <h2>Proyección financiera</h2>
                  <p className="hint" style={{ margin: "4px 0 0" }}>
                    Si sigo con mis ingresos y compromisos actuales, así voy a estar los próximos meses.
                  </p>
                </div>
                <div className="filtro-inline">
                  <button className="btn-icon" aria-label="Mes anterior" onClick={() => { const n = shiftMes(filtroMes, filtroAnio, -1); setFiltroMes(n.month); setFiltroAnio(n.year); verPeriodo(n.month, n.year); }}>‹</button>
                  <select value={filtroMes} onChange={(e) => { setFiltroMes(Number(e.target.value)); verPeriodo(Number(e.target.value), filtroAnio); }}>
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={filtroAnio} onChange={(e) => { setFiltroAnio(Number(e.target.value)); verPeriodo(filtroMes, Number(e.target.value)); }}>
                    {Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - 2 + i).map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <button className="btn-icon" aria-label="Mes siguiente" onClick={() => { const n = shiftMes(filtroMes, filtroAnio, 1); setFiltroMes(n.month); setFiltroAnio(n.year); verPeriodo(n.month, n.year); }}>›</button>
                  <button className="btn-ghost" onClick={verHoy}>Hoy</button>
                </div>
              </div>
            </section>

            {mesSel && (() => {
              const est = estadoMes(mesSel);
              const base = Math.max(mesSel.ingresos, mesSel.gastos, 1);
              return (
                <section className="card">
                  <div className="card-head-row">
                    <h2>{MESES_NOMBRE[mesSel.month]} {mesSel.year}</h2>
                    <span className={`estado-chip estado-${est.id}`}>{est.texto}</span>
                  </div>
                  <div className="ahorro-hero">
                    <div className="stat-tile-label">Ahorro proyectado</div>
                    <div className="ahorro-hero-value">{fmt(mesSel.ahorroProyectado)}</div>
                    <div className="stat-tile-sub">
                      {est.id === "deficit" && `Los gastos superan a los ingresos por ${fmt(-mesSel.margen)}.`}
                      {est.id === "ajustado" && `No alcanza para el piso de ${fmt(mesSel.pisoConfigurado)}: el piso se ajusta a ${fmt(mesSel.piso)}.`}
                      {est.id === "ok" && `Es lo que queda por encima de tu piso de ${fmt(mesSel.pisoConfigurado)}.`}
                      {est.id === "justo" && `Queda exactamente tu piso de ${fmt(mesSel.pisoConfigurado)}.`}
                    </div>
                  </div>

                  <div className="flow-bar">
                    <span style={{ width: `${(Math.min(mesSel.gastos, base) / base) * 100}%`, background: PAL.gasto }}></span>
                    <span style={{ width: `${(mesSel.piso / base) * 100}%`, background: PAL.piso }}></span>
                    <span style={{ width: `${(mesSel.ahorroProyectado / base) * 100}%`, background: PAL.ahorro }}></span>
                  </div>
                  <div className="flow-legend">
                    <span><i style={{ background: PAL.gasto }}></i>Gastos</span>
                    <span><i style={{ background: PAL.piso }}></i>Piso</span>
                    <span><i style={{ background: PAL.ahorro }}></i>Ahorro</span>
                  </div>

                  <div className="proy-stats">
                    <div><div className="stat-tile-label">Ingresos</div><div className="proy-stat-value pos">{fmt(mesSel.ingresos)}</div>
                      {(mesSel.aguinaldo > 0 || mesSel.ingresoExtra > 0) && (
                        <div className="subnote">
                          {mesSel.aguinaldo > 0 ? `incl. aguinaldo ${fmt(mesSel.aguinaldo)}` : ""} {mesSel.ingresoExtra > 0 ? `incl. extra ${fmt(mesSel.ingresoExtra)}` : ""}
                        </div>
                      )}
                    </div>
                    <div><div className="stat-tile-label">Gastos proyectados</div><div className="proy-stat-value neg">{fmt(mesSel.gastos)}</div></div>
                    <div><div className="stat-tile-label">Piso</div><div className="proy-stat-value">{fmt(mesSel.piso)}</div>
                      {mesSel.piso < mesSel.pisoConfigurado && <div className="subnote">config. {fmt(mesSel.pisoConfigurado)}</div>}
                    </div>
                    <div><div className="stat-tile-label">Margen</div><div className={`proy-stat-value ${mesSel.margen < 0 ? "neg" : ""}`}>{fmt(mesSel.margen)}</div>
                      <div className="subnote">ingresos − gastos</div>
                    </div>
                  </div>

                  <div className="porque">
                    <span className="muted">Por qué ese gasto:</span>{" "}
                    Fijos <strong>{fmt(mesSel.gastoFijo)}</strong> ({mesSel.gastos ? Math.round((mesSel.gastoFijo / mesSel.gastos) * 100) : 0}%)
                    {" · "}Cuotas y compras <strong>{fmt(mesSel.gastoVariable)}</strong> ({mesSel.gastos ? Math.round((mesSel.gastoVariable / mesSel.gastos) * 100) : 0}%)
                  </div>
                  {porCuentaMesActual && Object.keys(porCuentaMesActual.cuentas).length > 0 && (
                    <div className="porque muted" style={{ fontSize: 12 }}>
                      Por cuenta: {Object.entries(porCuentaMesActual.cuentas).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${fmt(v)}`).join(" · ")}
                    </div>
                  )}
                  <button className="section-link" style={{ marginTop: 12 }} onClick={() => { setGastosMesFiltro({ month: mesSel.month, year: mesSel.year }); abrirTab("gastos"); }}>
                    Ver detalle de gastos →
                  </button>
                </section>
              );
            })()}

            <section className="card">
              <div className="card-head"><h2>Evolución de los próximos meses</h2></div>
              <div className="chart-box"><canvas ref={canvasRef}></canvas></div>
            </section>

            {alertasProy.length > 0 && (
              <section className="card">
                <div className="card-head"><h2>Meses a mirar</h2></div>
                {alertasProy.slice(0, 8).map((a, i) => (
                  <div className={`alerta-row alerta-${a.nivel}`} key={i}>
                    <span className="alerta-icon"><Icon name={a.nivel === "ok" ? "check-circle" : (a.nivel === "info" ? "info" : "alert")} size={16} /></span>
                    <div><strong>{a.mes}</strong> — {a.texto}</div>
                  </div>
                ))}
                {alertasProy.length > 8 && <p className="hint" style={{ margin: "8px 0 0" }}>y {alertasProy.length - 8} más en la tabla de abajo.</p>}
              </section>
            )}

            <section className="card">
              <div className="card-head"><h2>Situación mes a mes</h2></div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Mes</th><th className="num">Ingresos</th><th className="num">Gastos</th>
                      <th className="num">Piso</th><th className="num">Margen</th><th className="num">Ahorro proyectado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meses.map((mo) => {
                      const est = estadoMes(mo);
                      return (
                        <tr key={mo.key} className={est.id === "deficit" ? "row-deficit" : (est.id === "ajustado" ? "row-ajustado" : "")}>
                          <td className="strong">{mo.label}</td>
                          <td className="num pos">
                            {fmt(mo.ingresos)}
                            {mo.aguinaldo > 0 && <div className="subnote">incl. aguinaldo {fmt(mo.aguinaldo)}</div>}
                            {mo.ingresoExtra > 0 && <div className="subnote">incl. extra {fmt(mo.ingresoExtra)}</div>}
                          </td>
                          <td className="num neg">{fmt(mo.gastos)}</td>
                          <td className="num muted">
                            {fmt(mo.piso)}
                            {mo.piso < mo.pisoConfigurado && <div className="subnote">ajustado (config. {fmt(mo.pisoConfigurado)})</div>}
                          </td>
                          <td className={`num ${mo.margen < 0 ? "neg" : "muted"}`}>{fmt(mo.margen)}</td>
                          <td className={`num ahorro-cell ${mo.ahorroProyectado > 0 ? "pos" : "muted"}`}>{fmt(mo.ahorroProyectado)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card config-card">
              <div className="card-head-row" style={{ marginBottom: 6 }}>
                <h2>⚙ Piso de ahorro</h2>
              </div>
              <p className="hint" style={{ margin: "0 0 12px" }}>
                El monto mínimo que quiero conservar disponible. El ahorro proyectado es lo que queda de
                ingresos − gastos después de reservar este piso; si no alcanza, el piso se ajusta a lo que hay.
              </p>
              <div className="field-row">
                <div className="field">
                  <label>Piso disponible (siempre libre)</label>
                  <input type="number" placeholder="400000" value={cfgPiso} onChange={(e) => setCfgPiso(e.target.value)} />
                </div>
                <div className="field field-action">
                  <button className="btn-primary" onClick={guardarConfig}>Guardar</button>
                </div>
              </div>
              {cfgStatus && <StatusMsg texto={cfgStatus} />}
            </section>
              </>
            )}
            {proyVista === "sueldo" && (
              <>
            <section className="card">
              <div className="card-head">
                <h2>Evolución del sueldo</h2>
              </div>
              <p className="hint" style={{ margin: "0 0 16px" }}>
                Cargá desde qué mes rige cada sueldo — por ejemplo, &ldquo;desde septiembre $X&rdquo; y &ldquo;desde
                diciembre $Y&rdquo; para un aumento ya sabido. El tablero usa el tramo vigente en cada mes de la
                proyección, y el aguinaldo (medio sueldo) se suma solo en junio y diciembre.
              </p>

              {sueldoSchedule.length > 0 && (
                <div className="table-scroll" style={{ marginBottom: 16 }}>
                  <table>
                    <thead>
                      <tr><th>Vigente desde</th><th className="num">Sueldo</th><th></th></tr>
                    </thead>
                    <tbody>
                      {sueldoSchedule.map((t) => (
                        <tr key={t.key}>
                          <td className="strong">{labelTramo(t.key)}</td>
                          <td className="num">{fmt(t.monto)}</td>
                          <td className="col-action">
                            <button className="btn-danger-ghost" onClick={() => eliminarTramoSueldo(t.key)}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label>Vigente desde (mes)</label>
                  <select value={sueldoForm.month} onChange={(e) => setSueldoForm({ ...sueldoForm, month: Number(e.target.value) })}>
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Año</label>
                  <input type="number" value={sueldoForm.year} onChange={(e) => setSueldoForm({ ...sueldoForm, year: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Monto del sueldo</label>
                  <input type="number" placeholder="0" value={sueldoForm.monto} onChange={(e) => setSueldoForm({ ...sueldoForm, monto: e.target.value })} />
                </div>
                <div className="field field-action">
                  <button className="btn-primary" onClick={agregarTramoSueldo}>Agregar tramo</button>
                </div>
              </div>
              {sueldoStatus && <StatusMsg texto={sueldoStatus} />}
            </section>
              </>
            )}
          </div>
        )}

        {tab === "gastos" && (
          <div className="stack">
            <Segmented
              value={gastosVista}
              onChange={setGastosVista}
              options={[{ value: "detalle", label: "Detalle" }, { value: "dashboard", label: "Dashboard" }, { value: "historico", label: "Compras" }, { value: "fijos", label: "Fijos" }]}
            />
            {(gastosVista === "detalle" || gastosVista === "dashboard") && (
            <section className="card">
              <div className="card-head-row" style={{ marginBottom: 0 }}>
                <h2>Gastos de {MESES_NOMBRE[gastosMesFiltro.month].toLowerCase()} {gastosMesFiltro.year}</h2>
                <div className="filtro-inline">
                  <button className="btn-icon" aria-label="Mes anterior" onClick={() => { const n = shiftMes(gastosMesFiltro.month, gastosMesFiltro.year, -1); elegirMesGastos(n.month, n.year); }}>‹</button>
                  <select value={gastosMesFiltro.month} onChange={(e) => elegirMesGastos(Number(e.target.value), gastosMesFiltro.year)}>
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={gastosMesFiltro.year} onChange={(e) => elegirMesGastos(gastosMesFiltro.month, Number(e.target.value))}>
                    {Array.from(
                      { length: shiftMes(gastosVentanaInicio.month, gastosVentanaInicio.year, 35).year - gastosVentanaInicio.year + 1 },
                      (_, i) => gastosVentanaInicio.year + i
                    ).map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <button className="btn-icon" aria-label="Mes siguiente" onClick={() => { const n = shiftMes(gastosMesFiltro.month, gastosMesFiltro.year, 1); elegirMesGastos(n.month, n.year); }}>›</button>
                  <button className="btn-ghost" onClick={() => elegirMesGastos(mesObjetivo.month, mesObjetivo.year)}>Hoy</button>
                </div>
              </div>
            </section>
            )}

            {gastosVista === "historico" ? (
              <>
            <section className="card">
              <div className="card-head-row">
                <h2>Compras de {MESES_NOMBRE[histMes.month].toLowerCase()} {histMes.year}</h2>
                <div className="filtro-inline">
                  <button className="btn-icon" aria-label="Mes anterior" onClick={() => setHistMes(shiftMes(histMes.month, histMes.year, -1))}>‹</button>
                  <select value={histMes.month} onChange={(e) => setHistMes({ ...histMes, month: Number(e.target.value) })}>
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={histMes.year} onChange={(e) => setHistMes({ ...histMes, year: Number(e.target.value) })}>
                    {histAnios.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <button className="btn-icon" aria-label="Mes siguiente" onClick={() => setHistMes(shiftMes(histMes.month, histMes.year, 1))}>›</button>
                  <button className="btn-ghost" onClick={() => setHistMes({ month: hoy.getMonth(), year: hoy.getFullYear() })}>Hoy</button>
                </div>
              </div>

              {histItemsMes === null ? (
                <Skeleton />
              ) : histCategorias.length === 0 ? (
                <div className="empty-hint">No hay compras cargadas en ese mes.</div>
              ) : (
                <>
                  <div className="chips">
                    <button className={`chip ${histCatActiva === "" ? "active" : ""}`} onClick={() => setHistCat("")}>Todas</button>
                    {histCategorias.map(([cat, total]) => (
                      <button key={cat} className={`chip ${histCatActiva === cat ? "active" : ""}`} onClick={() => setHistCat(cat)}>
                        {cat} · {fmt(total)}
                      </button>
                    ))}
                  </div>
                  <p className="hint" style={{ margin: "0 0 8px" }}>
                    {histCantidadMes} compras · total <span className="strong">{fmt(histTotalMes)}</span>
                  </p>

                  {histGrupos.map((g) => (
                    <div className="cat-block" key={g.cat}>
                      <div className="cat-head">
                        <span className="cat-name">{g.cat}</span>
                        <span className="cat-total">{fmt(g.total)}</span>
                      </div>
                      <div className="cat-bar"><span style={{ width: `${histTotalMes ? (g.total / histTotalMes) * 100 : 0}%` }}></span></div>
                      {g.items.map((h) => (
                        <div className="cat-item" key={h.row}>
                          <div className="cat-item-left">
                            <span className="cat-item-medio">{String(h.dia).padStart(2, "0")}/{String(h.m + 1).padStart(2, "0")}</span>
                            <span className="strong">{h.desc}</span>
                            <span className="cat-item-medio">{h.medio}</span>
                            {Number(h.cuotas) > 1 && <span className="badge badge-info">{h.cuotas} cuotas · total {fmt(h.totalARS)}</span>}
                            {h.mesPago && <span className="badge badge-fijo">Se paga en {labelTramo(h.mesPago)}{h.ultimoMesPago && h.ultimoMesPago !== h.mesPago ? ` → ${labelTramo(h.ultimoMesPago)}` : ""}</span>}
                          </div>
                          <div className="cat-item-monto">{celdaEquivalencia(h.moneda, h.montoARS, h.montoUSD)}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Evolutivo de compras (valor de cuota)</h2>
              </div>
              {histEvolutivo.length === 0 ? (
                <Skeleton />
              ) : (
                <>
                  <div className="chart-box"><canvas ref={histCanvasRef}></canvas></div>
                  <div className="subsection-title">En qué más gasté cada mes</div>
                  <div className="top-mes-grid">
                    {histEvolutivo.map((m) => (
                      <div className="top-mes" key={m.key}>
                        <div className="top-mes-label">{m.label}</div>
                        <div className="top-mes-cat">{m.topCat ? `${m.topCat[0]} · ${fmt(m.topCat[1])}` : "—"}</div>
                        <div className="top-mes-sub">{m.topItem ? `Mayor compra: ${m.topItem.desc} (${fmt(m.topItem.total)})` : "Sin compras"}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
              </>
            ) : gastosVista === "fijos" ? (
              <section className="card">
                <div className="card-head"><h2>Gastos fijos</h2></div>
                {renderFijos()}
              </section>
            ) : gastosVista === "dashboard" ? (
              gastosKpis === null ? (
                <section className="card"><Skeleton /></section>
              ) : (
                <>
                  <section className="card">
                    <div className="hero-kpi">
                      <div>
                        <div className="stat-tile-label">Total del mes</div>
                        <div className="hero-kpi-value">{fmt(gastosKpis.total)}</div>
                        <div className="stat-tile-sub">
                          {gastosKpis.prev === null ? `${gastosKpis.cantidad} gastos` : (
                            <span className={claseVariacion(gastosKpis.total - gastosKpis.prev, "gasto")}>
                              {gastosKpis.total > gastosKpis.prev ? "↑" : "↓"} {fmt(Math.abs(gastosKpis.total - gastosKpis.prev))}
                              {gastosKpis.prev ? ` (${gastosKpis.total > gastosKpis.prev ? "+" : "-"}${Math.round(Math.abs(gastosKpis.total - gastosKpis.prev) / gastosKpis.prev * 100)}%)` : ""} vs mes anterior
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="hero-kpi-side">
                        <div><span className="muted">Gastos fijos</span> <strong>{fmt(gastosKpis.cur.fijo)}</strong></div>
                        <div><span className="muted">Compras en cuotas</span> <strong>{fmt(gastosKpis.cur.cuotas)}</strong></div>
                        <div>
                          <span className="muted">Ingresos usados</span>{" "}
                          <strong>{gastosKpis.ingresos ? `${Math.round((gastosKpis.total / gastosKpis.ingresos) * 100)}%` : "—"}</strong>
                        </div>
                        <div>
                          <span className="muted">Promedio {gastosKpis.serie.length} meses</span> <strong>{fmt(gastosKpis.promedio)}</strong>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="card">
                    <div className="card-head"><h2>En qué gasté</h2></div>
                    {gastosKpis.ranking.length === 0 ? (
                      <div className="empty-hint">Sin gastos en el mes.</div>
                    ) : gastosKpis.ranking.map(([cat, monto]) => (
                      <div className="rank-row" key={cat}>
                        <span className="rank-name">{cat}</span>
                        <div className="rank-bar"><span style={{ width: `${gastosKpis.total ? (monto / gastosKpis.total) * 100 : 0}%` }}></span></div>
                        <span className="rank-monto">{fmt(monto)}</span>
                        <span className="rank-pct">{gastosKpis.total ? Math.round((monto / gastosKpis.total) * 100) : 0}%</span>
                      </div>
                    ))}
                  </section>

                  <section className="card">
                    <div className="card-head"><h2>Composición del gasto</h2></div>
                    <div className="comp-bar">
                      {[["fijo", PAL.gasto], ["variable", PAL.variable], ["cuotas", PAL.cuota]].map(([k, color]) => (
                        <span key={k} style={{ width: `${gastosKpis.total ? (gastosKpis.cur[k] / gastosKpis.total) * 100 : 0}%`, background: color }}></span>
                      ))}
                    </div>
                    {[["fijo", "Gastos fijos", PAL.gasto], ["variable", "Gastos variables (pago único)", PAL.variable], ["cuotas", "Compras en cuotas", PAL.cuota]].map(([k, nombre, color]) => (
                      <div className="comp-row" key={k}>
                        <span className="comp-dot" style={{ background: color }}></span>
                        <span className="comp-name">{nombre}</span>
                        <span className="rank-monto">{fmt(gastosKpis.cur[k])}</span>
                        <span className="rank-pct">{gastosKpis.total ? Math.round((gastosKpis.cur[k] / gastosKpis.total) * 100) : 0}%</span>
                        <span className="comp-delta">
                          {gastosKpis.ant === null ? "" : (
                            <span className={claseVariacion(gastosKpis.cur[k] - gastosKpis.ant[k], "gasto")}>
                              {gastosKpis.cur[k] === gastosKpis.ant[k] ? "= igual" : `${gastosKpis.cur[k] > gastosKpis.ant[k] ? "↑" : "↓"} ${fmt(Math.abs(gastosKpis.cur[k] - gastosKpis.ant[k]))}`}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </section>

                  <section className="card">
                    <div className="card-head-row">
                      <h2>Evolución de gastos</h2>
                      {gastosKpis.tendencia && (
                        <span className={`badge ${gastosKpis.tendencia.texto === "en alza" ? "badge-info" : "badge-neutral"}`}>
                          Tendencia {gastosKpis.tendencia.texto} ({gastosKpis.tendencia.dif > 0 ? "+" : ""}{Math.round(gastosKpis.tendencia.dif * 100)}%)
                        </span>
                      )}
                    </div>
                    <div className="chart-box" style={{ height: 240, marginBottom: 8 }}><canvas ref={gastosDashRef}></canvas></div>
                    <p className="hint" style={{ margin: 0 }}>
                      Línea punteada: promedio de {gastosKpis.serie.length} meses ({fmt(gastosKpis.promedio)}).
                      {gastosKpis.tendencia ? " Tendencia: últimos 3 meses contra los 3 anteriores." : ""}
                    </p>
                  </section>

                  <section className="card">
                    <div className="card-head"><h2>Los 5 gastos más grandes del mes</h2></div>
                    {gastosKpis.top5.map((g, i) => (
                      <div className="top-gasto" key={i}>
                        <div>
                          <div className="strong">{g.desc}</div>
                          <div className="cat-item-medio">{g.categoria} · {g.medio}</div>
                          {g.detalle === "Fijo"
                            ? <span className="badge badge-neutral">Fijo</span>
                            : Number(g.cuotasTotales) > 1 && <span className="badge badge-info">{g.cuotaNumero}/{g.cuotasTotales} cuotas</span>}
                        </div>
                        <div className="cat-item-monto strong">{fmt(g.montoARS)}</div>
                      </div>
                    ))}
                  </section>

                  <section className="card compact-card">
                    <div className="subsection-title" style={{ margin: "0 0 8px" }}>Medios de pago</div>
                    {gastosKpis.medios.map(([medio, monto]) => (
                      <div className="medio-row" key={medio}>
                        <span>{medio}</span>
                        <span>{fmt(monto)} <span className="muted">· {gastosKpis.total ? Math.round((monto / gastosKpis.total) * 100) : 0}%</span></span>
                      </div>
                    ))}
                  </section>
                </>
              )
            ) : (
              <>
                <section className="card">
                  {gastosItemsMes === null ? (
                    <Skeleton />
                  ) : gastosCategorias.length === 0 ? (
                    <div className="empty-hint">No hay gastos en ese mes.</div>
                  ) : (
                    <>
                      <div className="chips">
                        <button className={`chip ${gastosCatActiva === "" ? "active" : ""}`} onClick={() => setGastosCat("")}>Todas</button>
                        {gastosCategorias.map(([tipo, total]) => (
                          <button key={tipo} className={`chip ${gastosCatActiva === tipo ? "active" : ""}`} onClick={() => setGastosCat(tipo)}>
                            {tipo} · {fmt(total)}
                          </button>
                        ))}
                      </div>
                      <p className="hint" style={{ margin: "0 0 8px" }}>
                        {gastosCantidadMes} gastos · total <span className="strong">{fmt(gastosTotalMes)}</span>
                      </p>

                      {gastosGrupos.map((gr) => (
                        <div className="cat-block" key={gr.tipo}>
                          <div className="cat-head">
                            <span className="cat-name">{gr.tipo}</span>
                            <span className="cat-total">{fmt(gr.total)}</span>
                          </div>
                          <div className="cat-bar"><span style={{ width: `${gastosTotalMes ? (gr.total / gastosTotalMes) * 100 : 0}%` }}></span></div>
                          {gr.items.map((g, i) => (
                            <div className="cat-item" key={`${gr.tipo}-${i}`}>
                              <div className="cat-item-left">
                                <span className="strong">{g.desc}</span>
                                <span className="cat-item-medio">{g.medio}</span>
                                <span className={`badge ${g.detalle === "Fijo" ? "badge-neutral" : "badge-info"}`}>{g.detalle}</span>
                              </div>
                              <div className="cat-item-monto">{celdaEquivalencia(g.moneda, g.montoARS, g.montoUSD)}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </>
                  )}
                </section>

                <section className="card">
                  <div className="card-head">
                    <h2>Evolutivo de gastos</h2>
                  </div>
                  {evolutivo.length === 0 ? (
                    <Skeleton />
                  ) : (
                    <>
                      <div className="chart-box"><canvas ref={gastosCanvasRef}></canvas></div>
                      <div className="subsection-title">En qué más gasté cada mes</div>
                      <div className="top-mes-grid">
                        {evolutivo.map((m) => (
                          <div className="top-mes" key={m.key}>
                            <div className="top-mes-label">{m.label}</div>
                            <div className="top-mes-cat">{m.topCat ? `${m.topCat[0]} · ${fmt(m.topCat[1])}` : "—"}</div>
                            <div className="top-mes-sub">
                              {m.topItem ? `Mayor gasto: ${m.topItem.desc} (${fmt(m.topItem.montoARS)})` : "Sin gastos"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {tab === "ahorro" && (
          <div className="stack">
            <div className="two-col">
              <section className="card">
                <div className="stat-tile-label">Ahorrado en pesos</div>
                <div className="stat-tile-value">{fmt(tenencia.totalARS)}</div>
                <div className="stat-tile-sub">≈ {fmtUSD2(dolarBlue ? tenencia.totalARS / dolarBlue : 0)} al dólar blue</div>
              </section>
              <section className="card">
                <div className="stat-tile-label">Ahorrado en dólares</div>
                <div className="stat-tile-value">{fmtUSD2(tenencia.totalUSD)}</div>
                <div className="stat-tile-sub">≈ {fmt(tenencia.totalUSD * (dolarBlue || 0))} al dólar blue</div>
              </section>
            </div>

            <section className="card">
              <div className="card-head-row">
                <h2>Tenencia total</h2>
                <div className="tarjeta-totales">
                  <span className="badge badge-total">{fmt(tenencia.equivARS)}</span>
                  <span className="badge badge-neutral">≈ {fmtUSD2(tenencia.equivUSD)}</span>
                </div>
              </div>
              {tenencia.filas.length === 0 ? (
                <div className="empty-hint">Todavía no cargaste ahorros. Agregá el primero abajo.</div>
              ) : (
                <div className="chart-box"><canvas ref={ahorroCanvasRef}></canvas></div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Movimientos</h2>
              </div>
              {tenencia.filas.length > 0 && (
                <div className="mov-list">
                  {[...tenencia.filas].reverse().map((f) => (
                    <div className="mov-row" key={f.id}>
                      <div className="mov-fecha">{fechaLarga(f.fecha)}</div>
                      <div className="mov-monto pos">
                        + {f.moneda === "USD" ? fmtUSD2(f.monto) : fmt(f.monto)}
                      </div>
                      <div className="mov-acum">
                        <span className="muted">Acumulado</span>{" "}
                        {f.moneda === "USD" ? fmtUSD2(f.accUSD) : fmt(f.accARS)}
                      </div>
                      <button className="btn-danger-ghost" onClick={() => eliminarAhorro(f.id)}>Eliminar</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="pago-fields" style={{ marginTop: 16 }}>
                <div className="field-row">
                  <div className="field">
                    <label>Fecha</label>
                    <input type="date" value={ahorroForm.fecha} onChange={(e) => setAhorroForm({ ...ahorroForm, fecha: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Moneda</label>
                    <select value={ahorroForm.moneda} onChange={(e) => setAhorroForm({ ...ahorroForm, moneda: e.target.value })}>
                      <option value="ARS">Pesos (ARS)</option>
                      <option value="USD">Dólares (USD)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Monto ahorrado</label>
                    <input type="number" placeholder="0" value={ahorroForm.monto} onChange={(e) => setAhorroForm({ ...ahorroForm, monto: e.target.value })} />
                  </div>
                  <div className="field field-action">
                    <button className="btn-primary" onClick={guardarAhorro}>Agregar</button>
                  </div>
                </div>
              </div>
              {ahorroStatus && <StatusMsg texto={ahorroStatus} />}
            </section>
          </div>
        )}

        {tab === "tarjetas" && (
          <div className="stack">
            <Segmented value={tarjetasVista} onChange={setTarjetasVista} options={[{ value: "tarjeta", label: "Por tarjeta" }, { value: "cuotas", label: "Cuotas del mes" }]} />
            {tarjetasVista === "cuotas" && (
              <>
            {porCuenta && porCuenta.cuentas.length > 0 && (
              <section className="card">
                <div className="card-head">
                  <h2>Cuánto pago por cuenta, mes a mes</h2>
                </div>
                <p className="hint" style={{ margin: "0 0 16px" }}>
                  Según las cuotas ya cargadas, a partir del mes que viene. La primera fila es lo
                  que corresponde pagar el mes siguiente.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Mes</th>
                        {porCuenta.cuentas.map((c) => <th className="num" key={c}>{c}</th>)}
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porCuenta.meses.map((mo, i) => (
                        <tr key={mo.key}>
                          <td className="strong">
                            {mo.label}
                            {i === 0 && <span className="badge badge-info" style={{ marginLeft: 8 }}>Próximo mes</span>}
                          </td>
                          {porCuenta.cuentas.map((c) => (
                            <td className="num" key={c}>{mo.cuentas[c] ? fmt(mo.cuentas[c]) : <span className="muted">—</span>}</td>
                          ))}
                          <td className="num strong">{fmt(mo.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="card">
              <div className="card-head-row">
                <h2>Cuotas activas en el mes</h2>
                <div className="filtro-inline">
                  <select
                    value={cuotasMesFiltro.month}
                    onChange={(e) => setCuotasMesFiltro({ ...cuotasMesFiltro, month: Number(e.target.value) })}
                  >
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <input
                    type="number"
                    className="anio-input"
                    value={cuotasMesFiltro.year}
                    onChange={(e) => setCuotasMesFiltro({ ...cuotasMesFiltro, year: Number(e.target.value) })}
                  />
                  <button className="btn-secondary" onClick={() => cargarCuotasMes()}>Ver</button>
                  <button className="btn-ghost" onClick={() => { setCuotasMesFiltro(mesObjetivo); cargarCuotasMes(mesObjetivo.month, mesObjetivo.year); }}>Hoy</button>
                </div>
              </div>
              {cuotasMes !== null && (
                <p className="hint" style={{ margin: "0 0 16px" }}>
                  Total de cuotas que se pagan en {MESES_NOMBRE[cuotasMesFiltro.month].toLowerCase()} {cuotasMesFiltro.year}:{" "}
                  <span className="strong">{fmt(cuotasMesTotal)}</span>
                </p>
              )}
            </section>

            {cuotasMes !== null && cuotasMes.length === 0 && (
              <section className="card"><div className="empty-hint">No hay cuotas activas en ese mes.</div></section>
            )}

            {cuotasMesTarjetas.length > 0 && <div className="subsection-title" style={{ margin: "4px 0 0" }}><Icon name="card" size={16} /> Tarjetas</div>}
            {cuotasMesTarjetas.map((g) => (
              <section className="card" key={g.nombre}>
                <div className="card-head-row">
                  <button className="section-link" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)" }} onClick={() => irATarjeta(g.nombre)}>
                    {g.nombre}
                  </button>
                  <span className="badge badge-total">{fmt(g.totalARS)}</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Descripción</th><th className="num">Monto de la cuota</th><th>Cuota</th></tr>
                    </thead>
                    <tbody>
                      {g.cuotas.map((c, i) => (
                        <tr key={i}>
                          <td className="strong">{c.desc}</td>
                          <td className="num">{celdaEquivalencia(c.moneda, c.montoCuotaARS, c.montoCuotaUSD)}</td>
                          <td><span className="badge badge-info">{c.cuotaNumero} de {c.cuotasTotales}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            {cuotasMesBanco.length > 0 && <div className="subsection-title"><Icon name="bank" size={16} /> El Banco (préstamos y transferencias)</div>}
            {cuotasMesBanco.map((g) => (
              <section className="card" key={g.nombre}>
                <div className="card-head-row">
                  <h2>{g.nombre}</h2>
                  <span className="badge badge-total">{fmt(g.totalARS)}</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Descripción</th><th className="num">Monto de la cuota</th><th>Cuota</th></tr>
                    </thead>
                    <tbody>
                      {g.cuotas.map((c, i) => (
                        <tr key={i}>
                          <td className="strong">{c.desc}</td>
                          <td className="num">{celdaEquivalencia(c.moneda, c.montoCuotaARS, c.montoCuotaUSD)}</td>
                          <td><span className="badge badge-neutral">{c.cuotaNumero} de {c.cuotasTotales}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
              </>
            )}
            {tarjetasVista === "tarjeta" && (
              <>
            <details className="card cierre-card">
              <summary className="cierre-summary">
                <h2>Día de cierre de cada tarjeta</h2>
                <span className="muted">
                  {opciones.bancos.filter((b) => !cierreDias[b]).length > 0
                    ? `${opciones.bancos.filter((b) => !cierreDias[b]).length} sin configurar`
                    : "Todas configuradas"}
                </span>
              </summary>
              <div className="card-head" style={{ marginTop: 14 }}>
                <p className="hint" style={{ margin: "4px 0 0" }}>
                  Una compra hecha <strong>antes</strong> del día de cierre se paga con el sueldo del mes siguiente; la hecha
                  <strong> el día del cierre o después</strong> se paga un mes más tarde. Ej.: cierre el 20 → compra del 19/10 en
                  noviembre, del 20/10 en diciembre. Sin día configurado se usa el jueves de cierre de la planilla.
                </p>
              </div>
              {opciones.bancos.length === 0 ? (
                <div className="empty-hint">No hay tarjetas en la tabla Tarjeta/Cierre de la planilla.</div>
              ) : opciones.bancos.map((banco) => {
                const valor = cierreForm[banco] ?? (cierreDias[banco] ? String(cierreDias[banco]) : "");
                const sinCambios = String(valor) === (cierreDias[banco] ? String(cierreDias[banco]) : "");
                return (
                  <div className="cierre-row" key={banco}>
                    <span className="cierre-banco">{banco}</span>
                    <span className="cierre-campo">
                      <span className="muted">Cierra el día</span>
                      <input
                        type="number" min="1" max="31" placeholder="—" className="cuotas-input"
                        value={valor}
                        onChange={(e) => setCierreForm({ ...cierreForm, [banco]: e.target.value })}
                      />
                    </span>
                    <button className="btn-secondary cierre-guardar" disabled={sinCambios} onClick={() => guardarCierre(banco)}>Guardar</button>
                  </div>
                );
              })}
              {cierreStatus && <StatusMsg texto={cierreStatus} />}
            </details>

            <div className="bankcards-row">
              {porTarjeta.length === 0 && <div className="empty-hint">Todavía no tenés compras con tarjeta de crédito cargadas.</div>}
              {porTarjeta.map((g) => (
                <div
                  key={g.medio}
                  className={`bankcard ${cardTheme(g.banco)} ${grupoActivo?.medio === g.medio ? "active" : ""}`}
                  onClick={() => setTarjetaActiva(g.medio)}
                >
                  <div className="bankcard-top">
                    <span className="bankcard-brand">{g.medio}</span>
                    <span className="bankcard-chip"></span>
                  </div>
                  <div className="bankcard-dots">•••• •••• •••• {iniciales(g.medio)}</div>
                  <div className="bankcard-bottom">
                    <span className="bankcard-name">
                      {totalesMesPorTarjeta[g.medio]?.cuotas || 0} cuotas · {totalesMesPorTarjeta[g.medio]?.fijos || 0} fijos · {MESES_NOMBRE[tarjetaMesFiltro.month].slice(0, 3)}
                    </span>
                    <span className="bankcard-total">{fmt(totalesMesPorTarjeta[g.medio]?.total || 0)}</span>
                  </div>
                </div>
              ))}
            </div>

            {grupoActivo && (
              <>
                <section className="card">
                  <div className="card-head-row">
                    <h2>{grupoActivo.medio}</h2>
                    <div className="tarjeta-totales">
                      <span className="badge badge-total">{fmt(tarjetaMesTotal)}</span>
                      {tarjetaMesTotalUSD > 0 && <span className="badge badge-neutral">≈ {fmtUSD(tarjetaMesTotalUSD)}</span>}
                    </div>
                  </div>

                  <div className="month-nav" style={{ marginBottom: 14 }}>
                    <button className="btn-icon" aria-label="Mes anterior" onClick={() => irMesTarjeta(-1)}>‹</button>
                    <span className="month-nav-label">{MESES_NOMBRE[tarjetaMesFiltro.month]} {tarjetaMesFiltro.year}</span>
                    <button className="btn-icon" aria-label="Mes siguiente" onClick={() => irMesTarjeta(1)}>›</button>
                    {!tarjetaEnMesActual && <button className="btn-ghost" onClick={irMesActualTarjeta}>Mes actual</button>}
                  </div>

                  <Segmented
                    value={tarjetaSubtab}
                    onChange={setTarjetaSubtab}
                    options={[
                      { value: "consumos", label: `Consumos · ${tarjetaMesCuotasItems.length} · ${fmt(tarjetaConsumosTotal)}` },
                      { value: "fijos", label: `Gastos fijos · ${tarjetaMesFijosItems.length} · ${fmt(tarjetaFijosTotal)}` }
                    ]}
                  />

                  {tarjetaMesCuotas === null ? (
                    <Skeleton />
                  ) : tarjetaItemsVista.length === 0 ? (
                    <div className="empty-hint">
                      {tarjetaSubtab === "consumos" ? "Esta tarjeta no tiene consumos en ese mes." : "Esta tarjeta no tiene gastos fijos."}
                    </div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{tarjetaSubtab === "consumos" ? "Compra" : "Gasto fijo"}</th>
                            <th className="num">Monto</th>
                            <th>{tarjetaSubtab === "consumos" ? "Pago" : "Frecuencia"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tarjetaItemsVista.map((c, i) => (
                            <tr key={i}>
                              <td className="strong">{c.desc}</td>
                              <td className="num">{celdaEquivalencia(c.moneda, c.montoARS, c.montoUSD)}</td>
                              <td>
                                {tarjetaSubtab === "fijos"
                                  ? <span className="badge badge-fijo">Fijo mensual</span>
                                  : <span className="badge badge-info">{c.cuota === "1 de 1" ? "Un pago" : `Cuota ${c.cuota}`}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="cuenta-total">
                    <span>{tarjetaSubtab === "consumos" ? "Total de consumos" : "Total de gastos fijos"}</span>
                    <strong>{fmt(tarjetaSubtab === "consumos" ? tarjetaConsumosTotal : tarjetaFijosTotal)}</strong>
                  </div>
                  <div className="cuenta-total">
                    <span>Total del mes de la tarjeta</span>
                    <strong>{fmt(tarjetaMesTotal)}</strong>
                  </div>
                </section>

                <details className="card historial-details">
                  <summary className="subsection-title" style={{ cursor: "pointer", margin: 0 }}>
                    Ver historial completo · {grupoActivo.gastos.length} gastos · total histórico {fmt(grupoActivo.totalARS)}
                  </summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Categoría</th>
                          <th>Cuotas</th><th className="num">Monto</th><th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupoActivo.gastos.map((h) => (
                          <tr key={h.row}>
                            <td className="muted">{h.fecha}</td>
                            <td className="strong">{h.desc}</td>
                            <td>{h.tipo}</td>
                            <td className="muted">{h.categoria || "—"}</td>
                            <td>{h.gasto === "Gasto fijo" ? <span className="badge badge-fijo">Fijo mensual</span> : h.cuotas}</td>
                            <td className="num">{celdaEquivalencia(h.moneda, h.montoARS, h.montoUSD)}</td>
                            <td>{h.gasto === "Gasto fijo" ? <span className="muted">—</span> : estadoBadge(h.estado)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
              </>
            )}
          </div>
        )}

        {cargarAbierto && (() => {
          const esIngreso = gForm.gasto === "Ingreso extra";
          const esFijo = gForm.gasto === "Gasto fijo";
          const esCompra = gForm.gasto === "Gasto variable";
          const esTarjeta = !esIngreso && gForm.formaPago === FORMA_TARJETA;
          const cuotasN = Math.max(1, Number(gForm.cuotas) || 1);
          const montoN = Number(gForm.monto) || 0;
          const usd = gForm.moneda === "USD";
          const fmtM = (n) => (usd ? fmtUSD2(n) : fmt(n));
          const equiv = (n) => (usd && dolarBlue ? ` (≈ ${fmt(n * dolarBlue)} al dólar blue)` : "");
          const [fy, fm, fd] = String(gForm.fecha || "").split("-");
          const mesFecha = fm ? `${MESES_NOMBRE[Number(fm) - 1]} ${fy}` : "";
          const set = (patch) => {
            setGForm({ ...gForm, ...patch });
            // al corregir un campo, se le saca el error
            setErroresForm((er) => {
              const nuevo = { ...er };
              Object.keys(patch).forEach((k) => { delete nuevo[k]; });
              return nuevo;
            });
          };

          const extras = (opciones.categorias || []).filter((c) => !CATEGORIAS_GASTO.includes(c) && !CATEGORIAS_INGRESO.includes(c) && !CATEGORIAS_VIEJAS.includes(c));
          const categoriasDisponibles = esIngreso ? CATEGORIAS_INGRESO : [...CATEGORIAS_GASTO, ...extras];

          // En qué meses se paga la compra: se calcula con describirPago, la MISMA regla que usa la
          // proyección, así que el texto no puede decir otra cosa que lo que después se ve en los números.
          const compraD = (fm && fd) ? new Date(Number(fy), Number(fm) - 1, Number(fd)) : null;
          let cierreManual = null;
          if (esTarjeta && esCompra && gForm.fechaCierre) {
            const [cy, cm, cd] = gForm.fechaCierre.split("-").map(Number);
            cierreManual = new Date(cy, cm - 1, cd);
          }
          const nJueves = (opciones.cierreN || {})[gForm.banco] || 0;
          const pago = esCompra && compraD
            ? describirPago({
              formaPago: gForm.formaPago, fecha: compraD, cuotas: cuotasN, fechaCierre: cierreManual,
              cierreDia: cierreDias[gForm.banco] || null, n: nJueves
            })
            : null;
          const mesesPago = pago ? pago.meses : [];

          const faltan = [];
          if (!String(gForm.desc).trim()) faltan.push("la descripción");
          if (!(montoN > 0)) faltan.push("el monto");
          if (!esIngreso && !gForm.categoria) faltan.push("la categoría");
          if (!fm) faltan.push("la fecha");
          if (!esIngreso && gForm.formaPago !== "Efectivo" && !gForm.banco) faltan.push(esTarjeta ? "la tarjeta (banco)" : "el banco");
          const completo = faltan.length === 0;

          const fechaTxt = (x) => `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
          const nombreJueves = ["", "primer", "segundo", "tercer", "cuarto"][nJueves] || "";
          const notaDePago = () => {
            if (!pago) return "";
            if (pago.regla === "cierre-dia") {
              const dia = cierreDias[gForm.banco];
              const aplica = fechaAplicacion(compraD, dia);
              return aplica.getTime() === compraD.getTime()
                ? `${gForm.banco} cierra el día ${dia}: la compra todavía entra en este cierre.`
                : `${gForm.banco} cerró el día ${dia}: la compra queda con fecha ${fechaTxt(compraD)}, pero se aplica el ${fechaTxt(aplica)} (entra en el cierre siguiente).`;
            }
            if (pago.regla === "cierre-manual") return `Con la fecha de cierre que indicaste (${fechaTxt(cierreManual)}).`;
            if (pago.regla === "cierre-jueves") return `${gForm.banco} no tiene día de cierre configurado: se usa la regla de la planilla (cierra el ${nombreJueves} jueves).`;
            return esTarjeta
              ? `${gForm.banco || "La tarjeta"} no tiene regla de cierre: la compra cuenta en el mes de la compra (regla provisoria).`
              : "Sin cierre de tarjeta: la compra cuenta en el mes de la compra.";
          };

          let impacto = null;
          if (completo) {
            const medioTxt = esIngreso ? "" : (esTarjeta ? [gForm.marca, gForm.banco].filter(Boolean).join(" ") : (gForm.formaPago === "Efectivo" ? "Efectivo" : (gForm.banco || gForm.formaPago)));
            if (esCompra && mesesPago.length) {
              const primero = labelTramo(mesesPago[0]);
              const ultimo = labelTramo(mesesPago[mesesPago.length - 1]);
              impacto = {
                nota: notaDePago(),
                titulo: mesesPago.length > 1 ? `${primero} → ${ultimo}` : primero,
                detalle: cuotasN > 1
                  ? `${cuotasN} cuotas de ${fmtM(montoN)} (${medioTxt}), una por mes. Total ${fmtM(montoN * cuotasN)}${equiv(montoN * cuotasN)}.`
                  : `Un solo pago de ${fmtM(montoN)}${equiv(montoN)} (${medioTxt}).`
              };
            } else if (esFijo) {
              // Un fijo cuenta desde el mes de su fecha, todos los meses, hasta que lo pausás o terminás.
              impacto = {
                titulo: mesFecha ? `Desde ${mesFecha}, todos los meses` : "Todos los meses",
                detalle: `Se suman ${fmtM(montoN)}${equiv(montoN)} a tus gastos en cada mes desde la fecha elegida (${medioTxt}).`,
                nota: "Después lo podés pausar o terminar desde la lista de gastos fijos."
              };
            } else if (esIngreso) {
              impacto = { titulo: mesFecha, detalle: `Se suman ${fmtM(montoN)}${equiv(montoN)} a tus ingresos de ese mes.` };
            }
          }

          const recientes = historico ? [...historico].sort((a, b) => b.row - a.row).slice(0, 6) : [];
          const claseInfo = (g) => ({ "Gasto fijo": ["Fijo", "badge-neutral"], "Gasto variable": ["Compra", "badge-info"], "Ingreso extra": ["Ingreso", "badge-ok"] }[g] || [g, "badge-neutral"]);

          return (
            <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrarCargar(); }}>
              <div className="modal" role="dialog" aria-modal="true" aria-label="Cargar a la planilla">
                <div className="modal-head">
                  <h2>Cargar</h2>
                  <button className="btn-icon" aria-label="Cerrar" onClick={cerrarCargar}><Icon name="x" size={18} /></button>
                </div>

                <Segmented
                  className={esIngreso ? "tipo-ingreso" : "tipo-gasto"}
                  value={esIngreso ? "ingreso" : "gasto"}
                  onChange={(v) => set(v === "ingreso" ? { gasto: "Ingreso extra", categoria: "" } : { gasto: "Gasto variable", categoria: "" })}
                  options={[{ value: "gasto", label: "Gasto" }, { value: "ingreso", label: "Ingreso" }]}
                />

                <label>Descripción</label>
                <input id="cargar-desc" autoFocus aria-invalid={!!erroresForm.desc} aria-describedby={erroresForm.desc ? "err-desc" : undefined} placeholder={esIngreso ? "Ej: Venta, Reintegro..." : "Ej: Zapatillas, Netflix, Nafta..."} value={gForm.desc} onChange={(e) => set({ desc: e.target.value })} />
                {erroresForm.desc && <p className="field-error" id="err-desc">{erroresForm.desc}</p>}

                <div className="form-grid">
                  <div>
                    <label>{esCompra && cuotasN > 1 ? "Monto de cada cuota" : "Monto"}</label>
                    <input id="cargar-monto" type="number" inputMode="decimal" min="0" placeholder="0" aria-invalid={!!erroresForm.monto} aria-describedby={erroresForm.monto ? "err-monto" : undefined} value={gForm.monto} onChange={(e) => set({ monto: e.target.value })} />
                    {erroresForm.monto && <p className="field-error" id="err-monto">{erroresForm.monto}</p>}
                  </div>
                  <div>
                    <label>Moneda</label>
                    <Segmented value={gForm.moneda} onChange={(v) => set({ moneda: v })} options={opciones.monedas.length ? opciones.monedas : ["ARS", "USD"]} />
                  </div>
                </div>

                <label>Categoría</label>
                <div className="chips" id="cargar-categoria" tabIndex={-1} role="group" aria-label="Categoría">
                  {categoriasDisponibles.map((c) => (
                    <button key={c} type="button" aria-pressed={gForm.categoria === c} className={`chip ${gForm.categoria === c ? "active" : ""}`} onClick={() => set({ categoria: c })}>{c}</button>
                  ))}
                </div>
                {erroresForm.categoria && <p className="field-error" role="alert">{erroresForm.categoria}</p>}

                <div className="form-grid">
                  <div>
                    <label>{esIngreso ? "Fecha del ingreso" : "Fecha"}</label>
                    <input type="date" value={gForm.fecha} onChange={(e) => set({ fecha: e.target.value })} />
                  </div>
                  {!esIngreso && (
                    <div>
                      <label>&nbsp;</label>
                      <label className="check-row">
                        <input type="checkbox" checked={esFijo} onChange={(e) => set({ gasto: e.target.checked ? "Gasto fijo" : "Gasto variable", cuotas: 1 })} />
                        Se repite todos los meses
                      </label>
                    </div>
                  )}
                </div>

                {!esIngreso && (
                  <>
                    <label>Cómo se paga</label>
                    <Segmented
                      value={gForm.formaPago}
                      onChange={(v) => set({ formaPago: v })}
                      options={opciones.formasPago.map((v) => ({ value: v, label: v === FORMA_TARJETA ? "Tarjeta" : v }))}
                    />
                    {gForm.formaPago !== "Efectivo" && (
                      <>
                        <label>{esTarjeta ? "Tarjeta" : "Banco"}</label>
                        <Segmented value={gForm.banco} onChange={(v) => set({ banco: v })} options={opciones.bancos} />
                      </>
                    )}
                    {esTarjeta && (
                      <>
                        <label>Marca</label>
                        <Segmented value={gForm.marca} onChange={(v) => set({ marca: v })} options={opciones.marcas} />
                      </>
                    )}
                    {esCompra && (
                      <>
                        <label>Cuotas</label>
                        <div className="cuotas-row">
                          <Segmented value={String(cuotasN)} onChange={(v) => set({ cuotas: Number(v) })} options={["1", "3", "6", "12"]} />
                          <input type="number" min="1" className="cuotas-input" value={gForm.cuotas} onChange={(e) => set({ cuotas: e.target.value })} />
                        </div>
                      </>
                    )}
                    {esTarjeta && esCompra && (
                      <details className="cierre-details">
                        <summary>Cambiar la fecha de cierre de esta compra</summary>
                        <input type="date" value={gForm.fechaCierre} onChange={(e) => set({ fechaCierre: e.target.value })} />
                        <p className="hint" style={{ margin: "6px 0 0" }}>Si la ponés, las cuotas se calculan desde esa fecha exacta en vez del día de cierre de la tarjeta.</p>
                      </details>
                    )}
                  </>
                )}

                <div className={`impacto-box ${completo ? "ok" : ""} ${esIngreso ? "ingreso" : ""}`} aria-live="polite">
                  {completo && impacto ? (
                    <>
                      <div className="resumen-label">{pago && pago.regla !== "mes-de-compra" ? "Se paga con el sueldo de" : "Impacta en"}</div>
                      <div className="impacto-titulo">{impacto.titulo}</div>
                      <div className="resumen-text">{impacto.detalle}</div>
                      {impacto.nota && <p className="impacto-nota">{impacto.nota}</p>}
                    </>
                  ) : (
                    <>
                      <div className="resumen-label">Dónde va a impactar</div>
                      <div className="resumen-text">Falta {faltan.join(", ")} para saber en qué mes impacta.</div>
                    </>
                  )}
                </div>

                <button className="btn-primary btn-big" onClick={agregar}>Guardar en la planilla</button>
                {addStatus && <StatusMsg texto={addStatus} />}

                <details className="cierre-details">
                  <summary>Gastos fijos cargados · {gastosFijos.length} · {fmt(gastosFijos.filter((g) => g.estado === "activo").reduce((acc, g) => acc + (Number(g.montoARS) || 0), 0))} por mes</summary>
                  {renderFijos()}
                </details>
                <details className="cierre-details">
                  <summary>Lo último que cargaste</summary>
                  {recientes.length === 0 ? (
                    <div className="empty-hint">Todavía no hay movimientos.</div>
                  ) : recientes.map((h) => {
                    const [txt, cls] = claseInfo(h.gasto);
                    return (
                      <div className="reciente-row" key={h.row}>
                        <div className="reciente-main">
                          <span className="strong">{h.desc}</span>
                          <span className="cat-item-medio">{h.fecha}{h.medio ? ` · ${h.medio}` : ""}</span>
                        </div>
                        <div className="reciente-side">
                          <span className={`badge ${cls}`}>{txt}{h.gasto === "Gasto variable" && Number(h.cuotas) > 1 ? ` · ${h.cuotas} cuotas` : ""}</span>
                          <span className="reciente-monto">{celdaEquivalencia(h.moneda, h.montoARS, h.montoUSD)}</span>
                        </div>
                      </div>
                    );
                  })}
                </details>
              </div>
            </div>
          );
        })()}

      </main>
      </div>

      <nav className="bottomnav" aria-label="Secciones">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`bottomlink ${tab === t.id ? "active" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => abrirTab(t.id)}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <button className="fab" onClick={() => abrirCargar()} aria-label="Cargar un gasto o ingreso">
        <Icon name="plus" size={20} /> Cargar
      </button>
    </div>
  );
}
