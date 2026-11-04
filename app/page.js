"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { fechaCierreDia, fechaAplicacion, describirPago } from "@/lib/closing";
import { resumenPatrimonio, acumuladoConIol, LUGARES } from "@/lib/patrimonio";

const MESES_NOMBRE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const TABS = [
  { id: "inicio", label: "Inicio", icon: "home", sub: "" },
  { id: "gastos", label: "Gastos", icon: "receipt", sub: "Qué pasó con la plata, mes a mes." },
  { id: "tarjetas", label: "Tarjetas", icon: "card", sub: "Cierres, cuotas y gastos fijos de cada tarjeta." },
  { id: "ahorro", label: "Ahorro e inversiones", corto: "Ahorro", icon: "wallet", sub: "Lo que ahorraste y lo que tenés invertido, y dónde está cada cosa." },
  { id: "sueldos", label: "Sueldos", icon: "coins", sub: "Lo que cobrás cada mes: sueldo y extra." },
  { id: "graficos", label: "Gráficos y proyección", corto: "Gráficos", icon: "bars", sub: "Lo que pasó contra lo proyectado, y cómo vas a estar los próximos meses." }
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
  gasto: "#d6402b", contado: "#8a5cc2", gastoSuave: "#efb6ab", ingreso: "#9fd6b8", ahorro: "#0a7040", piso: "#8a8576",
  libre: "#c9c1ae", variable: "#d98a12", cuota: "#2b44d6", grid: "#e6e0d3", texto: "#5a554a", ingresoLinea: "#2f8f62"
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

function fechaCortaISO(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(/-/g, "/");
}

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
  bars: <path d="M5 21V10M12 21V4M19 21v-7" />,
  coins: <><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.4-.8-1.3-1.2-2.5-1.2-1.6 0-2.5.7-2.5 1.7s.9 1.5 2.5 1.8 2.5.8 2.5 1.8-.9 1.9-2.5 1.9c-1.3 0-2.2-.5-2.6-1.3M12 6.5V8m0 8v1.5" /></>,
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

const fmtCorto = (n) => "$" + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k");

// Línea de lo REAL (sólida) y de lo PROYECTADO (punteada, más fina, sin puntos): mismo color = misma cosa.
const lineaReal = (label, data, color) => ({
  type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 3,
  pointRadius: 3, pointHoverRadius: 5, tension: 0.2
});
const lineaProy = (label, data, color) => ({
  type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
  borderDash: [2, 5], borderCapStyle: "round", pointRadius: 0, pointHoverRadius: 4, tension: 0.2
});

// Marca vertical del mes en curso ("hoy") en los gráficos mensuales.
const pluginHoy = {
  id: "lineaHoy",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.index === undefined || opts.index < 0) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(opts.index);
    if (!Number.isFinite(x)) return;
    ctx.save();
    ctx.strokeStyle = PAL.texto;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.fillStyle = PAL.texto;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("hoy", x, chartArea.top - 4);
    ctx.restore();
  }
};

// "▲ +3,2%" / "▼ −1,5%" / "= 0%" para una variación (0,032 = 3,2%).
const textoVariacion = (v) => {
  const n = Math.abs(Math.round(v * 1000) / 10);
  return `${n === 0 ? "= " : (v > 0 ? "▲ +" : "▼ −")}${String(n).replace(".", ",")}%`;
};

