"use client";

import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";

const MESES_NOMBRE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
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
      <br />
      <span className="usd">≈ {equivalente}</span>
    </>
  );
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

  const [dolarBlue, setDolarBlue] = useState(0);
  const [meses, setMeses] = useState([]);
  const [detalle, setDetalle] = useState([]);
  const [gastosFijos, setGastosFijos] = useState([]);
  const [historico, setHistorico] = useState(null);
  const [opciones, setOpciones] = useState({ tarjetas: [], tipos: [], gastos: [], monedas: [] });

  const [cfgSueldo, setCfgSueldo] = useState("");
  const [cfgPiso, setCfgPiso] = useState("");
  const [cfgStatus, setCfgStatus] = useState("");

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
      setCfgSueldo(payload.config.sueldoMensual || "");
      setCfgPiso(payload.config.piso || "");
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos vía fetch
    cargarOpciones();
    cargarTablero();
    cargarGastosFijos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
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
          { type: "bar", label: "Ingresos", data: ingresos, backgroundColor: "#34a853", borderRadius: 4, barPercentage: 0.7 },
          { type: "bar", label: "Gastos", data: gastos, backgroundColor: "#ea4335", borderRadius: 4, barPercentage: 0.7 },
          { type: "line", label: "Ahorro proyectado", data: ahorro, borderColor: "#1a73e8", backgroundColor: "#1a73e8", tension: 0.35, borderWidth: 3, pointRadius: 4, pointBackgroundColor: "#1a73e8" }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { font: { size: 13 }, usePointStyle: true, padding: 16 } },
          tooltip: {
            padding: 10, titleFont: { size: 13 }, bodyFont: { size: 13 },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12 } } },
          y: { grid: { color: "#f1f3f4" }, ticks: { font: { size: 12 }, callback: (v) => fmtCorto(v) } }
        }
      }
    });
  }, [meses]);

  async function guardarConfig() {
    setCfgStatus("Guardando...");
    try {
      const payload = await fetchJSON("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sueldoMensual: cfgSueldo, piso: cfgPiso })
      });
      render(payload);
      setCfgStatus("✅ Guardado");
    } catch (e) {
      setCfgStatus("❌ " + e.message);
    }
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
    } catch (e) {
      setAddStatus("❌ " + e.message);
    }
  }

  async function eliminarFijo(row) {
    if (!confirm("¿Eliminar este gasto fijo de la planilla?")) return;
    const res = await fetchJSON(`/api/gastos/${row}`, { method: "DELETE" });
    render(res.dashboard);
    setGastosFijos(res.gastosFijos);
  }

  async function buscarHistorico() {
    const params = new URLSearchParams();
    if (histDesde) params.set("desde", histDesde);
    if (histHasta) params.set("hasta", histHasta);
    const lista = await fetchJSON(`/api/historico?${params.toString()}`);
    setHistorico(lista);
  }

  return (
    <div className="wrap">
      <h1>💰 Tablero de Control de Gastos</h1>
      <div className="dolarInfo">
        {dolarBlue ? <>Dólar blue: <b>{fmt(dolarBlue)}</b></> : "Dólar blue: no disponible en este momento"}
      </div>

      <div className="card">
        <h2>⚙️ Sueldo y piso de ahorro</h2>
        <div className="cfg-row">
          <div>
            <label>Sueldo</label>
            <input type="number" placeholder="0" value={cfgSueldo} onChange={(e) => setCfgSueldo(e.target.value)} />
          </div>
          <div>
            <label>Piso disponible (siempre libre)</label>
            <input type="number" placeholder="300000" value={cfgPiso} onChange={(e) => setCfgPiso(e.target.value)} />
          </div>
        </div>
        <div className="hint">
          Se aplica al mes corriente y a los futuros. Los meses que ya pasaron quedan congelados solos con el valor
          que tenía este campo en ese momento — no hay que tocar nada. El aguinaldo (medio sueldo) se suma
          automáticamente en junio y diciembre.
        </div>
        <button className="btn-primary" onClick={guardarConfig}>Guardar</button>
        <div className="status">{cfgStatus}</div>
      </div>

      <div className="card">
        <h2>📅 Ver otro período</h2>
        <div className="filtro-row">
          <div>
            <label>Mes</label>
            <select value={filtroMes} onChange={(e) => setFiltroMes(Number(e.target.value))}>
              {MESES_NOMBRE.map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Año</label>
            <input type="number" value={filtroAnio} onChange={(e) => setFiltroAnio(Number(e.target.value))} />
          </div>
          <div>
            <button className="btn-secondary" onClick={verPeriodo}>Ver</button>
          </div>
          <div>
            <button className="btn-secondary" onClick={verHoy}>Volver a hoy</button>
          </div>
        </div>
      </div>

      <div className="grid">
        <div>
          <div className="card chart-card">
            <canvas ref={canvasRef}></canvas>
          </div>

          <div className="card">
            <h2>Proyección mes a mes</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Piso</th><th>Ahorro proyectado</th></tr>
                </thead>
                <tbody>
                  {meses.map((mo) => (
                    <tr key={mo.key}>
                      <td>{mo.label}</td>
                      <td className="pos">
                        {fmt(mo.ingresos)}
                        {mo.aguinaldo > 0 && <><br /><span className="usd">incl. aguinaldo {fmt(mo.aguinaldo)}</span></>}
                        {mo.ingresoExtra > 0 && <><br /><span className="usd">incl. extra {fmt(mo.ingresoExtra)}</span></>}
                      </td>
                      <td className="neg">{fmt(mo.gastos)}</td>
                      <td>{fmt(mo.piso)}</td>
                      <td className={mo.ahorroProyectado >= 0 ? "pos" : "neg"}>{fmt(mo.ahorroProyectado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Compras en cuotas activas</h2>
            <div className="table-scroll">
              <table>
                {detalle.length === 0 ? (
                  <tbody><tr><td>No hay compras en cuotas activas.</td></tr></tbody>
                ) : (
                  <>
                    <thead>
                      <tr><th>Descripción</th><th>Medio</th><th>Monto/cuota</th><th>Cuotas</th><th>Restantes</th></tr>
                    </thead>
                    <tbody>
                      {detalle.map((d, i) => (
                        <tr key={i}>
                          <td>{d.desc}</td>
                          <td>{d.medio}</td>
                          <td>{celdaEquivalencia(d.moneda, d.montoCuotaARS, d.montoCuotaUSD)}</td>
                          <td>{d.cuotasTotales}</td>
                          <td>{d.cuotasRestantes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>

          <div className="card">
            <h2>📌 Gastos fijos</h2>
            <div className="table-scroll">
              <table>
                {gastosFijos.length === 0 ? (
                  <tbody><tr><td>No tenés gastos fijos cargados.</td></tr></tbody>
                ) : (
                  <>
                    <thead>
                      <tr><th>Descripción</th><th>Tipo</th><th>Medio</th><th>Monto</th><th></th></tr>
                    </thead>
                    <tbody>
                      {gastosFijos.map((g) => (
                        <tr key={g.row}>
                          <td>{g.desc}</td>
                          <td>{g.tipo}</td>
                          <td>{g.medio}</td>
                          <td>{celdaEquivalencia(g.moneda, g.montoARS, g.montoUSD)}</td>
                          <td><button className="btn-secondary btn-row" onClick={() => eliminarFijo(g.row)}>Eliminar</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>

          <div className="card">
            <h2>📜 Histórico</h2>
            <div className="filtro-row">
              <div>
                <label>Desde</label>
                <input type="date" value={histDesde} onChange={(e) => setHistDesde(e.target.value)} />
              </div>
              <div>
                <label>Hasta</label>
                <input type="date" value={histHasta} onChange={(e) => setHistHasta(e.target.value)} />
              </div>
              <div>
                <button className="btn-secondary" onClick={buscarHistorico}>Buscar</button>
              </div>
            </div>
            <div className="table-scroll">
              <table style={{ marginTop: 10 }}>
                {historico === null ? null : historico.length === 0 ? (
                  <tbody><tr><td>Sin resultados en ese rango.</td></tr></tbody>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th>Fecha</th><th>Gasto</th><th>Tipo</th><th>Medio</th><th>Descripción</th>
                        <th>Cuotas</th><th>Monto</th><th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map((h) => (
                        <tr key={h.row}>
                          <td>{h.fecha}</td>
                          <td>{h.gasto}</td>
                          <td>{h.tipo}</td>
                          <td>{h.medio}</td>
                          <td>{h.desc}</td>
                          <td>{h.cuotas}</td>
                          <td>{celdaEquivalencia(h.moneda, h.montoARS, h.montoUSD)}</td>
                          <td>{h.estado}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>➕ Cargar gasto / ingreso extra</h2>
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
            <div className="status">{addStatus}</div>
          </div>

          <div className="card">
            <h2>🧪 Simular compra (sin guardar)</h2>
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
            <button className="btn-secondary" onClick={simular}>Simular impacto</button>
            <button className="btn-primary" onClick={guardarSimulacion}>Guardar esta compra</button>
            <div className="status">{simStatus}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
