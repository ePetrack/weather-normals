"""Climate & Energy — degree days, growing degree days, freeze/heat counts, heat waves, year rankings."""
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import common as c

st.set_page_config(page_title="Climate & Energy — Weather Normals", page_icon="⚡", layout="wide")
sid, data = c.page_header(
    "Climate & Energy",
    "Heating and cooling degree days, growing degree days, freeze and heat counts, and heat waves — the numbers "
    "behind energy demand and the growing season.")
nd, ob, dd_off = data["normals_daily"], data["observed"], data["degree_days"]

HOT_F, FREEZE_F, COLD_SNAP_F = 90, 32, 20
MIN_STREAK, COMPLETE_DAYS = 3, 350
FALL_FREEZE_START = "07-01"
LAST = ob["date"].iloc[-1]
YEAR, LAST_MMDD = LAST.year, LAST.strftime("%m-%d")
DAYS = list(nd["mmdd"])
NORMAL_BY_MMDD = nd.set_index("mmdd")

# ---------------------------------------------------------------- base selector + daily metrics
base = st.radio("Degree-day base (°F)", [50, 55, 60, 65], index=3, horizontal=True)

for df, hi, lo in ((ob, "tmax", "tmin"), (nd, "tmax_normal", "tmin_normal")):
    df["mean"] = (df[hi] + df[lo]) / 2
    df["hdd"], df["cdd"] = c.degree_days(df[hi], df[lo], base)
    df["hdd"] = df["hdd"].where(df["mean"].notna())
    df["cdd"] = df["cdd"].where(df["mean"].notna())
    df["gdd"] = c.gdd(df[hi], df[lo]).where(df["mean"].notna())


def valid_in_year(y, mmdd):
    return mmdd != "02-29" or pd.Timestamp(year=y, month=1, day=1).is_leap_year


def season_series(kind, y, source="obs"):
    """Cumulative degree days across the 366 day-slots of year y (NaN-skipping)."""
    if source == "obs":
        by = ob[ob["year"] == y].set_index("mmdd")[kind]
    else:
        by = nd.set_index("mmdd")[kind]
    vals = [by.get(m, np.nan) if valid_in_year(y, m) else np.nan for m in DAYS]
    return pd.Series(vals).fillna(0).cumsum().values, ~pd.isna(vals)


X = c.dummy_date(DAYS)
today_idx = DAYS.index(LAST_MMDD)


def cumulative_totals(kind):
    cur, _ = season_series(kind, YEAR)
    nrm, _ = season_series(kind, YEAR, "normal")
    return cur[today_idx], nrm[today_idx]


# ---------------------------------------------------------------- Season to date
st.header("Season to date")
st.caption("Heating, cooling and growing degree days since Jan 1, and the last 30 days' temperature vs. normal.")

daily = ob.merge(nd[["mmdd", "mean"]].rename(columns={"mean": "nmean"}), on="mmdd", how="left")
daily["anom"] = daily["mean"] - daily["nmean"]
daily["anom30"] = daily["anom"].rolling(30, min_periods=20).mean()
last_anom = daily["anom30"].iloc[-1] if len(daily) else np.nan


def dd_tile(kind, name):
    o, n = cumulative_totals(kind)
    pct = f"{(o - n) / n * 100:+.0f}%" if n > 0 else None
    return (f"{name} this year", f"{o:,.0f}", f"normal to date {n:,.0f}" + (f" ({pct})" if pct else ""))


t = [dd_tile("hdd", "HDD"), dd_tile("cdd", "CDD"), dd_tile("gdd", "GDD")]
t.append(("Last 30 days vs. normal", "—" if pd.isna(last_anom) else f"{last_anom:+.1f}°F", None))
c.tiles(t)

# ---------------------------------------------------------------- Anomaly
st.header("30-day temperature anomaly")
st.caption("Rolling 30-day average temperature minus the 1991–2020 normal, past 12 months.")
pts = daily[daily["date"] > LAST - pd.DateOffset(months=12)].dropna(subset=["anom30"])
if pts.empty:
    st.info("Not enough recent data.")
