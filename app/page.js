"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

const MESES_NOMBRE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const TABS = [
  { id: "resumen", label: "Resumen", icon: "📊" },
  { id: "gastos", label: "Gastos", icon: "🧮" },
  { id: "sueldo", label: "Sueldo", icon: "💵" },
  { id: "ahorro", label: "Ahorro", icon: "🐷" },
  { id: "tarjetas", label: "Tarjetas", icon: "💳" },
  { id: "cuotas", label: "Cuotas activas", icon: "🧾" },
  { id: "fijos", label: "Gastos fijos", icon: "📌" },
  { id: "cargar", label: "Cargar / Simular", icon: "➕" },
  { id: "historico", label: "Histórico", icon: "📜" }
];

const FORMA_TARJETA = "Tarjeta de Crédito";

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
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Error ${resp.status}`);
  }
  return resp.json();
}

// Campos de "cómo se pagó" reutilizados por el form de carga y el simulador.
function CamposPago({ form, setForm, opciones }) {
  return (
    <div className="pago-fields">
      <label>Forma de pago</label>
      <select value={form.formaPago} onChange={(e) => setForm({ ...form, formaPago: e.target.value })}>
        {opciones.formasPago.map((v) => <option key={v}>{v}</option>)}
      </select>

      {form.formaPago !== "Efectivo" && (
        <>
          <label>Banco (opcional)</label>
          <select value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })}>
            <option value="">— Ninguno —</option>
            {opciones.bancos.map((v) => <option key={v}>{v}</option>)}
          </select>
        </>
      )}

      {form.formaPago === FORMA_TARJETA && (
        <>
          <label>Marca de la tarjeta</label>
          <select value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })}>
            {opciones.marcas.map((v) => <option key={v}>{v}</option>)}
          </select>

          <label>Fecha de cierre de esta compra (opcional)</label>
          <input type="date" value={form.fechaCierre} onChange={(e) => setForm({ ...form, fechaCierre: e.target.value })} />
          <p className="hint" style={{ margin: "4px 0 12px" }}>
            Si la cargás, el tablero calcula las cuotas a partir de esta fecha exacta en vez de
            inferir el jueves de cierre — evita discrepancias con el resumen real de la tarjeta.
          </p>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const hoy = new Date();
  // El mes "vigente" a mostrar por defecto en todas las pestañas es siempre el mes calendario
  // siguiente al actual, y cambia justo el día 1 de cada mes (ej. el 08/09 se ve octubre; recién
  // el 01/10 pasa a verse noviembre).
  const mesObjetivo = shiftMes(hoy.getMonth(), hoy.getFullYear(), 1);

  const [tab, setTab] = useState("resumen");

  const [dolarBlue, setDolarBlue] = useState(0);
  const [meses, setMeses] = useState([]);
  // Copia de "meses" que NO se pisa cuando el usuario navega a otro período con "Ver otro
  // período" — sirve para que el balance del header siempre refleje el mes real siguiente al
  // que ya se paga (no el período que se esté mirando en la tabla de proyección).
  const [mesesBase, setMesesBase] = useState([]);
  const [porCuenta, setPorCuenta] = useState(null);
  const [gastosFijos, setGastosFijos] = useState([]);
  const [historico, setHistorico] = useState(null);
  const [opciones, setOpciones] = useState({ bancos: [], formasPago: [], marcas: [], tipos: [], gastos: [], monedas: [] });
  const [tarjetaActiva, setTarjetaActiva] = useState(null);

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
    gasto: "", tipo: "", ...pagoInicial, desc: "", fecha: "", cuotas: 1, moneda: "ARS", monto: ""
  });
  const [addStatus, setAddStatus] = useState("");

  const [simForm, setSimForm] = useState({
    ...pagoInicial, moneda: "ARS", monto: "", cuotas: 1, fecha: ""
  });
  const [simStatus, setSimStatus] = useState("");

  const [histDesde, setHistDesde] = useState("");
  const [histHasta, setHistHasta] = useState("");

  const [cuotasMesFiltro, setCuotasMesFiltro] = useState({ month: mesObjetivo.month, year: mesObjetivo.year });
  const [cuotasMes, setCuotasMes] = useState(null);

  // Pestaña "Gastos": mes elegido y cuotas de ese mes (los gastos fijos se suman aparte).
  const [gastosMesFiltro, setGastosMesFiltro] = useState({ month: mesObjetivo.month, year: mesObjetivo.year });
  const [gastosHist, setGastosHist] = useState(null);
  const [gastosCat, setGastosCat] = useState("");

  // Navegador de meses independiente para el detalle de una tarjeta puntual (estilo Mercado Pago).
  const [tarjetaMesFiltro, setTarjetaMesFiltro] = useState({ month: mesObjetivo.month, year: mesObjetivo.year });
  const [tarjetaMesCuotas, setTarjetaMesCuotas] = useState(null);

  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const ahorroCanvasRef = useRef(null);
  const ahorroChartRef = useRef(null);
  const gastosCanvasRef = useRef(null);
  const gastosChartRef = useRef(null);

  function render(payload, opts = {}) {
    if (!opts.onlyBase) setMeses(payload.meses || []);
    if (!opts.anchored) setMesesBase(payload.meses || []);
    if (payload.porCuenta) setPorCuenta(payload.porCuenta);
    if (payload.config) {
      setCfgPiso(payload.config.piso || "");
      setSueldoSchedule(payload.config.sueldoSchedule || []);
      setAhorroMovs(payload.config.ahorroMovs || []);
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
    setGForm((f) => ({ ...f, gasto: op.gastos[0] || "", tipo: op.tipos[0] || "", formaPago, banco, marca, moneda: op.monedas[0] || "ARS" }));
    setSimForm((f) => ({ ...f, formaPago, banco, marca, moneda: op.monedas[0] || "ARS" }));
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
    if (id === "gastos" && gastosHist === null) cargarGastosMes();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos vía fetch
    cargarOpciones();
    cargarTablero(); // fija mesesBase (siempre relativo a hoy, para el header y por-cuenta)
    // eslint-disable-next-line react-hooks/immutability -- el efecto corre después del render
    verPeriodo(mesObjetivo.month, mesObjetivo.year); // la tabla/gráfico arrancan en el mes de referencia
    cargarGastosFijos();
    buscarHistorico("", "");
    cargarCuotasMes();
    cargarTarjetaMes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canvasRef.current || tab !== "resumen") return;
    const labels = meses.map((m) => m.label);
    const ingresos = meses.map((m) => m.ingresos);
    const gastos = meses.map((m) => m.gastos);
    const ahorro = meses.map((m) => m.ahorroProyectado);
    const ahorroRealSerie = meses.map((m) => (m.ahorroReal ? m.ahorroReal.montoARS : null));
    const hayAhorroReal = ahorroRealSerie.some((v) => v !== null);
    const fmtCorto = (n) => "$" + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k");

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Ingresos", data: ingresos, backgroundColor: "#0a8a3d", borderRadius: 6, barPercentage: 0.6 },
          { type: "bar", label: "Gastos", data: gastos, backgroundColor: "#7a0c2e", borderRadius: 6, barPercentage: 0.6 },
          { type: "line", label: "Ahorro proyectado", data: ahorro, borderColor: "#1c1c1e", backgroundColor: "#1c1c1e", tension: 0.35, borderWidth: 3, pointRadius: 4, pointBackgroundColor: "#1c1c1e" },
          ...(hayAhorroReal ? [{
            type: "line", label: "Ahorro real", data: ahorroRealSerie, borderColor: "#b8720a", backgroundColor: "#b8720a",
            borderDash: [6, 4], tension: 0.35, borderWidth: 3, pointRadius: 4, pointBackgroundColor: "#b8720a", spanGaps: false
          }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { font: { size: 12.5, family: "inherit" }, usePointStyle: true, padding: 16, boxHeight: 8 } },
          tooltip: {
            padding: 12, cornerRadius: 8, titleFont: { size: 13, family: "inherit" }, bodyFont: { size: 13, family: "inherit" },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12, family: "inherit" } } },
          y: { grid: { color: "#f1f1f4" }, border: { display: false }, ticks: { font: { size: 12, family: "inherit" }, callback: (v) => fmtCorto(v) } }
        }
      }
    });
  }, [meses, tab]);

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

  async function simular() {
    setSimStatus("Calculando...");
    try {
      const data = await fetchJSON("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hipotetico: simForm })
      });
      render(data);
      setSimStatus("✅ Simulación aplicada (no se guardó nada)");
    } catch (e) {
      setSimStatus("❌ " + e.message);
    }
  }

  async function guardarSimulacion() {
    setSimStatus("Guardando...");
    try {
      const data = {
        gasto: "Gasto variable",
        tipo: "Compra",
        ...simForm,
        desc: "Compra simulada"
      };
      const res = await fetchJSON("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      render(res.dashboard);
      setGastosFijos(res.gastosFijos);
      setSimStatus("✅ Gasto guardado en la planilla");
      buscarHistorico();
      cargarCuotasMes();
      cargarTarjetaMes();
      if (gastosHist !== null) cargarGastosMes();
    } catch (e) {
      setSimStatus("❌ " + e.message);
    }
  }

  async function agregar() {
    setAddStatus("Guardando...");
    try {
      const res = await fetchJSON("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gForm)
      });
      render(res.dashboard);
      setGastosFijos(res.gastosFijos);
      setAddStatus("✅ Agregado");
      setGForm((f) => ({ ...f, desc: "", monto: "" }));
      buscarHistorico();
      cargarCuotasMes();
      cargarTarjetaMes();
      if (gastosHist !== null) cargarGastosMes();
    } catch (e) {
      setAddStatus("❌ " + e.message);
    }
  }

  async function eliminarFijo(row) {
    if (!confirm("¿Eliminar este gasto fijo de la planilla?")) return;
    const res = await fetchJSON(`/api/gastos/${row}`, { method: "DELETE" });
    render(res.dashboard);
    setGastosFijos(res.gastosFijos);
    buscarHistorico();
  }

  function irATarjeta(nombre) {
    setTarjetaActiva(nombre);
    setTab("tarjetas");
  }

  // Agrupa el histórico (ya traído del server, sin tocar la lógica) por tarjeta, dejando afuera
  // todo lo que no sea "Tarjeta de Crédito" (préstamos, transferencias) — eso va en "El Banco".
  const porTarjeta = useMemo(() => {
    if (!historico) return [];
    const grupos = new Map();
    historico
      .filter((h) => h.formaPago === FORMA_TARJETA)
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
      .filter((g) => g.formaPago === FORMA_TARJETA)
      .forEach((g) => agregar([g.marca, g.banco].filter(Boolean).join(" "), {
        desc: g.desc, moneda: g.moneda, montoARS: g.montoARS, montoUSD: g.montoUSD, cuota: "Fijo"
      }));
    return items;
  }, [tarjetaMesCuotas, gastosFijos]);

  const tarjetaMesItems = itemsMesPorTarjeta[grupoActivo?.medio] || [];
  const tarjetaMesTotal = tarjetaMesItems.reduce((acc, c) => acc + (Number(c.montoARS) || 0), 0);
  const tarjetaMesTotalUSD = tarjetaMesItems.reduce((acc, c) => acc + (Number(c.montoUSD) || 0), 0);

  // Total del mes navegado para CADA tarjeta (mismo criterio que "Total del mes"), para que el
  // número de la tarjetita coincida con el detalle.
  const totalesMesPorTarjeta = useMemo(() => {
    const totales = {};
    Object.entries(itemsMesPorTarjeta).forEach(([key, lista]) => {
      totales[key] = {
        total: lista.reduce((acc, c) => acc + (Number(c.montoARS) || 0), 0),
        cuotas: lista.length
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
    (gastosItemsMes || []).forEach((g) => { totales[g.tipo] = (totales[g.tipo] || 0) + (Number(g.montoARS) || 0); });
    return Object.entries(totales).sort((a, b) => b[1] - a[1]);
  }, [gastosItemsMes]);
  const gastosCatActiva = gastosCategorias.some(([t]) => t === gastosCat) ? gastosCat : "";

  const gastosGrupos = useMemo(() => {
    const grupos = {};
    (gastosItemsMes || [])
      .filter((g) => !gastosCatActiva || g.tipo === gastosCatActiva)
      .forEach((g) => {
        if (!grupos[g.tipo]) grupos[g.tipo] = { tipo: g.tipo, total: 0, items: [] };
        grupos[g.tipo].total += Number(g.montoARS) || 0;
        grupos[g.tipo].items.push(g);
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
        m.items.forEach((g) => { porCat[g.tipo] = (porCat[g.tipo] || 0) + (Number(g.montoARS) || 0); });
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
    if (!gastosCanvasRef.current || tab !== "gastos") return;
    if (gastosChartRef.current) gastosChartRef.current.destroy();
    if (!evolutivo.length) return;
    gastosChartRef.current = new Chart(gastosCanvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: evolutivo.map((m) => m.label),
        datasets: [
          { label: "Total de gastos", data: evolutivo.map((m) => m.total), borderColor: "#7a0c2e", backgroundColor: "#7a0c2e", tension: 0.3, borderWidth: 3, pointRadius: 4 },
          { label: "Categoría en la que más gasté", data: evolutivo.map((m) => (m.topCat ? m.topCat[1] : 0)), borderColor: "#b8720a", backgroundColor: "#b8720a", borderDash: [6, 4], tension: 0.3, borderWidth: 3, pointRadius: 4 }
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
          y: { grid: { color: "#f1f1f4" }, border: { display: false }, ticks: { callback: (v) => fmt(v) } }
        }
      }
    });
  }, [evolutivo, tab]);

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
          ...(hayARS ? [{ label: "Pesos acumulados", data: filas.map((f) => f.accARS), yAxisID: "y", borderColor: "#7a0c2e", backgroundColor: "#7a0c2e", stepped: true, borderWidth: 3, pointRadius: 4 }] : []),
          ...(hayUSD ? [{ label: "Dólares acumulados", data: filas.map((f) => f.accUSD), yAxisID: "y2", borderColor: "#0a8a3d", backgroundColor: "#0a8a3d", stepped: true, borderWidth: 3, pointRadius: 4 }] : [])
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
          y: { display: hayARS, position: "left", grid: { color: "#f1f1f4" }, border: { display: false }, ticks: { callback: (v) => fmt(v) } },
          y2: { display: hayUSD, position: "right", grid: { display: false }, border: { display: false }, ticks: { callback: (v) => fmtUSD2(v) } }
        }
      }
    });
  }, [tenencia, tab]);

  function irMesTarjeta(delta) {
    const nuevo = shiftMes(tarjetaMesFiltro.month, tarjetaMesFiltro.year, delta);
    setTarjetaMesFiltro(nuevo);
    cargarTarjetaMes(nuevo.month, nuevo.year);
  }

  // mesesBase[0] es siempre el mes calendario siguiente al de hoy (mismo criterio que mesObjetivo).
  const mesActualData = mesesBase[0] || null;
  const porCuentaMesActual = (porCuenta && mesActualData)
    ? porCuenta.meses.find((m) => m.key === mesActualData.key) || null
    : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-icon">💰</span>
            <div>
              <h1>Tablero de Gastos</h1>
              <div className="dolarInfo">
                {dolarBlue ? <>Dólar blue <b>{fmt(dolarBlue)}</b></> : "Dólar blue no disponible"}
              </div>
            </div>
          </div>
          {mesActualData && (
            <div className="hero-balance">
              <div className="hero-balance-label">Ahorro proyectado · {mesActualData.label}</div>
              <div className={`hero-balance-amount ${mesActualData.ahorroProyectado < 0 ? "neg" : ""}`}>
                {fmt(mesActualData.ahorroProyectado)}
              </div>
              <div className="hero-balance-sub">Gastos del mes: {fmt(mesActualData.gastos)}</div>
            </div>
          )}
        </div>
        <nav className="tabnav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tabbtn ${tab === t.id ? "active" : ""}`}
              onClick={() => abrirTab(t.id)}
            >
              <span className="tabbtn-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {tab === "resumen" && (
          <div className="stack">
            <div className="two-col">
              <section className="card">
                <div className="card-head">
                  <h2>Piso de ahorro</h2>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Piso disponible (siempre libre)</label>
                    <input type="number" placeholder="300000" value={cfgPiso} onChange={(e) => setCfgPiso(e.target.value)} />
                  </div>
                  <div className="field field-action">
                    <button className="btn-primary" onClick={guardarConfig}>Guardar</button>
                  </div>
                </div>
                {cfgStatus && <div className="status">{cfgStatus}</div>}
              </section>

              <section className="card">
                <div className="card-head-row">
                  <h2>Resumen de {mesActualData ? mesActualData.label : "..."}</h2>
                  <button className="section-link" onClick={() => setTab("cuotas")}>Ver detalle →</button>
                </div>
                {!mesActualData ? (
                  <div className="empty-hint">Cargando...</div>
                ) : (
                  <>
                    {porCuentaMesActual && Object.entries(porCuentaMesActual.cuentas).length > 0 &&
                      Object.entries(porCuentaMesActual.cuentas)
                        .sort((a, b) => b[1] - a[1])
                        .map(([nombre, monto]) => (
                          <div className="mini-tarjeta-row" key={nombre}>
                            <div className="mini-tarjeta-left">
                              <span className="tarjeta-avatar">{iniciales(nombre)}</span>
                              <div className="mini-tarjeta-name">Total {nombre}</div>
                            </div>
                            <div className="mini-tarjeta-amount">{fmt(monto)}</div>
                          </div>
                        ))}
                    <div className="mini-tarjeta-row">
                      <div className="mini-tarjeta-name strong">Total gastos</div>
                      <div className="mini-tarjeta-amount neg">{fmt(mesActualData.gastos)}</div>
                    </div>
                    <div className="mini-tarjeta-row">
                      <div className="mini-tarjeta-name">Piso</div>
                      <div className="mini-tarjeta-amount muted">{fmt(mesActualData.piso)}</div>
                    </div>
                    <div className="mini-tarjeta-row">
                      <div className="mini-tarjeta-name strong">Restante (ahorro proyectado)</div>
                      <div className={`mini-tarjeta-amount strong ${mesActualData.ahorroProyectado >= 0 ? "pos" : "neg"}`}>
                        {fmt(mesActualData.ahorroProyectado)}
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>

            <section className="card">
              <div className="card-head-row">
                <h2>Proyección</h2>
                <div className="filtro-inline">
                  <select value={filtroMes} onChange={(e) => setFiltroMes(Number(e.target.value))}>
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <input type="number" className="anio-input" value={filtroAnio} onChange={(e) => setFiltroAnio(Number(e.target.value))} />
                  <button className="btn-secondary" onClick={() => verPeriodo()}>Ver</button>
                  <button className="btn-ghost" onClick={verHoy}>Hoy</button>
                </div>
              </div>

              <div className="chart-box">
                <canvas ref={canvasRef}></canvas>
              </div>

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Mes</th><th className="num">Ingresos</th><th className="num">Gastos</th><th className="num">Piso</th><th className="num">Ahorro proyectado</th></tr>
                  </thead>
                  <tbody>
                    {meses.map((mo) => (
                      <tr key={mo.key}>
                        <td className="strong">{mo.label}</td>
                        <td className="num pos">
                          {fmt(mo.ingresos)}
                          {mo.aguinaldo > 0 && <div className="subnote">incl. aguinaldo {fmt(mo.aguinaldo)}</div>}
                          {mo.ingresoExtra > 0 && <div className="subnote">incl. extra {fmt(mo.ingresoExtra)}</div>}
                        </td>
                        <td className="num neg">{fmt(mo.gastos)}</td>
                        <td className="num muted">{fmt(mo.piso)}</td>
                        <td className={`num strong ${mo.ahorroProyectado >= 0 ? "pos" : "neg"}`}>{fmt(mo.ahorroProyectado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {tab === "gastos" && (
          <div className="stack">
            <section className="card">
              <div className="card-head-row">
                <h2>Gastos de {MESES_NOMBRE[gastosMesFiltro.month].toLowerCase()} {gastosMesFiltro.year}</h2>
                <div className="filtro-inline">
                  <button className="btn-icon" onClick={() => { const n = shiftMes(gastosMesFiltro.month, gastosMesFiltro.year, -1); elegirMesGastos(n.month, n.year); }}>‹</button>
                  <select value={gastosMesFiltro.month} onChange={(e) => elegirMesGastos(Number(e.target.value), gastosMesFiltro.year)}>
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={gastosMesFiltro.year} onChange={(e) => elegirMesGastos(gastosMesFiltro.month, Number(e.target.value))}>
                    {Array.from(
                      { length: shiftMes(gastosVentanaInicio.month, gastosVentanaInicio.year, 35).year - gastosVentanaInicio.year + 1 },
                      (_, i) => gastosVentanaInicio.year + i
                    ).map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <button className="btn-icon" onClick={() => { const n = shiftMes(gastosMesFiltro.month, gastosMesFiltro.year, 1); elegirMesGastos(n.month, n.year); }}>›</button>
                  <button className="btn-ghost" onClick={() => elegirMesGastos(mesObjetivo.month, mesObjetivo.year)}>Hoy</button>
                </div>
              </div>

              {gastosItemsMes === null ? (
                <div className="empty-hint">Cargando...</div>
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
                <div className="empty-hint">Cargando...</div>
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
          </div>
        )}

        {tab === "sueldo" && (
          <div className="stack">
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
              {sueldoStatus && <div className="status">{sueldoStatus}</div>}
            </section>
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
              {ahorroStatus && <div className="status">{ahorroStatus}</div>}
            </section>
          </div>
        )}

        {tab === "tarjetas" && (
          <div className="stack">
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
                      {totalesMesPorTarjeta[g.medio]?.cuotas || 0} gastos · {MESES_NOMBRE[tarjetaMesFiltro.month].slice(0, 3)}
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

                  <div className="subsection-title">Cuotas por mes</div>
                  <div className="month-nav" style={{ marginBottom: 14 }}>
                    <button className="btn-icon" onClick={() => irMesTarjeta(-1)}>‹</button>
                    <span className="month-nav-label">{MESES_NOMBRE[tarjetaMesFiltro.month]} {tarjetaMesFiltro.year}</span>
                    <button className="btn-icon" onClick={() => irMesTarjeta(1)}>›</button>
                  </div>

                  {tarjetaMesCuotas === null ? (
                    <div className="empty-hint">Cargando...</div>
                  ) : tarjetaMesItems.length === 0 ? (
                    <div className="empty-hint">Esta tarjeta no tiene gastos en ese mes.</div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>Descripción</th><th className="num">Monto</th><th>Detalle</th></tr>
                        </thead>
                        <tbody>
                          {tarjetaMesItems.map((c, i) => (
                            <tr key={i}>
                              <td className="strong">{c.desc}</td>
                              <td className="num">{celdaEquivalencia(c.moneda, c.montoARS, c.montoUSD)}</td>
                              <td>
                                <span className={`badge ${c.cuota === "Fijo" ? "badge-neutral" : "badge-info"}`}>
                                  {c.cuota === "Fijo" ? "Fijo" : `Cuota ${c.cuota}`}
                                </span>
                              </td>
                            </tr>
                          ))}
                          <tr>
                            <td className="strong">Total del mes</td>
                            <td className="num strong">{fmt(tarjetaMesTotal)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="card">
                  <div className="subsection-title">
                    Historial completo · {grupoActivo.gastos.length} gastos · total histórico {fmt(grupoActivo.totalARS)}
                  </div>
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
                            <td>{h.gasto}</td>
                            <td>{h.cuotas}</td>
                            <td className="num">{celdaEquivalencia(h.moneda, h.montoARS, h.montoUSD)}</td>
                            <td>{estadoBadge(h.estado)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {tab === "cuotas" && (
          <div className="stack">
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

            {cuotasMesTarjetas.length > 0 && <div className="subsection-title" style={{ margin: "4px 0 0" }}>💳 Tarjetas</div>}
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

            {cuotasMesBanco.length > 0 && <div className="subsection-title">🏦 El Banco (préstamos y transferencias)</div>}
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
          </div>
        )}

        {tab === "fijos" && (
          <section className="card">
            <div className="card-head">
              <h2>Gastos fijos</h2>
            </div>
            <div className="table-scroll">
              <table>
                {gastosFijos.length === 0 ? (
                  <tbody><tr><td className="empty-hint">No tenés gastos fijos cargados.</td></tr></tbody>
                ) : (
                  <>
                    <thead>
                      <tr><th>Descripción</th><th>Tipo</th><th>Medio</th><th className="num">Monto</th><th></th></tr>
                    </thead>
                    <tbody>
                      {gastosFijos.map((g) => (
                        <tr key={g.row}>
                          <td className="strong">{g.desc}</td>
                          <td>{g.tipo}</td>
                          <td>{g.medio}</td>
                          <td className="num">{celdaEquivalencia(g.moneda, g.montoARS, g.montoUSD)}</td>
                          <td className="col-action"><button className="btn-danger-ghost" onClick={() => eliminarFijo(g.row)}>Eliminar</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </section>
        )}

        {tab === "cargar" && (
          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>➕ Cargar gasto / ingreso extra</h2>
              </div>
              <label>Categoría</label>
              <select value={gForm.gasto} onChange={(e) => setGForm({ ...gForm, gasto: e.target.value })}>
                {opciones.gastos.map((v) => <option key={v}>{v}</option>)}
              </select>
              <label>Tipo</label>
              <select value={gForm.tipo} onChange={(e) => setGForm({ ...gForm, tipo: e.target.value })}>
                {opciones.tipos.map((v) => <option key={v}>{v}</option>)}
              </select>
              <label>Descripción</label>
              <input placeholder="Ej: Zapatillas" value={gForm.desc} onChange={(e) => setGForm({ ...gForm, desc: e.target.value })} />
              <label>Fecha de compra / del ingreso</label>
              <input type="date" value={gForm.fecha} onChange={(e) => setGForm({ ...gForm, fecha: e.target.value })} />
              <label>Cantidad de cuotas</label>
              <input type="number" min="1" value={gForm.cuotas} onChange={(e) => setGForm({ ...gForm, cuotas: e.target.value })} />
              <label>Moneda</label>
              <select value={gForm.moneda} onChange={(e) => setGForm({ ...gForm, moneda: e.target.value })}>
                {opciones.monedas.map((v) => <option key={v}>{v}</option>)}
              </select>
              <label>Monto por cuota / monto del ingreso</label>
              <input type="number" placeholder="0" value={gForm.monto} onChange={(e) => setGForm({ ...gForm, monto: e.target.value })} />

              <CamposPago form={gForm} setForm={setGForm} opciones={opciones} />

              <button className="btn-primary" onClick={agregar}>Agregar a la planilla</button>
              {addStatus && <div className="status">{addStatus}</div>}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>🧪 Simular compra (sin guardar)</h2>
              </div>
              <label>Monto por cuota</label>
              <input type="number" placeholder="0" value={simForm.monto} onChange={(e) => setSimForm({ ...simForm, monto: e.target.value })} />
              <label>Moneda</label>
              <select value={simForm.moneda} onChange={(e) => setSimForm({ ...simForm, moneda: e.target.value })}>
                {opciones.monedas.map((v) => <option key={v}>{v}</option>)}
              </select>
              <label>Cantidad de cuotas</label>
              <input type="number" min="1" value={simForm.cuotas} onChange={(e) => setSimForm({ ...simForm, cuotas: e.target.value })} />
              <label>Fecha de compra</label>
              <input type="date" value={simForm.fecha} onChange={(e) => setSimForm({ ...simForm, fecha: e.target.value })} />

              <CamposPago form={simForm} setForm={setSimForm} opciones={opciones} />

              <div className="btn-pair">
                <button className="btn-secondary" onClick={simular}>Simular impacto</button>
                <button className="btn-primary" onClick={guardarSimulacion}>Guardar esta compra</button>
              </div>
              {simStatus && <div className="status">{simStatus}</div>}
            </section>
          </div>
        )}

        {tab === "historico" && (
          <section className="card">
            <div className="card-head-row">
              <h2>Histórico completo</h2>
              <div className="filtro-inline">
                <input type="date" value={histDesde} onChange={(e) => setHistDesde(e.target.value)} />
                <span className="filtro-sep">a</span>
                <input type="date" value={histHasta} onChange={(e) => setHistHasta(e.target.value)} />
                <button className="btn-secondary" onClick={() => buscarHistorico()}>Buscar</button>
                <button className="btn-ghost" onClick={() => { setHistDesde(""); setHistHasta(""); buscarHistorico("", ""); }}>Todo</button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                {historico === null ? null : historico.length === 0 ? (
                  <tbody><tr><td className="empty-hint">Sin resultados en ese rango.</td></tr></tbody>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th>Fecha</th><th>Gasto</th><th>Tipo</th><th>Medio</th><th>Descripción</th>
                        <th>Cuotas</th><th className="num">Monto</th><th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map((h) => (
                        <tr key={h.row}>
                          <td className="muted">{h.fecha}</td>
                          <td>{h.gasto}</td>
                          <td>{h.tipo}</td>
                          <td>{h.medio}</td>
                          <td className="strong">{h.desc}</td>
                          <td>{h.cuotas}</td>
                          <td className="num">{celdaEquivalencia(h.moneda, h.montoARS, h.montoUSD)}</td>
                          <td>{estadoBadge(h.estado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
