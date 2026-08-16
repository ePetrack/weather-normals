/* Weather Normals Tracker — shared chart primitives.
 * Used by both app.js (normals comparison page) and extremes.js
 * (precipitation extremes page). Plain global, no build step: load this
 * script before either page script.
 */
(() => {
  "use strict";

  const MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const RECENT_YEAR_COUNT = 3; // this year + up to 2 prior years
  const AVG_YEAR_COUNT = 5; // trailing years averaged for the "recent history" baseline

  const seriesColor = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const fmtDate = d3.timeFormat("%b %-d, %Y");
  const fmtDateShort = d3.timeFormat("%b %-d");
  const parseISODate = d3.timeParse("%Y-%m-%d");

  async function fetchJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
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
  // Day-of-year indexing, shared by any chart that aligns years by
  // calendar day (normals_daily.json has 366 rows, "MM-DD" keyed, in
  // calendar order — including Feb 29 for leap-year alignment).
  // ---------------------------------------------------------------------
  function buildDayIndex(normalsDaily) {
    const dayOrder = normalsDaily.map((d) => d.date); // 366 sorted "MM-DD"
    const dayIndex = new Map(dayOrder.map((d, i) => [d, i]));
    return { dayOrder, dayIndex };
  }

  function monthTicks(dayIndex) {
    return MONTH_ABBR.map((name, m) => {
      const key = `${String(m + 1).padStart(2, "0")}-01`;
      return { name, idx: dayIndex.get(key) };
    });
  }

  // Years from `candidates` that actually have any observations.
  function presentYears(observed, candidates) {
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    return candidates.filter((y) => byYear.has(String(y)));
  }

  // Keep the header's page-nav links (Normals <-> Extremes) pointed at
  // whichever station is currently selected, so switching pages doesn't
  // reset the station picker.
  function syncNavStationParam(stationId) {
    document.querySelectorAll(".page-nav a[data-nav-target]").forEach((a) => {
      const url = new URL(a.getAttribute("data-nav-target"), window.location.href);
      url.searchParams.set("station", stationId);
      a.href = `${url.pathname}${url.search}`;
    });
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

  window.ChartUtils = {
    MONTH_ABBR,
    RECENT_YEAR_COUNT,
    AVG_YEAR_COUNT,
    seriesColor,
    fmtDate,
    fmtDateShort,
    parseISODate,
    fetchJSON,
    showMessage,
    buildSvg,
    drawLegend,
    yAxisLeft,
    buildDayIndex,
    monthTicks,
    presentYears,
    showTooltip,
    syncNavStationParam,
  };
})();