else:
    fig = go.Figure()
    fig.add_scatter(x=pts["date"], y=pts["anom30"].clip(lower=0), fill="tozeroy", line=dict(width=0),
                    fillcolor="rgba(235,104,52,0.45)", hoverinfo="skip", showlegend=False)
    fig.add_scatter(x=pts["date"], y=pts["anom30"].clip(upper=0), fill="tozeroy", line=dict(width=0),
                    fillcolor="rgba(42,120,214,0.45)", hoverinfo="skip", showlegend=False)
    fig.add_scatter(x=pts["date"], y=pts["anom30"], line=dict(color="#52514e", width=1.5), name="30-day avg vs. normal",
                    hovertemplate="%{y:+.1f}°F<extra></extra>")
    c.show(c.style(fig, height=320, yfmt="+.0f", ytitle="°F vs. normal", legend=False))


# ---------------------------------------------------------------- Cumulative charts
def cumulative_chart(title, note, kind, color_this, unit):
    st.header(title)
    st.caption(note)
    cur, hasdata = season_series(kind, YEAR)
    prev, prev_has = season_series(kind, YEAR - 1)
    nrm, _ = season_series(kind, YEAR, "normal")
    fig = go.Figure()
    fig.add_scatter(x=X, y=nrm, name="1991–2020 normal", line=dict(color=c.C["normal"], dash="dash", width=2))
    if prev_has.any():
        fig.add_scatter(x=X, y=prev, name=str(YEAR - 1), line=dict(color=c.C["navy"], width=2))
    fig.add_scatter(x=X[: today_idx + 1], y=cur[: today_idx + 1], name=str(YEAR), fill="tozeroy",
                    fillcolor="rgba(42,120,214,0.12)", line=dict(color=color_this, width=2))
    c.show(c.style(fig, yfmt=",.0f", ytitle=unit).update_xaxes(tickformat="%b"))


cumulative_chart("Heating degree days", "Cumulative HDD for the calendar year: this year vs. last vs. normal. "
                 "More HDD means more heating demand.", "hdd", c.C["blue"], "HDD")
cumulative_chart("Cooling degree days", "Cumulative CDD for the calendar year: this year vs. last vs. normal. "
                 "More CDD means more cooling demand.", "cdd", c.C["orange"], "CDD")
cumulative_chart("Growing degree days", "Cumulative GDD (base 50°F, temperatures capped at 86°F). Fixed base; "
                 "unaffected by the selector.", "gdd", c.C["aqua"], "GDD")


# ---------------------------------------------------------------- Monthly bars
def monthly_obs(kind, y):
    r = ob[(ob["year"] == y)].dropna(subset=[kind])
    return r.groupby("month")[kind].sum().reindex(range(1, 13)).values


def monthly_norm(kind, y=YEAR):
    r = nd[[valid_in_year(y, m) for m in nd["mmdd"]]].copy()
    r["month"] = r["mmdd"].str[:2].astype(int)
    return r.groupby("month")[kind].sum().reindex(range(1, 13)).values


def monthly_chart(title, kind, official_col):
    st.header(title)
    official = base == 65 and official_col in dd_off.columns
    normal = dd_off.sort_values("month")[official_col].values if official else monthly_norm(kind)
    this = monthly_obs(kind, YEAR).copy()
    this[LAST.month:] = np.nan
    fig = go.Figure()
    fig.add_bar(x=c.MONTHS, y=normal, name="Normal (NOAA)" if official else "Normal", marker_color=c.C["normal"])
    fig.add_bar(x=c.MONTHS, y=monthly_obs(kind, YEAR - 1), name=str(YEAR - 1), marker_color=c.C["navy"])
    fig.add_bar(x=c.MONTHS, y=this, name=str(YEAR),
                marker=dict(color=c.C["blue"] if kind == "hdd" else c.C["orange"],
                            opacity=[0.55 if i == LAST.month else 1 for i in range(1, 13)]))
    c.show(c.style(fig, height=320, yfmt=",.0f", barmode="group", bargap=0.25))


monthly_chart("Monthly heating degree days", "hdd", "hdd_normal")
monthly_chart("Monthly cooling degree days", "cdd", "cdd_normal")

# ---------------------------------------------------------------- Balance days
st.header("Heating & cooling days")
st.caption("Days per month needing heat (mean below the base), cooling (mean above it) or neither. "
           f"Left bar: record average; right bar: {YEAR}.")
