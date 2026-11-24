"""Shared data access, analytics helpers and chart styling for the Streamlit app.

Data comes from Snowflake tables (see setup.sql / load_data.py). For local
development without a Snowflake account, set WEATHER_DATA_DIR=docs/data to read
the repo's JSON files instead.
"""
import datetime as dt
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

# Fully-qualified location of the tables created by setup.sql.
DB_SCHEMA = os.environ.get("WEATHER_DB_SCHEMA", "WEATHER_NORMALS.APP")
LOCAL_DIR = os.environ.get("WEATHER_DATA_DIR")

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
AVG_YEARS = 5            # trailing years averaged for the "recent history" baseline
NORMALS_START, NORMALS_END = 1991, 2020

# Series palette (from docs/styles.css).
C = dict(normal="#898781", blue="#2a78d6", navy="#6c8db3", orange="#eb6834",
         aqua="#1baf7a", red="#e34948")
INTENSITY = [  # key, label, upper bound (exclusive), colour
    ("trace", 'Trace (<0.01")', 0.01, "#c9d6e0"),
    ("light", 'Light (0.01–0.24")', 0.25, "#a9c9e8"),
    ("moderate", 'Moderate (0.25–0.74")', 0.75, "#5f96d6"),
    ("heavy", 'Heavy (0.75–1.49")', 1.5, "#2a5fa8"),
    ("extreme", 'Extreme (1.5"+)', float("inf"), "#12234f"),
]
INTENSITY_COLOR = {k: c for k, _, _, c in INTENSITY}
INTENSITY_LABEL = {k: l for k, l, _, _ in INTENSITY}


def intensity_key(v):
    if v is None or pd.isna(v) or v <= 0:
        return None
    for key, _, hi, _ in INTENSITY:
        if v < hi:
            return key
    return "extreme"


# ---------------------------------------------------------------------------
# Data access
# ---------------------------------------------------------------------------
def _session():
    try:
        from snowflake.snowpark.context import get_active_session
        return get_active_session()
    except Exception:  # not running inside Snowflake -> use st.connection / secrets
        return st.connection("snowflake").session()


@st.cache_data(ttl=3600, show_spinner="Loading data…")
def _sql(query: str) -> pd.DataFrame:
    df = _session().sql(query).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df


def _json(station, name):
    return pd.DataFrame(json.loads((Path(LOCAL_DIR) / station / f"{name}.json").read_text()))


@st.cache_data(ttl=3600)
def stations() -> pd.DataFrame:
    if LOCAL_DIR:
        return pd.DataFrame(json.loads((Path(LOCAL_DIR).parent / "stations.json").read_text()))
    return _sql(f"SELECT id, name FROM {DB_SCHEMA}.STATIONS ORDER BY name")


@st.cache_data(ttl=3600, show_spinner="Loading station data…")
def load_station(station: str) -> dict:
    """Return normals_daily / normals_monthly / degree_days / observed DataFrames."""
    if LOCAL_DIR:
        nd = _json(station, "normals_daily").rename(columns={"date": "mmdd"})
        nm = _json(station, "normals_monthly")
        dd = _json(station, "degree_days_normals")
        ob = _json(station, "observed_daily").rename(columns={"date": "obs_date"})
    else:
        q = lambda t, cols, order: _sql(  # noqa: E731
            f"SELECT {cols} FROM {DB_SCHEMA}.{t} WHERE station_id = '{station}' ORDER BY {order}")
        nd = q("NORMALS_DAILY", "mmdd, tmax_normal, tmin_normal, precip_normal", "mmdd")
        nm = q("NORMALS_MONTHLY", "month, month_name, tmax_normal, tmin_normal, precip_normal_total", "month")
        dd = q("DEGREE_DAYS_NORMALS", "month, hdd_normal, cdd_normal", "month")
        ob = q("OBSERVED_DAILY", "obs_date, tmax, tmin, precip, snow", "obs_date")
    ob = ob.rename(columns={"obs_date": "date"})
    ob["date"] = pd.to_datetime(ob["date"])
    for c in ("tmax", "tmin", "precip", "snow"):
        ob[c] = pd.to_numeric(ob[c], errors="coerce")
    ob = ob.sort_values("date").reset_index(drop=True)
    ob["year"], ob["month"] = ob["date"].dt.year, ob["date"].dt.month
    ob["mmdd"] = ob["date"].dt.strftime("%m-%d")
    for df in (nd, nm, dd):
        for c in df.columns:
            if c not in ("mmdd", "month_name"):
                df[c] = pd.to_numeric(df[c], errors="coerce")
    return dict(normals_daily=nd.reset_index(drop=True), normals_monthly=nm, degree_days=dd, observed=ob)


