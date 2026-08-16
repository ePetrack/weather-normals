/* Weather Normals Tracker — client-side charts.
 * Reads the JSON committed by the fetch_*.py pipeline under data/<station>/
 * and renders four D3 charts. No build step: this file is served as-is.
 */
(() => {
  "use strict";

  const MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const RECENT_YEAR_COUNT = 3; // this year + up to 2 prior years
  const TEMP_WINDOW_DAYS = 120;

  const seriesColor = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const fmtDate = d3.timeFormat("%b %-d, %Y");
  const fmtDateShort = d3.timeFormat("%b %-d");
  const parseISODate = d3.timeParse("%Y-%m-%d");

  async function main() {
    const stations = await fetchJSON("stations.json");
    const select = document.getElementById("station-select");
    select.innerHTML = stations
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join("");

    select.addEventListener("change", () => loadStation(select.value));

    const initial = new URLSearchParams(location.search).get("station");
    const startId = stations.some((s) => s.id === initial) ? initial : stations[0].id;
    select.value = startId;
    loadStation(startId);
  }

  async function fetchJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function loadStation(stationId) {
    const base = `data/${stationId}`;
    const chartIds = [
      "chart-cum-precip",
      "chart-temp-band",
      "chart-monthly-temp",
      "chart-monthly-precip",
    ];

    let normalsDaily, normalsMonthly, observed;
    try {
      [normalsDaily, normalsMonthly, observed] = await Promise.all([
        fetchJSON(`${base}/normals_daily.json`),
        fetchJSON(`${base}/normals_monthly.json`),
        fetchJSON(`${base}/observed_daily.json`),
      ]);
    } catch (err) {
      chartIds.forEach((id) => showMessage(id,
        "Data isn't published yet for this station — it appears after the first " +
        "scheduled (or manually triggered) data-update run completes."));
      document.getElementById("last-updated").textContent = "";
      console.error(err);
      return;
    }

    const lastObsDate = observed.length ? observed[observed.length - 1].date : null;
    document.getElementById("last-updated").textContent = lastObsDate
      ? `Data through ${fmtDate(parseISODate(lastObsDate))}`
      : "";

    drawCumulativePrecip(normalsDaily, observed);
    drawTempBand(normalsDaily, observed);
    drawMonthlyTemp(normalsMonthly, observed);
    drawMonthlyPrecip(normalsMonthly, observed);
  }

  function showMessage(chartId, text) {
    document.getElementById(chartId).innerHTML = `<p class="state-message">${text}</p>`;
  }

  // ---------------------------------------------------------------------
  // Shared SVG scaffolding: a fixed logical coordinate system scaled
  // responsively via viewBox (no resize listeners needed).
  // ---------------------------------------------------------------------
  function buildSvg(containerId, { width = 880, height = 340, margin }) {
    const container = d3.select(`#${containerId}`);
    container.selectAll("*").remove();
    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMinYMin meet");
    const plot = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const tooltip = container
      .append("div")
      .attr("class", "tooltip");
    return { container, svg, plot, innerWidth, innerHeight, tooltip };
  }

  function drawLegend(containerId, items) {
    const el = document.getElementById(containerId);
    el.innerHTML = items
      .map(
        (it) => `
      <span class="legend-item">
        <span class="legend-swatch ${it.style || ""}" style="background:${it.style === "dashed" ? "none" : it.color};border-top-color:${it.color}"></span>
        ${it.label}
      </span>`
      )
      .join("");
  }

  function yAxisLeft(plot, y, innerWidth, { ticks = 5, format = (d) => d } = {}) {
    plot
      .append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).ticks(ticks).tickFormat(format).tickSize(-innerWidth))
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll(".tick line").attr("class", "gridline"));
  }

  // ---------------------------------------------------------------------
  // Chart 1: Cumulative precipitation — normal + this year + prior years
  // ---------------------------------------------------------------------
  function drawCumulativePrecip(normalsDaily, observed) {
    const dayOrder = normalsDaily.map((d) => d.date); // 366 sorted "MM-DD"
    const dayIndex = new Map(dayOrder.map((d, i) => [d, i]));

    let cum = 0;
    const normalCum = normalsDaily.map((d) => {
      cum += d.precip_normal || 0;
      return cum;
    });

    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: RECENT_YEAR_COUNT }, (_, i) => currentYear - i).filter(
      (y) => byYear.has(String(y))
    );

    const palette = [seriesColor("--series-blue"), seriesColor("--series-orange"), seriesColor("--series-aqua")];
    const yearSeries = years.map((year, i) => {
      const rows = byYear.get(String(year)).slice().sort((a, b) => d3.ascending(a.date, b.date));
      let running = 0;
      const points = [];
      for (const r of rows) {
        const key = r.date.slice(5);
        const idx = dayIndex.get(key);
        if (idx === undefined) continue;
        running += r.precip || 0;
        points.push({ idx, value: running, date: r.date });
      }
      return { year, color: palette[i], points };
    });

    drawLegend("legend-precip", [
      { label: "1991–2020 normal", color: seriesColor("--series-normal"), style: "dashed" },
      ...yearSeries.map((s) => ({ label: String(s.year), color: s.color, style: "line" })),
    ]);

    const margin = { top: 10, right: 16, bottom: 26, left: 46 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-cum-precip", { margin });

    const x = d3.scaleLinear().domain([0, 365]).range([0, innerWidth]);
    const maxY = Math.max(
      d3.max(normalCum) || 0,
      d3.max(yearSeries, (s) => d3.max(s.points, (p) => p.value)) || 0
    );
    const y = d3.scaleLinear().domain([0, maxY * 1.08]).nice().range([innerHeight, 0]);

    yAxisLeft(plot, y, innerWidth, { format: (d) => `${d}"` });

    const monthTicks = MONTH_ABBR.map((name, m) => {
      const key = `${String(m + 1).padStart(2, "0")}-01`;
      return { name, idx: dayIndex.get(key) };
    });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(monthTicks.map((t) => t.idx))
          .tickFormat((d, i) => monthTicks[i].name)
      )
      .call((g) => g.select(".domain").attr("class", "baseline"));

    const line = d3.line().x((d) => x(d.idx)).y((d) => y(d.value));

    plot
      .append("path")
      .datum(normalCum.map((v, idx) => ({ idx, value: v })))
      .attr("fill", "none")
      .attr("stroke", seriesColor("--series-normal"))
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,4")
      .attr("d", line);

    yearSeries.forEach((s) => {
      plot
        .append("path")
        .datum(s.points)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 2)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", line);
    });

    // Crosshair + tooltip
    const focusLine = plot
      .append("line")
      .attr("class", "gridline")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .style("opacity", 0);
    const focusDots = yearSeries.map((s) =>
      plot
        .append("circle")
        .attr("r", 4)
        .attr("fill", s.color)
        .style("stroke", "var(--surface-1)")
        .style("stroke-width", 2)
        .style("opacity", 0)
    );

    plot
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);
        const idx = Math.round(x.invert(mx));
        const dayKey = dayOrder[Math.max(0, Math.min(365, idx))];
        focusLine.attr("x1", x(idx)).attr("x2", x(idx)).style("opacity", 1);

        const rows = yearSeries.map((s, i) => {
          const pt = s.points.reduce((best, p) => (p.idx <= idx ? p : best), null);
          if (pt) focusDots[i].attr("cx", x(pt.idx)).attr("cy", y(pt.value)).style("opacity", 1);
          else focusDots[i].style("opacity", 0);
          return pt ? { label: String(s.year), color: s.color, value: pt.value } : null;
        }).filter(Boolean);

        const normalVal = normalCum[Math.max(0, Math.min(365, idx))];
        rows.unshift({ label: "Normal", color: seriesColor("--series-normal"), value: normalVal });

        showTooltip(tooltip, container, event, `Through ${monthTickLabel(dayKey)}`, rows, (v) => `${v.toFixed(2)}"`);
      })
      .on("mouseleave", () => {
        focusLine.style("opacity", 0);
        focusDots.forEach((d) => d.style("opacity", 0));
        tooltip.style("opacity", 0);
      });
  }

  function monthTickLabel(mmdd) {
    const [m, d] = mmdd.split("-").map(Number);
    return `${MONTH_ABBR[m - 1]} ${d}`;
  }

  // ---------------------------------------------------------------------
  // Chart 2: Daily temperature vs. normal range (last N days)
  // ---------------------------------------------------------------------
  function drawTempBand(normalsDaily, observed) {
    const normalsByDay = new Map(normalsDaily.map((d) => [d.date, d]));
    const recent = observed.slice(-TEMP_WINDOW_DAYS).map((d) => ({
      ...d,
      dateObj: parseISODate(d.date),
      normal: normalsByDay.get(d.date.slice(5)),
    }));

    drawLegend("legend-temp", [
      { label: "Normal range", color: seriesColor("--series-normal"), style: "dashed" },
      { label: "Daily high", color: seriesColor("--series-red"), style: "line" },
      { label: "Daily low", color: seriesColor("--series-blue"), style: "line" },
    ]);

    const margin = { top: 10, right: 16, bottom: 26, left: 40 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-temp-band", { margin });

    const x = d3.scaleTime().domain(d3.extent(recent, (d) => d.dateObj)).range([0, innerWidth]);
    const allTemps = recent.flatMap((d) => [d.tmax, d.tmin, d.normal?.tmax_normal, d.normal?.tmin_normal]).filter((v) => v != null);
    const y = d3.scaleLinear().domain(d3.extent(allTemps)).nice().range([innerHeight, 0]);

    yAxisLeft(plot, y, innerWidth, { format: (d) => `${d}°` });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat("%b %-d")))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    const area = d3
      .area()
      .defined((d) => d.normal)
      .x((d) => x(d.dateObj))
      .y0((d) => y(d.normal.tmin_normal))
      .y1((d) => y(d.normal.tmax_normal));
    plot
      .append("path")
      .datum(recent)
      .attr("fill", seriesColor("--series-normal"))
      .attr("opacity", 0.12)
      .attr("d", area);

    const lineMax = d3.line().defined((d) => d.tmax != null).x((d) => x(d.dateObj)).y((d) => y(d.tmax));
    const lineMin = d3.line().defined((d) => d.tmin != null).x((d) => x(d.dateObj)).y((d) => y(d.tmin));
    plot.append("path").datum(recent).attr("fill", "none").attr("stroke", seriesColor("--series-red")).attr("stroke-width", 2).attr("d", lineMax);
    plot.append("path").datum(recent).attr("fill", "none").attr("stroke", seriesColor("--series-blue")).attr("stroke-width", 2).attr("d", lineMin);

    const bisect = d3.bisector((d) => d.dateObj).left;
    const focusLine = plot.append("line").attr("class", "gridline").attr("y1", 0).attr("y2", innerHeight).style("opacity", 0);

    plot
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);
        const date0 = x.invert(mx);
        const i = Math.min(recent.length - 1, Math.max(0, bisect(recent, date0)));
        const d = recent[i];
        focusLine.attr("x1", x(d.dateObj)).attr("x2", x(d.dateObj)).style("opacity", 1);

        const rows = [];
        if (d.tmax != null) rows.push({ label: "High", color: seriesColor("--series-red"), value: d.tmax });
        if (d.tmin != null) rows.push({ label: "Low", color: seriesColor("--series-blue"), value: d.tmin });
        if (d.normal) {
          rows.push({ label: "Normal high", color: seriesColor("--series-normal"), value: d.normal.tmax_normal });
          rows.push({ label: "Normal low", color: seriesColor("--series-normal"), value: d.normal.tmin_normal });
        }
        showTooltip(tooltip, container, event, fmtDateShort(d.dateObj), rows, (v) => `${Math.round(v)}°F`);
      })
      .on("mouseleave", () => {
        focusLine.style("opacity", 0);
        tooltip.style("opacity", 0);
      });
  }

  // ---------------------------------------------------------------------
  // Charts 3 & 4: monthly grouped bars (temperature avg, precip total)
  // ---------------------------------------------------------------------
  function monthlyObservedAgg(observed, year) {
    const result = Array.from({ length: 12 }, () => ({ tempSum: 0, tempCount: 0, precipSum: 0, hasData: false }));
    for (const r of observed) {
      if (!r.date.startsWith(String(year))) continue;
      const m = Number(r.date.slice(5, 7)) - 1;
      const bucket = result[m];
      bucket.hasData = true;
      if (r.tmax != null && r.tmin != null) {
        bucket.tempSum += (r.tmax + r.tmin) / 2;
        bucket.tempCount += 1;
      }
      if (r.precip != null) bucket.precipSum += r.precip;
    }
    return result.map((b, i) => ({
      month: i + 1,
      avgTemp: b.tempCount ? b.tempSum / b.tempCount : null,
      precipTotal: b.hasData ? b.precipSum : null,
    }));
  }

  function buildMonthlySeries(normalsMonthly, observed) {
    const currentYear = new Date().getFullYear();
    const thisYear = monthlyObservedAgg(observed, currentYear);
    const lastYear = monthlyObservedAgg(observed, currentYear - 1);
    const currentMonth = new Date().getMonth() + 1;
    return normalsMonthly
      .slice()
      .sort((a, b) => a.month - b.month)
      .map((n) => ({
        month: n.month,
        normalTemp: (n.tmax_normal + n.tmin_normal) / 2,
        normalPrecip: n.precip_normal_total,
        thisYearTemp: thisYear[n.month - 1].avgTemp,
        thisYearPrecip: thisYear[n.month - 1].precipTotal,
        lastYearTemp: lastYear[n.month - 1].avgTemp,
        lastYearPrecip: lastYear[n.month - 1].precipTotal,
        isPartial: n.month === currentMonth,
      }));
  }

  // Rounded top corners, square baseline — matches the bar mark spec.
  function roundedTopRectPath(x, y, width, height, radius) {
    if (height <= 0 || width <= 0) return "";
    const r = Math.min(radius, height, width / 2);
    return `M${x},${y + height} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height} Z`;
  }

  function drawMonthlyGrouped(containerId, legendId, rows, seriesDefs, { format, ticks }) {
    drawLegend(legendId, seriesDefs.map((s) => ({ label: s.label, color: s.color, style: "swatch" })));

    const margin = { top: 10, right: 16, bottom: 26, left: 46 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg(containerId, { margin, height: 300 });

    const x0 = d3.scaleBand().domain(rows.map((r) => r.month)).range([0, innerWidth]).paddingInner(0.28).paddingOuter(0.08);
    const x1 = d3.scaleBand().domain(seriesDefs.map((s) => s.key)).range([0, x0.bandwidth()]).padding(0.08);
    const maxY = d3.max(rows, (r) => d3.max(seriesDefs, (s) => r[s.key] || 0)) || 1;
    const y = d3.scaleLinear().domain([0, maxY * 1.1]).nice().range([innerHeight, 0]);

    yAxisLeft(plot, y, innerWidth, { ticks, format });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x0).tickFormat((m) => MONTH_ABBR[m - 1]))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    const groups = plot
      .selectAll(".month-group")
      .data(rows)
      .join("g")
      .attr("transform", (r) => `translate(${x0(r.month)},0)`);

    const barWidth = Math.min(24, x1.bandwidth());
    const barOffset = x1.bandwidth() / 2 - barWidth / 2;

    seriesDefs.forEach((s) => {
      groups
        .append("path")
        .attr("d", (r) => {
          const h = r[s.key] != null ? innerHeight - y(r[s.key]) : 0;
          const bx = x1(s.key) + barOffset;
          return roundedTopRectPath(bx, innerHeight - h, barWidth, h, 4);
        })
        .attr("fill", s.color)
        .attr("opacity", (r) => (s.key.startsWith("thisYear") && r.isPartial ? 0.55 : 1))
        .on("mousemove", function (event, r) {
          if (r[s.key] == null) return;
          const label = s.key.startsWith("thisYear") && r.isPartial ? `${s.label} (month to date)` : s.label;
          showTooltip(
            tooltip,
            container,
            event,
            MONTH_ABBR[r.month - 1],
            [{ label, color: s.color, value: r[s.key] }],
            format
          );
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));
    });
  }

  function drawMonthlyTemp(normalsMonthly, observed) {
    const rows = buildMonthlySeries(normalsMonthly, observed);
    drawMonthlyGrouped(
      "chart-monthly-temp",
      "legend-monthly-temp",
      rows,
      [
        { key: "normalTemp", label: "Normal", color: seriesColor("--series-normal") },
        { key: "thisYearTemp", label: "This year", color: seriesColor("--series-blue") },
        { key: "lastYearTemp", label: "Last year", color: seriesColor("--series-orange") },
      ],
      { format: (d) => `${Math.round(d)}°`, ticks: 5 }
    );
  }

  function drawMonthlyPrecip(normalsMonthly, observed) {
    const rows = buildMonthlySeries(normalsMonthly, observed);
    drawMonthlyGrouped(
      "chart-monthly-precip",
      "legend-monthly-precip",
      rows,
      [
        { key: "normalPrecip", label: "Normal", color: seriesColor("--series-normal") },
        { key: "thisYearPrecip", label: "This year", color: seriesColor("--series-blue") },
        { key: "lastYearPrecip", label: "Last year", color: seriesColor("--series-orange") },
      ],
      { format: (d) => `${d.toFixed(1)}"`, ticks: 5 }
    );
  }

  // ---------------------------------------------------------------------
  // Tooltip helper shared by all charts
  // ---------------------------------------------------------------------
  function showTooltip(tooltip, container, event, title, rows, format) {
    tooltip.html(
      `<div class="tooltip-date">${title}</div>` +
        rows
          .map(
            (r) => `<div class="tooltip-row">
              <span class="tooltip-dot" style="background:${r.color}"></span>
              <span>${r.label}: ${format(r.value)}</span>
            </div>`
          )
          .join("")
    );
    const [mx, my] = d3.pointer(event, container.node());
    const containerWidth = container.node().clientWidth;
    const tooltipWidth = tooltip.node().offsetWidth || 140;
    const left = Math.min(mx + 14, containerWidth - tooltipWidth - 4);
    tooltip.style("left", `${Math.max(4, left)}px`).style("top", `${my + 10}px`).style("opacity", 1);
  }

  main().catch((err) => console.error(err));
})();
