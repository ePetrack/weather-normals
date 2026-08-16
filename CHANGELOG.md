# Changelog

All notable changes to this project are documented in this file.

## 2026-08-16

### Added

- **Initial release**: automated weather normals tracker for Pittsburgh, PA (station `KPIT`).
  - Python pipeline (`scripts/fetch_normals.py`, `scripts/fetch_observed.py`) that pulls 1991–2020
    daily and monthly climate normals, plus observed daily data backfilled to 1991, from the
    [ACIS Web Services API](https://www.rcc-acis.org/) — the same data source behind the NWS's
    NOWData tool.
  - `.github/workflows/update-data.yml`: a scheduled (daily) and manually-triggerable GitHub
    Actions workflow that runs the pipeline and commits updated data straight into
    `docs/data/<station>/`.
  - Static site in `docs/`, served via GitHub Pages, with four charts: cumulative precipitation
    (normal vs. this year vs. recent years), daily temperature vs. the normal range, and monthly
    temperature/precipitation comparisons. Station-picker structured for adding more locations
    later via `config/stations.yml`.
- **Data pipeline fix**: `fetch_observed.py` now re-fetches a trailing 5-day window on every run,
  not just new days, so a day written with "missing" values (ACIS hasn't finalized "today" yet)
  gets healed once the real observation becomes available instead of staying null forever.
- **"Rainfall to date" chart**: a new burnup-style chart — a filled area for this year's actual
  cumulative rainfall climbing toward a dashed 1991–2020 normal-to-date line and a flat annual-normal
  reference line, with a today marker and a plain-language summary of the current surplus/deficit.
- **5-year average series**: added a third line to the "Rainfall to date" chart — the average of
  the 5 most recent complete calendar years, aligned by day-of-year — so this year can be compared
  against both the 30-year normal and recent history in one view.
- **"Precipitation Extremes" page**: a new `docs/extremes.html`, linked from the header nav, with
  eight chart views of the same 35-year daily precipitation record, each aimed at the same
  question — are events getting fewer/bigger or more/smaller over time — from a different angle:
  a horizon chart, a calendar heatmap, a storm-count dot chart (normal vs. recent vs. this year),
  a monthly precipitation-range candlestick, a storm-event candlestick timeline, a streamgraph by
  rainfall intensity, small-multiple radial year-rings, and a size-proportional rain-bubble strip.
  Shared chart primitives (`buildSvg`, tooltips, day-of-year alignment, etc.) were factored out of
  `app.js` into `docs/chart-utils.js` so both pages use one copy.