def station_picker():
    """Sidebar station select that persists across pages. Returns (id, name)."""
    st_df = stations()
    ids = st_df["id"].tolist()
    if st.session_state.get("station") not in ids:
        st.session_state["station"] = ids[0]
    choice = st.sidebar.selectbox(
        "Station", ids, index=ids.index(st.session_state["station"]),
        format_func=lambda i: st_df.set_index("id").loc[i, "name"])
    st.session_state["station"] = choice
    return choice, st_df.set_index("id").loc[choice, "name"]


def page_header(title, subtitle):
    st.title(title)
    st.caption(subtitle)
    sid, name = station_picker()
    data = load_station(sid)
    ob = data["observed"]
    if ob.empty:
        st.warning("Data isn't available for this station yet.")
        st.stop()
    last = ob["date"].iloc[-1]
    age = (pd.Timestamp.today().normalize() - last).days
    msg = f"{name} · Data through {last:%b %-d, %Y}"
    (st.warning if age > 3 else st.caption)(msg + (f" — {age} days old, update may be delayed" if age > 3 else ""))
    return sid, data


# ---------------------------------------------------------------------------
# Analytics helpers (ported from docs/chart-utils.js, geek.js)
# ---------------------------------------------------------------------------
def dummy_date(mmdd_series):
    """Map 'MM-DD' to a leap year so day-of-year charts share one axis."""
    return pd.to_datetime("2000-" + pd.Series(mmdd_series).astype(str))


def detect_storms(ob: pd.DataFrame) -> pd.DataFrame:
    """Runs of consecutive wet days. A single missing day inside a run is bridged;
    two or more consecutive missing days, or any dry day, end it."""
    events, cur, gap = [], None, 0

    def finalize():
        nonlocal cur
        if cur:
            events.append(dict(start=cur["days"][0], end=cur["days"][-1], days=cur["days"],
                               ndays=len(cur["days"]), total=cur["total"],
                               peak=cur["peak"], peak_date=cur["peak_date"]))
        cur = None

    for d, p in zip(ob["date"], ob["precip"]):
        if p is not None and not pd.isna(p) and p > 0:
            if cur and gap >= 2:
                finalize()
            if not cur:
                cur = dict(days=[], total=0.0, peak=-1.0, peak_date=None)
            gap = 0
            cur["days"].append(d)
            cur["total"] += p
            if p > cur["peak"]:
                cur["peak"], cur["peak_date"] = p, d
        elif pd.isna(p) and cur:
            gap += 1
        else:
            finalize()
            gap = 0
    finalize()
    return pd.DataFrame(events, columns=["start", "end", "days", "ndays", "total", "peak", "peak_date"])


def degree_days(tmax, tmin, base):
    mean = (tmax + tmin) / 2
    return np.maximum(0, base - mean), np.maximum(0, mean - base)


def gdd(tmax, tmin, base=50, cap=86):
    hi, lo = np.clip(tmax, base, cap), np.clip(tmin, base, cap)
    return (hi + lo) / 2 - base


def linear_trend(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    if len(x) < 3:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    return slope, intercept


def ordinal(n):
    n = int(n)
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


# ---------------------------------------------------------------------------
# Chart styling
# ---------------------------------------------------------------------------
def style(fig, height=380, yfmt=None, ytitle=None, legend=True, **layout):
    opts = dict(height=height, margin=dict(l=10, r=10, t=10, b=10), hovermode="x unified",
                legend=dict(orientation="h", y=1.1, x=0), showlegend=legend)
    opts.update(layout)
    fig.update_layout(**opts)
    fig.update_yaxes(tickformat=yfmt, title=ytitle, gridcolor="rgba(128,128,128,0.2)", zeroline=False)
    fig.update_xaxes(showgrid=False)
    return fig


def show(fig, **kw):
    st.plotly_chart(fig, use_container_width=True, **kw)


def tiles(items):
    """Row of st.metric tiles: items = [(label, value, delta_or_None)]."""
    for col, (label, value, delta) in zip(st.columns(len(items)), items):
        col.metric(label, value, delta, delta_color="off")