// Opciones comunes de los gráficos de la sección Gráficos: una sola escala, leyenda arriba, grilla de línea fina.
function opcionesChart(formato = fmtCorto) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 14 } },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { usePointStyle: true, padding: 16, boxHeight: 8 } },
      tooltip: { padding: 12, cornerRadius: 8, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
    },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: PAL.grid }, border: { display: false }, ticks: { callback: (v) => formato(v) } }
    }
  };
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
  const [capacidad, setCapacidad] = useState(null); // cuánto se puede gastar hasta el próximo cobro
  const [cobroAbierto, setCobroAbierto] = useState(false);
  const [reservaForm, setReservaForm] = useState({ activa: false, tipo: "porcentaje", valor: "" }); // reserva automática de MercadoPago
  const [reservaVigente, setReservaVigente] = useState(null);
  const [reservaStatus, setReservaStatus] = useState("");
  const [graficos, setGraficos] = useState(null); // evolutivo contra proyectado (se pide al abrir Gráficos)
  const [graficosVista, setGraficosVista] = useState("ahorro");
  const [iol, setIol] = useState(null); // cartera de IOL (solo lectura); { configurado, cartera, fotos } o { error }
  const [iolCargando, setIolCargando] = useState(false);
  const [sueldoAgrupar, setSueldoAgrupar] = useState("mes"); // mes | trimestre | anio
  const [sueldoAnio, setSueldoAnio] = useState("todos");
  const [saldoMonto, setSaldoMonto] = useState(""); // lo que tengo hoy
  const [saldoPagados, setSaldoPagados] = useState([]); // ids de lo comprometido que ya pagué (tildes)
  const [saldoAhorrado, setSaldoAhorrado] = useState(""); // lo ahorrado desde el último cobro
  // Guardado automático de "Hasta cobrar": espejo de lo escrito (para el temporizador) y la pausa antes de guardar.
  const estadoSaldo = useRef({ monto: "", pagados: [], ahorrado: "" });
  const temporizadorSaldo = useRef(null);
  const horaPendiente = useRef(false);
  const [saldoStatus, setSaldoStatus] = useState("");
  const [hoyKey, setHoyKey] = useState(""); // "YYYY-M" del mes en curso (según el servidor)
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
  const [ahorroForm, setAhorroForm] = useState({ fecha: hoyISO, monto: "", moneda: "ARS", lugar: "", lugarOtro: "" });
  const [cobros, setCobros] = useState(null); // lo que realmente cobré (sueldo y extra); se pide al abrir Sueldos
  const [cobroForm, setCobroForm] = useState({ fecha: hoyISO, monto: "", tipo: "sueldo", nota: "" });
  const [cobroStatus, setCobroStatus] = useState("");
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
  // Gastos abre en el mes en curso: cada gasto cuenta en el mes en que está anotado.
  const [gastosMesFiltro, setGastosMesFiltro] = useState({ month: hoy.getMonth(), year: hoy.getFullYear() });
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
  const ahorroUsdRef = useRef(null);
  const ahorroMesRef = useRef(null);
  const sueldoRef = useRef(null);
  const iolArsRef = useRef(null);
  const iolUsdRef = useRef(null);
  const ingresoRef = useRef(null);
  const ahorroAcumRef = useRef(null);
  const gastoIngRef = useRef(null);
  const gastosCanvasRef = useRef(null);
  const gastosChartRef = useRef(null);
  const gastosDashRef = useRef(null);
  const gastosDashChart = useRef(null);
  const histCanvasRef = useRef(null);
  const histChartRef = useRef(null);

  function render(payload, opts = {}) {
    setGraficos(null); // algo cambió: los gráficos se piden de nuevo la próxima vez
    if (!opts.onlyBase) setMeses(payload.meses || []);
    if (!opts.anchored) setMesesBase(payload.meses || []);
    if (payload.porCuenta) setPorCuenta(payload.porCuenta);
    if (payload.capacidad !== undefined) {
      setCapacidad(payload.capacidad);
      if (!opts.conservarSaldo) setSaldoAhorrado(payload.capacidad && payload.capacidad.ahorradoPeriodo > 0 ? String(Math.round(payload.capacidad.ahorradoPeriodo)) : "");
    }
    if (payload.hoy) setHoyKey(payload.hoy);
    if (payload.config) {
      setCfgPiso(payload.config.piso || "");
      setSueldoSchedule(payload.config.sueldoSchedule || []);
      setAhorroMovs(payload.config.ahorroMovs || []);
      if (payload.config.cierreDias) setCierreDias(payload.config.cierreDias);
      const sa = payload.config.saldoActual;
      if (!opts.conservarSaldo) {
        setSaldoMonto(sa ? String(sa.monto) : "");
        setSaldoPagados(sa && Array.isArray(sa.pagados) ? sa.pagados : []);
      }
      const rm = payload.config.reservaMP;
      setReservaVigente(rm || null);
      setReservaForm(rm ? { activa: rm.activa, tipo: rm.tipo, valor: String(rm.valor) } : { activa: false, tipo: "porcentaje", valor: "" });
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
    if (id === "proyeccion") { setGraficosVista("proyeccion"); id = "graficos"; } // la proyección ahora vive dentro de Gráficos
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
      if (id === "proyeccion") { setGraficosVista("proyeccion"); setTabRaw("graficos"); } // enlace viejo
      else if (TABS.some((t) => t.id === id)) setTabRaw(id);
    };
    leer();
    window.addEventListener("popstate", leer);
    return () => window.removeEventListener("popstate", leer);
  }, []);

  // "Cuotas del mes" se trae recién al abrir Tarjetas (una lectura menos en la carga inicial).
  useEffect(() => {
    if (tab === "tarjetas" && cuotasMes === null) cargarCuotasMes().catch((e) => setLoadError(mensajeDeError(e)));
    if ((tab === "gastos" || tab === "graficos") && gastosHist === null) cargarGastosMes().catch((e) => setLoadError(mensajeDeError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Gráficos: los datos mes a mes se piden al abrir la sección y se vuelven a pedir si algo cambió (render los descarta).
  useEffect(() => {
    if (tab !== "sueldos" || cobros !== null) return;
    fetchJSON("/api/cobros").then((r) => setCobros(r.cobros)).catch((e) => setLoadError(mensajeDeError(e)));
  }, [tab, cobros]);

  useEffect(() => {
    if (tab !== "graficos" || graficos !== null) return;
    fetchJSON("/api/graficos").then(setGraficos).catch((e) => setLoadError(mensajeDeError(e)));
  }, [tab, graficos]);

  // Datos mes a mes de la sección Gráficos (con acumulados). Va antes que los efectos de los gráficos que lo usan.
  const graficosSerie = useMemo(() => {
    if (!graficos) return null;
    let accProy = 0, accReal = 0;
    const manuales = graficos.meses.map((m) => {
      accProy += m.ahorroProyectado;
      if (m.ahorroReal !== null) accReal += m.ahorroReal;
      return { ...m, accProy, accReal: m.ahorroReal === null ? null : accReal };
    });
    // El acumulado real suma el valor total de la cartera de IOL (en pesos) al cierre de cada mes, desde que se conectó.
    const iolFotos = iol && iol.configurado && !iol.error ? iol.fotos : null;
    const filas = acumuladoConIol(manuales, iolFotos, dolarBlue || 0);
    const primeraFoto = iolFotos ? Object.keys(iolFotos).sort()[0] : null;
    const hechos = filas.filter((m) => m.estado !== "futuro");
    const real = hechos.reduce((acc, m) => acc + (m.ahorroReal || 0), 0);
    const plan = hechos.reduce((acc, m) => acc + m.ahorroProyectado, 0);
    const aprox = filas.filter((m) => m.aprox);
    return {
      filas, real, plan, dif: real - plan,
      desde: filas[0] ? filas[0].label : "", hasta: hechos.length ? hechos[hechos.length - 1].label : "",
      indiceHoy: filas.findIndex((m) => m.estado === "actual"),
      hayIol: filas.some((m) => m.iol !== null), iolDesde: primeraFoto,
      aproxHasta: aprox.length ? aprox[aprox.length - 1].label : ""
    };
  }, [graficos, iol, dolarBlue]);

  useEffect(() => {
    if (!canvasRef.current || tab !== "graficos" || graficosVista !== "proyeccion") return;
    if (chartRef.current) chartRef.current.destroy();
    if (!meses.length) return;
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      data: {
        labels: meses.map((m) => m.label),
        datasets: [
          lineaReal("Ingresos", meses.map((m) => m.ingresos), PAL.ingresoLinea),
          lineaReal("Gastos", meses.map((m) => m.gastos), PAL.gasto),
          lineaReal("Ahorro proyectado", meses.map((m) => m.ahorroProyectado), PAL.ahorro),
          lineaProy("Piso configurado", meses.map((m) => m.pisoConfigurado), PAL.piso)
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
  }, [meses, tab, graficosVista, graficosSerie]);

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
        body: JSON.stringify({ ...ahorroForm, lugar: ahorroForm.lugar === "Otro" ? ahorroForm.lugarOtro : ahorroForm.lugar })
      });
      render(payload);
      setAhorroStatus("✅ Guardado");
      setAhorroForm((f) => ({ ...f, monto: "" }));
    } catch (e) {
      setAhorroStatus("❌ " + e.message);
    }
  }

  async function guardarCobro() {
    setCobroStatus("Guardando...");
    try {
      const res = await fetchJSON("/api/cobros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cobroForm)
      });
      setCobros(res.cobros);
      setGraficos(null);
      setCobroStatus("✅ Guardado");
      setCobroForm((f) => ({ ...f, monto: "", nota: "" }));
    } catch (e) {
      setCobroStatus("❌ " + e.message);
    }
  }

  async function eliminarCobroReal(c) {
    if (!confirm(`¿Eliminar este cobro de ${fmt(c.monto)}?`)) return;
    try {
      const res = await fetchJSON(`/api/cobros/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      setCobros(res.cobros);
      setGraficos(null);
    } catch (e) {
      setCobroStatus("❌ " + e.message);
    }
  }

  // Cambia dónde está guardado un ahorro ya cargado ("" = sin ubicar).
  async function cambiarLugarAhorro(id, lugar) {
    try {
      render(await fetchJSON(`/api/ahorro/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lugar })
      }));
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

  // Cierre del período: qué ya pagué (tildes), cuánto tengo y cuánto ahorré (se carga solo en Ahorro).
  // Reserva automática: por cada gasto al contado en MercadoPago por transferencia se aparta un % o un monto fijo.
  async function guardarReserva() {
    setReservaStatus("Guardando...");
    try {
      const res = await fetchJSON("/api/reserva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reservaForm)
      });
      render(res, { onlyBase: true });
      setReservaStatus(reservaForm.activa ? "✅ Reserva activada" : "✅ Reserva apagada");
    } catch (e) {
      setReservaStatus("❌ " + e.message);
    }
  }

  function alternarPagado(id) {
    setSaldoPagados((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
    programarSaldo(false);
  }

  // Guarda lo escrito y recalcula. `hora: false` = solo cambió un tilde o el ahorro: la hora de "lo que tengo" no se renueva.
  async function guardarSaldo(borrar = false, { hora = true } = {}) {
    const e = estadoSaldo.current;
    setSaldoStatus("Calculando...");
    try {
      const res = await fetchJSON("/api/saldo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(borrar ? { monto: "" } : { monto: e.monto, pagados: e.pagados, ahorrado: e.ahorrado, actualizarHora: hora })
      });
      // Si se sigue escribiendo, la respuesta no pisa lo que hay en los campos.
      render(res, { onlyBase: true, conservarSaldo: !borrar });
      setSaldoStatus(borrar ? "Listo: vuelve a la estimación." : "✅ Calculado");
    } catch (err) {
      setSaldoStatus("❌ " + err.message);
    }
  }

  // El cálculo es automático: al escribir o tildar se espera una pausa corta y se guarda solo.
  function programarSaldo(cambiaMonto) {
    if (cambiaMonto) horaPendiente.current = true;
    clearTimeout(temporizadorSaldo.current);
    if (estadoSaldo.current.monto === "" && !cambiaMonto) setSaldoStatus("Poné cuánto tenés hoy y se calcula solo.");
    temporizadorSaldo.current = setTimeout(() => {
      const hora = horaPendiente.current;
      horaPendiente.current = false;
      if (estadoSaldo.current.monto === "") return; // sin "lo que tengo" no hay con qué calcular
      guardarSaldo(false, { hora });
    }, 900);
  }

  useEffect(() => {
    estadoSaldo.current = { monto: saldoMonto, pagados: saldoPagados, ahorrado: saldoAhorrado };
  });
  useEffect(() => () => clearTimeout(temporizadorSaldo.current), []);

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
    if (!gastosCanvasRef.current || tab !== "graficos" || graficosVista !== "gastos") return;
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
  }, [evolutivo, tab, graficosVista, graficosSerie]);

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
    if (!histCanvasRef.current || tab !== "graficos" || graficosVista !== "gastos") return;
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
  }, [histEvolutivo, tab, graficosVista, graficosSerie]);

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

    // fijo / contado (un pago en transferencia o efectivo: el día a día) / variable (un pago con tarjeta u otro medio) / cuotas
    const clase = (g) => (g.detalle === "Fijo" ? "fijo" : (Number(g.cuotasTotales) > 1 ? "cuotas" : (g.alContado ? "contado" : "variable")));
    const porClase = (items) => {
      const r = { fijo: 0, contado: 0, variable: 0, cuotas: 0 };
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
    if (!gastosDashRef.current || tab !== "graficos" || graficosVista !== "gastos") return;
    if (gastosDashChart.current) gastosDashChart.current.destroy();
    if (!gastosKpis || !gastosKpis.serie.length) return;
    const s = gastosKpis.serie;
    gastosDashChart.current = new Chart(gastosDashRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: s.map((x) => x.label),
        datasets: [
          lineaReal("Gasto del mes", s.map((x) => x.total), PAL.gasto),
          lineaProy("Promedio", s.map(() => gastosKpis.promedio), PAL.texto)
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
  }, [gastosKpis, tab, graficosVista, graficosSerie]);

  // Tenencia de ahorro: cada movimiento con su acumulado en la moneda en que se ahorró, y los
  // totales en pesos y en dólares (más su equivalente con el dólar blue vigente).
  // Todo lo que tengo: lo ahorrado a mano (cada uno con su lugar) más la cartera de IOL, que llega sola.
  const patrimonio = useMemo(
    () => resumenPatrimonio(ahorroMovs, iol && iol.cartera ? iol.cartera : null, dolarBlue || 0),
    [ahorroMovs, iol, dolarBlue]
  );

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

  // ---- Sección "Gráficos": todo en líneas. Punteada = proyectado, sólida = real, marca vertical = hoy ----
  // Opciones de un gráfico mensual: marca de "hoy" y, al pasar el mouse, qué tan firme es lo proyectado de ese mes.
  const opcionesMensual = (serie, formato, extra = null) => {
    const o = opcionesChart(formato);
    o.plugins.lineaHoy = { index: serie.indiceHoy };
    o.plugins.tooltip.callbacks.afterBody = (items) => {
      const m = items.length ? serie.filas[items[0].dataIndex] : null;
      if (!m) return "";
      const estado = m.aprox ? "Proyectado aproximado: ese mes no tenía foto"
        : (m.fijo ? "Proyectado fijo desde que arrancó el mes" : "Proyección de hoy: cambia con lo que cargues");
      return [estado, extra ? extra(m) : ""].filter(Boolean);
    };
    return o;
  };

  useEffect(() => {
    if (tab !== "graficos" || graficosVista !== "ahorro" || !graficosSerie) return undefined;
    const f = graficosSerie.filas;
    const etiquetas = f.map((m) => m.label);
    const charts = [];
    const nuevo = (canvas, real, proy, etiqueta = "Real", extra = null) => canvas && charts.push(new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: etiquetas, datasets: [lineaProy("Proyectado", proy, PAL.ahorro), lineaReal(etiqueta, real, PAL.ahorro)] },
      options: opcionesMensual(graficosSerie, undefined, extra),
      plugins: [pluginHoy]
    }));
    nuevo(ahorroMesRef.current, f.map((m) => m.ahorroReal), f.map((m) => m.ahorroProyectado));
    // El acumulado real incluye el valor total de la cartera de IOL en pesos (los dólares, al blue de hoy).
    nuevo(ahorroAcumRef.current, f.map((m) => m.accRealTotal), f.map((m) => m.accProy), graficosSerie.hayIol ? "Real (con IOL)" : "Real",
      (m) => (m.iol !== null && m.iol !== undefined ? `Incluye IOL: ${fmt(m.iol)}` : ""));
    return () => charts.forEach((c) => c.destroy());
  }, [graficosSerie, tab, graficosVista]);

  useEffect(() => {
    if (tab !== "graficos" || graficosVista !== "gastos" || !graficosSerie) return undefined;
    const f = graficosSerie.filas;
    const etiquetas = f.map((m) => m.label);
    const charts = [];
    const nuevo = (canvas, proy, real, color) => canvas && charts.push(new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: etiquetas, datasets: [lineaProy("Proyectado", proy, color), lineaReal(real.etiqueta, real.datos, color)] },
      options: opcionesMensual(graficosSerie),
      plugins: [pluginHoy]
    }));
    nuevo(gastoIngRef.current, f.map((m) => m.gastos), { etiqueta: "Real", datos: f.map((m) => m.gastosReal) }, PAL.gasto);
    nuevo(ingresoRef.current, f.map((m) => m.ingresos), { etiqueta: "Cobrado", datos: f.map((m) => m.ingresosReal) }, PAL.ingresoLinea);
    return () => charts.forEach((c) => c.destroy());
  }, [graficosSerie, tab, graficosVista]);

  // Evolutivo de lo que realmente se cobró (solo lo anotado en Sueldos), agrupado por mes, trimestre o año.
  const sueldoSerie = useMemo(() => {
    if (!graficos) return null;
    const todos = graficos.cobros || [];
    if (!todos.length) return { vacio: true, anios: [], periodos: [] };
    const anios = [...new Set(todos.map((c) => c.fecha.slice(0, 4)))].sort().reverse();
    const lista = sueldoAnio === "todos" ? todos : todos.filter((c) => c.fecha.startsWith(sueldoAnio));
    const mes3 = (i) => MESES_NOMBRE[i].slice(0, 3).toLowerCase();
    const claveDe = (fecha) => {
      const [y, m] = fecha.split("-").map(Number);
      if (sueldoAgrupar === "anio") return y;
      if (sueldoAgrupar === "trimestre") return y * 4 + Math.floor((m - 1) / 3);
      return y * 12 + (m - 1);
    };
    const etiquetaDe = (k) => {
      if (sueldoAgrupar === "anio") return String(k);
      if (sueldoAgrupar === "trimestre") return `T${(k % 4) + 1} ${Math.floor(k / 4)}`;
      return `${mes3(k % 12)} ${Math.floor(k / 12)}`;
    };
    const acum = {};
    lista.forEach((c) => {
      const k = claveDe(c.fecha);
      if (!acum[k]) acum[k] = { sueldo: 0, extra: 0, mesesSueldo: new Set() };
      acum[k][c.tipo] += c.monto;
      if (c.tipo === "sueldo") acum[k].mesesSueldo.add(c.fecha.slice(0, 7));
    });
    const claves = Object.keys(acum).map(Number);
    const periodos = [];
    for (let k = Math.min(...claves); k <= Math.max(...claves); k++) {
      const v = acum[k] || { sueldo: 0, extra: 0, mesesSueldo: new Set() };
      const meses = v.mesesSueldo.size;
      // "sueldo" es el promedio por mes cobrado del período: así un trimestre o año incompleto se compara parejo
      // (sumar todo haría parecer una caída que no existe). "total" es lo cobrado en el período.
      periodos.push({ k, label: etiquetaDe(k), total: v.sueldo, meses, sueldo: meses ? v.sueldo / meses : 0, extra: v.extra });
    }
    // Variación contra el período anterior que tuvo ese mismo tipo de cobro (un período sin cobro no cuenta como -100%).
    let anteriorSueldo = null, anteriorExtra = null;
    periodos.forEach((p) => {
      p.varSueldo = p.sueldo > 0 && anteriorSueldo ? (p.sueldo - anteriorSueldo) / anteriorSueldo : null;
      if (p.sueldo > 0) anteriorSueldo = p.sueldo;
      p.varExtra = p.extra > 0 && anteriorExtra ? (p.extra - anteriorExtra) / anteriorExtra : null;
      if (p.extra > 0) anteriorExtra = p.extra;
    });
    const conSueldo = periodos.filter((p) => p.sueldo > 0);
    const ultimo = conSueldo.length ? conSueldo[conSueldo.length - 1] : null;
    const ultimos = conSueldo.slice(-6);
    return {
      periodos, anios, ultimo,
      promedio: ultimos.length ? ultimos.reduce((acc, p) => acc + p.sueldo, 0) / ultimos.length : null,
      cuantosPromedio: ultimos.length,
      totalExtra: periodos.reduce((acc, p) => acc + p.extra, 0)
    };
  }, [graficos, sueldoAgrupar, sueldoAnio]);

  useEffect(() => {
    if (tab !== "graficos" || graficosVista !== "sueldos" || !sueldoSerie || sueldoSerie.vacio || !sueldoRef.current) return undefined;
    const ps = sueldoSerie.periodos;
    const opciones = opcionesChart();
    const pct = (v) => (v === null ? null : `${v > 0 ? "▲ +" : (v < 0 ? "▼ −" : "= ")}${Math.abs(Math.round(v * 1000) / 10)}%`);
    opciones.plugins.tooltip.callbacks.afterBody = (items) => {
      const p = items.length ? ps[items[0].dataIndex] : null;
      if (!p) return "";
      return [p.varSueldo !== null ? `Sueldo ${pct(p.varSueldo)} contra el período anterior` : "", p.varExtra !== null ? `Extra ${pct(p.varExtra)} contra el período anterior` : ""].filter(Boolean);
    };
    const chart = new Chart(sueldoRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: ps.map((p) => p.label),
        datasets: [
          { ...lineaReal(sueldoAgrupar === "mes" ? "Sueldo" : "Sueldo (promedio por mes)", ps.map((p) => (p.sueldo > 0 ? p.sueldo : null)), PAL.ingresoLinea), spanGaps: true },
          lineaReal("Extra", ps.map((p) => p.extra), PAL.cuota)
        ]
      },
      options: opciones
    });
    return () => chart.destroy();
  }, [sueldoSerie, sueldoAgrupar, tab, graficosVista]);

  // Cartera de IOL (solo lectura): se pide al abrir Ahorro o Gráficos → Cartera. Un error de IOL se muestra ahí mismo.
  async function cargarIol(forzar = false) {
    setIolCargando(true);
    try {
      setIol(await fetchJSON(forzar ? "/api/iol?forzar=1" : "/api/iol"));
    } catch (e) {
      setIol((previo) => (previo && previo.cartera ? previo : { configurado: true, error: e.message }));
    } finally {
      setIolCargando(false);
    }
  }

  useEffect(() => {
    if (iol !== null || !(tab === "ahorro" || (tab === "graficos" && (graficosVista === "cartera" || graficosVista === "ahorro")))) return;
    cargarIol();
  }, [tab, graficosVista, iol]);

  // Evolutivo de la cartera: una foto por día, en pesos y en dólares por separado (nunca dos escalas juntas).
  const carteraSerie = useMemo(() => {
    if (!iol || !iol.fotos) return null;
    const dias = Object.keys(iol.fotos).sort();
    if (!dias.length) return null;
    const ars = dias.map((d) => iol.fotos[d].ars);
    const usd = dias.map((d) => iol.fotos[d].usd);
    const variacion = (serie) => (serie.length > 1 && serie[0] > 0 ? (serie[serie.length - 1] - serie[0]) / serie[0] : null);
    return { dias, ars, usd, hayUsd: usd.some((v) => v > 0), varArs: variacion(ars), varUsd: variacion(usd) };
  }, [iol]);

  useEffect(() => {
    if (tab !== "graficos" || graficosVista !== "cartera" || !carteraSerie) return undefined;
    const charts = [];
    const linea = (canvas, etiqueta, datos, color, formato) => canvas && charts.push(new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: carteraSerie.dias.map(fechaLarga), datasets: [lineaReal(etiqueta, datos, color)] },
      options: { ...opcionesChart(formato), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${etiqueta}: ${formato(ctx.parsed.y)}` } } } }
    }));
    linea(iolArsRef.current, "Pesos", carteraSerie.ars, PAL.cuota, fmt);
    if (carteraSerie.hayUsd) linea(iolUsdRef.current, "Dólares", carteraSerie.usd, PAL.ahorro, fmtUSD2);
    return () => charts.forEach((c) => c.destroy());
  }, [carteraSerie, tab, graficosVista, graficosSerie]);

  // Pesos y dólares ahorrados, cada uno en su propio gráfico (nunca dos escalas en un mismo gráfico).
  useEffect(() => {
    if (tab !== "graficos" || graficosVista !== "ahorro") return undefined;
    const filas = tenencia.filas;
    const charts = [];
    const linea = (canvas, etiqueta, datos, color, formato) => new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: filas.map((f) => fechaLarga(f.fecha)),
        datasets: [{ label: etiqueta, data: datos, borderColor: color, backgroundColor: color, stepped: true, borderWidth: 3, pointRadius: 4 }]
      },
      options: { ...opcionesChart(formato), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${etiqueta}: ${formato(ctx.parsed.y)}` } } } }
    });
    if (ahorroCanvasRef.current && filas.some((f) => f.moneda !== "USD")) {
      charts.push(linea(ahorroCanvasRef.current, "Pesos acumulados", filas.map((f) => f.accARS), PAL.gasto, fmt));
    }
    if (ahorroUsdRef.current && filas.some((f) => f.moneda === "USD")) {
      charts.push(linea(ahorroUsdRef.current, "Dólares acumulados", filas.map((f) => f.accUSD), PAL.ahorro, fmtUSD2));
    }
    return () => charts.forEach((c) => c.destroy());
  }, [tenencia, tab, graficosVista, graficosSerie]);

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
              // En el mes en curso no se proyecta el ahorro: se muestra lo que realmente se ahorró.
              const enCurso = mo.key === hoyKey;
              const ahorradoReal = enCurso ? (mo.ahorroReal ? mo.ahorroReal.montoARS : 0) : null;
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
                          <span className="hero-label" id="hero-titulo">{enCurso ? "Ahorrado este mes" : "Ahorro proyectado"}</span>
                          <span className="estado-chip">{enCurso ? "Mes en curso" : est.texto}</span>
                        </div>
                        <div className="hero-value">{fmt(enCurso ? ahorradoReal : mo.ahorroProyectado)}</div>
                        <p className="hero-sub">{enCurso
                          ? (ahorradoReal > 0 ? "Lo que realmente apartaste este mes en Ahorro." : "Todavía no cargaste ahorro este mes.")
                          : textoEstado}</p>

                        <div className="flow-bar on-hero" role="img" aria-label={`De ${fmt(mo.ingresos)} de ingresos: gastos ${fmt(mo.gastos)}, piso ${fmt(mo.piso)}, ahorro ${fmt(mo.ahorroProyectado)}`}>
                          <span className="f-gasto" style={{ width: ancho(Math.min(mo.gastos, base)) }}></span>
                          <span className="f-libre" style={{ width: ancho(mo.piso) }}></span>
                          <span className="f-ahorro" style={{ width: ancho(enCurso ? ahorradoReal : mo.ahorroProyectado) }}></span>
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

                      {capacidad && (
                        <section className="cobro-card">
                          <button className="cobro-toggle" aria-expanded={cobroAbierto} aria-controls="cobro-panel" onClick={() => setCobroAbierto((v) => !v)}>
                            <span>Hasta cobrar</span>
                            <span className="muted">{capacidad.diasRestantes} {capacidad.diasRestantes === 1 ? "día" : "días"} · {cobroAbierto ? "ocultar" : "ver"} <span className={`cobro-chevron${cobroAbierto ? " abierto" : ""}`} aria-hidden="true">▾</span></span>
                          </button>
                          {cobroAbierto && (
                            <div id="cobro-panel" className="cobro-panel">
                              <p className="cobro-intro muted">Completá estos tres datos y se calcula solo cuánto podés gastar por día hasta cobrar el {fechaCortaISO(capacidad.hasta)}.</p>

                              <fieldset className="cobro-paso">
                                <legend>1. ¿Qué ya pagaste de {labelTramo(capacidad.mesKey)}?</legend>
                                {capacidad.grupos.length === 0 ? (
                                  <p className="muted">No hay nada comprometido para este mes.</p>
                                ) : capacidad.grupos.map((g) => (
                                  <label className="cobro-check" key={g.id}>
                                    <input type="checkbox" checked={saldoPagados.includes(g.id)} onChange={() => alternarPagado(g.id)} />
                                    <span>{g.tipo === "tarjeta" ? "Tarjeta " : ""}{g.nombre}</span>
                                    <strong>{fmt(g.total)}</strong>
                                  </label>
                                ))}
                              </fieldset>

                              <div className="cobro-paso">
                                <label htmlFor="saldo-monto">2. ¿Cuánto tenés hoy en tu cuenta?</label>
                                <input id="saldo-monto" type="number" inputMode="decimal" placeholder="Ej.: 650000" value={saldoMonto} onChange={(e) => { setSaldoMonto(e.target.value); programarSaldo(true); }} />
                              </div>

                              <div className="cobro-paso">
                                <label htmlFor="saldo-ahorrado">3. ¿Cuánto ahorraste desde que cobraste?</label>
                                <input id="saldo-ahorrado" type="number" inputMode="decimal" placeholder="0" value={saldoAhorrado} onChange={(e) => { setSaldoAhorrado(e.target.value); programarSaldo(false); }} />
                                <small className="muted">Se carga solo en la pestaña Ahorro. Es el total del período, no lo que sumás hoy.</small>
                              </div>

                              {capacidad.saldo && (
                                <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => guardarSaldo(true)}>Usar la estimación</button>
                              )}
                              {saldoStatus && <StatusMsg texto={saldoStatus} />}

                              <div className="cobro-resultado">
                                {capacidad.enDeficit ? (
                                  <p className="cobro-deficit">
                                    {capacidad.modo === "saldo"
                                      ? `Lo que tenés no alcanza para lo que te falta pagar: faltan ${fmt(-capacidad.libre)}.`
                                      : `Los ingresos de ${labelTramo(capacidad.mesKey)} no alcanzan para lo comprometido: faltan ${fmt(-capacidad.libre)}.`}
                                  </p>
                                ) : (
                                  <div className="cobro-valor">{fmt(capacidad.porDia)}<small> por día hasta el {fechaCortaISO(capacidad.hasta)}</small></div>
                                )}
                                <div className="cobro-cuenta">
                                  {capacidad.modo === "saldo" ? (
                                    <>
                                      <span>Tenés <strong>{fmt(capacidad.saldo.monto)}</strong></span>
                                      <span>− Te falta pagar <strong>{fmt(capacidad.pendiente)}</strong>{capacidad.pagado > 0 ? ` (ya pagaste ${fmt(capacidad.pagado)})` : ""}</span>
                                      {capacidad.gastado > 0 && <span>− Gastaste después de cargar lo que tenés <strong>{fmt(capacidad.gastado)}</strong></span>}
                                      {capacidad.reservado > 0 && <span>− Reservado en MercadoPago <strong>{fmt(capacidad.reservado)}</strong></span>}
                                      {capacidad.ahorrado > 0 && <span>− Ahorrado después de calcular esto <strong>{fmt(capacidad.ahorrado)}</strong></span>}
                                      <span>= Podés gastar <strong>{fmt(capacidad.libre)}</strong> en {capacidad.diasRestantes} {capacidad.diasRestantes === 1 ? "día" : "días"}</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>Ingresos de {labelTramo(capacidad.mesKey)} <strong>{fmt(capacidad.ingresos)}</strong></span>
                                      <span>− Comprometido <strong>{fmt(capacidad.comprometido)}</strong></span>
                                      {capacidad.ahorrado > 0 && <span>− Ahorrado desde el último cobro <strong>{fmt(capacidad.ahorrado)}</strong></span>}
                                      {capacidad.reservado > 0 && <span>− Reservado en MercadoPago <strong>{fmt(capacidad.reservado)}</strong></span>}
                                      <span>= Podés gastar <strong>{fmt(capacidad.libre)}</strong> en {capacidad.diasRestantes} {capacidad.diasRestantes === 1 ? "día" : "días"}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <details className="cierre-details">
                                <summary>Reserva automática de MercadoPago{reservaVigente && reservaVigente.activa ? " · activa" : ""}</summary>
                                <p className="hint" style={{ margin: "8px 0" }}>
                                  Por cada gasto al contado en MercadoPago por transferencia se aparta plata: sigue siendo tuya, pero se descuenta de lo que podés gastar. Vale desde que la activás.
                                </p>
                                <label className="cobro-check">
                                  <input type="checkbox" checked={reservaForm.activa} onChange={(e) => setReservaForm({ ...reservaForm, activa: e.target.checked })} />
                                  <span>Activar la reserva</span>
                                </label>
                                <div className="field-row" style={{ marginTop: 10 }}>
                                  <div className="field">
                                    <label htmlFor="reserva-tipo">Cómo se calcula</label>
                                    <select id="reserva-tipo" value={reservaForm.tipo} onChange={(e) => setReservaForm({ ...reservaForm, tipo: e.target.value })}>
                                      <option value="porcentaje">Un porcentaje del gasto</option>
                                      <option value="fijo">Un monto fijo por gasto</option>
                                    </select>
                                  </div>
                                  <div className="field">
                                    <label htmlFor="reserva-valor">{reservaForm.tipo === "porcentaje" ? "Porcentaje (%)" : "Monto por gasto ($)"}</label>
                                    <input id="reserva-valor" type="number" inputMode="decimal" placeholder={reservaForm.tipo === "porcentaje" ? "Ej.: 2" : "Ej.: 100"} value={reservaForm.valor} onChange={(e) => setReservaForm({ ...reservaForm, valor: e.target.value })} />
                                  </div>
                                </div>
                                <button className="btn-primary" onClick={guardarReserva} disabled={reservaForm.valor === ""}>Guardar</button>
                                {reservaStatus && <StatusMsg texto={reservaStatus} />}
                                {reservaVigente && reservaVigente.activa && reservaVigente.desde && (
                                  <p className="hint" style={{ margin: "8px 0 0" }}>Rige desde el {fechaLarga(reservaVigente.desde)}: cuenta lo que cargues a partir de ahí.</p>
                                )}
                              </details>

                              <p className="cobro-nota muted">
                                {capacidad.modo === "saldo"
                                  ? `Calculado con lo que cargaste el ${fechaCortaISO(capacidad.saldo.fecha)}. Los pagos únicos en transferencia o efectivo que cargues después se descuentan solos; si gastaste algo que no anotaste, volvé a calcular.`
                                  : capacidad.saldoVencido
                                    ? "Lo que cargaste es de un período anterior: ya cobraste de nuevo, así que se usa la estimación. Respondé las tres preguntas para afinarla."
                                    : "Por ahora es una estimación con lo cargado en la planilla: no conoce el saldo de tu cuenta."}
                                {" "}El sueldo del último día hábil de cada mes paga el mes siguiente.
                              </p>
                            </div>
                          )}
                        </section>
                      )}

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
                <h2>Compras: lo más grande de cada mes</h2>
              </div>
              {histEvolutivo.length === 0 ? (
                <Skeleton />
              ) : (
                <>
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
                        <div><span className="muted">Día a día (al contado)</span> <strong>{fmt(gastosKpis.cur.contado)}</strong></div>
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
                      {[["fijo", PAL.gasto], ["contado", PAL.contado], ["variable", PAL.variable], ["cuotas", PAL.cuota]].map(([k, color]) => (
                        <span key={k} style={{ width: `${gastosKpis.total ? (gastosKpis.cur[k] / gastosKpis.total) * 100 : 0}%`, background: color }}></span>
                      ))}
                    </div>
                    {[["fijo", "Gastos fijos", PAL.gasto], ["contado", "Día a día (al contado)", PAL.contado], ["variable", "Un pago (tarjeta u otro medio)", PAL.variable], ["cuotas", "Compras en cuotas", PAL.cuota]].map(([k, nombre, color]) => (
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
                    <div className="card-head"><h2>Los 5 gastos más grandes del mes</h2></div>
                    {gastosKpis.top5.map((g, i) => (
                      <div className="top-gasto" key={i}>
                        <div>
                          <div className="strong">{g.desc}</div>
                          <div className="cat-item-medio">{g.categoria} · {g.medio}</div>
                          {g.detalle === "Fijo"
                            ? <span className="badge badge-neutral">Fijo</span>
                            : (Number(g.cuotasTotales) > 1
                              ? <span className="badge badge-info">{g.cuotaNumero}/{g.cuotasTotales} cuotas</span>
                              : (g.alContado && <span className="badge badge-contado">Al contado</span>))}
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
                                <span className={`badge ${g.detalle === "Fijo" ? "badge-neutral" : (g.alContado ? "badge-contado" : "badge-info")}`}>{g.detalle}</span>
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
                    <h2>Gastos: lo más grande de cada mes</h2>
                  </div>
                  {evolutivo.length === 0 ? (
                    <Skeleton />
                  ) : (
                    <>
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

        {tab === "sueldos" && (
          <div className="stack">
            <section className="card">
              <div className="card-head"><h2>Anotá lo que cobraste</h2></div>
              <p className="hint" style={{ margin: "0 0 12px" }}>Es solo un registro de lo que de verdad cobraste: no cambia la proyección. El aguinaldo y cualquier otro ingreso aparte va como extra.</p>
              <div className="pago-fields">
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="cobro-fecha">Fecha de cobro</label>
                    <input id="cobro-fecha" type="date" value={cobroForm.fecha} onChange={(e) => setCobroForm({ ...cobroForm, fecha: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="cobro-monto">Monto cobrado</label>
                    <input id="cobro-monto" type="number" inputMode="decimal" placeholder="0" value={cobroForm.monto} onChange={(e) => setCobroForm({ ...cobroForm, monto: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label>Tipo</label>
                  <Segmented value={cobroForm.tipo} onChange={(v) => setCobroForm({ ...cobroForm, tipo: v })} options={[{ value: "sueldo", label: "Sueldo" }, { value: "extra", label: "Extra" }]} />
                </div>
                <div className="field">
                  <label htmlFor="cobro-nota">Nota <span className="muted">(opcional)</span></label>
                  <input id="cobro-nota" type="text" maxLength={80} placeholder={cobroForm.tipo === "extra" ? "Ej.: aguinaldo, turnos, venta" : "Ej.: octubre"} value={cobroForm.nota} onChange={(e) => setCobroForm({ ...cobroForm, nota: e.target.value })} />
                </div>
                <button className="btn-primary" onClick={guardarCobro}>Guardar cobro</button>
                {cobroStatus && <StatusMsg texto={cobroStatus} />}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2>Lo que fuiste cobrando</h2></div>
              {cobros === null ? (
                <Skeleton />
              ) : cobros.length === 0 ? (
                <div className="empty-hint">Todavía no anotaste ningún cobro. El evolutivo se arma con lo que anotes acá.</div>
              ) : (
                <div className="mov-list">
                  {cobros.map((c) => (
                    <div className="mov-row" key={c.id}>
                      <div className="mov-fecha">{fechaLarga(c.fecha)}</div>
                      <div className="mov-monto pos">+ {fmt(c.monto)}</div>
                      <div className="mov-acum">
                        <span className={`badge ${c.tipo === "extra" ? "badge-info" : "badge-ok"}`}>{c.tipo === "extra" ? "Extra" : "Sueldo"}</span>
                        {c.nota ? <span className="muted"> {c.nota}</span> : null}
                      </div>
                      <button className="btn-danger-ghost" onClick={() => eliminarCobroReal(c)}>Eliminar</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="hint" style={{ margin: "12px 0 0" }}>El gráfico de evolución está en la sección Gráficos → Sueldos.</p>
            </section>
          </div>
        )}

        {tab === "graficos" && (
          <div className="stack">
            <Segmented value={graficosVista} onChange={setGraficosVista} options={[{ value: "ahorro", label: "Ahorro" }, { value: "gastos", label: "Gastos" }, { value: "sueldos", label: "Sueldos" }, { value: "cartera", label: "Cartera" }, { value: "proyeccion", label: "Proyección" }]} />

            {graficosSerie === null ? (
              <section className="card"><Skeleton /></section>
            ) : (
              <>
                {(graficosVista === "ahorro" || graficosVista === "gastos") && (
                  <p className="hint leyenda-graf">
                    <strong>Línea punteada: lo proyectado.</strong> Cuando un mes arranca queda fija, así ves cuánto se desvió; en los meses que vienen cambia con lo que cargues.
                    {" "}<strong>Línea sólida: lo real.</strong> La marca vertical es hoy.
                    {graficosSerie.aproxHasta ? ` Hasta ${graficosSerie.aproxHasta} el proyectado es aproximado: la app todavía no guardaba la foto de esos meses.` : ""}
                  </p>
                )}

                {graficosVista === "ahorro" && (
                  <>
                    <div className="kpi-3">
                      <section className="card">
                        <div className="stat-tile-label">Ahorrado de verdad</div>
                        <div className="stat-tile-value">{fmt(graficosSerie.real)}</div>
                        <div className="stat-tile-sub">de {graficosSerie.desde} a {graficosSerie.hasta}</div>
                      </section>
                      <section className="card">
                        <div className="stat-tile-label">Lo proyectado</div>
                        <div className="stat-tile-value">{fmt(graficosSerie.plan)}</div>
                        <div className="stat-tile-sub">ingresos − gastos − piso, en los mismos meses</div>
                      </section>
                      <section className="card">
                        <div className="stat-tile-label">Diferencia</div>
                        <div className={`stat-tile-value ${graficosSerie.dif >= 0 ? "pos" : "neg"}`}>{graficosSerie.dif >= 0 ? "+" : "−"}{fmt(Math.abs(graficosSerie.dif))}</div>
                        <div className="stat-tile-sub">{graficosSerie.dif >= 0 ? "ahorraste más de lo proyectado" : "ahorraste menos de lo proyectado"}</div>
                      </section>
                    </div>

                    <section className="card">
                      <div className="card-head"><h2>Ahorro por mes: proyectado contra real</h2></div>
                      <div className="chart-box"><canvas ref={ahorroMesRef}></canvas></div>
                      <p className="hint grafico-nota">Lo proyectado es lo que queda de los ingresos después de los gastos y el piso. Lo real es lo que cargaste en Ahorro ese mes. Los meses que vienen solo tienen proyección.</p>
                    </section>

                    <section className="card">
                      <div className="card-head"><h2>Ahorro acumulado</h2></div>
                      <div className="chart-box"><canvas ref={ahorroAcumRef}></canvas></div>
                      {graficosSerie.hayIol && (
                        <p className="hint grafico-nota">
                          El real incluye el valor total de tu cartera de IOL en pesos, con los dólares al blue de hoy ({fmt(dolarBlue || 0)}), desde que la conectaste el {fechaLarga(graficosSerie.iolDesde)}. Antes de esa fecha no hay historia de IOL, por eso la línea sube de golpe ese mes.
                        </p>
                      )}
                    </section>

                    {tenencia.filas.some((f) => f.moneda !== "USD") && (
                      <section className="card">
                        <div className="card-head"><h2>Pesos ahorrados, acumulado</h2></div>
                        <div className="chart-box"><canvas ref={ahorroCanvasRef}></canvas></div>
                      </section>
                    )}
                    {tenencia.filas.some((f) => f.moneda === "USD") && (
                      <section className="card">
                        <div className="card-head"><h2>Dólares ahorrados, acumulado</h2></div>
                        <div className="chart-box"><canvas ref={ahorroUsdRef}></canvas></div>
                      </section>
                    )}
                  </>
                )}

                {graficosVista === "gastos" && (
                  <>
                    <section className="card">
                      <div className="card-head"><h2>Gastos: proyectado contra real</h2></div>
                      <div className="chart-box"><canvas ref={gastoIngRef}></canvas></div>
                      <p className="hint grafico-nota">La distancia entre las dos líneas es lo que se gastó de más o de menos contra lo que se esperaba al empezar el mes. El real del mes en curso incluye lo que todavía falta pagar.</p>
                    </section>

                    <section className="card">
                      <div className="card-head"><h2>Ingresos: proyectado contra cobrado</h2></div>
                      <div className="chart-box"><canvas ref={ingresoRef}></canvas></div>
                      <p className="hint grafico-nota">Lo cobrado es lo que anotaste en Sueldos (sueldo y extra) en cada mes.</p>
                    </section>

                    <section className="card">
                      <div className="card-head-row">
                        <h2>Evolución de gastos</h2>
                        {gastosKpis && gastosKpis.tendencia && (
                          <span className={`badge ${gastosKpis.tendencia.texto === "en alza" ? "badge-info" : "badge-neutral"}`}>
                            Tendencia {gastosKpis.tendencia.texto} ({gastosKpis.tendencia.dif > 0 ? "+" : ""}{Math.round(gastosKpis.tendencia.dif * 100)}%)
                          </span>
                        )}
                      </div>
                      {!gastosKpis ? <Skeleton /> : (
                        <>
                          <div className="chart-box" style={{ height: 240, marginBottom: 8 }}><canvas ref={gastosDashRef}></canvas></div>
                          <p className="hint" style={{ margin: 0 }}>
                            Línea punteada: promedio de {gastosKpis.serie.length} meses ({fmt(gastosKpis.promedio)}).
                            {gastosKpis.tendencia ? " Tendencia: últimos 3 meses contra los 3 anteriores." : ""}
                          </p>
                        </>
                      )}
                    </section>

                    <section className="card">
                      <div className="card-head"><h2>Evolutivo de gastos</h2></div>
                      {evolutivo.length === 0 ? <Skeleton /> : <div className="chart-box"><canvas ref={gastosCanvasRef}></canvas></div>}
                    </section>

                    <section className="card">
                      <div className="card-head"><h2>Evolutivo de compras (valor de cuota)</h2></div>
                      {histEvolutivo.length === 0 ? <Skeleton /> : <div className="chart-box"><canvas ref={histCanvasRef}></canvas></div>}
                    </section>
                  </>
                )}

                {graficosVista === "sueldos" && (
                  !sueldoSerie || sueldoSerie.vacio ? (
                    <section className="card">
                      <div className="card-head"><h2>Evolutivo de lo que cobraste</h2></div>
                      <div className="empty-hint">Todavía no anotaste cobros. Cargalos en la sección Sueldos y acá aparece el evolutivo.</div>
                    </section>
                  ) : (
                    <>
                      <div className="filtros-fila">
                        <Segmented value={sueldoAgrupar} onChange={setSueldoAgrupar} options={[{ value: "mes", label: "Por mes" }, { value: "trimestre", label: "Por trimestre" }, { value: "anio", label: "Por año" }]} />
                        {sueldoSerie.anios.length > 1 && (
                          <select aria-label="Filtrar por año" value={sueldoAnio} onChange={(e) => setSueldoAnio(e.target.value)}>
                            <option value="todos">Todos los años</option>
                            {sueldoSerie.anios.map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                        )}
                      </div>
                      <div className="kpi-3">
                        <section className="card">
                          <div className="stat-tile-label">{sueldoAgrupar === "mes" ? "Último sueldo" : "Último período (por mes)"}</div>
                          <div className="stat-tile-value">{sueldoSerie.ultimo ? fmt(sueldoSerie.ultimo.sueldo) : "—"}</div>
                          <div className="stat-tile-sub">
                            {sueldoSerie.ultimo ? sueldoSerie.ultimo.label : "sin sueldos anotados"}
                            {sueldoSerie.ultimo && sueldoSerie.ultimo.varSueldo !== null ? ` · ${textoVariacion(sueldoSerie.ultimo.varSueldo)} contra el anterior` : ""}
                          </div>
                        </section>
                        <section className="card">
                          <div className="stat-tile-label">Sueldo promedio</div>
                          <div className="stat-tile-value">{sueldoSerie.promedio !== null ? fmt(sueldoSerie.promedio) : "—"}</div>
                          <div className="stat-tile-sub">de los últimos {sueldoSerie.cuantosPromedio} {sueldoAgrupar === "anio" ? "años" : (sueldoAgrupar === "trimestre" ? "trimestres" : "meses")} con sueldo</div>
                        </section>
                        <section className="card">
                          <div className="stat-tile-label">Extras cobrados</div>
                          <div className="stat-tile-value">{fmt(sueldoSerie.totalExtra)}</div>
                          <div className="stat-tile-sub">en el período mostrado (sin el sueldo normal)</div>
                        </section>
                      </div>
                      <section className="card">
                        <div className="card-head"><h2>Evolutivo de lo que cobraste</h2></div>
                        <div className="chart-box"><canvas ref={sueldoRef}></canvas></div>
                        <p className="hint grafico-nota">
                          Cuenta solo lo que anotaste en Sueldos. Verde: sueldo normal; azul: extras (aguinaldo, turnos, ventas).
                          {sueldoAgrupar !== "mes" ? " El sueldo es el promedio por mes cobrado de cada período, así un trimestre o año que todavía no terminó se compara parejo; los extras suman todo lo cobrado." : ""}
                        </p>
                      </section>
                      <section className="card">
                        <div className="card-head"><h2>Variación contra el período anterior</h2></div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr><th>Período</th><th className="num">{sueldoAgrupar === "mes" ? "Sueldo" : "Sueldo por mes"}</th><th className="num">Variación</th>{sueldoAgrupar !== "mes" && <th className="num">Total cobrado</th>}<th className="num">Extra</th><th className="num">Variación</th></tr>
                            </thead>
                            <tbody>
                              {[...sueldoSerie.periodos].reverse().map((p) => (
                                <tr key={p.k}>
                                  <td className="strong">{p.label}</td>
                                  <td className="num">{p.sueldo > 0 ? fmt(p.sueldo) : "—"}</td>
                                  <td className={`num ${p.varSueldo === null ? "" : (p.varSueldo >= 0 ? "pos" : "neg")}`}>{p.varSueldo === null ? "—" : textoVariacion(p.varSueldo)}</td>
                                  {sueldoAgrupar !== "mes" && <td className="num">{p.total > 0 ? `${fmt(p.total)} (${p.meses} ${p.meses === 1 ? "mes" : "meses"})` : "—"}</td>}
                                  <td className="num">{p.extra > 0 ? fmt(p.extra) : "—"}</td>
                                  <td className={`num ${p.varExtra === null ? "" : (p.varExtra >= 0 ? "pos" : "neg")}`}>{p.varExtra === null ? "—" : textoVariacion(p.varExtra)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </>
                  )
                )}

                {graficosVista === "cartera" && (
                  iol === null ? (
                    <section className="card"><Skeleton /></section>
                  ) : !iol.configurado || iol.error ? (
                    <section className="card">
                      <div className="card-head"><h2>Evolutivo de la cartera</h2></div>
                      <div className="empty-hint">{iol.error ? iol.error : "Conectá IOL desde la pestaña Ahorro para ver acá cómo evoluciona tu cartera."}</div>
                    </section>
                  ) : !carteraSerie ? (
                    <section className="card"><Skeleton /></section>
                  ) : (
                    <>
                      <div className="kpi-3">
                        <section className="card">
                          <div className="stat-tile-label">Cartera en pesos</div>
                          <div className="stat-tile-value">{fmt(iol.cartera.total.ars)}</div>
                          <div className="stat-tile-sub">
                            {carteraSerie.varArs === null ? "se compara a partir del segundo día" : `${textoVariacion(carteraSerie.varArs)} desde el ${fechaLarga(carteraSerie.dias[0])}`}
                          </div>
                        </section>
                        <section className="card">
                          <div className="stat-tile-label">Cartera en dólares</div>
                          <div className="stat-tile-value">{fmtUSD2(iol.cartera.total.usd)}</div>
                          <div className="stat-tile-sub">
                            {carteraSerie.varUsd === null ? "se compara a partir del segundo día" : `${textoVariacion(carteraSerie.varUsd)} desde el ${fechaLarga(carteraSerie.dias[0])}`}
                          </div>
                        </section>
                        <section className="card">
                          <div className="stat-tile-label">Días registrados</div>
                          <div className="stat-tile-value">{carteraSerie.dias.length}</div>
                          <div className="stat-tile-sub">una foto por día</div>
                        </section>
                      </div>
                      <section className="card">
                        <div className="card-head"><h2>Cartera en pesos</h2></div>
                        <div className="chart-box"><canvas ref={iolArsRef}></canvas></div>
                      </section>
                      {carteraSerie.hayUsd && (
                        <section className="card">
                          <div className="card-head"><h2>Cartera en dólares</h2></div>
                          <div className="chart-box"><canvas ref={iolUsdRef}></canvas></div>
                        </section>
                      )}
                      <p className="hint grafico-nota">Incluye lo invertido y lo disponible en tu cuenta de IOL. Se guarda una foto por día, la primera vez que abrís Ahorro o esta vista; el historial arranca desde que conectaste IOL. Los movimientos de plata (depósitos y retiros) también mueven la línea.</p>
                    </>
                  )
                )}

                {graficosVista === "proyeccion" && (
                  <>
            <Segmented value={proyVista} onChange={setProyVista} options={[{ value: "proyeccion", label: "Proyección" }, { value: "sueldo", label: "Sueldo" }]} />
            {proyVista === "proyeccion" && (
              <>
            <section className="card">
              <div className="card-head"><h2>Evolución de los próximos meses</h2></div>
              <div className="chart-box"><canvas ref={canvasRef}></canvas></div>
            </section>
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
                  </>
                )}

                <details className="cierre-details">
                  <summary>Ver los datos en una tabla</summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr><th>Mes</th><th className="num">Ingresos proy.</th><th className="num">Cobrado</th><th className="num">Gastos proy.</th><th className="num">Gastos real</th><th className="num">Ahorro proy.</th><th className="num">Ahorro real</th></tr>
                      </thead>
                      <tbody>
                        {graficosSerie.filas.map((m) => (
                          <tr key={m.key}>
                            <td className="strong">{m.label}{m.estado === "actual" ? " · hoy" : ""}{m.aprox ? " *" : ""}</td>
                            <td className="num">{fmt(m.ingresos)}</td>
                            <td className="num">{m.ingresosReal === null ? "—" : fmt(m.ingresosReal)}</td>
                            <td className="num">{fmt(m.gastos)}</td>
                            <td className="num">{m.gastosReal === null ? "—" : fmt(m.gastosReal)}</td>
                            <td className="num">{fmt(m.ahorroProyectado)}</td>
                            <td className="num">{m.ahorroReal === null ? "—" : fmt(m.ahorroReal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        )}

        {tab === "ahorro" && (
          <div className="stack">
            <section className="card">
              <div className="card-head-row">
                <h2>Ahorro e inversiones</h2>
                <div className="tarjeta-totales">
                  <span className="badge badge-total">{fmt(patrimonio.equivArs)}</span>
                  <span className="badge badge-neutral">≈ {fmtUSD2(patrimonio.equivUsd)}</span>
                </div>
              </div>
              <p className="hint" style={{ margin: "0 0 10px" }}>
                Todo lo que tenés: lo que cargaste a mano más tu cartera de IOL. Los dólares se pasan a pesos al blue de hoy ({fmt(dolarBlue || 0)}).
              </p>
              {patrimonio.lugares.length === 0 ? (
                <div className="empty-hint">Todavía no cargaste ahorros. Agregá el primero abajo.</div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Dónde está</th><th className="num">Pesos</th><th className="num">Dólares</th><th className="num">Parte</th></tr>
                    </thead>
                    <tbody>
                      {patrimonio.lugares.map((l) => (
                        <tr key={l.lugar}>
                          <td className="strong">{l.lugar}{l.automatico ? <span className="muted"> · se actualiza solo</span> : null}</td>
                          <td className="num">{l.ars ? fmt(l.ars) : "—"}</td>
                          <td className="num">{l.usd ? fmtUSD2(l.usd) : "—"}</td>
                          <td className="num">{Math.round(l.parte * 100)}%</td>
                        </tr>
                      ))}
                      <tr className="fila-total">
                        <td className="strong">Total</td>
                        <td className="num strong">{fmt(patrimonio.total.ars)}</td>
                        <td className="num strong">{fmtUSD2(patrimonio.total.usd)}</td>
                        <td className="num">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="hint" style={{ margin: "10px 0 0" }}>
                {iol && iol.error
                  ? "No pude leer IOL ahora, así que el total no lo incluye."
                  : (iol && iol.configurado
                    ? "Lo que está en IOL aparece solo: no lo cargues a mano. Lo que dejás quieto, cargalo abajo con su lugar."
                    : "Lo que dejás quieto, cargalo abajo con su lugar. Cuando conectes IOL, lo que transfieras ahí se suma solo.")}
              </p>
            </section>

            <div className="two-col">
              <section className="card">
                <div className="stat-tile-label">Ahorrado a mano en pesos</div>
                <div className="stat-tile-value">{fmt(tenencia.totalARS)}</div>
                <div className="stat-tile-sub">≈ {fmtUSD2(dolarBlue ? tenencia.totalARS / dolarBlue : 0)} al dólar blue</div>
              </section>
              <section className="card">
                <div className="stat-tile-label">Ahorrado a mano en dólares</div>
                <div className="stat-tile-value">{fmtUSD2(tenencia.totalUSD)}</div>
                <div className="stat-tile-sub">≈ {fmt(tenencia.totalUSD * (dolarBlue || 0))} al dólar blue</div>
              </section>
            </div>

            <section className="card">
              <div className="card-head-row">
                <h2>Inversiones en IOL</h2>
                {iol && iol.configurado && !iol.error && (
                  <button className="btn-ghost-sm" onClick={() => cargarIol(true)} disabled={iolCargando}>{iolCargando ? "Actualizando..." : "Actualizar"}</button>
                )}
              </div>
              {iol === null ? (
                <Skeleton />
              ) : !iol.configurado ? (
                <>
                  <p className="hint" style={{ margin: "0 0 8px" }}>Conectá tu cuenta de InvertirOnline para ver acá tu cartera. Es solo lectura: la app consulta, no compra ni vende.</p>
                  <details className="cierre-details">
                    <summary>Cómo conectarla</summary>
                    <ol className="pasos-iol">
                      <li>Pedile a IOL que active la API desde tu cuenta (Mi cuenta → API) y aceptá los términos. Confirmá antes si tiene costo.</li>
                      <li>En Vercel → Settings → Environment Variables cargá <code>IOL_USUARIO</code> y <code>IOL_CLAVE</code> (entorno Production).</li>
                      <li>Volvé a desplegar (Redeploy). Tu clave queda solo en Vercel: no pasa por la planilla ni por el navegador.</li>
                    </ol>
                  </details>
                </>
              ) : iol.error ? (
                <>
                  <StatusMsg texto={"❌ " + iol.error} />
                  <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => cargarIol(true)} disabled={iolCargando}>Reintentar</button>
                </>
              ) : (
                <>
                  <div className="kpi-3">
                    <div className="card">
                      <div className="stat-tile-label">Total en pesos</div>
                      <div className="stat-tile-value">{fmt(iol.cartera.total.ars)}</div>
                      <div className="stat-tile-sub">invertido {fmt(iol.cartera.invertido.ars)} · disponible {fmt(iol.cartera.disponible.ars)}</div>
                    </div>
                    <div className="card">
                      <div className="stat-tile-label">Total en dólares</div>
                      <div className="stat-tile-value">{fmtUSD2(iol.cartera.total.usd)}</div>
                      <div className="stat-tile-sub">invertido {fmtUSD2(iol.cartera.invertido.usd)} · disponible {fmtUSD2(iol.cartera.disponible.usd)}</div>
                    </div>
                    <div className="card">
                      <div className="stat-tile-label">Todo en pesos</div>
                      <div className="stat-tile-value">{fmt(iol.cartera.total.ars + iol.cartera.total.usd * (dolarBlue || 0))}</div>
                      <div className="stat-tile-sub">con los dólares al blue de hoy</div>
                    </div>
                  </div>
                  {iol.cartera.activos.length === 0 ? (
                    <div className="empty-hint">No hay títulos en tu cartera.</div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>Título</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Valor</th><th className="num">Ganancia</th><th className="num">Hoy</th></tr>
                        </thead>
                        <tbody>
                          {iol.cartera.activos.map((a) => {
                            const f = a.moneda === "USD" ? fmtUSD2 : fmt;
                            return (
                              <tr key={a.simbolo + a.moneda}>
                                <td className="strong">{a.simbolo}<span className="muted"> {a.descripcion}</span></td>
                                <td className="num">{a.cantidad.toLocaleString("es-AR")}</td>
                                <td className="num">{f(a.ultimoPrecio)}</td>
                                <td className="num">{f(a.valorizado)}</td>
                                <td className={`num ${a.gananciaDinero >= 0 ? "pos" : "neg"}`}>{f(a.gananciaDinero)} ({a.gananciaPorcentaje >= 0 ? "+" : ""}{String(Math.round(a.gananciaPorcentaje * 10) / 10).replace(".", ",")}%)</td>
                                <td className={`num ${a.variacionDiaria >= 0 ? "pos" : "neg"}`}>{a.variacionDiaria >= 0 ? "+" : ""}{String(Math.round(a.variacionDiaria * 10) / 10).replace(".", ",")}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="hint" style={{ margin: "10px 0 0" }}>
                    Actualizado a las {new Date(iol.cartera.actualizado).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · Esto no se suma a lo que cargaste en Ahorro · El evolutivo está en Gráficos → Cartera
                  </p>
                </>
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
                        <select className="lugar-select" aria-label="Dónde está" value={f.lugar || ""} onChange={(e) => cambiarLugarAhorro(f.id, e.target.value)}>
                          <option value="">Sin ubicar</option>
                          {LUGARES.filter((l) => l !== "Otro").map((l) => <option key={l} value={l}>{l}</option>)}
                          {f.lugar && !LUGARES.includes(f.lugar) ? <option value={f.lugar}>{f.lugar}</option> : null}
                        </select>
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
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>¿Dónde lo dejás?</label>
                    <select value={ahorroForm.lugar} onChange={(e) => setAhorroForm({ ...ahorroForm, lugar: e.target.value })}>
                      <option value="">Sin ubicar</option>
                      {LUGARES.map((l) => <option key={l} value={l}>{l === "Otro" ? "Otro…" : l}</option>)}
                    </select>
                  </div>
                  {ahorroForm.lugar === "Otro" && (
                    <div className="field">
                      <label>¿Dónde?</label>
                      <input type="text" maxLength={40} placeholder="Ej.: casa de mis viejos" value={ahorroForm.lugarOtro} onChange={(e) => setAhorroForm({ ...ahorroForm, lugarOtro: e.target.value })} />
                    </div>
                  )}
                  <div className="field field-action">
                    <button className="btn-primary" onClick={guardarAhorro}>Agregar</button>
                  </div>
                </div>
                <p className="hint" style={{ margin: "8px 0 0" }}>Si lo dejás en IOL, transferilo a IOL y aparece solo: no lo cargues acá.</p>
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
            <span>{t.corto || t.label}</span>
          </button>
        ))}
      </nav>
      <button className="fab" onClick={() => abrirCargar()} aria-label="Cargar un gasto o ingreso">
        <Icon name="plus" size={20} /> Cargar
      </button>
    </div>
  );
}
