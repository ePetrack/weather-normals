/* Weather Normals Tracker — recent-events spotlights.
 * A short, hand-curated list of notable storms (docs/events.js's EVENTS
 * array below), each rendered with stats computed live from the same
 * data/<station>/ JSON as the rest of the site — so "23rd wettest day on
 * record" stays correct as new data lands, instead of going stale as a
 * hardcoded number. Adding a new event is just appending to EVENTS.
 */
(() => {
  "use strict";

  const {
    seriesColor,
    fmtDate,
    parseISODate,
    fetchJSON,
    buildSvg,
    drawLegend,
    yAxisLeft,
    showTooltip,
    syncNavStationParam,
    intensityBucket,
    intensityColor,
    detectStormEvents,
  } = window.ChartUtils;

  const FULL_MONTH = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // ---------------------------------------------------------------------
  // Event registry — add a new storm by appending an entry here. Only
  // `peakDate` (the day to rank/spotlight) and the display window are
  // curated by hand; every number shown is computed from the data at
  // render time.
  // ---------------------------------------------------------------------
  const EVENTS = [
    {
      id: "2026-09-03-storm",
      station: "pittsburgh",
      title: "The September 3 storm",
      peakDate: "2026-09-03",
      windowStart: "2026-08-24",
      windowEnd: "2026-09-05",
    },
  ];

  async function main() {
    const stations = await fetchJSON("stations.json");
    const select = document.getElementById("station-select");
    select.innerHTML = stations.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

    select.addEventListener("change", () => loadStationEvents(select.value));

    const initial = new URLSearchParams(location.search).get("station");
    const startId = stations.some((s) => s.id === initial) ? initial : stations[0].id;
    select.value = startId;
    loadStationEvents(startId);
  }

  async function loadStationEvents(stationId) {
    syncNavStationParam(stationId);
    const container = document.getElementById("events-list");
    container.innerHTML = "";

    const events = EVENTS.filter((e) => e.station === stationId).sort((a, b) => (a.peakDate < b.peakDate ? 1 : -1));
    if (!events.length) {
      container.innerHTML = `<p class="state-message">No spotlighted events for this station yet.</p>`;
      document.getElementById("last-updated").textContent = "";
      return;
    }

    const base = `data/${stationId}`;
    let normalsDaily, observed;
    try {
      [normalsDaily, observed] = await Promise.all([
        fetchJSON(`${base}/normals_daily.json`),
        fetchJSON(`${base}/observed_daily.json`),
      ]);
    } catch (err) {
      container.innerHTML = `<p class="state-message">Data isn't published yet for this station — it appears after the first scheduled (or manually triggered) data-update run completes.</p>`;
      document.getElementById("last-updated").textContent = "";
      console.error(err);
      return;
    }

    const lastObsDate = observed.length ? observed[observed.length - 1].date : null;
    document.getElementById("last-updated").textContent = lastObsDate
      ? `Data through ${fmtDate(parseISODate(lastObsDate))}`
      : "";

    const normalByMmdd = new Map(normalsDaily.map((n) => [n.date, n]));

    events.forEach((event) => renderEvent(event, normalByMmdd, observed, container));
  }

  // ---------------------------------------------------------------------
  // Stats — everything the card states is computed here, not hand-typed.
  // ---------------------------------------------------------------------
  function computeStats(event, normalByMmdd, observed) {
    const withPrecip = observed.filter((r) => r.precip != null);
    const peakRow = observed.find((r) => r.date === event.peakDate);
    const peakPrecip = peakRow ? peakRow.precip : null;

    const sortedAll = withPrecip.slice().sort((a, b) => b.precip - a.precip);
    const allRank = peakPrecip == null ? null : sortedAll.findIndex((r) => r.precip <= peakPrecip) + 1;
    const percentile = allRank == null ? null : (1 - (allRank - 1) / sortedAll.length) * 100;

    const mm = event.peakDate.slice(5, 7);
    const monthRows = withPrecip.filter((r) => r.date.slice(5, 7) === mm);
    const sortedMonth = monthRows.slice().sort((a, b) => b.precip - a.precip);
    const monthRank = sortedMonth.findIndex((r) => r.date === event.peakDate) + 1;
    const monthName = FULL_MONTH[Number(mm) - 1];

    const stormEvents = detectStormEvents(observed);
    const storm = stormEvents.find((e) => e.days.includes(event.peakDate)) || null;

    const normalRow = normalByMmdd.get(event.peakDate.slice(5));
    const normalPrecip = normalRow ? normalRow.precip_normal : null;
    const multiplier = normalPrecip && peakPrecip != null ? peakPrecip / normalPrecip : null;

    // Dry streak immediately before the storm started (consecutive
    // zero-precip days walking back from the storm's first day).
    let dryStreak = 0;
    if (storm) {
      const startIdx = observed.findIndex((r) => r.date === storm.startDate);
      for (let i = startIdx - 1; i >= 0; i--) {
        if (observed[i].precip === 0) dryStreak++;
        else break;
      }
    }

    // Hottest day within the display window (a natural "what led into
    // this" data point — no separate curation needed). Each row also gets
    // that date's normal high attached, for the temp-panel reference line.
    const windowRows = observed
      .filter((r) => r.date >= event.windowStart && r.date <= event.windowEnd)
      .map((r) => {
        const n = normalByMmdd.get(r.date.slice(5));
        return { ...r, normal: n ? n.tmax_normal : null };
      });
    const hottest = windowRows.reduce((best, r) => (r.tmax != null && (!best || r.tmax > best.tmax) ? r : best), null);

    const totalDays = withPrecip.length;

    return {
      peakPrecip, allRank, percentile, monthRank, monthName, totalDays,
      storm, normalPrecip, multiplier, dryStreak, hottest, windowRows,
    };
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  }

  // ---------------------------------------------------------------------
  // Card
  // ---------------------------------------------------------------------
  function renderEvent(event, normalByMmdd, observed, container) {
    const stats = computeStats(event, normalByMmdd, observed);

    const card = document.createElement("section");
    card.className = "card event-card";
    card.innerHTML = `
      <p class="event-eyebrow">${fmtDate(parseISODate(event.peakDate))}</p>
      <h2>${event.title}</h2>
      <p class="event-narrative"></p>
      <div class="stat-grid"></div>
      <div class="event-chart-block">
        <div class="panel-head">
          <h3>Two weeks in the gauge</h3>
          <span class="panel-note">${fmtDate(parseISODate(event.windowStart))} &ndash; ${fmtDate(parseISODate(event.windowEnd))}</span>
        </div>
        <div class="legend" id="legend-gauge-${event.id}"></div>
        <div id="chart-gauge-${event.id}" class="chart"></div>
      </div>
      <div class="event-chart-block">
        <div class="panel-head">
          <h3>Where it ranks</h3>
          <span class="panel-note">All-time daily rainfall on record</span>
        </div>
        <div class="legend" id="legend-rank-${event.id}"></div>
        <div id="chart-rank-${event.id}" class="chart"></div>
      </div>
    `;
    container.appendChild(card);

    card.querySelector(".event-narrative").innerHTML = buildNarrative(event, stats);
    card.querySelector(".stat-grid").innerHTML = buildStatTiles(event, stats);

    drawGaugeChart(event, stats);
    drawRankChart(event, stats, observed);
  }

  function buildNarrative(event, stats) {
    if (stats.peakPrecip == null) return "";
    const dryPart = stats.dryStreak > 0
      ? `after ${stats.dryStreak} straight dry day${stats.dryStreak === 1 ? "" : "s"} `
      : "";
    const hotPart = stats.hottest
      ? ` The heat peaked at <strong>${Math.round(stats.hottest.tmax)}&deg;F on ${fmtDate(parseISODate(stats.hottest.date))}</strong> before the front moved through.`
      : "";
    const multiplierPart = stats.multiplier != null
      ? ` &mdash; about <strong>${stats.multiplier.toFixed(1)}&times;</strong> the normal pace for the date`
      : "";
    const stormPart = stats.storm && stats.storm.days.length > 1
      ? ` A trailing ${(stats.storm.totalPrecip - stats.peakPrecip).toFixed(2)}&Prime; over the following day${stats.storm.days.length > 2 ? "s" : ""} brought the storm's ${stats.storm.days.length}-day total to <strong>${stats.storm.totalPrecip.toFixed(2)}&Prime;</strong>.`
      : "";
    return `
      Rain arrived ${dryPart}and put down <strong>${stats.peakPrecip.toFixed(2)}&Prime;</strong>
      in a single day${multiplierPart}.${hotPart}${stormPart}
    `;
  }

  function buildStatTiles(event, stats) {
    const tiles = [];
    if (stats.percentile != null) {
      tiles.push({ value: `${stats.percentile.toFixed(1)}<span class="unit">th pct.</span>`, label: `of all ${stats.totalDays.toLocaleString()} recorded days at this station` });
    }
    if (stats.allRank != null) {
      tiles.push({ value: `#${stats.allRank}`, label: "wettest single day on record" });
    }
    if (stats.monthRank) {
      tiles.push({ value: ordinal(stats.monthRank), label: `wettest ${stats.monthName} day since records began` });
    }
    if (stats.multiplier != null) {
      tiles.push({ value: `${stats.multiplier.toFixed(1)}<span class="unit">&times;</span>`, label: `the normal pace for the date (${stats.normalPrecip.toFixed(2)}&Prime;)` });
    }
    return tiles.map((t) => `<div class="stat-tile"><div class="stat-value">${t.value}</div><div class="stat-label">${t.label}</div></div>`).join("");
  }

  // ---------------------------------------------------------------------
  // Chart 1: two-week precip + temp small multiple
  // ---------------------------------------------------------------------
  function drawGaugeChart(event, stats) {
    const days = stats.windowRows;
    drawLegend(`legend-gauge-${event.id}`, [
      { label: "Daily rainfall (darker = heavier)", color: intensityColor("extreme"), style: "swatch" },
      { label: "Daily high", color: seriesColor("--series-orange"), style: "line" },
      { label: "Normal high", color: seriesColor("--baseline"), style: "dashed" },
    ]);

    const margin = { top: 10, right: 16, bottom: 34, left: 40 };
    const width = 880;
    const precipH = 110;
    const gap = 14;
    const tempH = 110;
    const height = margin.top + precipH + gap + tempH + margin.bottom;
    const { plot, innerWidth, tooltip, container } = buildSvg(`chart-gauge-${event.id}`, { width, height, margin });

    const x = d3.scaleBand().domain(days.map((d) => d.date)).range([0, innerWidth]).paddingInner(0.35).paddingOuter(0.2);
    const barW = Math.min(26, x.bandwidth());

    const precipMax = Math.max(0.1, d3.max(days, (d) => d.precip || 0)) * 1.15;
    const yPrecip = d3.scaleLinear().domain([0, precipMax]).range([precipH, 0]);
    yAxisLeft(plot, yPrecip, innerWidth, { ticks: 4, format: (d) => `${d}″` });

    const gPrecip = plot.append("g");
    days.forEach((d) => {
      const cx = x(d.date) + x.bandwidth() / 2;
      if (d.precip == null) {
        gPrecip.append("line")
          .attr("x1", cx - barW / 2).attr("x2", cx + barW / 2)
          .attr("y1", precipH - 1).attr("y2", precipH - 1)
          .attr("stroke", seriesColor("--intensity-none")).attr("stroke-width", 2).attr("stroke-dasharray", "2,2");
        return;
      }
      const bar = gPrecip.append("rect")
        .attr("x", cx - barW / 2).attr("width", barW)
        .attr("y", yPrecip(d.precip)).attr("height", Math.max(0, precipH - yPrecip(d.precip)))
        .attr("rx", 3)
        .attr("fill", d.precip > 0 ? intensityColor(intensityBucket(d.precip).key) : seriesColor("--intensity-trace"));
      bar.on("mousemove", (event2) =>
        showTooltip(tooltip, container, event2, fmtDate(parseISODate(d.date)), [
          { label: "Rain", color: intensityColor(d.precip > 0 ? intensityBucket(d.precip).key : "trace"), value: d.precip },
        ], (v) => `${v.toFixed(2)}″`)
      ).on("mouseleave", () => tooltip.style("opacity", 0));
    });

    const tempVals = days.flatMap((d) => [d.tmax, d.normal]).filter((v) => v != null);
    const tMin = d3.min(tempVals) - 4, tMax = d3.max(tempVals) + 4;
    const yTemp = d3.scaleLinear().domain([tMin, tMax]).range([tempH, 0]);
    const gTemp = plot.append("g").attr("transform", `translate(0,${precipH + gap})`);
    yAxisLeft(gTemp, yTemp, innerWidth, { ticks: 3, format: (d) => `${Math.round(d)}°` });

    const lineNormal = d3.line().defined((d) => d.normal != null).x((d) => x(d.date) + x.bandwidth() / 2).y((d) => yTemp(d.normal));
    const lineTemp = d3.line().defined((d) => d.tmax != null).x((d) => x(d.date) + x.bandwidth() / 2).y((d) => yTemp(d.tmax));
    gTemp.append("path").datum(days).attr("fill", "none").attr("stroke", seriesColor("--baseline")).attr("stroke-width", 1.5).attr("stroke-dasharray", "4,3").attr("d", lineNormal);
    gTemp.append("path").datum(days).attr("fill", "none").attr("stroke", seriesColor("--series-orange")).attr("stroke-width", 2).attr("stroke-linejoin", "round").attr("d", lineTemp);
    days.forEach((d) => {
      if (d.tmax == null) return;
      const cx = x(d.date) + x.bandwidth() / 2;
      gTemp.append("circle").attr("cx", cx).attr("cy", yTemp(d.tmax)).attr("r", 3.5)
        .attr("fill", seriesColor("--series-orange")).attr("stroke", seriesColor("--surface-1")).attr("stroke-width", 1.5)
        .on("mousemove", (event2) =>
          showTooltip(tooltip, container, event2, fmtDate(parseISODate(d.date)), [
            { label: "High", color: seriesColor("--series-orange"), value: d.tmax },
            { label: "Normal high", color: seriesColor("--baseline"), value: d.normal },
          ].filter((r) => r.value != null), (v) => `${Math.round(v)}°F`)
        ).on("mouseleave", () => tooltip.style("opacity", 0));
    });

    plot.append("g").attr("transform", `translate(0,${precipH + gap + tempH})`)
      .call(d3.axisBottom(x).tickFormat((d) => fmtDate(parseISODate(d)).replace(/, \d+$/, "")).tickSizeOuter(0))
      .call((g) => g.selectAll("text").attr("class", "chart-label").attr("transform", "rotate(-30)").style("text-anchor", "end"))
      .call((g) => g.select(".domain").attr("class", "baseline"))
      .call((g) => g.selectAll(".tick line").remove());
  }

  // ---------------------------------------------------------------------
  // Chart 2: all-time ranked leaderboard, this event highlighted
  // ---------------------------------------------------------------------
  function drawRankChart(event, stats, observed) {
    const withPrecip = observed.filter((r) => r.precip != null);
    const sorted = withPrecip.slice().sort((a, b) => b.precip - a.precip);
    const top = sorted.slice(0, 12).map((r, i) => ({ date: r.date, precip: r.precip, rank: i + 1 }));
    const isAlreadyInTop = top.some((r) => r.date === event.peakDate);
    const thisEntry = { date: event.peakDate, precip: stats.peakPrecip, rank: stats.allRank };

    drawLegend(`legend-rank-${event.id}`, [
      { label: "Other days (all-time top 12)", color: seriesColor("--baseline"), style: "swatch" },
      { label: fmtDate(parseISODate(event.peakDate)), color: seriesColor("--series-blue"), style: "swatch" },
    ]);

    const rows = isAlreadyInTop ? top : [...top, { gap: true }, thisEntry];
    const rowH = 24;
    const gapH = 14;
    const margin = { top: 6, right: 16, bottom: 24, left: 40 };
    const width = 880;
    const innerHeight = rows.reduce((sum, r) => sum + (r.gap ? gapH : rowH), 0);
    const { plot, innerWidth, tooltip, container } = buildSvg(`chart-rank-${event.id}`, {
      width, height: innerHeight + margin.top + margin.bottom, margin,
    });

    const maxVal = top[0].precip * 1.08;
    const x = d3.scaleLinear().domain([0, maxVal]).range([0, innerWidth - 130]);

    let cy = 0;
    rows.forEach((r) => {
      if (r.gap) {
        for (let gx = 0; gx < innerWidth - 130; gx += 8) {
          plot.append("circle").attr("cx", gx + 3).attr("cy", cy + gapH / 2).attr("r", 0.9).attr("fill", seriesColor("--baseline"));
        }
        cy += gapH;
        return;
      }
      const isThis = r.date === event.peakDate;
      const barH = 14;
      const by = cy + (rowH - barH) / 2;
      const bw = Math.max(2, x(r.precip));
      const bar = plot.append("rect")
        .attr("x", 0).attr("y", by).attr("width", bw).attr("height", barH).attr("rx", 3)
        .attr("fill", isThis ? seriesColor("--series-blue") : seriesColor("--baseline"))
        .attr("fill-opacity", isThis ? 1 : 0.55);
      bar.on("mousemove", (event2) =>
        showTooltip(tooltip, container, event2, fmtDate(parseISODate(r.date)), [
          { label: "Rainfall", color: isThis ? seriesColor("--series-blue") : seriesColor("--baseline"), value: `${r.precip.toFixed(2)}″` },
          { label: "All-time rank", color: isThis ? seriesColor("--series-blue") : seriesColor("--baseline"), value: `#${r.rank}` },
        ], (v) => v)
      ).on("mouseleave", () => tooltip.style("opacity", 0));

      plot.append("text").attr("x", -8).attr("y", cy + rowH / 2).attr("dy", "0.32em").attr("text-anchor", "end")
        .attr("class", isThis ? "chart-label-strong" : "chart-label").text(`#${r.rank}`);
      plot.append("text").attr("x", bw + 8).attr("y", cy + rowH / 2).attr("dy", "0.32em")
        .attr("class", isThis ? "chart-label-strong" : "chart-label")
        .text(`${r.precip.toFixed(2)}″ — ${fmtDate(parseISODate(r.date))}`);
      cy += rowH;
    });

    plot.append("g").attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${d}″`))
      .call((g) => g.select(".domain").attr("class", "baseline"))
      .call((g) => g.selectAll("text").attr("class", "chart-label"))
      .call((g) => g.selectAll(".tick line").attr("class", "gridline"));
  }

  main().catch((err) => console.error(err));
})();