m = ob.dropna(subset=["mean"]).copy()
m["cat"] = np.where(m["mean"] < base, "heat", np.where(m["mean"] > base, "cool", "neither"))
counts = m.groupby(["year", "month", "cat"]).size().unstack("cat").reindex(columns=["heat", "neither", "cool"]).fillna(0)
hist_counts = counts[counts.index.get_level_values("year") < YEAR].groupby("month").mean().reindex(range(1, 13))
cur_counts = counts.xs(YEAR, level="year").reindex(range(1, 13))
fig = go.Figure()
spec = [("heat", f"Heating days (mean below {base}°F)", c.C["blue"]), ("neither", "Neither", c.C["normal"]),
        ("cool", f"Cooling days (mean above {base}°F)", c.C["orange"])]
for grp, src in (("avg", hist_counts), (str(YEAR), cur_counts)):
    below = pd.Series(0.0, index=range(1, 13))
    for key, label, color in spec:
        v = src[key].fillna(0)
        fig.add_bar(x=c.MONTHS, y=v, base=below.values, name=label, offsetgroup=grp, legendgroup=key,
                    showlegend=(grp == "avg"), marker=dict(color=color, opacity=0.6 if grp == "avg" else 1),
                    hovertemplate=f"{grp}: %{{y:.1f}} days<extra>{label}</extra>")
        below = below + v
c.show(c.style(fig, height=340, barmode="group", ytitle="days").update_layout(hovermode="closest"))

# ---------------------------------------------------------------- Energy budget estimator
st.header("Energy budget estimator")
st.caption("Enter what you spent last year and it is converted to a cost per degree day, then applied to this "
           "year's weather so far and to normal weather for the rest of the year.")
b1, b2, b3 = st.columns(3)
heat_cost = b1.number_input("Heating cost, last year ($)", min_value=0.0, step=10.0, key=f"bh_{sid}")
cool_cost = b2.number_input("Cooling cost, last year ($)", min_value=0.0, step=10.0, key=f"bc_{sid}")
base_load = b3.number_input("Base load per year ($, optional)", min_value=0.0, step=10.0, key=f"bb_{sid}")
money = lambda v: f"${v:,.0f}"  # noqa: E731


def year_stats(value_series):
    """Per-year total / days / mean temp using only days with both temps."""
    r = ob.dropna(subset=["mean"]).assign(val=value_series)
    g = r.groupby("year").agg(value=("val", "sum"), days=("val", "size"), mean=("mean", "mean"))
    g["complete"] = (g.index < YEAR) & (g["days"] >= COMPLETE_DAYS)
    return g


def ysum(kind, y):
    r = ob[ob["year"] == y].dropna(subset=[kind])
    return r[kind].sum(), len(r)


last_h, last_h_days = ysum("hdd", YEAR - 1)
last_c, _ = ysum("cdd", YEAR - 1)
if last_h_days < 300:
    st.info("Needs a full prior year of observations for this station.")
elif not heat_cost and not cool_cost:
    st.info("Enter last year's heating and/or cooling cost above to see a projection.")
