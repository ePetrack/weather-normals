"""Precipitation Extremes — eight views of the same daily precipitation record."""
import datetime as dt

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import common as c
import enso

st.set_page_config(page_title="Precipitation Extremes — Weather Normals", page_icon="🌧️", layout="wide")
sid, data = c.page_header(
    "Precipitation Extremes",
    "Is rain arriving in fewer, bigger events or more frequent small ones? Eight views of the same daily "
    "precipitation record, each looking for the same signal from a different angle.")
nd, ob = data["normals_daily"], data["observed"]
today = dt.date.today()
YEAR, MONTH = today.year, today.month
years = sorted(ob["year"].unique())
day_idx = {m: i for i, m in enumerate(nd["mmdd"])}
ob = ob.assign(idx=ob["mmdd"].map(day_idx))
X = c.dummy_date(nd["mmdd"])  # shared day-of-year axis


def grid(value_col, fill=np.nan):
    """years x 366 matrix of a column."""
    g = ob.pivot_table(index="year", columns="idx", values=value_col, aggfunc="first")
    return g.reindex(index=years, columns=range(366)).values


def discrete_scale(colors):
    n = len(colors)
    scale = []
    for i, col in enumerate(colors):
        scale += [[i / n, col], [(i + 1) / n, col]]
    return scale


def legend_traces(fig, items):
    for label, color in items:
        fig.add_scatter(x=[None], y=[None], mode="markers", name=label,
                        marker=dict(symbol="square", size=10, color=color))


def year_heatmap(z, colors, labels, height):
    fig = go.Figure(go.Heatmap(
        x=X, y=[str(y) for y in years], z=z, colorscale=discrete_scale(colors), zmin=-0.5, zmax=len(colors) - 0.5,
        showscale=False, xgap=0, ygap=1, hovertemplate="%{y} %{x|%b %-d}<extra></extra>"))
    legend_traces(fig, zip(labels, colors))
    c.style(fig, height=height, hovermode="closest").update_xaxes(tickformat="%b")
    fig.update_yaxes(autorange="reversed", type="category", dtick=2)
    return fig


# ---------------------------------------------------------------- 1. Horizon
st.header("Horizon chart")
st.caption("One folded-colour band per year (oldest at top). Darker cells are wetter days — scan down the stack "
           "for recent rows looking “hotter” than older ones. Bands are quarters of the 99th-percentile day.")
wet = ob["precip"][ob["precip"] > 0]
ceiling = float(wet.quantile(0.99)) if len(wet) else 1.0
band = ceiling / 4
P = grid("precip")
z = np.full(P.shape, np.nan)
z[~np.isnan(P)] = 0                                    # 0 = dry
z[P > 0] = np.minimum(3, np.floor(P[P > 0] / band).astype(int)) + 1   # 1..4 = light..extreme (folded)
colors = ["#f1f1ee", "#a9c9e8", "#5f96d6", "#2a5fa8", "#12234f"]
labels = ["Dry", "Light", "Moderate", "Heavy", f'Extreme (folded, ≥ {ceiling:.2f}")']
c.show(year_heatmap(z, colors, labels, 120 + 11 * len(years)))

# ---------------------------------------------------------------- 2. Calendar heatmap
st.header("Calendar heatmap")
st.caption("Every day since 1991, coloured by rainfall intensity — years as rows, day-of-year as columns.")
z = np.full(P.shape, np.nan)
z[~np.isnan(P)] = 0
for i, (key, _, hi, _) in enumerate(c.INTENSITY, start=1):
    lo = c.INTENSITY[i - 2][2] if i > 1 else 0
    z[(P > 0) & (P >= lo) & (P < hi)] = i
colors = ["#f1f1ee"] + [col for *_, col in c.INTENSITY]
c.show(year_heatmap(z, colors, ["Dry"] + [lab for _, lab, *_ in c.INTENSITY], 120 + 11 * len(years)))

