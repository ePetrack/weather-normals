/* Weather Normals Tracker — precipitation extremes charts.
 * Eight views of the same 35-year daily precipitation record, each aimed
 * at the same question: are events getting bigger/fewer, or smaller/more
 * frequent? Reads the same data/<station>/ JSON as app.js, via the shared
 * helpers in chart-utils.js. No build step: served as-is.
 */
(() => {
  "use strict";

  const {
    MONTH_ABBR,
    AVG_YEAR_COUNT,
    seriesColor,
    fmtDate,
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
  } = window.ChartUtils;

  const NORMALS_START_YEAR = 1991;
  const NORMALS_END_YEAR = 2020;

  // ---------------------------------------------------------------------
  // Shared intensity vocabulary — used by the heatmap, storm-count,
  // streamgraph, and bubble-strip charts so a "heavy" day/storm means the
  // same thing everywhere on this page.
  // ---------------------------------------------------------------------
  const INTENSITY_BUCKETS = [
    { key: "trace", label: "Trace (<0.01\")", max: 0.01 },
    { key: "light", label: "Light (0.01–0.24\")", max: 0.25 },
    { key: "moderate", label: "Moderate (0.25–0.74\")", max: 0.75 },
    { key: "heavy", label: "Heavy (0.75–1.49\")", max: 1.5 },
    { key: "extreme", label: "Extreme (1.5\"+)", max: Infinity },
  ];

  function intensityBucket(value) {
    if (value == null || value <= 0) return null;
    return INTENSITY_BUCKETS.find((b) => value < b.max) || INTENSITY_BUCKETS[INTENSITY_BUCKETS.length - 1];
  }

  function intensityColor(key) {
    return seriesColor(`--intensity-${key}`);
  }

  // ---------------------------------------------------------------------
  // ENSO (El Niño Southern Oscillation) phase per calendar year, split by
  // meteorological season for the year-rings chart's segmented ring. Winter
  // spans the Dec/Jan seam, so it appears as two segments per ring
  // (Jan-Feb tail of one winter, Dec onset of the next) that can
  // legitimately differ.
  //
  // Source: NOAA CPC's Oceanic Niño Index (ONI), official methodology
  // (El Niño/La Niña declared once the +-0.5 SST-anomaly threshold holds
  // for 5+ consecutive overlapping 3-month seasons). Values pulled from
  // https://raw.githubusercontent.com/ahuang11/oni/master/oni.csv, a
  // documented re-derivation of NOAA's own
  // https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt — each of the
  // 12 overlapping seasons (DJF, JFM, ... NDJ) mapped to its center month,
  // then averaged into the 5 segments below (majority phase, mean anomaly).
  // `null` means that segment hasn't happened/been published yet (only
  // relevant to the current partial year) — rendered as "pending", not
  // silently defaulted to neutral.
  // ---------------------------------------------------------------------
  const SEASONS = [
    { key: "winterTail", label: "Winter (Jan–Feb)", startIdx: 0, endIdx: 60 },
    { key: "spring", label: "Spring (Mar–May)", startIdx: 60, endIdx: 152 },
    { key: "summer", label: "Summer (Jun–Aug)", startIdx: 152, endIdx: 244 },
    { key: "fall", label: "Fall (Sep–Nov)", startIdx: 244, endIdx: 335 },
    { key: "winterOnset", label: "Winter (Dec)", startIdx: 335, endIdx: 366 },
  ];

  const SEASON_PHASE_BY_YEAR = {
    1991: { winterTail: ["neutral", 0.33], spring: ["neutral", 0.31], summer: ["nino", 0.67], fall: ["nino", 0.87], winterOnset: ["nino", 1.53] },
    1992: { winterTail: ["nino", 1.67], spring: ["nino", 1.28], summer: ["neutral", 0.40], fall: ["neutral", -0.22], winterOnset: ["neutral", -0.13] },
    1993: { winterTail: ["neutral", 0.20], spring: ["neutral", 0.62], summer: ["neutral", 0.38], fall: ["neutral", 0.10], winterOnset: ["neutral", 0.06] },
    1994: { winterTail: ["neutral", 0.07], spring: ["neutral", 0.30], summer: ["neutral", 0.43], fall: ["nino", 0.77], winterOnset: ["nino", 1.09] },
    1995: { winterTail: ["nino", 0.84], spring: ["neutral", 0.32], summer: ["neutral", -0.27], fall: ["nina", -0.93], winterOnset: ["nina", -0.98] },
    1996: { winterTail: ["nina", -0.82], spring: ["neutral", -0.43], summer: ["neutral", -0.30], fall: ["neutral", -0.40], winterOnset: ["neutral", -0.49] },
    1997: { winterTail: ["neutral", -0.43], spring: ["neutral", 0.31], summer: ["nino", 1.57], fall: ["nino", 2.29], winterOnset: ["nino", 2.39] },
    1998: { winterTail: ["nino", 2.08], spring: ["nino", 0.96], summer: ["nina", -0.68], fall: ["nina", -1.38], winterOnset: ["nina", -1.57] },
    1999: { winterTail: ["nina", -1.43], spring: ["nina", -1.02], summer: ["nina", -1.08], fall: ["nina", -1.29], winterOnset: ["nina", -1.65] },
    2000: { winterTail: ["nina", -1.53], spring: ["nina", -0.86], summer: ["nina", -0.57], fall: ["nina", -0.64], winterOnset: ["nina", -0.74] },
    2001: { winterTail: ["nina", -0.60], spring: ["neutral", -0.34], summer: ["neutral", -0.11], fall: ["neutral", -0.28], winterOnset: ["neutral", -0.31] },
    2002: { winterTail: ["neutral", -0.06], spring: ["neutral", 0.24], summer: ["nino", 0.77], fall: ["nino", 1.18], winterOnset: ["nino", 1.14] },
    2003: { winterTail: ["nino", 0.78], spring: ["neutral", 0.03], summer: ["neutral", 0.04], fall: ["neutral", 0.30], winterOnset: ["neutral", 0.35] },
    2004: { winterTail: ["neutral", 0.34], spring: ["neutral", 0.19], summer: ["neutral", 0.46], fall: ["nino", 0.68], winterOnset: ["nino", 0.69] },
    2005: { winterTail: ["nino", 0.61], spring: ["neutral", 0.39], summer: ["neutral", -0.03], fall: ["neutral", -0.32], winterOnset: ["nina", -0.84] },
    2006: { winterTail: ["nina", -0.81], spring: ["neutral", -0.36], summer: ["neutral", 0.12], fall: ["nino", 0.75], winterOnset: ["nino", 0.94] },
    2007: { winterTail: ["nino", 0.44], spring: ["neutral", -0.27], summer: ["nina", -0.61], fall: ["nina", -1.30], winterOnset: ["nina", -1.60] },
    2008: { winterTail: ["nina", -1.58], spring: ["nina", -1.05], summer: ["neutral", -0.40], fall: ["neutral", -0.38], winterOnset: ["nina", -0.73] },
    2009: { winterTail: ["nina", -0.82], spring: ["neutral", -0.31], summer: ["neutral", 0.44], fall: ["nino", 1.03], winterOnset: ["nino", 1.56] },
    2010: { winterTail: ["nino", 1.36], spring: ["neutral", 0.34], summer: ["nina", -1.02], fall: ["nina", -1.61], winterOnset: ["nina", -1.54] },
    2011: { winterTail: ["nina", -1.18], spring: ["nina", -0.63], summer: ["neutral", -0.46], fall: ["nina", -0.92], winterOnset: ["nina", -0.92] },
    2012: { winterTail: ["nina", -0.65], spring: ["neutral", -0.33], summer: ["neutral", 0.26], fall: ["neutral", 0.28], winterOnset: ["neutral", -0.10] },
    2013: { winterTail: ["neutral", -0.29], spring: ["neutral", -0.22], summer: ["neutral", -0.32], fall: ["neutral", -0.15], winterOnset: ["neutral", -0.15] },
    2014: { winterTail: ["neutral", -0.30], spring: ["neutral", 0.11], summer: ["neutral", 0.15], fall: ["nino", 0.51], winterOnset: ["nino", 0.77] },
    2015: { winterTail: ["nino", 0.65], spring: ["nino", 0.83], summer: ["nino", 1.58], fall: ["nino", 2.44], winterOnset: ["nino", 2.75] },
    2016: { winterTail: ["nino", 2.46], spring: ["nino", 1.08], summer: ["neutral", -0.27], fall: ["neutral", -0.61], winterOnset: ["neutral", -0.45] },
    2017: { winterTail: ["neutral", -0.10], spring: ["neutral", 0.30], summer: ["neutral", 0.17], fall: ["nina", -0.57], winterOnset: ["nina", -0.86] },
    2018: { winterTail: ["nina", -0.74], spring: ["neutral", -0.36], summer: ["neutral", 0.16], fall: ["nino", 0.77], winterOnset: ["nino", 0.92] },
    2019: { winterTail: ["nino", 0.88], spring: ["nino", 0.75], summer: ["neutral", 0.35], fall: ["neutral", 0.40], winterOnset: ["nino", 0.66] },
    2020: { winterTail: ["nino", 0.64], spring: ["neutral", 0.28], summer: ["neutral", -0.37], fall: ["nina", -1.06], winterOnset: ["nina", -1.08] },
    2021: { winterTail: ["nina", -0.85], spring: ["nina", -0.55], summer: ["neutral", -0.37], fall: ["nina", -0.77], winterOnset: ["nina", -0.87] },
    2022: { winterTail: ["nina", -0.80], spring: ["nina", -0.90], summer: ["nina", -0.80], fall: ["nina", -0.92], winterOnset: ["nina", -0.71] },
    2023: { winterTail: ["nina", -0.42], spring: ["neutral", 0.27], summer: ["nino", 1.11], fall: ["nino", 1.81], winterOnset: ["nino", 2.06] },
    2024: { winterTail: ["nino", 1.77], spring: ["nino", 0.86], summer: ["neutral", 0.08], fall: ["neutral", -0.23], winterOnset: ["neutral", -0.42] },
    2025: { winterTail: ["neutral", -0.34], spring: ["neutral", -0.02], summer: ["neutral", -0.15], fall: ["neutral", -0.49], winterOnset: ["neutral", -0.54] },
    2026: { winterTail: ["neutral", -0.26], spring: ["neutral", 0.54], summer: null, fall: null, winterOnset: null },
  };

  const ENSO_PHASE_LABELS = { nino: "El Niño", nina: "La Niña", neutral: "Neutral", pending: "Not yet known" };
  const ENSO_PHASE_VARS = { nino: "--series-orange", nina: "--series-aqua", neutral: "--series-normal", pending: "--gridline" };

  function ensoColor(phase) {
    return seriesColor(ENSO_PHASE_VARS[phase]);
  }

  function seasonEntry(year, seasonKey) {
    return SEASON_PHASE_BY_YEAR[year] && SEASON_PHASE_BY_YEAR[year][seasonKey];
  }

  function seasonPhase(year, seasonKey) {
    const entry = seasonEntry(year, seasonKey);
    return entry ? entry[0] : "pending";
  }

  function ensoStrength(anom) {
    const a = Math.abs(anom);
    if (a >= 2.0) return "very strong";
    if (a >= 1.5) return "strong";
    if (a >= 1.0) return "moderate";
    return "weak";
  }

  // Continuous fill-opacity by ONI magnitude: weak/neutral segments fade
  // toward the background, strong/very-strong events visually pop — a
  // second data channel (strength) carried without adding any new marks.
  function ensoOpacity(phase, anom) {
    if (phase === "pending") return 0;
    if (phase === "neutral") return 0.35;
    const a = Math.min(Math.abs(anom), 2.0); // clamp at the "very strong" threshold
    return 0.35 + (a / 2.0) * 0.65;
  }

  function monthTickLabel(mmdd) {
    const [m, d] = mmdd.split("-").map(Number);
    return `${MONTH_ABBR[m - 1]} ${d}`;
  }

  // ---------------------------------------------------------------------
  // Storm-event detection: a run of consecutive wet days is one "event."
  // A single missing/trace day inside a run is bridged (ACIS trace "T"
  // collapses to null and is indistinguishable from a real gap); two or
  // more consecutive missing days end the event. A dry day always ends it.
  // Callers pass any date-ascending subset of `observed` — a single year
  // (accepting that a Dec 31 -> Jan 1 storm splits) or the full record
  // (true storm boundaries).
  // ---------------------------------------------------------------------
  function detectStormEvents(rows) {
    const events = [];
    let current = null;
    let pendingGap = 0;

    const finalize = () => {
      if (!current) return;
      events.push({
        startDate: current.days[0],
        endDate: current.days[current.days.length - 1],
        days: current.days,
        totalPrecip: current.totalPrecip,
        peakPrecip: current.peakPrecip,
        peakDate: current.peakDate,
      });
      current = null;
    };

    for (const r of rows) {
      const wet = r.precip != null && r.precip > 0;
      const missing = r.precip == null;

      if (wet) {
        if (current && pendingGap >= 2) finalize();
        if (!current) current = { days: [], totalPrecip: 0, peakPrecip: -Infinity, peakDate: null };
        pendingGap = 0;
        current.days.push(r.date);
        current.totalPrecip += r.precip;
        if (r.precip > current.peakPrecip) {
          current.peakPrecip = r.precip;
          current.peakDate = r.date;
        }
      } else if (missing && current) {
        pendingGap += 1;
      } else {
        finalize();
        pendingGap = 0;
      }
    }
    finalize();
    return events;
  }

  // ---------------------------------------------------------------------
  // Shared "one row per year" scaffold for the horizon chart, calendar
  // heatmap, and bubble strip — all x = day-of-year, rows stacked so all
  // 35 years are visible at once.
  // ---------------------------------------------------------------------
  function buildRowStrip(containerId, { years, rowHeight = 11, rowGap = 2 }) {
    const margin = { top: 10, right: 16, bottom: 26, left: 46 };
    const rowStep = rowHeight + rowGap;
    const height = years.length * rowStep - rowGap + margin.top + margin.bottom;
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg(containerId, {
      width: 880,
      height,
      margin,
    });
    const x = d3.scaleLinear().domain([0, 365]).range([0, innerWidth]);
    const rowIndex = new Map(years.map((y, i) => [y, i]));
    const rowY = (year) => rowIndex.get(year) * rowStep;
    return { plot, x, rowY, rowStep, innerWidth, innerHeight, tooltip, container };
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------
  async function main() {
    const stations = await fetchJSON("stations.json");
    const select = document.getElementById("station-select");
    select.innerHTML = stations.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

    select.addEventListener("change", () => loadStationExtremes(select.value));

    const initial = new URLSearchParams(location.search).get("station");
    const startId = stations.some((s) => s.id === initial) ? initial : stations[0].id;
    select.value = startId;
    loadStationExtremes(startId);
  }

  async function loadStationExtremes(stationId) {
    syncNavStationParam(stationId);
    const base = `data/${stationId}`;
    const chartIds = [
      "chart-horizon",
      "chart-calendar-heatmap",
      "chart-storm-dots",
      "chart-candle-monthly",
      "chart-candle-storms",
      "chart-streamgraph",
      "chart-radial-years",
      "chart-bubble-strip",
    ];

    let normalsDaily, observed;
    try {
      [normalsDaily, observed] = await Promise.all([
        fetchJSON(`${base}/normals_daily.json`),
        fetchJSON(`${base}/observed_daily.json`),
      ]);
    } catch (err) {
      chartIds.forEach((id) =>
        showMessage(
          id,
          "Data isn't published yet for this station — it appears after the first " +
            "scheduled (or manually triggered) data-update run completes."
        )
      );
      document.getElementById("last-updated").textContent = "";
      console.error(err);
      return;
    }

    const lastObsDate = observed.length ? observed[observed.length - 1].date : null;
    document.getElementById("last-updated").textContent = lastObsDate
      ? `Data through ${fmtDate(parseISODate(lastObsDate))}`
      : "";

    const years = Array.from(new Set(observed.map((d) => Number(d.date.slice(0, 4))))).sort((a, b) => a - b);

    drawHorizon(normalsDaily, observed, years);
    drawCalendarHeatmap(normalsDaily, observed, years);
    drawStormDots(observed);
    drawCandleMonthly(observed);
    drawCandleStorms(observed);
    drawStreamgraph(observed, years);
    drawRadialYears(normalsDaily, observed, years);
    drawBubbleStrip(normalsDaily, observed, years);
  }

  // ---------------------------------------------------------------------
  // Chart 1: Horizon chart — folded daily-precip color bands, one row/year
  // ---------------------------------------------------------------------
  function drawHorizon(normalsDaily, observed, years) {
    const { dayIndex } = buildDayIndex(normalsDaily);
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));

    const allPrecip = observed.map((d) => d.precip).filter((v) => v != null && v > 0).sort(d3.ascending);
    const bandCount = 4;
    const ceiling = d3.quantile(allPrecip, 0.99) || 1;
    const bandHeight = ceiling / bandCount;
    const bandColors = ["--intensity-light", "--intensity-moderate", "--intensity-heavy", "--intensity-extreme"].map(
      seriesColor
    );
    const noneColor = seriesColor("--intensity-none");

    drawLegend("legend-horizon", [
      { label: "No data", color: noneColor, style: "swatch" },
      { label: "Light", color: bandColors[0], style: "swatch" },
      { label: "Moderate", color: bandColors[1], style: "swatch" },
      { label: "Heavy", color: bandColors[2], style: "swatch" },
      { label: `Extreme (folded, ≥ ${ceiling.toFixed(2)}")`, color: bandColors[3], style: "swatch" },
    ]);

    const rowHeight = 9;
    const { plot, x, rowY, rowStep, innerWidth, innerHeight, tooltip, container } = buildRowStrip("chart-horizon", {
      years,
      rowHeight,
      rowGap: 1,
    });
    const cellWidth = Math.max(1, innerWidth / 366);

    years.forEach((year) => {
      const rows = byYear.get(String(year)) || [];
      const byDay = new Map();
      rows.forEach((r) => {
        const idx = dayIndex.get(r.date.slice(5));
        if (idx !== undefined) byDay.set(idx, r.precip);
      });
      const cells = d3.range(366).map((idx) => ({ idx, value: byDay.has(idx) ? byDay.get(idx) : null, year }));

      plot
        .append("g")
        .attr("transform", `translate(0,${rowY(year)})`)
        .selectAll("rect")
        .data(cells)
        .join("rect")
        .attr("x", (d) => x(d.idx))
        .attr("width", cellWidth)
        .attr("height", rowHeight)
        .attr("fill", (d) => {
          if (d.value == null) return noneColor;
          const bandIdx = Math.min(bandCount - 1, Math.floor(d.value / bandHeight));
          return bandColors[bandIdx];
        })
        .on("mousemove", function (event, d) {
          showTooltip(
            tooltip,
            container,
            event,
            `${year} — day ${d.idx + 1}`,
            [{ label: "Precip", color: d3.select(this).attr("fill"), value: d.value }],
            (v) => (v == null ? "No data" : `${v.toFixed(2)}"`)
          );
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));
    });

    drawYearLabels(plot, years, rowStep);
    drawMonthAxis(plot, x, innerHeight, dayIndex);
  }

  // ---------------------------------------------------------------------
  // Chart 2: Calendar heatmap — years x day-of-year, discrete intensity fill
  // ---------------------------------------------------------------------
  function drawCalendarHeatmap(normalsDaily, observed, years) {
    const { dayIndex } = buildDayIndex(normalsDaily);
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const dryColor = seriesColor("--intensity-trace");
    const noneColor = seriesColor("--intensity-none");

    drawLegend("legend-calendar-heatmap", [
      { label: "No data", color: noneColor, style: "swatch" },
      { label: "Dry", color: dryColor, style: "swatch" },
      ...INTENSITY_BUCKETS.map((b) => ({ label: b.label, color: intensityColor(b.key), style: "swatch" })),
    ]);

    const rowHeight = 9;
    const { plot, x, rowY, rowStep, innerWidth, innerHeight, tooltip, container } = buildRowStrip(
      "chart-calendar-heatmap",
      { years, rowHeight, rowGap: 2 }
    );
    const cellWidth = Math.max(1, innerWidth / 366 - 0.4);

    years.forEach((year) => {
      const rows = byYear.get(String(year)) || [];
      const byDay = new Map();
      rows.forEach((r) => {
        const idx = dayIndex.get(r.date.slice(5));
        if (idx !== undefined) byDay.set(idx, r.precip);
      });
      const cells = d3.range(366).map((idx) => ({ idx, value: byDay.has(idx) ? byDay.get(idx) : null }));

      plot
        .append("g")
        .attr("transform", `translate(0,${rowY(year)})`)
        .selectAll("rect")
        .data(cells)
        .join("rect")
        .attr("x", (d) => x(d.idx))
        .attr("width", cellWidth)
        .attr("height", rowHeight)
        .attr("rx", 1)
        .attr("fill", (d) => {
          if (d.value == null) return noneColor;
          if (d.value <= 0) return dryColor;
          const b = intensityBucket(d.value);
          return b ? intensityColor(b.key) : dryColor;
        })
        .on("mousemove", function (event, d) {
          showTooltip(
            tooltip,
            container,
            event,
            `${year}, day ${d.idx + 1}`,
            [{ label: "Precip", color: d3.select(this).attr("fill"), value: d.value }],
            (v) => (v == null ? "No data" : v <= 0 ? "Dry" : `${v.toFixed(2)}"`)
          );
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));
    });

    drawYearLabels(plot, years, rowStep);
    drawMonthAxis(plot, x, innerHeight, dayIndex);
  }

  // Shared row-strip decorations (year labels + month axis), factored out
  // once both chart 1 and chart 2 (and chart 8) needed the same treatment.
  function drawYearLabels(plot, years, rowStep) {
    years.forEach((year, i) => {
      if (i % 5 !== 0 && year !== years[years.length - 1]) return;
      plot
        .append("text")
        .attr("class", "chart-label")
        .attr("x", -8)
        .attr("y", i * rowStep + rowStep / 2)
        .attr("dy", "0.32em")
        .attr("text-anchor", "end")
        .text(year);
    });
  }

  function drawMonthAxis(plot, x, innerHeight, dayIndex) {
    const ticks = monthTicks(dayIndex);
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight + 6})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(ticks.map((t) => t.idx))
          .tickFormat((d, i) => ticks[i].name)
      )
      .call((g) => g.select(".domain").attr("class", "baseline"));
  }

  // ---------------------------------------------------------------------
  // Chart 3: Storm counts by size — normal-period vs. recent vs. this year
  // ---------------------------------------------------------------------
  function stormBucketCounts(observed, years) {
    const counts = Object.fromEntries(INTENSITY_BUCKETS.map((b) => [b.key, 0]));
    years.forEach((year) => {
      const rows = observed.filter((d) => d.date.startsWith(String(year)));
      detectStormEvents(rows).forEach((ev) => {
        const b = intensityBucket(ev.totalPrecip);
        if (b) counts[b.key] += 1;
      });
    });
    return counts;
  }

  function scaleCounts(counts, n) {
    const out = {};
    Object.keys(counts).forEach((k) => (out[k] = counts[k] / n));
    return out;
  }

  function drawStormDots(observed) {
    const currentYear = new Date().getFullYear();
    const baselineYears = presentYears(observed, d3.range(NORMALS_START_YEAR, NORMALS_END_YEAR + 1));
    const trailingYears = presentYears(
      observed,
      Array.from({ length: AVG_YEAR_COUNT }, (_, i) => currentYear - 1 - i)
    ).sort((a, b) => a - b);

    const groups = [
      baselineYears.length && {
        key: "baseline",
        label: `${NORMALS_START_YEAR}–${NORMALS_END_YEAR} avg/yr`,
        counts: scaleCounts(stormBucketCounts(observed, baselineYears), baselineYears.length),
        fractional: true,
      },
      trailingYears.length && {
        key: "trailing",
        label: `${trailingYears[0]}–${trailingYears[trailingYears.length - 1]} avg/yr`,
        counts: scaleCounts(stormBucketCounts(observed, trailingYears), trailingYears.length),
        fractional: true,
      },
      { key: "thisyear", label: `${currentYear} (YTD)`, counts: stormBucketCounts(observed, [currentYear]), fractional: false },
    ].filter(Boolean);

    drawLegend(
      "legend-storm-dots",
      INTENSITY_BUCKETS.map((b) => ({ label: b.label, color: intensityColor(b.key), style: "swatch" }))
    );

    const dotR = 5;
    const dotGap = 3;
    const dotStep = dotR * 2 + dotGap;
    const maxCount = Math.max(1, ...groups.flatMap((g) => Object.values(g.counts)));
    const margin = { top: 10, right: 16, bottom: 50, left: 40 };
    const height = Math.ceil(maxCount) * dotStep + margin.top + margin.bottom;
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-storm-dots", {
      width: 880,
      height,
      margin,
    });

    const x0 = d3
      .scaleBand()
      .domain(groups.map((g) => g.key))
      .range([0, innerWidth])
      .paddingInner(0.35)
      .paddingOuter(0.1);
    const x1 = d3
      .scaleBand()
      .domain(INTENSITY_BUCKETS.map((b) => b.key))
      .range([0, x0.bandwidth()])
      .padding(0.2);

    yAxisLeft(plot, d3.scaleLinear().domain([0, Math.ceil(maxCount)]).range([innerHeight, 0]), innerWidth, {
      ticks: Math.min(6, Math.ceil(maxCount)),
    });

    groups.forEach((g) => {
      const gx = x0(g.key);
      INTENSITY_BUCKETS.forEach((b) => {
        const count = g.counts[b.key] || 0;
        const full = Math.floor(count);
        const remainder = count - full;
        const bx = gx + x1(b.key) + x1.bandwidth() / 2;
        const total = remainder > 0.05 ? full + 1 : full;
        for (let i = 0; i < total; i++) {
          const isPartial = i === full && remainder > 0.05;
          plot
            .append("circle")
            .attr("cx", bx)
            .attr("cy", innerHeight - i * dotStep - dotR - 1)
            .attr("r", dotR)
            .attr("fill", intensityColor(b.key))
            .attr("opacity", isPartial ? Math.max(0.25, remainder) : 1)
            .on("mousemove", (event) =>
              showTooltip(
                tooltip,
                container,
                event,
                `${g.label} — ${b.label}`,
                [{ label: "Storms", color: intensityColor(b.key), value: count }],
                (v) => (g.fractional ? v.toFixed(2) : String(Math.round(v)))
              )
            )
            .on("mouseleave", () => tooltip.style("opacity", 0));
        }
      });

      // Bucket initials, then the group label beneath.
      INTENSITY_BUCKETS.forEach((b) => {
        plot
          .append("text")
          .attr("class", "chart-label")
          .attr("text-anchor", "middle")
          .attr("x", gx + x1(b.key) + x1.bandwidth() / 2)
          .attr("y", innerHeight + 14)
          .text(b.key[0].toUpperCase());
      });
      plot
        .append("text")
        .attr("class", "chart-label-strong")
        .attr("text-anchor", "middle")
        .attr("x", gx + x0.bandwidth() / 2)
        .attr("y", innerHeight + 32)
        .text(g.label);
    });
  }

  // ---------------------------------------------------------------------
  // Chart 4: Candlestick — monthly precipitation range vs. this year
  // ---------------------------------------------------------------------
  function drawCandleMonthly(observed) {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const totals = new Map();
    observed.forEach((r) => {
      if (r.precip == null) return;
      const year = Number(r.date.slice(0, 4));
      const month = Number(r.date.slice(5, 7));
      const key = `${year}-${month}`;
      if (!totals.has(key)) totals.set(key, { year, month, sum: 0 });
      totals.get(key).sum += r.precip;
    });

    const perMonth = d3.range(1, 13).map((month) => {
      const isCurrentMonth = month === currentMonth;
      const historyVals = [];
      let thisYearVal = null;
      let thisYearPartial = false;
      totals.forEach((b) => {
        if (b.month !== month) return;
        const isThisYear = b.year === currentYear;
        if (isThisYear) {
          thisYearVal = b.sum;
          thisYearPartial = isCurrentMonth;
          if (isCurrentMonth) return; // exclude only the in-progress month from history
        }
        historyVals.push(b.sum);
      });
      historyVals.sort(d3.ascending);
      return {
        month,
        p10: d3.quantile(historyVals, 0.1),
        p90: d3.quantile(historyVals, 0.9),
        min: d3.min(historyVals),
        max: d3.max(historyVals),
        thisYearVal,
        thisYearPartial,
        historyCount: historyVals.length,
      };
    });

    drawLegend("legend-candle-monthly", [
      { label: "Normal range (10th–90th pct)", color: seriesColor("--series-normal"), style: "swatch" },
      { label: "All-time min–max", color: seriesColor("--baseline"), style: "line" },
      { label: "This year, in range", color: seriesColor("--series-blue"), style: "swatch" },
      { label: "This year, outside range", color: seriesColor("--series-red"), style: "swatch" },
    ]);

    const margin = { top: 10, right: 16, bottom: 26, left: 46 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-candle-monthly", { margin });

    const x = d3.scaleBand().domain(d3.range(1, 13)).range([0, innerWidth]).padding(0.35);
    const maxY = Math.max(d3.max(perMonth, (d) => d.max) || 0, d3.max(perMonth, (d) => d.thisYearVal) || 0) * 1.12;
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([innerHeight, 0]);
    const candleWidth = Math.min(28, x.bandwidth());

    yAxisLeft(plot, y, innerWidth, { format: (d) => `${d}"` });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat((m) => MONTH_ABBR[m - 1]))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    perMonth.forEach((d) => {
      const cx = x(d.month) + x.bandwidth() / 2;
      const group = plot.append("g");
      if (d.historyCount) {
        group
          .append("line")
          .attr("x1", cx)
          .attr("x2", cx)
          .attr("y1", y(d.min))
          .attr("y2", y(d.max))
          .attr("stroke", seriesColor("--baseline"))
          .attr("stroke-width", 1.5);
        group
          .append("rect")
          .attr("x", cx - candleWidth / 2)
          .attr("y", y(d.p90))
          .attr("width", candleWidth)
          .attr("height", Math.max(1, y(d.p10) - y(d.p90)))
          .attr("rx", 3)
          .attr("fill", seriesColor("--series-normal"))
          .attr("opacity", 0.4);
      }
      if (d.thisYearVal != null) {
        const outside = d.historyCount && (d.thisYearVal < d.p10 || d.thisYearVal > d.p90);
        const markerColor = seriesColor(outside ? "--series-red" : "--series-blue");
        group
          .append("circle")
          .attr("cx", cx)
          .attr("cy", y(d.thisYearVal))
          .attr("r", 5)
          .attr("stroke", markerColor)
          .attr("stroke-width", 2)
          .attr("fill", d.thisYearPartial ? "var(--surface-1)" : markerColor);
      }
      group
        .append("rect")
        .attr("x", cx - x.bandwidth() / 2)
        .attr("y", 0)
        .attr("width", x.bandwidth())
        .attr("height", innerHeight)
        .attr("fill", "transparent")
        .on("mousemove", (event) => {
          const rows = [];
          if (d.historyCount) {
            rows.push({ label: "10th–90th pct", color: seriesColor("--series-normal"), value: `${d.p10.toFixed(2)}–${d.p90.toFixed(2)}"` });
            rows.push({ label: "All-time range", color: seriesColor("--baseline"), value: `${d.min.toFixed(2)}–${d.max.toFixed(2)}"` });
          }
          if (d.thisYearVal != null) {
            rows.push({
              label: d.thisYearPartial ? "This year (MTD)" : "This year",
              color: seriesColor("--series-blue"),
              value: `${d.thisYearVal.toFixed(2)}"`,
            });
          }
          showTooltip(tooltip, container, event, MONTH_ABBR[d.month - 1], rows, (v) => v);
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));
    });
  }

  // ---------------------------------------------------------------------
  // Chart 5: Storm-event candlestick timeline
  // ---------------------------------------------------------------------
  function drawCandleStorms(observed) {
    const events = detectStormEvents(observed).filter((e) => e.totalPrecip >= 1.0);

    drawLegend(
      "legend-candle-storms",
      INTENSITY_BUCKETS.slice(1).map((b) => ({ label: b.label, color: intensityColor(b.key), style: "swatch" }))
    );

    const margin = { top: 10, right: 16, bottom: 26, left: 46 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-candle-storms", { margin });

    if (!events.length) {
      showMessage("chart-candle-storms", "No storms of at least 1\" total rainfall recorded yet.");
      return;
    }

    const x = d3.scaleTime().domain(d3.extent(observed, (d) => parseISODate(d.date))).range([0, innerWidth]);
    const maxTotal = d3.max(events, (e) => e.totalPrecip) || 1;
    const y = d3.scaleLinear().domain([0, maxTotal * 1.1]).nice().range([innerHeight, 0]);
    const maxDuration = d3.max(events, (e) => e.days.length) || 1;
    const widthScale = d3.scaleLinear().domain([1, maxDuration]).range([2, 9]).clamp(true);

    yAxisLeft(plot, y, innerWidth, { format: (d) => `${d}"` });
    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(d3.timeYear.every(3)).tickFormat(d3.timeFormat("%Y")))
      .call((g) => g.select(".domain").attr("class", "baseline"));

    events.forEach((e) => {
      const midDate = parseISODate(e.days[Math.floor((e.days.length - 1) / 2)]);
      const bw = widthScale(e.days.length);
      const bx = x(midDate);
      const bucket = intensityBucket(e.totalPrecip) || INTENSITY_BUCKETS[INTENSITY_BUCKETS.length - 1];
      const color = intensityColor(bucket.key);

      const g = plot.append("g");
      g.append("rect")
        .attr("x", bx - bw / 2)
        .attr("y", y(e.totalPrecip))
        .attr("width", bw)
        .attr("height", Math.max(1, innerHeight - y(e.totalPrecip)))
        .attr("fill", color);
      g.append("line")
        .attr("x1", bx - bw / 2)
        .attr("x2", bx + bw / 2)
        .attr("y1", y(e.peakPrecip))
        .attr("y2", y(e.peakPrecip))
        .attr("stroke", "var(--surface-1)")
        .attr("stroke-width", 1.4);
      g.append("rect")
        .attr("x", bx - Math.max(bw, 6) / 2)
        .attr("y", 0)
        .attr("width", Math.max(bw, 6))
        .attr("height", innerHeight)
        .attr("fill", "transparent")
        .on("mousemove", (event) =>
          showTooltip(
            tooltip,
            container,
            event,
            `${fmtDate(parseISODate(e.startDate))} – ${fmtDate(parseISODate(e.endDate))}`,
            [
              { label: "Total", color, value: `${e.totalPrecip.toFixed(2)}"` },
              { label: `Peak day (${e.peakDate})`, color: "var(--surface-1)", value: `${e.peakPrecip.toFixed(2)}"` },
              { label: "Duration", color, value: `${e.days.length} day${e.days.length > 1 ? "s" : ""}` },
            ],
            (v) => v
          )
        )
        .on("mouseleave", () => tooltip.style("opacity", 0));
    });
  }

  // ---------------------------------------------------------------------
  // Chart 6: Streamgraph — annual rainfall split by intensity bucket
  // ---------------------------------------------------------------------
  function drawStreamgraph(observed, years) {
    const bucketKeys = INTENSITY_BUCKETS.map((b) => b.key);
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const currentYear = new Date().getFullYear();

    const data = years.map((year) => {
      const rows = byYear.get(String(year)) || [];
      const totals = Object.fromEntries(bucketKeys.map((k) => [k, 0]));
      rows.forEach((r) => {
        const b = intensityBucket(r.precip);
        if (b) totals[b.key] += r.precip;
      });
      return { year, ...totals };
    });

    drawLegend(
      "legend-streamgraph",
      INTENSITY_BUCKETS.map((b) => ({ label: b.label, color: intensityColor(b.key), style: "swatch" }))
    );

    const margin = { top: 16, right: 16, bottom: 26, left: 16 };
    const { plot, innerWidth, innerHeight, tooltip, container } = buildSvg("chart-streamgraph", { margin });

    const stack = d3.stack().keys(bucketKeys).order(d3.stackOrderInsideOut).offset(d3.stackOffsetWiggle);
    const series = stack(data);

    const x = d3.scaleLinear().domain(d3.extent(years)).range([0, innerWidth]);
    const yExtent = [d3.min(series, (s) => d3.min(s, (d) => d[0])), d3.max(series, (s) => d3.max(s, (d) => d[1]))];
    const y = d3.scaleLinear().domain(yExtent).nice().range([innerHeight, 0]);

    const area = d3
      .area()
      .curve(d3.curveBasis)
      .x((d) => x(d.data.year))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]));

    plot
      .selectAll("path")
      .data(series)
      .join("path")
      .attr("d", area)
      .attr("fill", (d) => intensityColor(d.key))
      .on("mousemove", function (event, seriesRow) {
        const [mx] = d3.pointer(event);
        const yearAt = Math.round(x.invert(mx));
        const row = data.find((d) => d.year === yearAt);
        if (!row) return;
        const bucket = INTENSITY_BUCKETS.find((b) => b.key === seriesRow.key);
        showTooltip(
          tooltip,
          container,
          event,
          String(yearAt),
          [{ label: bucket.label, color: intensityColor(bucket.key), value: row[bucket.key] }],
          (v) => `${v.toFixed(2)}"`
        );
      })
      .on("mouseleave", () => tooltip.style("opacity", 0));

    // Mute the current (partial) year so its narrower silhouette isn't
    // misread as "less extreme" rather than "not finished yet."
    if (years.includes(currentYear)) {
      const halfStep = innerWidth / Math.max(1, years.length - 1) / 2;
      plot
        .append("rect")
        .attr("x", x(currentYear) - halfStep)
        .attr("y", 0)
        .attr("width", innerWidth - (x(currentYear) - halfStep))
        .attr("height", innerHeight)
        .attr("fill", "var(--page)")
        .attr("opacity", 0.45)
        .style("pointer-events", "none");
      plot
        .append("text")
        .attr("class", "chart-label")
        .attr("x", innerWidth)
        .attr("y", 12)
        .attr("text-anchor", "end")
        .text(`${currentYear} year to date`);
    }

    plot
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")))
      .call((g) => g.select(".domain").attr("class", "baseline"));
  }

  // ---------------------------------------------------------------------
  // Chart 7: Radial year-rings — small multiples, one polar glyph per year
  // ---------------------------------------------------------------------
  function drawRadialYears(normalsDaily, observed, years) {
    const { dayOrder, dayIndex } = buildDayIndex(normalsDaily);
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const cols = 7;
    const rows = Math.ceil(years.length / cols);
    const glyphSize = 116;
    const baseR = 16;
    const maxR = 48;
    const margin = { top: 10, right: 16, bottom: 10, left: 16 };
    const width = 880;
    const height = rows * glyphSize + margin.top + margin.bottom;
    const { plot, tooltip, container } = buildSvg("chart-radial-years", { width, height, margin });
    const innerWidth = width - margin.left - margin.right;
    const colWidth = innerWidth / cols;

    const allVals = observed.map((d) => d.precip).filter((v) => v != null && v > 0).sort(d3.ascending);
    const ceiling = d3.quantile(allVals, 0.99) || 1;
    const k = (maxR - baseR) / ceiling;

    drawLegend("legend-radial-years", [
      ...INTENSITY_BUCKETS.map((b) => ({ label: b.label, color: intensityColor(b.key), style: "swatch" })),
      { label: "El Niño (season, darker = stronger)", color: ensoColor("nino"), style: "line" },
      { label: "La Niña (season, darker = stronger)", color: ensoColor("nina"), style: "line" },
      { label: "Neutral (season)", color: ensoColor("neutral"), style: "line" },
    ]);

    // Precompute colors once — resolved via getComputedStyle, so doing this
    // per-spoke across ~13k marks would be wasteful for what's only 9 values.
    const bucketColorMap = new Map(INTENSITY_BUCKETS.map((b) => [b.key, intensityColor(b.key)]));
    const ensoColorMap = new Map(["nino", "nina", "neutral", "pending"].map((p) => [p, ensoColor(p)]));

    const ringOuter = baseR;
    const ringInner = baseR - 4;
    const SEASON_BOUND_IDX = [60, 152, 244, 335]; // Mar 1, Jun 1, Sep 1, Dec 1

    const angle = (idx) => (idx / 366) * 2 * Math.PI; // idx 0 = 12 o'clock, clockwise
    const polar = (idx, r) => {
      const a = angle(idx);
      return [r * Math.sin(a), -r * Math.cos(a)];
    };
    const arcGen = d3
      .arc()
      .innerRadius(ringInner)
      .outerRadius(ringOuter)
      .padAngle(0.025)
      .startAngle((d) => angle(d.startIdx))
      .endAngle((d) => angle(d.endIdx));

    years.forEach((year, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = col * colWidth + colWidth / 2;
      const cy = row * glyphSize + glyphSize / 2 - 8;
      const yearRows = byYear.get(String(year)) || [];
      const byDay = new Map();
      yearRows.forEach((r) => {
        const idx = dayIndex.get(r.date.slice(5));
        if (idx !== undefined) byDay.set(idx, r.precip);
      });
      const pts = d3.range(366).map((idx) => ({ idx, value: byDay.get(idx) || 0 }));
      const wetDays = pts.filter((p) => p.value > 0);
      const annualTotal = d3.sum(pts, (p) => p.value);

      const g = plot.append("g").attr("transform", `translate(${cx},${cy})`);

      // Center hover target for the annual summary — sits behind everything
      // else (drawn first) and exactly fills the ring's interior, so it
      // never competes for hover with the ring segments or spokes.
      g.append("circle")
        .attr("r", ringInner)
        .attr("fill", "transparent")
        .on("mousemove", (event) =>
          showTooltip(
            tooltip,
            container,
            event,
            String(year),
            [
              { label: "Annual total", color: seriesColor("--series-normal"), value: `${annualTotal.toFixed(1)}"` },
              { label: "Wet days", color: seriesColor("--series-normal"), value: String(wetDays.length) },
            ],
            (v) => v
          )
        )
        .on("mouseleave", () => tooltip.style("opacity", 0));

      // ENSO season-phase ring: most years render as one uniform-colored
      // ring (all 5 segments share a phase); years where ENSO flipped
      // mid-year show a visibly multi-colored ring. Opacity carries
      // strength (weak -> very strong); "pending" segments (current year,
      // not yet happened/published) render as an outline only, no fill.
      g.selectAll(".enso-arc")
        .data(SEASONS)
        .join("path")
        .attr("class", "enso-arc")
        .attr("d", arcGen)
        .attr("fill", (d) => {
          const phase = seasonPhase(year, d.key);
          return phase === "pending" ? "none" : ensoColorMap.get(phase);
        })
        .attr("fill-opacity", (d) => {
          const phase = seasonPhase(year, d.key);
          const entry = seasonEntry(year, d.key);
          return ensoOpacity(phase, entry ? entry[1] : 0);
        })
        .attr("stroke", (d) => (seasonPhase(year, d.key) === "pending" ? ensoColorMap.get("pending") : "none"))
        .attr("stroke-width", 0.75)
        .attr("stroke-dasharray", (d) => (seasonPhase(year, d.key) === "pending" ? "1.5,1.5" : null))
        .on("mousemove", (event, d) => {
          const phase = seasonPhase(year, d.key);
          const entry = seasonEntry(year, d.key);
          const rows =
            phase === "pending"
              ? [{ label: "ENSO phase", color: ensoColorMap.get(phase), value: ENSO_PHASE_LABELS[phase] }]
              : [
                  {
                    label: "ENSO phase",
                    color: ensoColorMap.get(phase),
                    value: phase === "neutral" ? ENSO_PHASE_LABELS[phase] : `${ENSO_PHASE_LABELS[phase]} (${ensoStrength(entry[1])})`,
                  },
                  { label: "ONI", color: ensoColorMap.get(phase), value: `${entry[1] >= 0 ? "+" : ""}${entry[1].toFixed(2)}` },
                ];
          showTooltip(tooltip, container, event, `${year} — ${d.label}`, rows, (v) => v);
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));

      // Season divider lines — fixed visual reference for "where in the
      // year," independent of any data.
      g.selectAll(".season-divider")
        .data(SEASON_BOUND_IDX)
        .join("line")
        .attr("class", "gridline season-divider")
        .attr("x1", (idx) => polar(idx, ringInner)[0])
        .attr("y1", (idx) => polar(idx, ringInner)[1])
        .attr("x2", (idx) => polar(idx, maxR)[0])
        .attr("y2", (idx) => polar(idx, maxR)[1])
        .attr("stroke-width", 0.6)
        .attr("pointer-events", "none");

      // One spoke per rainy day — length and color both encode that day's
      // rainfall (color via the same intensity scale as the calendar
      // heatmap). Dry/missing days get no mark at all.
      g.selectAll(".spoke")
        .data(wetDays)
        .join("line")
        .attr("class", "spoke")
        .attr("x1", (d) => polar(d.idx, ringOuter)[0])
        .attr("y1", (d) => polar(d.idx, ringOuter)[1])
        .attr("x2", (d) => polar(d.idx, ringOuter + k * Math.min(d.value, ceiling))[0])
        .attr("y2", (d) => polar(d.idx, ringOuter + k * Math.min(d.value, ceiling))[1])
        .attr("stroke", (d) => bucketColorMap.get(intensityBucket(d.value).key))
        .attr("stroke-width", 1)
        .attr("stroke-linecap", "butt")
        .on("mousemove", (event, d) => {
          const bucket = intensityBucket(d.value);
          const dateLabel = fmtDate(parseISODate(`${year}-${dayOrder[d.idx]}`));
          showTooltip(
            tooltip,
            container,
            event,
            dateLabel,
            [
              { label: "Precip", color: bucketColorMap.get(bucket.key), value: `${d.value.toFixed(2)}"` },
              { label: "Intensity", color: bucketColorMap.get(bucket.key), value: bucket.label },
            ],
            (v) => v
          );
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));

      g.append("text").attr("class", "chart-label").attr("text-anchor", "middle").attr("y", maxR + 14).text(year);
    });
  }

  // ---------------------------------------------------------------------
  // Chart 8: Rain bubble strip — one row per year, size-proportional dots
  // ---------------------------------------------------------------------
  function drawBubbleStrip(normalsDaily, observed, years) {
    const { dayIndex } = buildDayIndex(normalsDaily);
    const byYear = d3.group(observed, (d) => d.date.slice(0, 4));
    const maxPrecip = d3.max(observed, (d) => d.precip) || 1;
    const maxRadius = 6;

    drawLegend(
      "legend-bubble-strip",
      INTENSITY_BUCKETS.map((b) => ({ label: b.label, color: intensityColor(b.key), style: "swatch" }))
    );

    const rowHeight = 12;
    const { plot, x, rowY, rowStep, innerHeight, tooltip, container } = buildRowStrip("chart-bubble-strip", {
      years,
      rowHeight,
      rowGap: 2,
    });

    years.forEach((year) => {
      const rows = (byYear.get(String(year)) || []).filter((r) => r.precip != null && r.precip > 0);
      const y0 = rowY(year) + rowHeight / 2;

      plot
        .selectAll(null)
        .data(rows)
        .join("circle")
        .attr("cx", (d) => {
          const idx = dayIndex.get(d.date.slice(5));
          return idx !== undefined ? x(idx) : -100;
        })
        .attr("cy", y0)
        .attr("r", (d) => Math.max(1, Math.sqrt(d.precip / maxPrecip) * maxRadius))
        .attr("fill", (d) => {
          const b = intensityBucket(d.precip);
          return b ? intensityColor(b.key) : intensityColor("trace");
        })
        .attr("fill-opacity", 0.85)
        .on("mousemove", function (event, d) {
          showTooltip(
            tooltip,
            container,
            event,
            fmtDate(parseISODate(d.date)),
            [{ label: "Precip", color: d3.select(this).attr("fill"), value: `${d.precip.toFixed(2)}"` }],
            (v) => v
          );
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));
    });

    drawYearLabels(plot, years, rowStep);
    drawMonthAxis(plot, x, innerHeight, dayIndex);
  }

  main().catch((err) => console.error(err));
})();
