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
  const HEATING_SEASON_START = "07-01";
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
    "chart-annual-cdd", "chart-hot-days", "chart-freeze-days",
  ];

  const state = { base: DEFAULT_BASE, data: null };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const validDate = (year, mmdd) => mmdd !== "02-29" || isLeap(year);
  const meanTemp = (tmax, tmin) => (tmax == null || tmin == null ? null : (tmax + tmin) / 2);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const fmtMmdd = (mmdd) => `${MONTH_ABBR[Number(mmdd.slice(0, 2)) - 1]} ${Number(mmdd.slice(3))}`;
  const signed = (v, digits = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

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
  // Cumulative season charts (HDD / CDD / GDD)
  // ---------------------------------------------------------------------
  // HDD runs on a Jul 1 - Jun 30 heating season; CDD and GDD on the calendar year.
  function seasonStartYear(kind, lastDate) {
    const year = Number(lastDate.slice(0, 4));
    if (kind !== "hdd") return year;
    return Number(lastDate.slice(5, 7)) >= 7 ? year : year - 1;
  }

  function seasonDays(kind, startYear) {
    const { dayOrder } = state.data;
    let order = dayOrder;
    if (kind === "hdd") {
      const k = dayOrder.indexOf(HEATING_SEASON_START);
      order = dayOrder.slice(k).concat(dayOrder.slice(0, k));
    }
    return order.map((mmdd, idx) => {
      const month = Number(mmdd.slice(0, 2));
      const year = kind === "hdd" && month < 7 ? startYear + 1 : startYear;
      return { idx, mmdd, date: validDate(year, mmdd) ? `${year}-${mmdd}` : null };
    });
  }

  function cumulative(days, getValue) {
    let total = 0;
    return days.map(({ idx, mmdd, date }) => {
      const v = date ? getValue(date, mmdd) : null;
      if (v != null) total += v;
      return { idx, mmdd, date, value: total, hasData: v != null };
    });
  }

  function seasonLabel(kind, startYear) {
    return kind === "hdd" ? `${startYear}–${String(startYear + 1).slice(2)}` : String(startYear);
  }

  // Draws one cumulative chart and returns { observed, normal } to-date totals.
  function drawCumulative({ kind, chartId, legendId, unitLabel }) {
    const { lastObsDate } = state.data;
    const startYear = seasonStartYear(kind, lastObsDate);
    const days = seasonDays(kind, startYear);
    const prevDays = seasonDays(kind, startYear - 1);
    const observed = cumulative(days, observedGetter(kind));
    const previous = cumulative(prevDays, observedGetter(kind));
    const normal = cumulative(days, normalGetter(kind));
    const todayIdx = observed.findIndex((p) => p.date === lastObsDate);
    const prevHasData = previous.some((p) => p.hasData);

    const thisLabel = seasonLabel(kind, startYear);
    const prevLabel = seasonLabel(kind, startYear - 1);
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

    return {
      observed: observed[todayIdx].value,
      normal: normal[todayIdx].value,
      missingDays: observed.slice(0, todayIdx + 1).filter((p) => p.date && !p.hasData).length,
    };
  }

  // ---------------------------------------------------------------------
  // Monthly bars (HDD / CDD), via the shared grouped-bar renderer
  // ---------------------------------------------------------------------
  function drawMonthly({ kind, chartId, legendId, blue }) {
    const { observed, normalsDaily, lastObsDate } = state.data;
    const year = Number(lastObsDate.slice(0, 4));
    const lastMonth = Number(lastObsDate.slice(5, 7));
    const monthSums = (y) => {
      const out = Array(12).fill(null);
      for (const r of observed) {
        if (Number(r.date.slice(0, 4)) !== y) continue;
        const v = dailyValue(kind, r.tmax, r.tmin);
        if (v == null) continue;
        const m = Number(r.date.slice(5, 7)) - 1;
        out[m] = (out[m] || 0) + v;
      }
      return out;
    };
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
      const spring = yearRows.filter((r) => r.date.slice(5) < HEATING_SEASON_START).pop();
      const fall = yearRows.find((r) => r.date.slice(5) >= HEATING_SEASON_START);
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
      dd(hdd, "HDD since Jul 1") +
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

    renderFreezeTable();
    renderStreaks();
    renderRankings();
  }

  function clearPage() {
    CHART_IDS.forEach((id) => showMessage(id, "Data isn't available for this station yet."));
    ["stat-tiles", "freeze-table", "streak-lists", "year-rankings"].forEach((id) => {
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
    loadStation(startId);
  }

  main().catch((err) => console.error(err));
})();