# ---------------------------------------------------------------- 3. Storm counts by size
st.header("Storm counts by size")
st.caption("Storms (runs of consecutive wet days) by total size: 1991–2020 average per year vs. the trailing "
           "five-year average vs. this year to date.")


def storm_counts(yrs):
    counts = dict.fromkeys([k for k, *_ in c.INTENSITY], 0)
    for y in yrs:
        s = c.detect_storms(ob[ob["year"] == y])
        for total in s["total"]:
            k = c.intensity_key(total)
            if k:
                counts[k] += 1
    return counts


base_years = [y for y in years if c.NORMALS_START <= y <= c.NORMALS_END]
trail_years = [y for y in range(YEAR - c.AVG_YEARS, YEAR) if y in years]
groups = []
if base_years:
    groups.append((f"{c.NORMALS_START}–{c.NORMALS_END} avg/yr", base_years, True))
if trail_years:
    groups.append((f"{trail_years[0]}–{trail_years[-1]} avg/yr", trail_years, True))
groups.append((f"{YEAR} (YTD)", [YEAR], False))
fig = go.Figure()
for key, label, _, color in c.INTENSITY:
    ys = []
    for _, yrs, avg in groups:
        n = storm_counts(yrs)[key]
        ys.append(n / len(yrs) if avg else n)
    fig.add_bar(x=[g[0] for g in groups], y=ys, name=label, marker_color=color,
                hovertemplate="%{y:.1f}<extra>" + label + "</extra>")
c.show(c.style(fig, height=360, barmode="group", ytitle="storms").update_layout(hovermode="closest"))

# ---------------------------------------------------------------- 4. Monthly range candles
st.header("Monthly precipitation range")
st.caption("Candle body = historical 10th–90th percentile range for that month (1991–present); whiskers = "
           "all-time min/max. Marker = this year's total — red if outside the body.")
tot = ob.dropna(subset=["precip"]).groupby(["year", "month"])["precip"].sum().reset_index()
hist = tot[~((tot["year"] == YEAR) & (tot["month"] == MONTH))]  # exclude only the in-progress month
rng = hist.groupby("month")["precip"].agg(p10=lambda s: s.quantile(0.1), p90=lambda s: s.quantile(0.9),
                                          lo="min", hi="max").reindex(range(1, 13))
cur = tot[tot["year"] == YEAR].set_index("month")["precip"].reindex(range(1, 13))
fig = go.Figure(go.Candlestick(
    x=c.MONTHS, open=rng["p10"], close=rng["p90"], low=rng["lo"], high=rng["hi"], name="Historical range",
    increasing=dict(line=dict(color=c.C["normal"]), fillcolor="rgba(137,135,129,0.35)"),
    decreasing=dict(line=dict(color=c.C["normal"]), fillcolor="rgba(137,135,129,0.35)")))
outside = (cur < rng["p10"]) | (cur > rng["p90"])
fig.add_scatter(x=c.MONTHS, y=cur, mode="markers", name=f"{YEAR} total",
                marker=dict(size=11, color=[c.C["red"] if o else c.C["blue"] for o in outside],
                            line=dict(color="white", width=1.5)))
c.show(c.style(fig, height=360, yfmt=".1f", ytitle="inches").update_layout(xaxis_rangeslider_visible=False))

# ---------------------------------------------------------------- 5. Storm events timeline
st.header("Storm events over time")
st.caption('One bar per storm of at least 1" total rainfall. Height = total; width grows with duration; '
           "the diamond marks the wettest day within the storm.")
storms = c.detect_storms(ob)
big = storms[storms["total"] >= 1.0]
if big.empty:
    st.info('No storms of at least 1" total rainfall recorded yet.')
