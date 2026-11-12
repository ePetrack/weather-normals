"""Weather Normals Tracker — Normals page (Streamlit in Snowflake)."""
import datetime as dt

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import common as c

st.set_page_config(page_title="Weather Normals Tracker", page_icon="🌦️", layout="wide")
sid, data = c.page_header(
    "Weather Normals Tracker",
    "How this year's temperature and precipitation compare to the 1991–2020 NOAA climate normals and recent years.")
nd, nm, ob = data["normals_daily"], data["normals_monthly"], data["observed"]
today = dt.date.today()
year, month = today.year, today.month
nd["x"] = c.dummy_date(nd["mmdd"])
day_idx = {m: i for i, m in enumerate(nd["mmdd"])}


# ---------------------------------------------------------------- Rainfall to date
st.header("Rainfall to date")


def cum_year(y):
    """Cumulative precip for year y, forward-filled by day-of-year index (0..365)."""
    rows = ob[ob["year"] == y]
    if rows.empty:
        return None
    s = pd.Series(np.nan, index=range(366))
    run = rows["precip"].fillna(0).cumsum()
    for m, v in zip(rows["mmdd"], run):
        if m in day_idx:
            s[day_idx[m]] = v
    return s.ffill().fillna(0), max(day_idx[m] for m in rows["mmdd"] if m in day_idx)


normal_cum = nd["precip_normal"].fillna(0).cumsum()
cur = cum_year(year)
if cur is None:
    st.info("No observations recorded yet this year.")
else:
    actual, today_idx = cur
    avg_years = [y for y in range(year - c.AVG_YEARS, year) if y in set(ob["year"])]
    avg_series = pd.concat([cum_year(y)[0] for y in avg_years], axis=1).mean(axis=1) if avg_years else None
    avg_label = f"{len(avg_years)}-yr avg ({avg_years[0]}–{avg_years[-1]})" if avg_years else None

    t_act, t_norm = actual[today_idx], normal_cum[today_idx]
    d = t_act - t_norm
    notes = [f'Recorded {t_act:.2f}" through {nd["x"][today_idx]:%b %-d}.',
             f'{abs(d):.2f}" {"above" if d >= 0 else "below"} the 1991–2020 normal pace of {t_norm:.2f}".']
    if avg_series is not None:
        da = t_act - avg_series[today_idx]
        notes.append(f'{abs(da):.2f}" {"above" if da >= 0 else "below"} the {avg_years[0]}–{avg_years[-1]} '
                     f'average pace of {avg_series[today_idx]:.2f}".')
    st.markdown("\n".join(f"- {n}" for n in notes))

    fig = go.Figure()
    fig.add_scatter(x=nd["x"], y=normal_cum, name="1991–2020 normal",
                    line=dict(color=c.C["normal"], dash="dash", width=2))
    if avg_series is not None:
        fig.add_scatter(x=nd["x"], y=avg_series, name=avg_label, line=dict(color=c.C["aqua"], width=2))
    fig.add_scatter(x=nd["x"][: today_idx + 1], y=actual[: today_idx + 1], name="This year (measured)",
                    line=dict(color=c.C["blue"], width=2), fill="tozeroy", fillcolor="rgba(42,120,214,0.12)")
    fig.add_hline(y=normal_cum.iloc[-1], line=dict(color=c.C["normal"], dash="dot", width=1), opacity=0.6,
                  annotation_text=f'Annual normal {normal_cum.iloc[-1]:.1f}"', annotation_position="top left")
    c.style(fig, yfmt='.1f', ytitle='inches').update_xaxes(tickformat="%b")
    c.show(fig)


# ---------------------------------------------------------------- Rain & snow by month
st.header("Rain & snow by month")
st.caption("Monthly precipitation split into rain and snow (water equivalent at 10:1), grouped by year.")
avail = sorted(ob["year"].unique())
years = st.multiselect("Years", avail, default=avail[-5:], key="precip_years")
if not years:
    st.info("Select at least one year.")
