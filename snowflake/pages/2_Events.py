"""Recent Events — notable storms put in context against the full record."""
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import common as c

st.set_page_config(page_title="Recent Events — Weather Normals", page_icon="🌩️", layout="wide")

# Hand-curated registry: only the peak day and display window are typed in;
# every number shown is computed from the data. Append to add an event.
EVENTS = [
    dict(id="2026-09-03-storm", station="pittsburgh", title="The September 3 storm",
         peak_date="2026-09-03", window_start="2026-08-24", window_end="2026-09-05"),
]

sid, data = c.page_header(
    "Recent Events",
    "Notable storms, put in context against the full climate record — how big, how rare, and how they happened.")
nd, ob = data["normals_daily"], data["observed"]
events = sorted([e for e in EVENTS if e["station"] == sid], key=lambda e: e["peak_date"], reverse=True)
if not events:
    st.info("No spotlighted events for this station yet.")
    st.stop()

storms = c.detect_storms(ob)
normal_by_mmdd = nd.set_index("mmdd")


def spotlight(ev):
    peak = pd.Timestamp(ev["peak_date"])
    wp = ob.dropna(subset=["precip"])
    row = ob[ob["date"] == peak]
    peak_p = row["precip"].iloc[0] if len(row) and pd.notna(row["precip"].iloc[0]) else None
    if peak_p is None:
        st.warning(f"No precipitation observation for {ev['peak_date']}.")
        return
    ranked = wp.sort_values("precip", ascending=False).reset_index(drop=True)
    all_rank = int((ranked["precip"] > peak_p).sum() + 1)
    pct = (1 - (all_rank - 1) / len(ranked)) * 100
    mrows = wp[wp["month"] == peak.month].sort_values("precip", ascending=False).reset_index(drop=True)
    month_rank = int(mrows.index[mrows["date"] == peak][0] + 1)
    normal_p = normal_by_mmdd["precip_normal"].get(peak.strftime("%m-%d"))
    mult = peak_p / normal_p if normal_p else None
    storm = next((s for s in storms.itertuples() if peak in s.days), None)

    dry = 0
    if storm is not None:
        before = ob[ob["date"] < storm.start].iloc[::-1]
        for p in before["precip"]:
            if p == 0:
                dry += 1
            else:
                break

    win = ob[(ob["date"] >= ev["window_start"]) & (ob["date"] <= ev["window_end"])].copy()
    win["normal"] = win["mmdd"].map(normal_by_mmdd["tmax_normal"])
    hot = win.loc[win["tmax"].idxmax()] if win["tmax"].notna().any() else None

    st.caption(f"{peak:%b %-d, %Y}")
    st.header(ev["title"])
    text = f"Rain arrived {f'after {dry} straight dry day' + ('s' if dry != 1 else '') + ' ' if dry else ''}and put down **{peak_p:.2f}″** in a single day"
    text += f" — about **{mult:.1f}×** the normal pace for the date." if mult else "."
    if hot is not None:
        text += f" The heat peaked at **{hot['tmax']:.0f}°F on {hot['date']:%b %-d, %Y}** before the front moved through."
    if storm is not None and storm.ndays > 1:
        text += (f" A trailing {storm.total - peak_p:.2f}″ over the following day{'s' if storm.ndays > 2 else ''} "
                 f"brought the storm's {storm.ndays}-day total to **{storm.total:.2f}″**.")
    st.markdown(text)

    items = [(f"{pct:.1f}th pct.", f"of all {len(ranked):,} recorded days"), (f"#{all_rank}", "wettest day on record"),
             (c.ordinal(month_rank), f"wettest {c.FULL_MONTHS[peak.month - 1]} day")]
    if mult:
        items.append((f"{mult:.1f}×", f"normal pace for the date ({normal_p:.2f}″)"))
    c.tiles([(label, value, None) for value, label in items])

    # --- Two weeks in the gauge
    st.subheader("Two weeks in the gauge")
    st.caption(f"{win['date'].min():%b %-d} – {win['date'].max():%b %-d, %Y}")
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, row_heights=[0.5, 0.5], vertical_spacing=0.08)
    colors = [c.INTENSITY_COLOR[c.intensity_key(p) or "trace"] for p in win["precip"]]
    fig.add_bar(x=win["date"], y=win["precip"], marker_color=colors, name="Rain", row=1, col=1,
                hovertemplate='%{y:.2f}″<extra>Rain</extra>')
    fig.add_scatter(x=win["date"], y=win["normal"], name="Normal high", row=2, col=1,
                    line=dict(color=c.C["normal"], dash="dash"))
    fig.add_scatter(x=win["date"], y=win["tmax"], name="Daily high", row=2, col=1, mode="lines+markers",
                    line=dict(color=c.C["orange"], width=2))
    c.style(fig, height=420, legend=True)
    fig.update_yaxes(tickformat='.1f', ticksuffix="″", row=1, col=1)
    fig.update_yaxes(ticksuffix="°", row=2, col=1)
    fig.update_xaxes(tickformat="%b %-d")
    c.show(fig)

    # --- Where it ranks
    st.subheader("Where it ranks")
    st.caption("All-time daily rainfall on record")
    top = ranked.head(12).assign(rank=lambda d: range(1, len(d) + 1))
    rows = top[["date", "precip", "rank"]]
    if peak not in set(top["date"]):
        rows = pd.concat([rows, pd.DataFrame([dict(date=peak, precip=peak_p, rank=all_rank)])])
    rows = rows.iloc[::-1]
    fig = go.Figure(go.Bar(
        y=[f"#{r.rank} · {r.date:%b %-d, %Y}" for r in rows.itertuples()], x=rows["precip"], orientation="h",
        marker_color=[c.C["blue"] if d == peak else "rgba(137,135,129,0.55)" for d in rows["date"]],
        text=[f'{p:.2f}″' for p in rows["precip"]], textposition="outside",
        hovertemplate="%{y}<br>%{x:.2f}″<extra></extra>"))
    c.style(fig, height=max(320, 28 * len(rows)), legend=False).update_layout(hovermode="closest")
    fig.update_xaxes(ticksuffix="″", range=[0, rows["precip"].max() * 1.15])
    fig.update_yaxes(gridcolor="rgba(0,0,0,0)")
    c.show(fig)


for e in events:
    spotlight(e)
st.caption("Rank and percentile are computed live from the full observed-daily record each time this page loads.")