else:
    fig = go.Figure()
    for key, label, _, color in c.INTENSITY[1:]:
        sub = big[big["total"].map(c.intensity_key) == key]
        if sub.empty:
            continue
        fig.add_bar(x=sub["start"] + (sub["end"] - sub["start"]) / 2, y=sub["total"], name=label,
                    marker_color=color, width=(10 + 4 * sub["ndays"].clip(upper=8)) * 86400000,
                    customdata=np.c_[sub["start"].dt.strftime("%b %-d, %Y"), sub["ndays"], sub["peak"]],
                    hovertemplate='%{customdata[0]} · %{customdata[1]} day(s)<br>Total %{y:.2f}″ · '
                                  'wettest day %{customdata[2]:.2f}″<extra></extra>')
    fig.add_scatter(x=big["peak_date"], y=big["peak"], mode="markers", name="Wettest day",
                    marker=dict(symbol="diamond", size=6, color="white", line=dict(color="#333", width=1)),
                    hoverinfo="skip")
    c.show(c.style(fig, height=380, yfmt=".1f", ytitle="inches", barmode="overlay").update_layout(hovermode="closest"))

# ---------------------------------------------------------------- 6. Streamgraph
st.header("Rainfall by intensity, year over year")
st.caption("Each year's total rainfall split by how it fell — trace, light, moderate, heavy, extreme days. "
           "Watch whether the heavy/extreme bands are thickening at the expense of light.")
keys = [k for k, *_ in c.INTENSITY]
ob_b = ob.assign(bucket=ob["precip"].map(c.intensity_key))
tbl = ob_b.dropna(subset=["bucket"]).pivot_table(index="year", columns="bucket", values="precip", aggfunc="sum")
tbl = tbl.reindex(index=years, columns=keys).fillna(0)
V = tbl.T.values  # series x years


def inside_out(v):
    """d3.stackOrderInsideOut: peak-ordered, alternately balanced above/below the centre."""
    order = sorted(range(len(v)), key=lambda i: int(np.argmax(v[i])))
    tops, bottoms, top_l, bot_l = 0.0, 0.0, [], []
    for i in order:
        if tops < bottoms:
            tops += v[i].sum(); top_l.append(i)
        else:
            bottoms += v[i].sum(); bot_l.append(i)
    return bot_l[::-1] + top_l


def wiggle(v, order):
    """d3.stackOffsetWiggle: baseline that minimises the weighted slope of the silhouette."""
    n, m = v.shape
    base = np.zeros(m)
    y = 0.0
    for j in range(1, m):
        s1 = s2 = 0.0
        for i, idx in enumerate(order):
            s3 = (v[idx, j] - v[idx, j - 1]) / 2 + sum(v[order[k], j] - v[order[k], j - 1] for k in range(i))
            s1 += v[idx, j]
            s2 += s3 * v[idx, j]
        base[j - 1] = y
        if s1:
            y -= s2 / s1
    base[m - 1] = y
    return base


order = inside_out(V)
lower = wiggle(V, order)
fig = go.Figure()
for idx in order:
    upper = lower + V[idx]
    key = keys[idx]
    fig.add_scatter(x=years, y=lower, mode="lines", line=dict(width=0), showlegend=False, hoverinfo="skip")
    fig.add_scatter(x=years, y=upper, mode="lines", line=dict(width=0.5, color="white"), fill="tonexty",
                    fillcolor=c.INTENSITY_COLOR[key], name=c.INTENSITY_LABEL[key], customdata=V[idx],
                    hovertemplate='%{customdata:.1f}″<extra>' + c.INTENSITY_LABEL[key] + "</extra>")
    lower = upper
fig.update_yaxes(visible=False)
c.show(c.style(fig, height=380).update_layout(hovermode="x unified"))

# ---------------------------------------------------------------- 7. Year rings
st.header("Year rings")
st.caption("A radial calendar per year: each spoke is one rainy day (angle = day of year, length and colour = "
           "rainfall amount). The thin inner ring is split into 5 seasons coloured by ENSO phase from NOAA CPC's "
           "Oceanic Niño Index — fainter = weaker event.")
