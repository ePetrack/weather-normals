/* Weather Normals Tracker — Climate & Energy page.
 * Degree days, growing degree days, freeze/heat counts, streaks and year
 * rankings, all computed client-side from observed_daily.json and
 * normals_daily.json. No build step.
 */
(() => {
  "use strict";

  const {
    MONTH_ABBR,
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
    showTooltip,
    syncNavStationParam,
    dataThroughText,
    degreeDays,
    drawMonthlyGrouped,
  } = window.ChartUtils;

  const BASES = [50, 55, 60, 65];
  const DEFAULT_BASE = 65;
  const GDD_BASE = 50;
  const GDD_CAP = 86;
  const FALL_FREEZE_SEARCH_START = "07-01";
  const FREEZE_F = 32;
  const HOT_DAY_F = 90;
  const COLD_SNAP_F = 20;
  const MIN_STREAK_DAYS = 3;
  const COMPLETE_YEAR_DAYS = 350;
  const ANOMALY_WINDOW = 30;
  const ANOMALY_MIN_DAYS = 20;

  const CHART_IDS = [
    "chart-anomaly", "chart-hdd", "chart-cdd", "chart-gdd",
    "chart-monthly-hdd", "chart-monthly-cdd", "chart-annual-hdd",
    "chart-annual-cdd", "chart-hot-days", "chart-freeze-days", "chart-balance", "chart-budget",
  ];

  const state = { base: DEFAULT_BASE, data: null, stationId: null };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const validDate = (year, mmdd) => mmdd !== "02-29" || isLeap(year);
  const meanTemp = (tmax, tmin) => (tmax == null || tmin == null ? null : (tmax + tmin) / 2);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const fmtMmdd = (mmdd) => `${MONTH_ABBR[Number(mmdd.slice(0, 2)) - 1]} ${Number(mmdd.slice(3))}`;
  const signed = (v, digits = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const money = (v) => `$${Math.round(v).toLocaleString()}`;

  // CSV export: each chart registers the rows it plots; a button per card downloads them.
  let exportsData = {};
  const registerExport = (chartId, rows) => {
    exportsData[chartId] = rows;
  };

  function downloadCsv(chartId) {
    const rows = exportsData[chartId];
    if (!rows || !rows.length) return;
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(","))).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.stationId}-${chartId.replace(/^chart-/, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function attachCsvButtons() {
    Object.keys(exportsData).forEach((chartId) => {
      const card = document.getElementById(chartId).closest(".card");
      if (!card || card.querySelector(".csv-btn")) return;
      const h2 = card.querySelector("h2");
      const head = document.createElement("div");
      head.className = "card-head";
      h2.replaceWith(head);
      head.appendChild(h2);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "csv-btn";
      btn.textContent = "CSV";
      btn.title = "Download this chart's data";
      btn.addEventListener("click", () => downloadCsv(chartId));
      head.appendChild(btn);
    });
  }

  // Modified growing-degree-day method: clamp both temperatures to [base, cap].
  function gddFor(tmax, tmin) {
    if (tmax == null || tmin == null) return null;
    const hi = Math.min(GDD_CAP, Math.max(GDD_BASE, tmax));
    const lo = Math.min(GDD_CAP, Math.max(GDD_BASE, tmin));
    return (hi + lo) / 2 - GDD_BASE;
  }

  // Daily value of one degree-day kind from a high/low pair.
  function dailyValue(kind, tmax, tmin) {
    if (kind === "gdd") return gddFor(tmax, tmin);
    const dd = degreeDays(tmax, tmin, state.base);
    return dd ? dd[kind] : null;
  }

  function prepare(normalsDaily, observed, officialDegreeDays) {
    const byDate = new Map(observed.map((r) => [r.date, r]));
    const normalByMmdd = new Map(normalsDaily.map((n) => [n.date, n]));
    const { dayOrder } = buildDayIndex(normalsDaily);
    const lastObsDate = observed.length ? observed[observed.length - 1].date : null;
    return { normalsDaily, observed, officialDegreeDays, byDate, normalByMmdd, dayOrder, lastObsDate };
  }

  const observedGetter = (kind) => (date) => {
    const r = state.data.byDate.get(date);
    return r ? dailyValue(kind, r.tmax, r.tmin) : null;
  };
  const normalGetter = (kind) => (_date, mmdd) => {
    const n = state.data.normalByMmdd.get(mmdd);
    return n ? dailyValue(kind, n.tmax_normal, n.tmin_normal) : null;
  };

  // ---------------------------------------------------------------------
  // Cumulative calendar-year charts (HDD / CDD / GDD)
  // ---------------------------------------------------------------------
  function seasonDays(year) {
    return state.data.dayOrder.map((mmdd, idx) => ({
      idx,
      mmdd,
      date: validDate(year, mmdd) ? `${year}-${mmdd}` : null,
    }));
  }

  function cumulative(days, getValue) {
    let total = 0;
    return days.map(({ idx, mmdd, date }) => {
      const v = date ? getValue(date, mmdd) : null;
      if (v != null) total += v;
      return { idx, mmdd, date, value: total, hasData: v != null };
    });
  }

  // Draws one cumulative chart and returns { observed, normal } to-date totals.
  function drawCumulative({ kind, chartId, legendId, unitLabel }) {
    const { lastObsDate } = state.data;
    const year = Number(lastObsDate.slice(0, 4));
    const days = seasonDays(year);
    const prevDays = seasonDays(year - 1);
    const observed = cumulative(days, observedGetter(kind));
    const previous = cumulative(prevDays, observedGetter(kind));
    const normal = cumulative(days, normalGetter(kind));
    const todayIdx = observed.findIndex((p) => p.date === lastObsDate);
    const prevHasData = previous.some((p) => p.hasData);

    const thisLabel = String(year);
    const prevLabel = String(year - 1);
    const legend = [{ label: "1991–2020 normal", color: seriesColor("--series-normal"), style: "dashed" }];
    if (prevHasData) legend.push({ label: prevLabel, color: seriesColor("--series-navy"), style: "line" });
    legend.push({ label: thisLabel, color: seriesColor("--series-blue"), style: "line" });
    drawLegend(legendId, legend);

    const margin = { top: 10, right: 16, bottom: 26, left: 50 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg(chartId, { margin });
    const x = d3.scaleLinear().domain([0, days.length - 1]).range([0, innerWidth]);
    const maxY = Math.max(
      normal[normal.length - 1].value,
      prevHasData ? previous[previous.length - 1].value : 0,
      observed[Math.max(todayIdx, 0)].value
    ) * 1.08 || 1;
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([innerHeight, 0]);
    yAxisLeft(plot, y, innerWidth, { format: (d) => d3.format(",")(d) });

    const ticks = MONTH_ABBR.map((name, m) => ({
      name,
      idx: days.findIndex((d) => d.mmdd === `${String(m + 1).padStart(2, "0")}-01`),
    }));
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickValues(ticks.map((t) => t.idx)).tickFormat((_d, i) => ticks[i].name))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    const line = d3.line().x((d) => x(d.idx)).y((d) => y(d.value));
    const thisSeries = observed.slice(0, todayIdx + 1);

    plot
      .append("path").datum(thisSeries)
      .attr("fill", seriesColor("--series-blue")).attr("opacity", 0.12)
      .attr("d", d3.area().x((d) => x(d.idx)).y0(innerHeight).y1((d) => y(d.value)));
    plot
      .append("path").datum(normal)
      .attr("fill", "none").attr("stroke", seriesColor("--series-normal"))
      .attr("stroke-width", 2).attr("stroke-dasharray", "5,4").attr("d", line);
    if (prevHasData) {
      plot
        .append("path").datum(previous)
        .attr("fill", "none").attr("stroke", seriesColor("--series-navy"))
        .attr("stroke-width", 2).attr("d", line);
    }
    plot
      .append("path").datum(thisSeries)
      .attr("fill", "none").attr("stroke", seriesColor("--series-blue"))
      .attr("stroke-width", 2).attr("stroke-linejoin", "round").attr("d", line);

    const focusLine = plot.append("line").attr("class", "gridline").attr("y1", 0).attr("y2", innerHeight).style("opacity", 0);
    plot
      .append("rect")
      .attr("width", innerWidth).attr("height", innerHeight).attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);
        const idx = Math.max(0, Math.min(days.length - 1, Math.round(x.invert(mx))));
        focusLine.attr("x1", x(idx)).attr("x2", x(idx)).style("opacity", 1);
        const rows = [{ label: "Normal", color: seriesColor("--series-normal"), value: normal[idx].value }];
        if (prevHasData) rows.push({ label: prevLabel, color: seriesColor("--series-navy"), value: previous[idx].value });
        if (idx <= todayIdx) rows.push({ label: thisLabel, color: seriesColor("--series-blue"), value: observed[idx].value });
        showTooltip(tooltip, container, event, fmtMmdd(days[idx].mmdd), rows, (v) => `${Math.round(v).toLocaleString()} ${unitLabel}`);
      })
      .on("mouseleave", () => {
        focusLine.style("opacity", 0);
        tooltip.style("opacity", 0);
      });

    registerExport(
      chartId,
      days.map((d, i) => ({
        date: d.mmdd,
        normal: round1(normal[i].value),
        [`year_${prevLabel}`]: prevHasData ? round1(previous[i].value) : "",
        [`year_${thisLabel}`]: i <= todayIdx ? round1(observed[i].value) : "",
      }))
    );
    return {
      observed: observed[todayIdx].value,
      normal: normal[todayIdx].value,
      missingDays: observed.slice(0, todayIdx + 1).filter((p) => p.date && !p.hasData).length,
    };
  }

  // ---------------------------------------------------------------------
  // Monthly bars (HDD / CDD), via the shared grouped-bar renderer
  // ---------------------------------------------------------------------
  // Monthly sums of one degree-day kind for a calendar year (null where a month has no data).
  function monthlyObserved(kind, year) {
    const out = Array(12).fill(null);
    for (const r of state.data.observed) {
      if (Number(r.date.slice(0, 4)) !== year) continue;
      const v = dailyValue(kind, r.tmax, r.tmin);
      if (v == null) continue;
      const m = Number(r.date.slice(5, 7)) - 1;
      out[m] = (out[m] || 0) + v;
    }
    return out;
  }

  // Monthly sums of the derived (daily-normals) degree days.
  function monthlyNormal(kind) {
    const out = Array(12).fill(0);
    for (const n of state.data.normalsDaily) {
      const v = dailyValue(kind, n.tmax_normal, n.tmin_normal);
      if (v != null) out[Number(n.date.slice(0, 2)) - 1] += v;
    }
    out[1] *= 28.25 / 29; // the 366-day normals include a full Feb 29
    return out;
  }

  function drawMonthly({ kind, chartId, legendId, blue }) {
    const { observed, normalsDaily, lastObsDate } = state.data;
    const year = Number(lastObsDate.slice(0, 4));
    const lastMonth = Number(lastObsDate.slice(5, 7));
    const monthSums = (y) => monthlyObserved(kind, y);
    // NOAA's published normals are base 65 only; otherwise derive from the daily normals.
    const official = state.base === 65 ? state.data.officialDegreeDays : null;
    const normalSums = Array(12).fill(0);
    if (official) {
      for (const r of official) normalSums[r.month - 1] = r[`${kind}_normal`];
    } else {
      for (const n of normalsDaily) {
        const v = dailyValue(kind, n.tmax_normal, n.tmin_normal);
        if (v != null) normalSums[Number(n.date.slice(0, 2)) - 1] += v;
      }
      normalSums[1] *= 28.25 / 29; // the 366-day normals include a full Feb 29
    }
    const thisYear = monthSums(year);
    const lastYear = monthSums(year - 1);

    const rows = normalSums.map((normalVal, i) => ({
      month: i + 1,
      normalVal,
      lastYearVal: lastYear[i],
      thisYearVal: i + 1 <= lastMonth ? thisYear[i] : null,
      isPartial: i + 1 === lastMonth,
    }));
    registerExport(
      chartId,
      rows.map((r) => ({
        month: MONTH_ABBR[r.month - 1],
        normal: round1(r.normalVal),
        [`year_${year - 1}`]: round1(r.lastYearVal),
        [`year_${year}`]: round1(r.thisYearVal),
      }))
    );
    drawMonthlyGrouped(
      chartId,
      legendId,
      rows,
      [
        { key: "normalVal", label: official ? "Normal (NOAA)" : "Normal", color: seriesColor("--series-normal") },
        { key: "lastYearVal", label: String(year - 1), color: seriesColor("--series-navy") },
        { key: "thisYearVal", label: String(year), color: seriesColor(blue ? "--series-blue" : "--series-orange") },
      ],
      { format: (d) => Math.round(d).toLocaleString(), ticks: 5 }
    );
  }

  // ---------------------------------------------------------------------
  // Annual bars with record average + linear trend
  // ---------------------------------------------------------------------
  function yearlyStats(valueFn) {
    const { observed, lastObsDate } = state.data;
    const lastYear = Number(lastObsDate.slice(0, 4));
    const byYear = new Map();
    for (const r of observed) {
      const y = Number(r.date.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, { year: y, value: 0, days: 0, tmaxs: [], means: [] });
      const s = byYear.get(y);
      if (r.tmax == null || r.tmin == null) continue;
      s.days += 1;
      s.value += valueFn(r);
      s.means.push((r.tmax + r.tmin) / 2);
    }
    return Array.from(byYear.values())
      .sort((a, b) => a.year - b.year)
      .map((s) => ({ ...s, complete: s.year < lastYear && s.days >= COMPLETE_YEAR_DAYS }));
  }

  function linearTrend(points) {
    const n = points.length;
    const mx = d3.mean(points, (p) => p.x);
    const my = d3.mean(points, (p) => p.y);
    const den = sum(points.map((p) => (p.x - mx) ** 2));
    if (n < 8 || den === 0) return null;
    const slope = sum(points.map((p) => (p.x - mx) * (p.y - my))) / den;
    return { slope, at: (x) => my + slope * (x - mx) };
  }

  function drawAnnual({ chartId, legendId, valueFn, color, unit, tipLabel }) {
    const stats = yearlyStats(valueFn).filter((s) => s.days > 0);
    const complete = stats.filter((s) => s.complete);
    if (!complete.length) {
      showMessage(chartId, "Not enough complete years of data yet.");
      return;
    }
    registerExport(
      chartId,
      stats.map((s) => ({ year: s.year, value: round1(s.value), days_with_data: s.days, complete: s.complete }))
    );
    const avg = d3.mean(complete, (s) => s.value);
    const trend = linearTrend(complete.map((s) => ({ x: s.year, y: s.value })));
    const perDecade = trend ? trend.slope * 10 : null;

    const legend = [
      { label: tipLabel, color, style: "swatch" },
      { label: `Average (${complete[0].year}–${complete[complete.length - 1].year})`, color: seriesColor("--series-normal"), style: "dashed" },
    ];
    if (trend) {
      legend.push({ label: `Trend (${signed(perDecade, 1)} ${unit}/decade)`, color: seriesColor("--text-primary"), style: "line" });
    }
    drawLegend(legendId, legend);

    const margin = { top: 10, right: 16, bottom: 26, left: 50 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg(chartId, { margin, height: 300 });
    const x = d3.scaleBand().domain(stats.map((s) => s.year)).range([0, innerWidth]).padding(0.2);
    const y = d3.scaleLinear().domain([0, (d3.max(stats, (s) => s.value) || 1) * 1.1]).nice().range([innerHeight, 0]);
    yAxisLeft(plot, y, innerWidth, { format: (d) => d3.format(",")(d) });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickValues(stats.map((s) => s.year).filter((yr) => yr % 5 === 0)).tickSize(0))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    plot
      .selectAll("rect.bar")
      .data(stats)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (s) => x(s.year))
      .attr("width", x.bandwidth())
      .attr("y", (s) => y(s.value))
      .attr("height", (s) => innerHeight - y(s.value))
      .attr("fill", color)
      .attr("opacity", (s) => (s.complete ? 1 : 0.5))
      .on("mousemove", (event, s) =>
        showTooltip(
          tooltip, container, event,
          s.complete ? String(s.year) : `${s.year} (partial, ${s.days} days)`,
          [{ label: tipLabel, color, value: s.value }],
          (v) => `${Math.round(v).toLocaleString()} ${unit}`
        )
      )
      .on("mouseleave", () => tooltip.style("opacity", 0));

    plot
      .append("line")
      .attr("x1", 0).attr("x2", innerWidth).attr("y1", y(avg)).attr("y2", y(avg))
      .attr("stroke", seriesColor("--series-normal")).attr("stroke-width", 1.5).attr("stroke-dasharray", "5,4");
    if (trend) {
      const first = complete[0].year;
      const last = complete[complete.length - 1].year;
      plot
        .append("line")
        .attr("x1", x(first) + x.bandwidth() / 2).attr("x2", x(last) + x.bandwidth() / 2)
        .attr("y1", y(trend.at(first))).attr("y2", y(trend.at(last)))
        .attr("stroke", seriesColor("--text-primary")).attr("stroke-width", 2);
    }
  }

  // ---------------------------------------------------------------------
  // 30-day temperature anomaly
  // ---------------------------------------------------------------------
  function computeAnomaly() {
    const { observed, normalByMmdd } = state.data;
    const daily = observed.slice(-(365 + ANOMALY_WINDOW)).map((r) => {
      const n = normalByMmdd.get(r.date.slice(5));
      const obs = meanTemp(r.tmax, r.tmin);
      const norm = n ? meanTemp(n.tmax_normal, n.tmin_normal) : null;
      return { date: r.date, value: obs != null && norm != null ? obs - norm : null };
    });
    const points = [];
    for (let i = ANOMALY_WINDOW - 1; i < daily.length; i++) {
      const window = daily.slice(i - ANOMALY_WINDOW + 1, i + 1).filter((d) => d.value != null);
      if (window.length >= ANOMALY_MIN_DAYS) {
        points.push({ date: parseISODate(daily[i].date), value: d3.mean(window, (d) => d.value) });
      }
    }
    return points;
  }

  function drawAnomaly(points) {
    if (!points.length) {
      showMessage("chart-anomaly", "Not enough recent data.");
      return;
    }
    registerExport(
      "chart-anomaly",
      points.map((p) => ({ date: d3.timeFormat("%Y-%m-%d")(p.date), anomaly_f: round1(p.value) }))
    );
    const margin = { top: 10, right: 16, bottom: 26, left: 50 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-anomaly", { margin, height: 300 });
    const x = d3.scaleTime().domain(d3.extent(points, (p) => p.date)).range([0, innerWidth]);
    const ext = d3.max(points, (p) => Math.abs(p.value)) || 1;
    const y = d3.scaleLinear().domain([-ext * 1.1, ext * 1.1]).nice().range([innerHeight, 0]);
    yAxisLeft(plot, y, innerWidth, { format: (d) => `${signed(d)}°` });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat("%b %Y")).tickSize(0))
      .call((g) => g.select(".domain").remove());

    const area = (clamp) => d3.area().x((p) => x(p.date)).y0(y(0)).y1((p) => y(clamp(p.value)));
    plot.append("path").datum(points).attr("fill", seriesColor("--series-orange")).attr("opacity", 0.35).attr("d", area((v) => Math.max(0, v)));
    plot.append("path").datum(points).attr("fill", seriesColor("--series-blue")).attr("opacity", 0.35).attr("d", area((v) => Math.min(0, v)));
    plot
      .append("path").datum(points)
      .attr("fill", "none").attr("stroke", seriesColor("--text-secondary")).attr("stroke-width", 1.5)
      .attr("d", d3.line().x((p) => x(p.date)).y((p) => y(p.value)));
    plot.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", innerWidth).attr("y1", y(0)).attr("y2", y(0));

    const bisect = d3.bisector((p) => p.date).center;
    plot
      .append("rect")
      .attr("width", innerWidth).attr("height", innerHeight).attr("fill", "transparent")
      .on("mousemove", (event) => {
        const p = points[bisect(points, x.invert(d3.pointer(event)[0]))];
        showTooltip(
          tooltip, container, event, fmtDate(p.date),
          [{ label: "30-day avg vs. normal", color: p.value >= 0 ? seriesColor("--series-orange") : seriesColor("--series-blue"), value: p.value }],
          (v) => `${signed(v, 1)}°F`
        );
      })
      .on("mouseleave", () => tooltip.style("opacity", 0));
  }

  // ---------------------------------------------------------------------
  // Freeze dates, streaks, rankings
  // ---------------------------------------------------------------------
  function freezeDates() {
    const { observed, lastObsDate } = state.data;
    const lastYear = Number(lastObsDate.slice(0, 4));
    const rows = [];
    for (let year = lastYear; year > lastYear - 10; year--) {
      const yearRows = observed.filter((r) => r.date.startsWith(`${year}-`) && r.tmin != null && r.tmin <= FREEZE_F);
      if (!observed.some((r) => r.date.startsWith(`${year}-`))) continue;
      const spring = yearRows.filter((r) => r.date.slice(5) < FALL_FREEZE_SEARCH_START).pop();
      const fall = yearRows.find((r) => r.date.slice(5) >= FALL_FREEZE_SEARCH_START);
      const freeFree = spring && fall
        ? Math.round((parseISODate(fall.date) - parseISODate(spring.date)) / 86400000) - 1
        : null;
      rows.push({ year, spring: spring ? spring.date : null, fall: fall ? fall.date : null, freeFree });
    }
    return rows;
  }

  function renderFreezeTable() {
    const rows = freezeDates();
    const cell = (d) => (d ? fmtDateShort(parseISODate(d)) : "—");
    document.getElementById("freeze-table").innerHTML = `
      <table class="data-table">
        <thead><tr><th>Year</th><th>Last spring freeze</th><th>First fall freeze</th><th class="num">Freeze-free days</th></tr></thead>
        <tbody>${rows
          .map((r) => `<tr><td>${r.year}</td><td>${cell(r.spring)}</td><td>${cell(r.fall)}</td><td class="num">${r.freeFree == null ? "—" : r.freeFree}</td></tr>`)
          .join("")}</tbody>
      </table>`;
  }

  // Runs of consecutive calendar days where `test(row)` holds.
  function findStreaks(test, extremeFn, better) {
    const { observed } = state.data;
    const streaks = [];
    let current = null;
    const close = () => {
      if (current && current.len >= MIN_STREAK_DAYS) streaks.push(current);
      current = null;
    };
    for (const r of observed) {
      const hit = test(r);
      const contiguous = current && (parseISODate(r.date) - parseISODate(current.end)) / 86400000 === 1;
      if (hit && current && contiguous) {
        current.end = r.date;
        current.len += 1;
        current.extreme = better(current.extreme, extremeFn(r));
      } else {
        close();
        if (hit) current = { start: r.date, end: r.date, len: 1, extreme: extremeFn(r) };
      }
    }
    close();
    return streaks.sort((a, b) => b.len - a.len || a.start.localeCompare(b.start)).slice(0, 8);
  }

  function renderStreaks() {
    const hot = findStreaks((r) => r.tmax != null && r.tmax >= HOT_DAY_F, (r) => r.tmax, Math.max);
    const cold = findStreaks((r) => r.tmin != null && r.tmin <= COLD_SNAP_F, (r) => r.tmin, Math.min);
    const list = (title, streaks, extremeLabel, empty) => `
      <div>
        <h3>${title}</h3>
        ${streaks.length ? `<table class="data-table">
          <thead><tr><th>Dates</th><th class="num">Days</th><th class="num">${extremeLabel}</th></tr></thead>
          <tbody>${streaks.map((s) => `<tr>
            <td>${fmtDateShort(parseISODate(s.start))} &ndash; ${fmtDateShort(parseISODate(s.end))}, ${s.end.slice(0, 4)}</td>
            <td class="num">${s.len}</td><td class="num">${Math.round(s.extreme)}&deg;</td></tr>`).join("")}</tbody>
        </table>` : `<p class="card-note">${empty}</p>`}
      </div>`;
    document.getElementById("streak-lists").innerHTML =
      list(`Heat waves (${HOT_DAY_F}°F+ highs)`, hot, "Peak high", "No runs of 3+ days on record.") +
      list(`Cold snaps (${COLD_SNAP_F}°F or lower lows)`, cold, "Lowest low", "No runs of 3+ days on record.");
  }

  function renderRankings() {
    const meanStats = yearlyStats((r) => (r.tmax + r.tmin) / 2).filter((s) => s.complete);
    const demandStats = yearlyStats((r) => {
      const dd = degreeDays(r.tmax, r.tmin, state.base);
      return dd.hdd + dd.cdd;
    }).filter((s) => s.complete);
    const avgTemp = (s) => sum(s.means) / s.means.length;

    const top = (title, items, valueFn, fmt) => `
      <div>
        <h3>${title}</h3>
        <table class="data-table"><tbody>${items
          .map((s, i) => `<tr><td>${i + 1}</td><td>${s.year}</td><td class="num">${fmt(valueFn(s))}</td></tr>`)
          .join("")}</tbody></table>
      </div>`;
    const byDesc = (arr, fn) => arr.slice().sort((a, b) => fn(b) - fn(a)).slice(0, 5);
    document.getElementById("year-rankings").innerHTML =
      top("Warmest years (mean temp)", byDesc(meanStats, avgTemp), avgTemp, (v) => `${v.toFixed(1)}°F`) +
      top("Coldest years (mean temp)", byDesc(meanStats, (s) => -avgTemp(s)), avgTemp, (v) => `${v.toFixed(1)}°F`) +
      top(`Highest energy demand (HDD + CDD, base ${state.base}°F)`, byDesc(demandStats, (s) => s.value), (s) => s.value, (v) => Math.round(v).toLocaleString());
  }

  // ---------------------------------------------------------------------
  // Heating / cooling balance days
  // ---------------------------------------------------------------------
  function computeBalance() {
    const { observed, lastObsDate } = state.data;
    const lastYear = Number(lastObsDate.slice(0, 4));
    const firstYear = Number(observed[0].date.slice(0, 4));
    const byMonth = new Map();
    for (const r of observed) {
      const mean = meanTemp(r.tmax, r.tmin);
      if (mean == null) continue;
      const key = r.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, { heat: 0, neither: 0, cool: 0, days: 0 });
      const c = byMonth.get(key);
      c.days += 1;
      if (mean < state.base) c.heat += 1;
      else if (mean > state.base) c.cool += 1;
      else c.neither += 1;
    }
    return d3.range(1, 13).map((month) => {
      const mm = String(month).padStart(2, "0");
      const history = [];
      for (let y = firstYear; y < lastYear; y++) {
        const c = byMonth.get(`${y}-${mm}`);
        if (c && c.days >= 25) history.push(c);
      }
      const avg = (k) => (history.length ? d3.mean(history, (c) => c[k]) : 0);
      return {
        month,
        avg: { heat: avg("heat"), neither: avg("neither"), cool: avg("cool") },
        cur: byMonth.get(`${lastYear}-${mm}`) || null,
      };
    });
  }

  function drawBalance() {
    const rows = computeBalance();
    const year = Number(state.data.lastObsDate.slice(0, 4));
    const layers = [
      { key: "heat", label: `Heating days (mean below ${state.base}°F)`, color: seriesColor("--series-blue") },
      { key: "neither", label: "Neither", color: seriesColor("--series-normal") },
      { key: "cool", label: `Cooling days (mean above ${state.base}°F)`, color: seriesColor("--series-orange") },
    ];
    drawLegend("legend-balance", layers.map((l) => ({ label: l.label, color: l.color, style: "swatch" })));
    registerExport(
      "chart-balance",
      rows.map((r) => ({
        month: MONTH_ABBR[r.month - 1],
        avg_heating: round1(r.avg.heat),
        avg_neither: round1(r.avg.neither),
        avg_cooling: round1(r.avg.cool),
        [`${year}_heating`]: r.cur ? r.cur.heat : "",
        [`${year}_neither`]: r.cur ? r.cur.neither : "",
        [`${year}_cooling`]: r.cur ? r.cur.cool : "",
      }))
    );

    const margin = { top: 10, right: 16, bottom: 26, left: 40 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-balance", { margin, height: 300 });
    const x0 = d3.scaleBand().domain(rows.map((r) => r.month)).range([0, innerWidth]).paddingInner(0.28).paddingOuter(0.08);
    const bars = [{ key: "avg", label: "Record average" }, { key: "cur", label: String(year) }];
    const x1 = d3.scaleBand().domain(bars.map((b) => b.key)).range([0, x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0, 31]).range([innerHeight, 0]);
    yAxisLeft(plot, y, innerWidth, { ticks: 4, format: (d) => d });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x0).tickFormat((m) => MONTH_ABBR[m - 1]))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    rows.forEach((r) => {
      bars.forEach((b) => {
        const counts = b.key === "avg" ? r.avg : r.cur;
        if (!counts) return;
        let acc = 0;
        layers.forEach((layer) => {
          const v = counts[layer.key];
          plot
            .append("rect")
            .attr("x", x0(r.month) + x1(b.key))
            .attr("width", x1.bandwidth())
            .attr("y", y(acc + v))
            .attr("height", Math.max(0, y(acc) - y(acc + v)))
            .attr("fill", layer.color)
            .attr("opacity", b.key === "avg" ? 0.55 : 1)
            .on("mousemove", (event) =>
              showTooltip(
                tooltip, container, event, `${MONTH_ABBR[r.month - 1]} — ${b.label}`,
                layers.map((l) => ({ label: l.label.split(" (")[0], color: l.color, value: counts[l.key] })),
                (val) => `${val.toFixed(b.key === "avg" ? 1 : 0)} days`
              )
            )
            .on("mouseleave", () => tooltip.style("opacity", 0));
          acc += v;
        });
      });
    });
  }

  // ---------------------------------------------------------------------
  // Energy budget estimator. Rates are calibrated from the user's own cost
  // for last year, so no price data is assumed.
  // ---------------------------------------------------------------------
  const budgetKey = () => `geek-budget:${state.stationId}`;

  function readBudgetInputs() {
    const num = (id) => {
      const v = parseFloat(document.getElementById(id).value);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    };
    return { heat: num("budget-heat"), cool: num("budget-cool"), base: num("budget-base") };
  }

  function loadBudgetInputs() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(budgetKey())) || {};
    } catch (err) {
      saved = {};
    }
    document.getElementById("budget-heat").value = saved.heat || "";
    document.getElementById("budget-cool").value = saved.cool || "";
    document.getElementById("budget-base").value = saved.base || "";
  }

  function saveBudgetInputs() {
    try {
      localStorage.setItem(budgetKey(), JSON.stringify(readBudgetInputs()));
    } catch (err) {
      /* storage unavailable (private window etc.): the card still works */
    }
  }

  function renderBudget() {
    const { observed, normalByMmdd, dayOrder, lastObsDate } = state.data;
    const tilesEl = document.getElementById("budget-tiles");
    const notesEl = document.getElementById("budget-notes");
    const reset = (msg) => {
      tilesEl.innerHTML = "";
      notesEl.innerHTML = "";
      document.getElementById("legend-budget").innerHTML = "";
      showMessage("chart-budget", msg);
    };
    const year = Number(lastObsDate.slice(0, 4));
    const lastMmdd = lastObsDate.slice(5);
    const inputs = readBudgetInputs();

    const yearSum = (kind, y) => {
      let total = 0;
      let days = 0;
      for (const r of observed) {
        if (Number(r.date.slice(0, 4)) !== y) continue;
        const v = dailyValue(kind, r.tmax, r.tmin);
        if (v != null) {
          total += v;
          days += 1;
        }
      }
      return { total, days };
    };
    const lastH = yearSum("hdd", year - 1);
    const lastC = yearSum("cdd", year - 1);
    if (lastH.days < 300) return reset("Needs a full prior year of observations for this station.");
    if (!inputs.heat && !inputs.cool) return reset("Enter last year's heating and/or cooling cost above to see a projection.");

    const heatRate = lastH.total > 0 ? inputs.heat / lastH.total : 0;
    const coolRate = lastC.total > 0 ? inputs.cool / lastC.total : 0;
    const cost = (h, c) => h * heatRate + c * coolRate;

    // Normal degree days over a set of "MM-DD" keys valid in `year`.
    const normalOver = (mmdds) => {
      let h = 0;
      let c = 0;
      for (const mmdd of mmdds) {
        const n = normalByMmdd.get(mmdd);
        if (!n || !validDate(year, mmdd)) continue;
        h += dailyValue("hdd", n.tmax_normal, n.tmin_normal) || 0;
        c += dailyValue("cdd", n.tmax_normal, n.tmin_normal) || 0;
      }
      return { h, c };
    };
    const remainingKeys = dayOrder.filter((k) => k > lastMmdd);
    const normalFull = normalOver(dayOrder);
    const normalRemaining = normalOver(remainingKeys);
    const ytdH = yearSum("hdd", year).total;
    const ytdC = yearSum("cdd", year).total;
    const ytdWeather = cost(ytdH, ytdC);
    const elapsedFraction = (Date.UTC(year, Number(lastMmdd.slice(0, 2)) - 1, Number(lastMmdd.slice(3))) - Date.UTC(year, 0, 0)) / 86400000 / (isLeap(year) ? 366 : 365);

    // Weather-risk band: what the rest of the year cost in each of the last 10 years.
    const remainingWindows = [];
    for (let y = year - 10; y < year; y++) {
      let h = 0;
      let c = 0;
      let days = 0;
      for (const r of observed) {
        if (!r.date.startsWith(`${y}-`) || r.date.slice(5) <= lastMmdd) continue;
        const dh = dailyValue("hdd", r.tmax, r.tmin);
        if (dh == null) continue;
        h += dh;
        c += dailyValue("cdd", r.tmax, r.tmin);
        days += 1;
      }
      if (remainingKeys.length && days >= 0.8 * remainingKeys.length) remainingWindows.push(cost(h, c));
    }
    remainingWindows.sort((a, b) => a - b);

    const normalWeatherFull = cost(normalFull.h, normalFull.c);
    const projected = ytdWeather + cost(normalRemaining.h, normalRemaining.c) + inputs.base;
    const normalYear = normalWeatherFull + inputs.base;
    const spentSoFar = ytdWeather + inputs.base * elapsedFraction;
    const vsNormal = normalYear > 0 ? ((projected - normalYear) / normalYear) * 100 : null;

    // Sensitivity: weather-driven cost vs. annual mean temperature across complete years.
    const yearly = yearlyStats((r) => {
      const dd = degreeDays(r.tmax, r.tmin, state.base);
      return cost(dd.hdd, dd.cdd);
    }).filter((s) => s.complete);
    const trend = linearTrend(yearly.map((s) => ({ x: d3.mean(s.means), y: s.value })));
    const perDegree = trend ? `${trend.slope >= 0 ? "+" : "−"}${money(Math.abs(trend.slope))}` : "—";

    const tile = (value, label) =>
      `<div class="stat-tile"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
    const range = remainingWindows.length
      ? `range ${money(ytdWeather + inputs.base + remainingWindows[0])} – ${money(ytdWeather + inputs.base + remainingWindows[remainingWindows.length - 1])}`
      : "no range (year complete)";
    tilesEl.innerHTML =
      tile(money(spentSoFar), "spent so far this year (weather-driven + base load to date)") +
      tile(money(projected), `projected year-end with normal weather ahead; ${range}`) +
      tile(money(normalYear), vsNormal == null ? "normal-weather year" : `normal-weather year; projection is ${signed(vsNormal)}% vs. normal`) +
      tile(perDegree, "weather-driven cost per +1°F of annual average temperature");

    const lastWeather = inputs.heat + inputs.cool;
    const lastVsNormal = normalWeatherFull > 0 ? ((lastWeather - normalWeatherFull) / normalWeatherFull) * 100 : null;
    const notes = [
      `Calibrated rates (base ${state.base}°F): ${money(heatRate * 100)}/100 HDD and ${money(coolRate * 100)}/100 CDD from last year's ${Math.round(lastH.total).toLocaleString()} HDD and ${Math.round(lastC.total).toLocaleString()} CDD.`,
    ];
    if (lastVsNormal != null) {
      notes.push(`At those rates a normal-weather year costs ${money(normalWeatherFull)} for weather-driven energy; last year's weather-driven cost was ${signed(lastVsNormal)}% vs. that.`);
    }
    notes.push("Assumes cost scales linearly with degree days; excludes rate changes and non-weather usage.");
    notesEl.innerHTML = notes.map((n) => `<li>${n}</li>`).join("");

    const obsH = monthlyObserved("hdd", year);
    const obsC = monthlyObserved("cdd", year);
    const prevH = monthlyObserved("hdd", year - 1);
    const prevC = monthlyObserved("cdd", year - 1);
    const normH = monthlyNormal("hdd");
    const normC = monthlyNormal("cdd");
    const lastMonth = Number(lastMmdd.slice(0, 2));
    const chartRows = d3.range(12).map((i) => ({
      month: i + 1,
      normalVal: cost(normH[i], normC[i]),
      lastYearVal: prevH[i] == null && prevC[i] == null ? null : cost(prevH[i] || 0, prevC[i] || 0),
      thisYearVal: i + 1 > lastMonth ? null : cost(obsH[i] || 0, obsC[i] || 0),
      isPartial: i + 1 === lastMonth,
    }));
    registerExport(
      "chart-budget",
      chartRows.map((r) => ({
        month: MONTH_ABBR[r.month - 1],
        normal_cost: round1(r.normalVal),
        [`${year - 1}_cost`]: round1(r.lastYearVal),
        [`${year}_cost`]: round1(r.thisYearVal),
      }))
    );
    drawMonthlyGrouped(
      "chart-budget",
      "legend-budget",
      chartRows,
      [
        { key: "normalVal", label: "Normal weather", color: seriesColor("--series-normal") },
        { key: "lastYearVal", label: String(year - 1), color: seriesColor("--series-navy") },
        { key: "thisYearVal", label: String(year), color: seriesColor("--series-blue") },
      ],
      { format: (d) => money(d), ticks: 5 }
    );
  }

  // ---------------------------------------------------------------------
  // Stat tiles
  // ---------------------------------------------------------------------
  function renderTiles({ hdd, cdd, gdd, anomaly }) {
    const pct = (s) => (s.normal > 0 ? ((s.observed - s.normal) / s.normal) * 100 : null);
    const tile = (value, label, cls = "") =>
      `<div class="stat-tile"><div class="stat-value ${cls}">${value}</div><div class="stat-label">${label}</div></div>`;
    const dd = (s, name) => {
      const p = pct(s);
      return tile(
        `${Math.round(s.observed).toLocaleString()}<span class="unit"> ${name}</span>`,
        `normal to date ${Math.round(s.normal).toLocaleString()}${p == null ? "" : ` (${signed(p)}%)`}`
      );
    };
    const last = anomaly.length ? anomaly[anomaly.length - 1].value : null;
    document.getElementById("stat-tiles").innerHTML =
      dd(hdd, "HDD this year") +
      dd(cdd, "CDD this year") +
      dd(gdd, "GDD this year") +
      (last == null
        ? tile("—", "30-day anomaly")
        : tile(`${signed(last, 1)}<span class="unit">&deg;F</span>`, "last 30 days vs. normal", last >= 0 ? "up" : "down"));
  }

  function renderBaseChips() {
    const el = document.getElementById("base-select");
    el.innerHTML = BASES.map(
      (b) => `<button type="button" class="year-chip" data-base="${b}" aria-pressed="${b === state.base}">${b}&deg;</button>`
    ).join("");
    el.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.base = Number(btn.dataset.base);
        renderBaseChips();
        drawAll();
      })
    );
  }

  // ---------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------
  function drawAll() {
    exportsData = {};
    const hdd = drawCumulative({ kind: "hdd", chartId: "chart-hdd", legendId: "legend-hdd", unitLabel: "HDD" });
    const cdd = drawCumulative({ kind: "cdd", chartId: "chart-cdd", legendId: "legend-cdd", unitLabel: "CDD" });
    const gdd = drawCumulative({ kind: "gdd", chartId: "chart-gdd", legendId: "legend-gdd", unitLabel: "GDD" });
    const anomaly = computeAnomaly();
    renderTiles({ hdd, cdd, gdd, anomaly });
    drawAnomaly(anomaly);

    drawMonthly({ kind: "hdd", chartId: "chart-monthly-hdd", legendId: "legend-monthly-hdd", blue: true });
    drawMonthly({ kind: "cdd", chartId: "chart-monthly-cdd", legendId: "legend-monthly-cdd", blue: false });

    drawAnnual({
      chartId: "chart-annual-hdd", legendId: "legend-annual-hdd", unit: "HDD", tipLabel: "HDD",
      color: seriesColor("--series-blue"),
      valueFn: (r) => degreeDays(r.tmax, r.tmin, state.base).hdd,
    });
    drawAnnual({
      chartId: "chart-annual-cdd", legendId: "legend-annual-cdd", unit: "CDD", tipLabel: "CDD",
      color: seriesColor("--series-orange"),
      valueFn: (r) => degreeDays(r.tmax, r.tmin, state.base).cdd,
    });
    drawAnnual({
      chartId: "chart-hot-days", legendId: "legend-hot-days", unit: "days", tipLabel: `Days ≥${HOT_DAY_F}°F`,
      color: seriesColor("--series-red"),
      valueFn: (r) => (r.tmax >= HOT_DAY_F ? 1 : 0),
    });
    drawAnnual({
      chartId: "chart-freeze-days", legendId: "legend-freeze-days", unit: "days", tipLabel: `Days ≤${FREEZE_F}°F`,
      color: seriesColor("--series-navy"),
      valueFn: (r) => (r.tmin <= FREEZE_F ? 1 : 0),
    });

    drawBalance();
    renderBudget();

    renderFreezeTable();
    renderStreaks();
    renderRankings();
    attachCsvButtons();
  }

  function clearPage() {
    CHART_IDS.forEach((id) => showMessage(id, "Data isn't available for this station yet."));
    ["stat-tiles", "freeze-table", "streak-lists", "year-rankings", "budget-tiles", "budget-notes"].forEach((id) => {
      document.getElementById(id).innerHTML = "";
    });
    document.querySelectorAll(".legend").forEach((el) => {
      el.innerHTML = "";
    });
    document.getElementById("last-updated").textContent = "";
  }

  async function loadStation(stationId) {
    syncNavStationParam(stationId);
    const base = `data/${stationId}`;
    let normalsDaily, observed;
    try {
      [normalsDaily, observed] = await Promise.all([
        fetchJSON(`${base}/normals_daily.json`),
        fetchJSON(`${base}/observed_daily.json`),
      ]);
    } catch (err) {
      clearPage();
      console.error(err);
      return;
    }
    if (!observed.length) {
      clearPage();
      return;
    }
    // Optional file; absent until the pipeline has fetched it for this station.
    const officialDegreeDays = await fetchJSON(`${base}/degree_days_normals.json`).catch(() => null);
    state.data = prepare(normalsDaily, observed, officialDegreeDays);
    state.stationId = stationId;
    loadBudgetInputs();
    document.getElementById("last-updated").textContent = dataThroughText(state.data.lastObsDate);
    drawAll();
  }

  async function main() {
    const stations = await fetchJSON("stations.json");
    const select = document.getElementById("station-select");
    select.innerHTML = stations.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
    select.addEventListener("change", () => loadStation(select.value));

    const initial = new URLSearchParams(location.search).get("station");
    const startId = stations.some((s) => s.id === initial) ? initial : stations[0].id;
    select.value = startId;
    renderBaseChips();
    ["budget-heat", "budget-cool", "budget-base"].forEach((id) =>
      document.getElementById(id).addEventListener("input", () => {
        if (!state.data) return;
        saveBudgetInputs();
        renderBudget();
        attachCsvButtons();
      })
    );
    loadStation(startId);
  }

  main().catch((err) => console.error(err));
})();
