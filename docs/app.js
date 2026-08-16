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
  const AVG_YEAR_COUNT = 5; // trailing years averaged for the "recent history" baseline
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
      "chart-rainfall-burnup",
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
      document.getElementById("rainfall-burnup-note").textContent = "";
      console.error(err);
      return;
    }

    const lastObsDate = observed.length ? observed[observed.length - 1].date : null;
    document.getElementById("last-updated").textContent = lastObsDate
      ? `Data through ${fmtDate(parseISODate(lastObsDate))}`
      : "";

    drawRainfallBurnup(normalsDaily, observed);
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
      .map((it) => {
        const isHatch = it.style === "hatch-a" || it.style === "hatch-b";
        // Hatch swatches layer a CSS background-image over this color, so they
        // need background-color specifically — the "background" shorthand
        // would reset that image back to none.
        const style = isHatch
          ? `background-color:${it.color};border-top-color:${it.color}`
          : `background:${it.style === "dashed" ? "none" : it.color};border-top-color:${it.color}`;
        return `
      <span class="legend-item">
        <span class="legend-swatch ${it.style || ""}" style="${style}"></span>
        ${it.label}
      </span>`;
      })
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
  // Shared helpers for day-of-year cumulative precipitation, used by both
  // the multi-year comparison chart and the rainfall-to-date burnup chart.
  // ---------------------------------------------------------------------
  function buildDayIndex(normalsDaily) {
    const dayOrder = normalsDaily.map((d) => d.date); // 366 sorted "MM-DD"
    const dayIndex = new Map(dayOrder.map((d, i) => [d, i]));
    return { dayOrder, dayIndex };
  }

  function cumulativeNormalPrecip(normalsDaily) {
    let cum = 0;
    return normalsDaily.map((d) => {
      cum += d.precip_normal || 0;
      return cum;
    });
  }

  function cumulativeYearPrecip(observed, year, dayIndex) {
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const rows = byYear.get(String(year));
    if (!rows) return [];
    const sorted = rows.slice().sort((a, b) => d3.ascending(a.date, b.date));
    let running = 0;
    const points = [];
    for (const r of sorted) {
      const idx = dayIndex.get(r.date.slice(5));
      if (idx === undefined) continue;
      running += r.precip || 0;
      points.push({ idx, value: running, date: r.date });
    }
    return points;
  }

  // Years from `candidates` that actually have any observations.
  function presentYears(observed, candidates) {
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    return candidates.filter((y) => byYear.has(String(y)));
  }

  // Average cumulative precipitation across several years, aligned by day-of-year
  // (forward-filled per year so a day with no fresh observation carries the prior
  // running total). Returns a full 366-entry array, or [] if no years have data.
  function cumulativeAverageYearsPrecip(observed, years, dayIndex) {
    const perYear = years
      .map((year) => cumulativeYearPrecip(observed, year, dayIndex))
      .filter((points) => points.length);
    if (!perYear.length) return [];

    const aligned = perYear.map((points) => {
      const byIdx = new Map(points.map((p) => [p.idx, p.value]));
      const out = [];
      let last = 0;
      for (let i = 0; i < 366; i++) {
        if (byIdx.has(i)) last = byIdx.get(i);
        out.push(last);
      }
      return out;
    });

    return Array.from({ length: 366 }, (_, i) => d3.mean(aligned, (series) => series[i]));
  }

  function monthTicks(dayIndex) {
    return MONTH_ABBR.map((name, m) => {
      const key = `${String(m + 1).padStart(2, "0")}-01`;
      return { name, idx: dayIndex.get(key) };
    });
  }

  // ---------------------------------------------------------------------
  // Chart 1: Cumulative precipitation — one stacked bar per year (plus a
  // normal-to-date reference bar), split into rain vs. snow water-equivalent
  // so the two precipitation types read as distinct fill + texture, not
  // just distinct hues.
  // ---------------------------------------------------------------------
  const SNOW_LIQUID_RATIO = 0.1; // standard 10:1 snowfall-to-water-equivalent rule of thumb

  function yearPrecipToDate(observed, year, dayIndex, cutoffIdx) {
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const rows = byYear.get(String(year));
    if (!rows) return null;
    let precip = 0;
    let snow = 0;
    let hasData = false;
    for (const r of rows) {
      const idx = dayIndex.get(r.date.slice(5));
      if (idx === undefined || idx > cutoffIdx) continue;
      precip += r.precip || 0;
      snow += r.snow || 0;
      hasData = true;
    }
    if (!hasData) return null;
    const snowSwe = Math.min(snow * SNOW_LIQUID_RATIO, precip);
    return { year, rain: precip - snowSwe, snow: snowSwe, total: precip };
  }

  function addHatchPattern(defs, id, angle) {
    const pattern = defs
      .append("pattern")
      .attr("id", id)
      .attr("width", 6)
      .attr("height", 6)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", `rotate(${angle})`);
    pattern.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", "rgba(0,0,0,0.22)").attr("stroke-width", 2);
  }

  function drawCumulativePrecip(normalsDaily, observed) {
    const { dayOrder, dayIndex } = buildDayIndex(normalsDaily);
    const normalCum = cumulativeNormalPrecip(normalsDaily);

    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const currentYear = new Date().getFullYear();
    const recentYears = Array.from({ length: RECENT_YEAR_COUNT }, (_, i) => currentYear - i).filter((y) =>
      byYear.has(String(y))
    );

    const rainColor = seriesColor("--series-blue");
    const snowColor = seriesColor("--series-aqua");
    const normalColor = seriesColor("--series-normal");

    drawLegend("legend-precip", [
      { label: "1991–2020 normal (to date)", color: normalColor, style: "dashed" },
      { label: "Rain", color: rainColor, style: "hatch-a" },
      { label: "Snow (water equiv.)", color: snowColor, style: "hatch-b" },
    ]);

    if (!recentYears.length) {
      showMessage("chart-cum-precip", "No observations recorded yet this year.");
      return;
    }

    // All bars compare the same "through day X" window, using the most
    // recent year's last observation as the cutoff — otherwise a partial
    // current year would look artificially small next to full prior years.
    const mostRecentYear = recentYears[0];
    const cutoffPoints = cumulativeYearPrecip(observed, mostRecentYear, dayIndex);
    const cutoffIdx = cutoffPoints.length ? cutoffPoints[cutoffPoints.length - 1].idx : 365;
    const cutoffLabel = monthTickLabel(dayOrder[cutoffIdx]);

    const years = recentYears.slice().sort((a, b) => a - b);
    const yearBars = years
      .map((year) => yearPrecipToDate(observed, year, dayIndex, cutoffIdx))
      .filter((b) => b);
    const normalTotal = normalCum[cutoffIdx] || 0;

    const margin = { top: 10, right: 16, bottom: 26, left: 46 };
    const { plot, svg, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-cum-precip", { margin });

    const categories = ["normal", ...yearBars.map((b) => String(b.year))];
    const x = d3.scaleBand().domain(categories).range([0, innerWidth]).paddingInner(0.4).paddingOuter(0.2);
    const maxY = Math.max(normalTotal, d3.max(yearBars, (b) => b.total) || 0);
    const y = d3.scaleLinear().domain([0, maxY * 1.12]).nice().range([innerHeight, 0]);

    yAxisLeft(plot, y, innerWidth, { format: (d) => `${d}"` });

    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat((c) => (c === "normal" ? "Normal" : c)))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    const defs = svg.append("defs");
    addHatchPattern(defs, "precip-hatch-rain", 45);
    addHatchPattern(defs, "precip-hatch-snow", 135);

    const barWidth = Math.min(24, x.bandwidth());
    const GAP = 2; // surface gap between the stacked rain/snow segments

    // Normal reference bar: hollow dashed outline + faint fill, matching the
    // "target" convention used by the other charts on this page.
    const normalBx = x("normal") + (x.bandwidth() - barWidth) / 2;
    const normalH = innerHeight - y(normalTotal);
    plot
      .append("path")
      .attr("d", roundedTopRectPath(normalBx, innerHeight - normalH, barWidth, normalH, 4))
      .attr("fill", normalColor)
      .attr("fill-opacity", 0.12)
      .attr("stroke", normalColor)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4,3");

    plot
      .append("rect")
      .attr("x", x("normal"))
      .attr("y", 0)
      .attr("width", x.bandwidth())
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        showTooltip(
          tooltip,
          container,
          event,
          `1991–2020 normal — through ${cutoffLabel}`,
          [{ label: "Normal total", color: normalColor, value: normalTotal }],
          (v) => `${v.toFixed(2)}"`
        );
      })
      .on("mouseleave", () => tooltip.style("opacity", 0));

    yearBars.forEach((b) => {
      const bx = x(String(b.year)) + (x.bandwidth() - barWidth) / 2;
      const hasSnow = b.snow > 0.005;

      const rainTopVal = hasSnow ? b.rain : b.total;
      let rainH = innerHeight - y(rainTopVal);
      if (hasSnow) rainH = Math.max(0, rainH - GAP / 2);
      const rainPath = roundedTopRectPath(bx, innerHeight - rainH, barWidth, rainH, hasSnow ? 0 : 4);
      plot.append("path").attr("d", rainPath).attr("fill", rainColor);
      plot.append("path").attr("d", rainPath).attr("fill", "url(#precip-hatch-rain)");

      if (hasSnow) {
        const snowTop = y(b.total);
        const snowH = Math.max(0, y(b.rain) - y(b.total) - GAP / 2);
        const snowPath = roundedTopRectPath(bx, snowTop, barWidth, snowH, 4);
        plot.append("path").attr("d", snowPath).attr("fill", snowColor);
        plot.append("path").attr("d", snowPath).attr("fill", "url(#precip-hatch-snow)");
      }

      plot
        .append("rect")
        .attr("x", x(String(b.year)))
        .attr("y", 0)
        .attr("width", x.bandwidth())
        .attr("height", innerHeight)
        .attr("fill", "transparent")
        .on("mousemove", (event) => {
          const rows = [];
          if (b.rain > 0.005) rows.push({ label: "Rain", color: rainColor, value: b.rain });
          if (hasSnow) rows.push({ label: "Snow (water equiv.)", color: snowColor, value: b.snow });
          rows.push({ label: "Total", color: seriesColor("--text-secondary"), value: b.total });
          showTooltip(tooltip, container, event, `${b.year} — through ${cutoffLabel}`, rows, (v) => `${v.toFixed(2)}"`);
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));
    });
  }

  function monthTickLabel(mmdd) {
    const [m, d] = mmdd.split("-").map(Number);
    return `${MONTH_ABBR[m - 1]} ${d}`;
  }

  // ---------------------------------------------------------------------
  // Chart 0: Rainfall to date — burnup-style normal vs. actual
  //
  // Burnup-chart shape: a filled "completed" area (this year's actual
  // cumulative rainfall) climbing toward a dashed "target trajectory"
  // (normal-to-date) and a flat "total scope" reference line (the full
  // year's normal total). The gap between the fill's top edge and the
  // dashed line *is* the surplus/deficit — reinforced with a plain-text
  // summary and a tooltip delta rather than a second overlapping fill, to
  // keep the chart itself readable.
  // ---------------------------------------------------------------------
  function drawRainfallBurnup(normalsDaily, observed) {
    const { dayOrder, dayIndex } = buildDayIndex(normalsDaily);
    const normalCum = cumulativeNormalPrecip(normalsDaily);
    const currentYear = new Date().getFullYear();
    const actualPoints = cumulativeYearPrecip(observed, currentYear, dayIndex);
    const noteEl = document.getElementById("rainfall-burnup-note");

    const avgYears = presentYears(
      observed,
      Array.from({ length: AVG_YEAR_COUNT }, (_, i) => currentYear - 1 - i)
    ).sort((a, b) => a - b);
    const avgSeries = cumulativeAverageYearsPrecip(observed, avgYears, dayIndex);
    const avgLabel = avgYears.length
      ? `${avgYears.length}-yr avg (${avgYears[0]}–${avgYears[avgYears.length - 1]})`
      : null;

    const legendItems = [
      { label: "1991–2020 normal", color: seriesColor("--series-normal"), style: "dashed" },
    ];
    if (avgLabel) legendItems.push({ label: avgLabel, color: seriesColor("--series-aqua"), style: "line" });
    legendItems.push({ label: "This year (measured)", color: seriesColor("--series-blue"), style: "line" });
    drawLegend("legend-rainfall-burnup", legendItems);

    if (!actualPoints.length) {
      showMessage("chart-rainfall-burnup", "No observations recorded yet this year.");
      if (noteEl) noteEl.textContent = "";
      return;
    }

    const todayIdx = actualPoints[actualPoints.length - 1].idx;
    const todayActual = actualPoints[actualPoints.length - 1].value;
    const todayNormal = normalCum[todayIdx];
    const todayAvg = avgSeries.length ? avgSeries[todayIdx] : null;
    const delta = todayActual - todayNormal;
    const avgDelta = todayAvg != null ? todayActual - todayAvg : null;
    const annualNormalTotal = normalCum[normalCum.length - 1];

    if (noteEl) {
      const direction = delta >= 0 ? "above" : "below";
      let text =
        `This year has recorded ${todayActual.toFixed(2)}" through ${monthTickLabel(dayOrder[todayIdx])} — ` +
        `${Math.abs(delta).toFixed(2)}" ${direction} the 1991–2020 normal pace of ${todayNormal.toFixed(2)}"`;
      if (avgDelta != null) {
        const avgDirection = avgDelta >= 0 ? "above" : "below";
        text +=
          ` and ${Math.abs(avgDelta).toFixed(2)}" ${avgDirection} the ${avgYears[0]}–${avgYears[avgYears.length - 1]} average pace of ${todayAvg.toFixed(2)}"`;
      }
      noteEl.textContent = text + ".";
    }

    // Forward-fill the actual series across every day index through today,
    // so the area/line have no gaps on days without a fresh observation.
    const actualByIdx = new Map(actualPoints.map((p) => [p.idx, p.value]));
    const aligned = [];
    let last = 0;
    for (let i = 0; i <= todayIdx; i++) {
      if (actualByIdx.has(i)) last = actualByIdx.get(i);
      aligned.push({ idx: i, value: last });
    }

    const margin = { top: 10, right: 92, bottom: 26, left: 46 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-rainfall-burnup", { margin });

    const x = d3.scaleLinear().domain([0, 365]).range([0, innerWidth]);
    const maxY = Math.max(annualNormalTotal, todayActual, d3.max(avgSeries) || 0) * 1.12;
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([innerHeight, 0]);

    yAxisLeft(plot, y, innerWidth, { format: (d) => `${d}"` });

    const ticks = monthTicks(dayIndex);
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(ticks.map((t) => t.idx))
          .tickFormat((d, i) => ticks[i].name)
      )
      .call((g) => g.select(".domain").attr("class", "baseline"));

    // Annual normal total — the burnup chart's flat "total scope" line.
    plot
      .append("line")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", y(annualNormalTotal))
      .attr("y2", y(annualNormalTotal))
      .attr("stroke", seriesColor("--series-normal"))
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2,3")
      .attr("opacity", 0.6);
    plot
      .append("text")
      .attr("class", "axis")
      .attr("x", innerWidth + 6)
      .attr("y", y(annualNormalTotal))
      .attr("dy", "0.32em")
      .text(`Annual normal ${annualNormalTotal.toFixed(1)}"`);

    // Progress area: this year, 0 -> actual (the burnup's "completed" fill).
    const area = d3.area().x((d) => x(d.idx)).y0(innerHeight).y1((d) => y(d.value));
    plot.append("path").datum(aligned).attr("fill", seriesColor("--series-blue")).attr("opacity", 0.12).attr("d", area);

    // Normal-to-date dashed reference curve (the "target trajectory").
    const line = d3.line().x((d) => x(d.idx)).y((d) => y(d.value));
    plot
      .append("path")
      .datum(normalCum.map((v, idx) => ({ idx, value: v })))
      .attr("fill", "none")
      .attr("stroke", seriesColor("--series-normal"))
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,4")
      .attr("d", line);

    // Recent-history average, solid, between the normal and this-year lines.
    if (avgSeries.length) {
      plot
        .append("path")
        .datum(avgSeries.map((v, idx) => ({ idx, value: v })))
        .attr("fill", "none")
        .attr("stroke", seriesColor("--series-aqua"))
        .attr("stroke-width", 2)
        .attr("d", line);
    }

    // This year, solid, on top.
    plot
      .append("path")
      .datum(aligned)
      .attr("fill", "none")
      .attr("stroke", seriesColor("--series-blue"))
      .attr("stroke-width", 2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("d", line);

    // Today marker.
    plot
      .append("line")
      .attr("class", "gridline")
      .attr("x1", x(todayIdx))
      .attr("x2", x(todayIdx))
      .attr("y1", 0)
      .attr("y2", innerHeight);
    plot
      .append("circle")
      .attr("cx", x(todayIdx))
      .attr("cy", y(todayActual))
      .attr("r", 4)
      .attr("fill", seriesColor("--series-blue"))
      .style("stroke", "var(--surface-1)")
      .style("stroke-width", 2);
    plot
      .append("circle")
      .attr("cx", x(todayIdx))
      .attr("cy", y(todayNormal))
      .attr("r", 4)
      .attr("fill", seriesColor("--series-normal"))
      .style("stroke", "var(--surface-1)")
      .style("stroke-width", 2);
    if (todayAvg != null) {
      plot
        .append("circle")
        .attr("cx", x(todayIdx))
        .attr("cy", y(todayAvg))
        .attr("r", 4)
        .attr("fill", seriesColor("--series-aqua"))
        .style("stroke", "var(--surface-1)")
        .style("stroke-width", 2);
    }

    // Crosshair + tooltip
    const focusLine = plot.append("line").attr("class", "gridline").attr("y1", 0).attr("y2", innerHeight).style("opacity", 0);
    const focusDotActual = plot.append("circle").attr("r", 4).attr("fill", seriesColor("--series-blue")).style("stroke", "var(--surface-1)").style("stroke-width", 2).style("opacity", 0);
    const focusDotNormal = plot.append("circle").attr("r", 4).attr("fill", seriesColor("--series-normal")).style("stroke", "var(--surface-1)").style("stroke-width", 2).style("opacity", 0);
    const focusDotAvg = avgSeries.length
      ? plot.append("circle").attr("r", 4).attr("fill", seriesColor("--series-aqua")).style("stroke", "var(--surface-1)").style("stroke-width", 2).style("opacity", 0)
      : null;

    plot
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);
        const idx = Math.max(0, Math.min(todayIdx, Math.round(x.invert(mx))));
        focusLine.attr("x1", x(idx)).attr("x2", x(idx)).style("opacity", 1);

        const actualVal = aligned[idx].value;
        const normalVal = normalCum[idx];
        focusDotActual.attr("cx", x(idx)).attr("cy", y(actualVal)).style("opacity", 1);
        focusDotNormal.attr("cx", x(idx)).attr("cy", y(normalVal)).style("opacity", 1);
        if (focusDotAvg) focusDotAvg.attr("cx", x(idx)).attr("cy", y(avgSeries[idx])).style("opacity", 1);

        const diff = actualVal - normalVal;
        const rows = [
          { label: "This year", color: seriesColor("--series-blue"), value: actualVal },
          { label: "Normal", color: seriesColor("--series-normal"), value: normalVal },
        ];
        if (avgSeries.length) rows.push({ label: avgLabel, color: seriesColor("--series-aqua"), value: avgSeries[idx] });
        rows.push({
          label: diff >= 0 ? "Above normal" : "Below normal",
          color: seriesColor(diff >= 0 ? "--series-blue" : "--series-red"),
          value: Math.abs(diff),
        });
        showTooltip(tooltip, container, event, `Through ${monthTickLabel(dayOrder[idx])}`, rows, (v) => `${v.toFixed(2)}"`);
      })
      .on("mouseleave", () => {
        focusLine.style("opacity", 0);
        focusDotActual.style("opacity", 0);
        focusDotNormal.style("opacity", 0);
        if (focusDotAvg) focusDotAvg.style("opacity", 0);
        tooltip.style("opacity", 0);
      });
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