else:
    h_rate = heat_cost / last_h if last_h > 0 else 0
    c_rate = cool_cost / last_c if last_c > 0 else 0
    cost = lambda h, cc: h * h_rate + cc * c_rate  # noqa: E731

    def normal_over(keys):
        r = nd[nd["mmdd"].isin(keys) & [valid_in_year(YEAR, mm) for mm in nd["mmdd"]]]
        return r["hdd"].sum(), r["cdd"].sum()

    remaining_keys = [k for k in DAYS if k > LAST_MMDD]
    n_full, n_rem = normal_over(DAYS), normal_over(remaining_keys)
    ytd_cost = cost(ysum("hdd", YEAR)[0], ysum("cdd", YEAR)[0])
    elapsed = LAST.dayofyear / (366 if LAST.is_leap_year else 365)

    windows = []
    for y in range(YEAR - 10, YEAR):
        r = ob[(ob["year"] == y) & (ob["mmdd"] > LAST_MMDD)].dropna(subset=["hdd"])
        if remaining_keys and len(r) >= 0.8 * len(remaining_keys):
            windows.append(cost(r["hdd"].sum(), r["cdd"].sum()))
    windows.sort()
    normal_weather = cost(*n_full)
    projected = ytd_cost + cost(*n_rem) + base_load
    normal_year = normal_weather + base_load
    vs_normal = (projected - normal_year) / normal_year * 100 if normal_year > 0 else None
    yearly = year_stats(ob["hdd"] * h_rate + ob["cdd"] * c_rate)
    yearly = yearly[yearly["complete"]]
    trend = c.linear_trend(yearly["mean"], yearly["value"])
    rng = (f"range {money(ytd_cost + base_load + windows[0])} – {money(ytd_cost + base_load + windows[-1])}"
           if windows else "no range (year complete)")
    c.tiles([
        ("Spent so far this year", money(ytd_cost + base_load * elapsed), None),
        ("Projected year-end", money(projected), rng),
        ("Normal-weather year", money(normal_year), f"projection {vs_normal:+.0f}% vs. normal" if vs_normal is not None else None),
        ("Cost per +1°F annual avg", "—" if not trend else f"{'+' if trend[0] >= 0 else '−'}{money(abs(trend[0]))}", None),
    ])
    notes = [f"Calibrated rates (base {base}°F): {money(h_rate * 100)}/100 HDD and {money(c_rate * 100)}/100 CDD "
             f"from last year's {last_h:,.0f} HDD and {last_c:,.0f} CDD.",
             "Assumes cost scales linearly with degree days; excludes rate changes and non-weather usage."]
    st.markdown("\n".join(f"- {n}" for n in notes))
    mh, mc = monthly_obs("hdd", YEAR), monthly_obs("cdd", YEAR)
    ph, pc = monthly_obs("hdd", YEAR - 1), monthly_obs("cdd", YEAR - 1)
    nh, nc = monthly_norm("hdd"), monthly_norm("cdd")
    this_cost = [cost(np.nan_to_num(mh[i]), np.nan_to_num(mc[i])) if i + 1 <= LAST.month else np.nan for i in range(12)]
    fig = go.Figure()
    fig.add_bar(x=c.MONTHS, y=[cost(nh[i], nc[i]) for i in range(12)], name="Normal weather", marker_color=c.C["normal"])
    fig.add_bar(x=c.MONTHS, y=[cost(np.nan_to_num(ph[i]), np.nan_to_num(pc[i])) for i in range(12)],
                name=str(YEAR - 1), marker_color=c.C["navy"])
    fig.add_bar(x=c.MONTHS, y=this_cost, name=str(YEAR), marker_color=c.C["blue"])
    c.show(c.style(fig, height=320, yfmt="$,.0f", barmode="group", bargap=0.25))


# ---------------------------------------------------------------- Annual charts
def annual_chart(title, series, color, unit, note=None):
    st.header(title)
    if note:
        st.caption(note)
    g = year_stats(series)
    comp = g[g["complete"]]
    fig = go.Figure(go.Bar(x=g.index, y=g["value"], marker=dict(color=color, opacity=[0.55 if y == YEAR else 1 for y in g.index]),
                           name=unit, hovertemplate="%{y:,.0f} " + unit + "<extra>%{x}</extra>"))
    if len(comp):
        fig.add_hline(y=comp["value"].mean(), line=dict(color=c.C["normal"], dash="dash"),
                      annotation_text=f"record avg {comp['value'].mean():,.0f}", annotation_position="top left")
        tr = c.linear_trend(comp.index, comp["value"])
        if tr:
            xs = [comp.index.min(), comp.index.max()]
            fig.add_scatter(x=xs, y=[tr[0] * x + tr[1] for x in xs], mode="lines", name="Trend",
                            line=dict(color=c.C["red"], width=2))
            st.caption(f"Linear trend: {tr[0] * 10:+,.1f} {unit} per decade (complete years only).")
    c.show(c.style(fig, height=320, yfmt=",.0f", legend=False).update_layout(hovermode="closest"))


annual_chart("Annual heating degree days", ob["hdd"], c.C["blue"], "HDD",
             "Calendar-year totals with the record average and a linear trend (complete years only).")
annual_chart("Annual cooling degree days", ob["cdd"], c.C["orange"], "CDD")
annual_chart("Hot days per year", (ob["tmax"] >= HOT_F).astype(float), c.C["orange"], "days", f"Days with a high of {HOT_F}°F or more.")
annual_chart("Freeze days per year", (ob["tmin"] <= FREEZE_F).astype(float), c.C["blue"], "days", f"Days with a low of {FREEZE_F}°F or less.")

