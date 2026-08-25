"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

const MESES_NOMBRE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const TABS = [
  { id: "resumen", label: "Resumen", icon: "📊" },
  { id: "tarjetas", label: "Por tarjeta", icon: "💳" },
  { id: "cuotas", label: "Cuotas activas", icon: "🧾" },
  { id: "fijos", label: "Gastos fijos", icon: "📌" },
  { id: "cargar", label: "Cargar / Simular", icon: "➕" },
  { id: "historico", label: "Histórico", icon: "📜" }
];

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

async function fetchJSON(url, opts) {
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Error ${resp.status}`);
  }
  return resp.json();
}

export default function Home() {
  const hoy = new Date();

  const [tab, setTab] = useState("resumen");

  const [dolarBlue, setDolarBlue] = useState(0);
  const [meses, setMeses] = useState([]);
  const [detalle, setDetalle] = useState([]);
  const [gastosFijos, setGastosFijos] = useState([]);
  const [historico, setHistorico] = useState(null);
  const [opciones, setOpciones] = useState({ tarjetas: [], tipos: [], gastos: [], monedas: [] });
  const [tarjetaActiva, setTarjetaActiva] = useState(null);

  const [cfgPiso, setCfgPiso] = useState("");
  const [cfgStatus, setCfgStatus] = useState("");

  const [sueldoSchedule, setSueldoSchedule] = useState([]);
  const [sueldoForm, setSueldoForm] = useState({ month: hoy.getMonth(), year: hoy.getFullYear(), monto: "" });
  const [sueldoStatus, setSueldoStatus] = useState("");

  const [filtroMes, setFiltroMes] = useState(hoy.getMonth());
  const [filtroAnio, setFiltroAnio] = useState(hoy.getFullYear());

  const [gForm, setGForm] = useState({
    gasto: "", tipo: "", medio: "", desc: "", fecha: "", cuotas: 1, moneda: "ARS", monto: ""
  });
  const [addStatus, setAddStatus] = useState("");

  const [simForm, setSimForm] = useState({
    medio: "", moneda: "ARS", monto: "", cuotas: 1, fecha: ""
  });
  const [simStatus, setSimStatus] = useState("");

  const [histDesde, setHistDesde] = useState("");
  const [histHasta, setHistHasta] = useState("");

  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  function render(payload) {
    setMeses(payload.meses || []);
    setDetalle(payload.detalle || []);
    if (payload.config) {
      setCfgPiso(payload.config.piso || "");
      setSueldoSchedule(payload.config.sueldoSchedule || []);
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
    setGForm((f) => ({ ...f, gasto: op.gastos[0] || "", tipo: op.tipos[0] || "", medio: op.tarjetas[0] || "", moneda: op.monedas[0] || "ARS" }));
    setSimForm((f) => ({ ...f, medio: op.tarjetas[0] || "", moneda: op.monedas[0] || "ARS" }));
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos vía fetch
    cargarOpciones();
    cargarTablero();
    cargarGastosFijos();
    buscarHistorico("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canvasRef.current || tab !== "resumen") return;
    const labels = meses.map((m) => m.label);
    const ingresos = meses.map((m) => m.ingresos);
    const gastos = meses.map((m) => m.gastos);
    const ahorro = meses.map((m) => m.ahorroProyectado);
    const fmtCorto = (n) => "$" + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k");

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Ingresos", data: ingresos, backgroundColor: "#22c55e", borderRadius: 6, barPercentage: 0.6 },
          { type: "bar", label: "Gastos", data: gastos, backgroundColor: "#f43f5e", borderRadius: 6, barPercentage: 0.6 },
          { type: "line", label: "Ahorro proyectado", data: ahorro, borderColor: "#3b82f6", backgroundColor: "#3b82f6", tension: 0.35, borderWidth: 3, pointRadius: 4, pointBackgroundColor: "#3b82f6" }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { font: { size: 13, family: "inherit" }, usePointStyle: true, padding: 18, boxHeight: 8 } },
          tooltip: {
            padding: 12, cornerRadius: 8, titleFont: { size: 13, family: "inherit" }, bodyFont: { size: 13, family: "inherit" },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12, family: "inherit" } } },
          y: { grid: { color: "#eef0f4" }, border: { display: false }, ticks: { font: { size: 12, family: "inherit" }, callback: (v) => fmtCorto(v) } }
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
        medio: simForm.medio,
        desc: "Compra simulada",
        fecha: simForm.fecha,
        cuotas: simForm.cuotas,
        monto: simForm.monto,
        moneda: simForm.moneda
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

  // Agrupa el histórico (ya traído del server, sin tocar la lógica) por medio de pago.
  const porTarjeta = useMemo(() => {
    if (!historico) return [];
    const grupos = new Map();
    historico.forEach((h) => {
      const key = h.medio || "Sin especificar";
      if (!grupos.has(key)) grupos.set(key, { medio: key, gastos: [], totalARS: 0, totalUSD: 0 });
      const g = grupos.get(key);
      g.gastos.push(h);
      g.totalARS += Number(h.montoARS) || 0;
      g.totalUSD += Number(h.montoUSD) || 0;
    });
    return [...grupos.values()].sort((a, b) => b.totalARS - a.totalARS);
  }, [historico]);

  const grupoActivo = porTarjeta.find((g) => g.medio === tarjetaActiva) || porTarjeta[0] || null;

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
              <div className="card-head">
                <h2>Evolución del sueldo</h2>
              </div>
              <p className="hint" style={{ margin: "0 0 16px" }}>
                Cargá desde qué mes rige cada sueldo — por ejemplo, &ldquo;desde septiembre $X&rdquo; y &ldquo;desde
                diciembre $Y&rdquo; para un aumento ya sabido. El tablero usa el tramo vigente en cada mes de la
                proyección, y
                el aguinaldo (medio sueldo) se suma solo en junio y diciembre. Queda guardado en la planilla, no en
                el navegador, así que no se pierde.
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

        {tab === "tarjetas" && (
          <div className="cardgrid-layout">
            <aside className="tarjeta-list">
              {porTarjeta.length === 0 && <div className="empty-hint">Todavía no hay gastos cargados.</div>}
              {porTarjeta.map((g) => (
                <button
                  key={g.medio}
                  className={`tarjeta-pill ${grupoActivo?.medio === g.medio ? "active" : ""}`}
                  onClick={() => setTarjetaActiva(g.medio)}
                >
                  <span className="tarjeta-avatar">{iniciales(g.medio)}</span>
                  <span className="tarjeta-pill-info">
                    <span className="tarjeta-pill-nombre">{g.medio}</span>
                    <span className="tarjeta-pill-total">{fmt(g.totalARS)} · {g.gastos.length} gastos</span>
                  </span>
                </button>
              ))}
            </aside>

            <section className="card tarjeta-detalle">
              {!grupoActivo ? (
                <div className="empty-hint">Elegí una tarjeta para ver el detalle.</div>
              ) : (
                <>
                  <div className="card-head-row">
                    <h2>{grupoActivo.medio}</h2>
                    <div className="tarjeta-totales">
                      <span className="badge badge-total">{fmt(grupoActivo.totalARS)}</span>
                      {grupoActivo.totalUSD > 0 && <span className="badge badge-neutral">≈ {fmtUSD(grupoActivo.totalUSD)}</span>}
                    </div>
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
                </>
              )}
            </section>
          </div>
        )}

        {tab === "cuotas" && (
          <section className="card">
            <div className="card-head">
              <h2>Compras en cuotas activas</h2>
            </div>
            <div className="table-scroll">
              <table>
                {detalle.length === 0 ? (
                  <tbody><tr><td className="empty-hint">No hay compras en cuotas activas.</td></tr></tbody>
                ) : (
                  <>
                    <thead>
                      <tr><th>Descripción</th><th>Medio</th><th className="num">Monto/cuota</th><th>Cuotas</th><th>Restantes</th></tr>
                    </thead>
                    <tbody>
                      {detalle.map((d, i) => (
                        <tr key={i}>
                          <td className="strong">{d.desc}</td>
                          <td>{d.medio}</td>
                          <td className="num">{celdaEquivalencia(d.moneda, d.montoCuotaARS, d.montoCuotaUSD)}</td>
                          <td>{d.cuotasTotales}</td>
                          <td><span className="badge badge-info">{d.cuotasRestantes} restantes</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </section>
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
              <label>Medio de pago</label>
              <select value={gForm.medio} onChange={(e) => setGForm({ ...gForm, medio: e.target.value })}>
                {opciones.tarjetas.map((v) => <option key={v}>{v}</option>)}
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
              <button className="btn-primary" onClick={agregar}>Agregar a la planilla</button>
              {addStatus && <div className="status">{addStatus}</div>}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>🧪 Simular compra (sin guardar)</h2>
              </div>
              <label>Medio de pago</label>
              <select value={simForm.medio} onChange={(e) => setSimForm({ ...simForm, medio: e.target.value })}>
                {opciones.tarjetas.map((v) => <option key={v}>{v}</option>)}
              </select>
              <label>Moneda</label>
              <select value={simForm.moneda} onChange={(e) => setSimForm({ ...simForm, moneda: e.target.value })}>
                {opciones.monedas.map((v) => <option key={v}>{v}</option>)}
              </select>
              <label>Monto por cuota</label>
              <input type="number" placeholder="0" value={simForm.monto} onChange={(e) => setSimForm({ ...simForm, monto: e.target.value })} />
              <label>Cantidad de cuotas</label>
              <input type="number" min="1" value={simForm.cuotas} onChange={(e) => setSimForm({ ...simForm, cuotas: e.target.value })} />
              <label>Fecha de compra</label>
              <input type="date" value={simForm.fecha} onChange={(e) => setSimForm({ ...simForm, fecha: e.target.value })} />
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