default_rings = years[-8:]
chosen = st.multiselect("Years to show", years, default=default_rings, key="ring_years")
if chosen:
    cols = min(4, len(chosen))
    rows_n = -(-len(chosen) // cols)
    fig = make_subplots(rows=rows_n, cols=cols, specs=[[{"type": "polar"}] * cols for _ in range(rows_n)],
                        subplot_titles=[str(y) for y in chosen], vertical_spacing=0.08)
    ring_in, ring_out = 1.0, 1.4
    scale = 3.0 / ceiling
    for n, y in enumerate(chosen):
        r_, c_ = n // cols + 1, n % cols + 1
        for key, label, a, b in enso.SEASONS:
            entry = enso.SEASON_PHASE_BY_YEAR.get(y, {}).get(key)
            phase, anom = entry if entry else ("pending", 0.0)
            alpha = 0 if phase == "pending" else 0.35 if phase == "neutral" else 0.35 + min(abs(anom), 2) / 2 * 0.65
            col = enso.PHASE_COLORS[phase]
            rgb = tuple(int(col[i:i + 2], 16) for i in (1, 3, 5))
            fig.add_barpolar(theta=[(a + b) / 2 / 366 * 360], r=[ring_out - ring_in], base=[ring_in],
                             width=[(b - a) / 366 * 360], marker=dict(color=f"rgba{rgb + (alpha,)}",
                             line=dict(color=col, width=0.5)), showlegend=False,
                             hovertemplate=f"{label}: {enso.PHASE_LABELS[phase]}"
                                           + (f" (ONI {anom:+.2f})" if entry else "") + "<extra></extra>",
                             row=r_, col=c_)
        yr = ob[(ob["year"] == y) & (ob["precip"] > 0)]
        fig.add_barpolar(theta=yr["idx"] / 366 * 360, r=(yr["precip"].clip(upper=ceiling) * scale).clip(lower=0.1),
                         base=[ring_out + 0.2] * len(yr), width=0.8, showlegend=False,
                         marker_color=[c.INTENSITY_COLOR[c.intensity_key(p)] for p in yr["precip"]],
                         customdata=np.c_[yr["date"].dt.strftime("%b %-d"), yr["precip"]],
                         hovertemplate='%{customdata[0]}: %{customdata[1]:.2f}″<extra></extra>',
                         row=r_, col=c_)
    for k in range(1, len(chosen) + 1):
        fig.update_layout(**{f"polar{k if k > 1 else ''}": dict(
            radialaxis=dict(visible=False, range=[0, ring_out + 3.4]),
            angularaxis=dict(visible=False, direction="clockwise", rotation=90), bgcolor="rgba(0,0,0,0)")})
    fig.update_layout(height=300 * rows_n + 40, margin=dict(l=10, r=10, t=30, b=10), showlegend=False)
    c.show(fig)
    st.caption("Spoke colours: " + " · ".join(c.INTENSITY_LABEL[k] for k in keys)
               + ". ENSO ring: orange = El Niño, green = La Niña, grey = neutral.")

# ---------------------------------------------------------------- 8. Bubble strip
st.header("Rain bubble strip")
st.caption("One row per year; a bubble marks every wet day, sized by that day's rainfall. A row of many small "
           "bubbles tells a different story than a row with a few huge ones.")
w = ob[ob["precip"] > 0]
fig = go.Figure(go.Scatter(
    x=c.dummy_date(w["mmdd"]), y=w["year"].astype(str), mode="markers",
    marker=dict(size=w["precip"], sizemode="area", sizeref=2.0 * ceiling / (22 ** 2), sizemin=2,
                color=[c.INTENSITY_COLOR[c.intensity_key(p)] for p in w["precip"]], opacity=0.8,
                line=dict(width=0)),
    customdata=np.c_[w["date"].dt.strftime("%b %-d, %Y"), w["precip"]],
    hovertemplate='%{customdata[0]}: %{customdata[1]:.2f}″<extra></extra>'))
c.style(fig, height=120 + 18 * len(years), hovermode="closest", legend=False).update_xaxes(tickformat="%b")
fig.update_yaxes(type="category", autorange="reversed", dtick=2)
c.show(fig)

st.caption("“Storm” events are runs of consecutive days with measurable precipitation; a single missing day inside "
           "a run is bridged, two or more end it. ENSO data: NOAA CPC Oceanic Niño Index.")