# ---------------------------------------------------------------- Freeze dates
st.header("Freeze dates")
st.caption(f"Last spring and first fall freeze (low of {FREEZE_F}°F or less) and the freeze-free days between, last 10 years.")
rows = []
for y in range(YEAR, YEAR - 10, -1):
    yr = ob[ob["year"] == y]
    if yr.empty:
        continue
    fz = yr[yr["tmin"] <= FREEZE_F]
    spring = fz[fz["mmdd"] < FALL_FREEZE_START]["date"].max()
    fall = fz[fz["mmdd"] >= FALL_FREEZE_START]["date"].min()
    free = (fall - spring).days - 1 if pd.notna(spring) and pd.notna(fall) else None
    fmt = lambda d: d.strftime("%b %-d") if pd.notna(d) else "—"  # noqa: E731
    rows.append({"Year": y, "Last spring freeze": fmt(spring), "First fall freeze": fmt(fall),
                 "Freeze-free days": str(free) if free is not None else "—"})
st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


# ---------------------------------------------------------------- Streaks
def find_streaks(mask, extreme_col, pick):
    r = ob[["date", extreme_col]].copy()
    r["hit"] = mask.values
    out, cur = [], None
    for d, v, hit in zip(r["date"], r[extreme_col], r["hit"]):
        if hit and cur and (d - cur["end"]).days == 1:
            cur["end"], cur["len"], cur["ext"] = d, cur["len"] + 1, pick(cur["ext"], v)
        else:
            if cur and cur["len"] >= MIN_STREAK:
                out.append(cur)
            cur = dict(start=d, end=d, len=1, ext=v) if hit else None
    if cur and cur["len"] >= MIN_STREAK:
        out.append(cur)
    out.sort(key=lambda s: (-s["len"], s["start"]))
    return out[:8]


st.header("Heat waves & cold snaps")
st.caption(f"Longest runs on record of {HOT_F}°F+ highs and of {COLD_SNAP_F}°F-or-lower lows ({MIN_STREAK} days minimum).")
ca, cb = st.columns(2)
for col, title, streaks, lab in (
    (ca, f"Heat waves ({HOT_F}°F+ highs)", find_streaks(ob["tmax"] >= HOT_F, "tmax", max), "Peak high"),
    (cb, f"Cold snaps ({COLD_SNAP_F}°F or lower lows)", find_streaks(ob["tmin"] <= COLD_SNAP_F, "tmin", min), "Lowest low"),
):
    col.subheader(title)
    if streaks:
        col.dataframe(pd.DataFrame([{"Dates": f"{s['start']:%b %-d} – {s['end']:%b %-d, %Y}", "Days": s["len"],
                                     lab: f"{s['ext']:.0f}°"} for s in streaks]),
                      hide_index=True, use_container_width=True)
    else:
        col.caption(f"No runs of {MIN_STREAK}+ days on record.")

# ---------------------------------------------------------------- Rankings
st.header("Year rankings")
st.caption(f"Complete years only ({COMPLETE_DAYS}+ days of data).")
means = year_stats(ob["mean"])
means = means[means["complete"]]
demand = year_stats(ob["hdd"] + ob["cdd"])
demand = demand[demand["complete"]]
r1, r2, r3 = st.columns(3)


def top5(col, title, series, fmt, ascending=False):
    col.subheader(title)
    s = series.sort_values(ascending=ascending).head(5)
    col.dataframe(pd.DataFrame({"#": range(1, len(s) + 1), "Year": s.index, "Value": [fmt(v) for v in s]}),
                  hide_index=True, use_container_width=True)


top5(r1, "Warmest years (mean temp)", means["mean"], lambda v: f"{v:.1f}°F")
top5(r2, "Coldest years (mean temp)", means["mean"], lambda v: f"{v:.1f}°F", ascending=True)
top5(r3, f"Highest energy demand (HDD + CDD, base {base}°F)", demand["value"], lambda v: f"{v:,.0f}")

st.caption("Degree days are computed live from each day's high and low: mean = (high + low) / 2, "
           "HDD = max(0, base − mean), CDD = max(0, mean − base). Normal degree days are derived from the "
           "1991–2020 daily normal highs and lows; the monthly charts use NOAA's published base-65°F normals "
           "when available. Days with a missing high or low are skipped.")
