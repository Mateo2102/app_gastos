"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

const MESES_NOMBRE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const TABS = [
  { id: "resumen", label: "Resumen", icon: "📊" },
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

  const [tab, setTab] = useState("resumen");

  const [dolarBlue, setDolarBlue] = useState(0);
  const [meses, setMeses] = useState([]);
  const [gastosFijos, setGastosFijos] = useState([]);
  const [historico, setHistorico] = useState(null);
  const [opciones, setOpciones] = useState({ bancos: [], formasPago: [], marcas: [], tipos: [], gastos: [], monedas: [] });
  const [tarjetaActiva, setTarjetaActiva] = useState(null);

  const [cfgPiso, setCfgPiso] = useState("");
  const [cfgStatus, setCfgStatus] = useState("");

  const [sueldoSchedule, setSueldoSchedule] = useState([]);
  const [sueldoForm, setSueldoForm] = useState({ month: hoy.getMonth(), year: hoy.getFullYear(), monto: "" });
  const [sueldoStatus, setSueldoStatus] = useState("");

  const [ahorroReal, setAhorroReal] = useState({});
  const [ahorroForm, setAhorroForm] = useState({ month: hoy.getMonth(), year: hoy.getFullYear(), monto: "", moneda: "ARS" });
  const [ahorroStatus, setAhorroStatus] = useState("");

  const [filtroMes, setFiltroMes] = useState(hoy.getMonth());
  const [filtroAnio, setFiltroAnio] = useState(hoy.getFullYear());

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

  const [cuotasMesFiltro, setCuotasMesFiltro] = useState({ month: hoy.getMonth(), year: hoy.getFullYear() });
  const [cuotasMes, setCuotasMes] = useState(null);

  // Navegador de meses independiente para el detalle de una tarjeta puntual (estilo Mercado Pago).
  const [tarjetaMesFiltro, setTarjetaMesFiltro] = useState({ month: hoy.getMonth(), year: hoy.getFullYear() });
  const [tarjetaMesCuotas, setTarjetaMesCuotas] = useState(null);

  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  function render(payload) {
    setMeses(payload.meses || []);
    if (payload.config) {
      setCfgPiso(payload.config.piso || "");
      setSueldoSchedule(payload.config.sueldoSchedule || []);
      setAhorroReal(payload.config.ahorroReal || {});
    }
    if (payload.dolarBlue) setDolarBlue(payload.dolarBlue);
    else setDolarBlue(0);
  }

  async function cargarTablero() {
    const data = await fetchJSON("/api/dashboard");
    render(data);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos vía fetch
    cargarOpciones();
    cargarTablero();
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

  async function eliminarAhorro(key) {
    if (!confirm("¿Eliminar el ahorro cargado para este mes?")) return;
    const payload = await fetchJSON(`/api/ahorro/${encodeURIComponent(key)}`, { method: "DELETE" });
    render(payload);
  }

  async function verPeriodo() {
    const data = await fetchJSON("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchor: { month: filtroMes, year: filtroAnio } })
    });
    render(data);
  }

  async function verHoy() {
    const h = new Date();
    setFiltroMes(h.getMonth());
    setFiltroAnio(h.getFullYear());
    await cargarTablero();
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

  // Cuotas del mes navegado, filtradas a la tarjeta seleccionada en la pestaña "Tarjetas".
  const tarjetaMesCuotasFiltradas = (tarjetaMesCuotas || []).filter(
    (c) => c.formaPago === FORMA_TARJETA && ([c.marca, c.banco].filter(Boolean).join(" ") === grupoActivo?.medio)
  );
  const tarjetaMesTotal = tarjetaMesCuotasFiltradas.reduce((acc, c) => acc + (Number(c.montoCuotaARS) || 0), 0);

  function irMesTarjeta(delta) {
    const nuevo = shiftMes(tarjetaMesFiltro.month, tarjetaMesFiltro.year, delta);
    setTarjetaMesFiltro(nuevo);
    cargarTarjetaMes(nuevo.month, nuevo.year);
  }

  const mesActualData = meses.find((m) => m.key === `${hoy.getFullYear()}-${hoy.getMonth()}`) || meses[0] || null;

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
              onClick={() => setTab(t.id)}
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
                  <h2>Cuotas activas este mes</h2>
                  <button className="section-link" onClick={() => setTab("cuotas")}>Ver todo →</button>
                </div>
                {cuotasMes === null ? (
                  <div className="empty-hint">Cargando...</div>
                ) : cuotasMes.length === 0 ? (
                  <div className="empty-hint">No hay cuotas activas este mes.</div>
                ) : (
                  <>
                    <div className="stat-row">
                      <div className="stat-tile">
                        <div className="stat-tile-label">Total del mes</div>
                        <div className="stat-tile-value">{fmt(cuotasMesTotal)}</div>
                        <div className="stat-tile-sub">{cuotasMes.length} cuotas activas</div>
                      </div>
                    </div>
                    {cuotasMesCombinado.map((g) => (
                      <div className="mini-tarjeta-row" key={g.nombre}>
                        <div className="mini-tarjeta-left">
                          <span className="tarjeta-avatar">{iniciales(g.nombre)}</span>
                          <div>
                            <div className="mini-tarjeta-name">{g.nombre}</div>
                            <div className="mini-tarjeta-count">{g.cuotas.length} cuotas</div>
                          </div>
                        </div>
                        <div className="mini-tarjeta-amount">{fmt(g.totalARS)}</div>
                      </div>
                    ))}
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
                  <button className="btn-secondary" onClick={verPeriodo}>Ver</button>
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
            <section className="card">
              <div className="card-head">
                <h2>Ahorro real vs. proyectado</h2>
              </div>
              <p className="hint" style={{ margin: "0 0 16px" }}>
                Cargá cuánto ahorraste realmente cada mes (en pesos o en dólares) para compararlo contra lo
                proyectado. Queda guardado en la planilla, junto con el resto de la configuración.
              </p>

              <div className="table-scroll" style={{ marginBottom: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Mes</th><th className="num">Proyectado</th><th className="num">Real</th>
                      <th className="num">Diferencia</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {meses.map((mo) => {
                      const real = mo.ahorroReal;
                      const diferencia = real ? real.montoARS - mo.ahorroProyectado : null;
                      return (
                        <tr key={mo.key}>
                          <td className="strong">{mo.label}</td>
                          <td className={`num ${mo.ahorroProyectado >= 0 ? "pos" : "neg"}`}>{fmt(mo.ahorroProyectado)}</td>
                          <td className="num">
                            {real ? celdaEquivalencia(real.moneda, real.montoARS, real.montoUSD) : <span className="muted">— sin cargar —</span>}
                          </td>
                          <td className={`num ${real ? (diferencia >= 0 ? "pos" : "neg") : "muted"}`}>
                            {real ? fmt(diferencia) : "—"}
                          </td>
                          <td className="col-action">
                            {real && <button className="btn-danger-ghost" onClick={() => eliminarAhorro(mo.key)}>Eliminar</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Mes</label>
                  <select value={ahorroForm.month} onChange={(e) => setAhorroForm({ ...ahorroForm, month: Number(e.target.value) })}>
                    {MESES_NOMBRE.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Año</label>
                  <input type="number" value={ahorroForm.year} onChange={(e) => setAhorroForm({ ...ahorroForm, year: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Moneda</label>
                  <select value={ahorroForm.moneda} onChange={(e) => setAhorroForm({ ...ahorroForm, moneda: e.target.value })}>
                    {(opciones.monedas.length ? opciones.monedas : ["ARS", "USD"]).map((v) => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Ahorro real de ese mes</label>
                  <input type="number" placeholder="0" value={ahorroForm.monto} onChange={(e) => setAhorroForm({ ...ahorroForm, monto: e.target.value })} />
                </div>
                <div className="field field-action">
                  <button className="btn-primary" onClick={guardarAhorro}>Guardar</button>
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
                    <span className="bankcard-name">{g.gastos.length} gastos</span>
                    <span className="bankcard-total">{fmt(g.totalARS)}</span>
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
                      <span className="badge badge-total">{fmt(grupoActivo.totalARS)}</span>
                      {grupoActivo.totalUSD > 0 && <span className="badge badge-neutral">≈ {fmtUSD(grupoActivo.totalUSD)}</span>}
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
                  ) : tarjetaMesCuotasFiltradas.length === 0 ? (
                    <div className="empty-hint">Esta tarjeta no tiene cuotas activas en ese mes.</div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>Descripción</th><th className="num">Monto de la cuota</th><th>Cuota</th></tr>
                        </thead>
                        <tbody>
                          {tarjetaMesCuotasFiltradas.map((c, i) => (
                            <tr key={i}>
                              <td className="strong">{c.desc}</td>
                              <td className="num">{celdaEquivalencia(c.moneda, c.montoCuotaARS, c.montoCuotaUSD)}</td>
                              <td><span className="badge badge-info">{c.cuotaNumero} de {c.cuotasTotales}</span></td>
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
                  <div className="subsection-title">Historial completo</div>
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
                  <button className="btn-ghost" onClick={() => { const h = new Date(); const f = { month: h.getMonth(), year: h.getFullYear() }; setCuotasMesFiltro(f); cargarCuotasMes(f.month, f.year); }}>Hoy</button>
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