else:
    monthly = ob.groupby(["year", "month"]).agg(precip=("precip", "sum"), snow=("snow", "sum")).reset_index()
    monthly["snow_swe"] = np.minimum(monthly["snow"] * 0.1, monthly["precip"])
    monthly["rain"] = monthly["precip"] - monthly["snow_swe"]
    fig = go.Figure()
    fig.add_bar(x=c.MONTHS, y=nm["precip_normal_total"], name="1991–2020 normal", offsetgroup="normal",
                marker=dict(color="rgba(137,135,129,0.15)", line=dict(color=c.C["normal"], width=1.5)))
    for y in years:
        m = monthly[monthly["year"] == y].set_index("month").reindex(range(1, 13))
        partial = [0.55 if (y == year and i == month) else 1 for i in range(1, 13)]
        fig.add_bar(x=c.MONTHS, y=m["rain"], name=f"{y} rain", offsetgroup=str(y), legendgroup=str(y),
                    marker=dict(color=c.C["blue"], opacity=partial, pattern=dict(shape="/", size=6)))
        fig.add_bar(x=c.MONTHS, y=m["snow_swe"], base=m["rain"], name=f"{y} snow (water equiv.)",
                    offsetgroup=str(y), legendgroup=str(y),
                    marker=dict(color=c.C["aqua"], opacity=partial, pattern=dict(shape="\\", size=6)))
    c.style(fig, yfmt='.1f', ytitle='inches', barmode="group", bargap=0.2).update_layout(hovermode="closest")
    c.show(fig)


# ---------------------------------------------------------------- Daily temperature vs normal
st.header("Daily temperature vs. normal")
st.caption("Last 120 days: daily high/low vs. the climatological normal range.")
rec = ob.tail(120).merge(nd[["mmdd", "tmax_normal", "tmin_normal"]], on="mmdd", how="left")
fig = go.Figure()
fig.add_scatter(x=rec["date"], y=rec["tmin_normal"], line=dict(width=0), showlegend=False, hoverinfo="skip")
fig.add_scatter(x=rec["date"], y=rec["tmax_normal"], fill="tonexty", fillcolor="rgba(137,135,129,0.18)",
                line=dict(width=0), name="Normal range", customdata=rec[["tmin_normal"]],
                hovertemplate="Normal %{customdata[0]:.0f}–%{y:.0f}°F<extra></extra>")
fig.add_scatter(x=rec["date"], y=rec["tmax"], name="Daily high", line=dict(color=c.C["red"], width=2))
fig.add_scatter(x=rec["date"], y=rec["tmin"], name="Daily low", line=dict(color=c.C["blue"], width=2))
c.show(c.style(fig, yfmt=".0f", ytitle="°F"))


# ---------------------------------------------------------------- Monthly temperature / precip
def monthly_compare(title, note, observed_by_month, normal, fmt, ytitle):
    st.header(title)
    st.caption(note)
    fig = go.Figure()
    series = [("Normal", normal, c.C["normal"]), (str(year - 1), observed_by_month(year - 1), c.C["navy"]),
              (str(year), observed_by_month(year), c.C["blue"])]
    for name, vals, color in series:
        opacity = [0.55 if (name == str(year) and i == month) else 1 for i in range(1, 13)]
        fig.add_bar(x=c.MONTHS, y=vals, name=name, marker=dict(color=color, opacity=opacity))
    c.style(fig, height=320, yfmt=fmt, ytitle=ytitle, barmode="group", bargap=0.25)
    c.show(fig)


def avg_temp(y):
    r = ob[(ob["year"] == y) & ob["tmax"].notna() & ob["tmin"].notna()]
    return ((r["tmax"] + r["tmin"]) / 2).groupby(r["month"]).mean().reindex(range(1, 13)).values


def tot_precip(y):
    r = ob[ob["year"] == y]
    return r.groupby("month")["precip"].sum().reindex(range(1, 13)).values


monthly_compare("Monthly temperature", "Average temperature by month: this year vs. normal vs. last year.",
                avg_temp, ((nm["tmax_normal"] + nm["tmin_normal"]) / 2).values, ".0f", "°F")
monthly_compare("Monthly precipitation", "Total precipitation by month: this year vs. normal vs. last year.",
                tot_precip, nm["precip_normal_total"].values, ".1f", "inches")

st.divider()
st.caption("Data via the ACIS Web Services API (the source behind NWS NOWData). Normals are the 1991–2020 "
           "NOAA climate normals.")
