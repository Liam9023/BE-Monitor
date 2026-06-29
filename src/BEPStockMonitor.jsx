import { useState, useEffect, useMemo } from "react";

const GITHUB_BASE = "https://raw.githubusercontent.com/Liam9023/BE-Monitor/main/data";

function groupByDate(items) {
  const groups = {};
  items.forEach(item => {
    if (!item.scrapedAt) return;
    const date = item.scrapedAt.split("T")[0];
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  });
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, products]) => ({ date, products }));
}

function computeChanges(latest, previous) {
  if (!previous || !previous.length) {
    return latest.map(p => ({ ...p, type: "no-baseline", diff: null, prevQty: null }));
  }
  const prevMap = {};
  previous.forEach(p => { if (p.sku) prevMap[p.sku] = p; });
  return latest.map(curr => {
    const prev = prevMap[curr.sku];
    if (!prev) return { ...curr, type: "new", diff: null, prevQty: null };
    const diff = curr.nzStock - prev.nzStock;
    const type = diff < 0 ? "sold" : diff > 0 ? "restocked" : "unchanged";
    return { ...curr, type, diff, prevQty: prev.nzStock };
  });
}

function computeSevenDayReport(snapshots) {
  if (snapshots.length < 2) return [];
  const report = {};
  const days = Math.min(snapshots.length - 1, 7);
  for (let i = 0; i < days; i++) {
    const curr = snapshots[i];
    const prev = snapshots[i + 1];
    const prevMap = {};
    prev.products.forEach(p => { if (p.sku) prevMap[p.sku] = p; });
    curr.products.forEach(product => {
      const prevP = prevMap[product.sku];
      if (!prevP || prevP.nzStock === null || product.nzStock === null) return;
      const sold = Math.max(0, prevP.nzStock - product.nzStock);
      if (!report[product.sku]) {
        report[product.sku] = { sku: product.sku, productName: product.productName, url: product.url, currentStock: product.nzStock, totalSold: 0 };
      }
      report[product.sku].totalSold += sold;
    });
  }
  return Object.values(report).filter(r => r.totalSold > 0).sort((a, b) => b.totalSold - a.totalSold);
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function StockBadge({ qty }) {
  if (qty === null || qty === undefined) return <span style={{ color: "#9ca3af" }}>—</span>;
  const base = { padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600, display: "inline-block" };
  if (qty === 0) return <span style={{ ...base, background: "#fee2e2", color: "#dc2626" }}>Out of Stock</span>;
  if (qty <= 3) return <span style={{ ...base, background: "#fef3c7", color: "#b45309" }}>{qty} left</span>;
  return <span style={{ ...base, background: "#dcfce7", color: "#15803d" }}>{qty} in stock</span>;
}

function ChangeBadge({ type, diff }) {
  const base = { padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600, display: "inline-block" };
  if (type === "unchanged") return <span style={{ color: "#9ca3af", fontSize: 12 }}>No change</span>;
  if (type === "new") return <span style={{ ...base, background: "#eff6ff", color: "#2563eb" }}>New product</span>;
  if (type === "no-baseline") return <span style={{ color: "#9ca3af", fontSize: 12 }}>First scan</span>;
  if (type === "sold") return <span style={{ ...base, background: "#fee2e2", color: "#dc2626" }}>▼ {Math.abs(diff)} sold</span>;
  if (type === "restocked") return <span style={{ ...base, background: "#dcfce7", color: "#15803d" }}>▲ +{diff} restocked</span>;
  return null;
}

export default function BEPStockMonitor() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("current");
  const [lastFetch, setLastFetch] = useState(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("productName");
  const [sortDir, setSortDir] = useState("asc");
  const [runMsg, setRunMsg] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const t = Date.now();
      // Fetch index to get available snapshot dates
      const indexResp = await fetch(`${GITHUB_BASE}/index.json?t=${t}`);
      if (!indexResp.ok) {
        setItems([]);
        setLastFetch(new Date());
        setLoading(false);
        return;
      }
      const dates = await indexResp.json();
      // Fetch up to 7 most recent snapshots
      const recent = dates.slice(0, 7);
      const allItems = [];
      for (const date of recent) {
        const resp = await fetch(`${GITHUB_BASE}/${date}.json?t=${t}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        const valid = (Array.isArray(data) ? data : []).filter(i => i && i.sku);
        allItems.push(...valid);
      }
      setItems(allItems);
      setLastFetch(new Date());
    } catch {
      setError("Failed to load data. Check your connection and try again.");
    }
    setLoading(false);
  };

  const snapshots = useMemo(() => groupByDate(items), [items]);
  const latestSnap = snapshots[0];
  const prevSnap = snapshots[1];
  const latestProducts = latestSnap?.products || [];
  const prevProducts = prevSnap?.products || [];
  const changes = useMemo(() => computeChanges(latestProducts, prevProducts), [latestProducts, prevProducts]);
  const sevenDayReport = useMemo(() => computeSevenDayReport(snapshots), [snapshots]);

  const filteredProducts = useMemo(() => {
    let list = [...latestProducts];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p => p.productName?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
    }
    list.sort((a, b) => {
      let av = a[sortField] ?? "", bv = b[sortField] ?? "";
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av === null || av === "") return 1;
      if (bv === null || bv === "") return -1;
      return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return list;
  }, [latestProducts, search, sortField, sortDir]);

  const onSort = field => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }) => (
    <span style={{ marginLeft: 4, color: sortField === field ? "#111" : "#d1d5db" }}>
      {sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  const inStock = latestProducts.filter(p => p.nzStock > 0).length;
  const outOfStock = latestProducts.filter(p => p.nzStock === 0).length;
  const changedToday = changes.filter(c => c.type === "sold" || c.type === "restocked").length;

  const s = {
    wrap: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', background: "#fff", minHeight: "100vh", color: "#111", fontSize: 14 },
    header: { background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" },
    title: { fontSize: 17, fontWeight: 700, margin: 0 },
    subtitle: { fontSize: 12, color: "#6b7280", marginTop: 2 },
    btnRow: { display: "flex", gap: 8 },
    btn: { padding: "7px 13px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151" },
    btnDark: { padding: "7px 13px", borderRadius: 6, border: "none", background: "#111", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#fff" },
    statsRow: { display: "flex", gap: 12, padding: "16px 24px", borderBottom: "1px solid #e5e7eb" },
    card: (border) => ({ flex: 1, background: "#f9fafb", borderRadius: 8, padding: "12px 16px", border: `1px solid ${border || "#e5e7eb"}` }),
    cardNum: (color) => ({ fontSize: 28, fontWeight: 700, lineHeight: 1, color: color || "#111" }),
    cardLabel: { fontSize: 12, color: "#6b7280", marginTop: 4 },
    tabBar: { display: "flex", borderBottom: "1px solid #e5e7eb", padding: "0 24px" },
    tab: active => ({ padding: "11px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", border: "none", background: "none", color: active ? "#111" : "#6b7280", borderBottom: active ? "2px solid #111" : "2px solid transparent", marginBottom: -1 }),
    content: { padding: "20px 24px" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
    th: { textAlign: "left", padding: "9px 12px", background: "#f9fafb", color: "#374151", fontWeight: 600, borderBottom: "1px solid #e5e7eb", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" },
    thC: { textAlign: "center", padding: "9px 12px", background: "#f9fafb", color: "#374151", fontWeight: 600, borderBottom: "1px solid #e5e7eb", cursor: "pointer", userSelect: "none" },
    td: { padding: "9px 12px", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" },
    tdC: { padding: "9px 12px", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle", textAlign: "center" },
    input: { padding: "8px 12px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 13, width: "100%", maxWidth: 360, outline: "none", boxSizing: "border-box" },
    empty: { textAlign: "center", padding: "48px 24px", color: "#6b7280" },
    sku: { fontSize: 12, color: "#6b7280", fontFamily: "monospace" },
    link: { color: "#2563eb", fontSize: 12, textDecoration: "none" },
    msg: ok => ({ padding: "8px 24px", background: ok ? "#f0fdf4" : "#fff7ed", borderBottom: "1px solid #e5e7eb", fontSize: 13, color: ok ? "#15803d" : "#9a3412" })
  };

  const TABS = [
    ["current", "Current Stock"],
    ["changes", "Today's Changes"],
    ["report", "7-Day Sold Report"]
  ];

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.title}>BEP Stock Monitor</div>
          <div style={s.subtitle}>
            Hot Pressure Cleaners ·{" "}
            {lastFetch ? `Last refreshed ${lastFetch.toLocaleTimeString("en-NZ")}` : "Loading…"}
          </div>
        </div>
        <div style={s.btnRow}>
          <button style={s.btn} onClick={loadData} disabled={loading}>{loading ? "Loading…" : "↻ Refresh"}</button>
        </div>
      </div>

      {/* Messages */}
      {error && <div style={s.msg(false)}>{error}</div>}

      {/* Stats */}
      <div style={s.statsRow}>
        <div style={s.card()}>
          <div style={s.cardNum()}>{latestProducts.length}</div>
          <div style={s.cardLabel}>Total Products</div>
        </div>
        <div style={s.card("#bbf7d0")}>
          <div style={s.cardNum("#15803d")}>{inStock}</div>
          <div style={s.cardLabel}>In Stock (NZ)</div>
        </div>
        <div style={s.card("#fecaca")}>
          <div style={s.cardNum("#dc2626")}>{outOfStock}</div>
          <div style={s.cardLabel}>Out of Stock</div>
        </div>
        <div style={s.card("#bfdbfe")}>
          <div style={s.cardNum("#2563eb")}>{changedToday}</div>
          <div style={s.cardLabel}>Changes Today</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabBar}>
        {TABS.map(([id, label]) => (
          <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={s.content}>
        {loading ? (
          <div style={s.empty}>Loading stock data…</div>
        ) : items.length === 0 ? (
          <div style={s.empty}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 8 }}>No data yet</div>
            <div style={{ fontSize: 13 }}>
              Run the Python scraper locally to populate data.
              <br />Click <strong>↻ Refresh</strong> after it completes.
            </div>
          </div>
        ) : tab === "current" ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
              <input style={s.input} placeholder="Search by product name or SKU…" value={search} onChange={e => setSearch(e.target.value)} />
              <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                {filteredProducts.length} products · {latestSnap ? formatDate(latestSnap.date) : ""}
              </span>
            </div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th} onClick={() => onSort("sku")}>SKU <SortIcon field="sku" /></th>
                  <th style={s.th} onClick={() => onSort("productName")}>Product <SortIcon field="productName" /></th>
                  <th style={s.thC} onClick={() => onSort("nzStock")}>NZ Stock <SortIcon field="nzStock" /></th>
                  <th style={s.thC} onClick={() => onSort("auStock")}>AU Stock <SortIcon field="auStock" /></th>
                  <th style={s.th}>Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p, i) => (
                  <tr key={p.sku || i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={s.td}><span style={s.sku}>{p.sku}</span></td>
                    <td style={s.td}>{p.productName}</td>
                    <td style={s.tdC}><StockBadge qty={p.nzStock} /></td>
                    <td style={{ ...s.tdC, color: "#6b7280" }}>{p.auStock ?? "—"}</td>
                    <td style={s.td}><a href={p.url} target="_blank" rel="noopener noreferrer" style={s.link}>View →</a></td>
                  </tr>
                ))}
                {filteredProducts.length === 0 && (
                  <tr><td colSpan={5} style={{ ...s.tdC, padding: 30, color: "#9ca3af" }}>No products match your search.</td></tr>
                )}
              </tbody>
            </table>
          </>
        ) : tab === "changes" ? (
          prevProducts.length === 0 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 8 }}>No comparison data yet</div>
              <div style={{ fontSize: 13 }}>Day-on-day changes will appear after the second daily scrape runs tomorrow at 8am NZST.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14, fontSize: 13, color: "#6b7280" }}>
                Comparing <strong>{formatDate(latestSnap?.date)}</strong> vs <strong>{formatDate(prevSnap?.date)}</strong>
              </div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>SKU</th>
                    <th style={s.th}>Product</th>
                    <th style={s.thC}>Previous NZ Stock</th>
                    <th style={s.thC}>Current NZ Stock</th>
                    <th style={s.th}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {changes
                    .filter(c => c.type !== "unchanged" && c.type !== "no-baseline")
                    .sort((a, b) => { const o = { sold: 0, restocked: 1, new: 2 }; return (o[a.type] ?? 3) - (o[b.type] ?? 3); })
                    .map((p, i) => (
                      <tr key={p.sku || i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                        <td style={s.td}><span style={s.sku}>{p.sku}</span></td>
                        <td style={s.td}>{p.productName}</td>
                        <td style={{ ...s.tdC, color: "#6b7280" }}>{p.prevQty ?? "—"}</td>
                        <td style={s.tdC}><StockBadge qty={p.nzStock} /></td>
                        <td style={s.td}><ChangeBadge type={p.type} diff={p.diff} /></td>
                      </tr>
                    ))}
                  {changes.filter(c => c.type !== "unchanged" && c.type !== "no-baseline").length === 0 && (
                    <tr><td colSpan={5} style={{ ...s.tdC, padding: 30, color: "#9ca3af" }}>No changes detected since yesterday.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )
        ) : (
          snapshots.length < 2 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 8 }}>Not enough data yet</div>
              <div style={{ fontSize: 13 }}>The 7-day sold report needs at least 2 days of data. Check back after tomorrow's scrape.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14, fontSize: 13, color: "#6b7280" }}>
                Estimated units sold based on NZ stock reductions over the last {Math.min(snapshots.length - 1, 7)} day(s). Stock increases (restocks) are excluded from the count.
              </div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>SKU</th>
                    <th style={s.th}>Product</th>
                    <th style={s.thC}>Est. Units Sold</th>
                    <th style={s.thC}>Current NZ Stock</th>
                    <th style={s.th}>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {sevenDayReport.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...s.tdC, padding: 30, color: "#9ca3af" }}>No sales activity detected in this period.</td></tr>
                  ) : sevenDayReport.map((r, i) => (
                    <tr key={r.sku || i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={s.td}><span style={s.sku}>{r.sku}</span></td>
                      <td style={s.td}>{r.productName}</td>
                      <td style={{ ...s.tdC, fontWeight: 700, fontSize: 15 }}>{r.totalSold}</td>
                      <td style={s.tdC}><StockBadge qty={r.currentStock} /></td>
                      <td style={s.td}><a href={r.url} target="_blank" rel="noopener noreferrer" style={s.link}>View →</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        )}
      </div>
    </div>
  );
}

