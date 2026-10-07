# Changelog

All notable changes to this project are documented in this file.

## 2026-10-09

### Added

- **Climate & Energy tab**: heating & cooling day counts per month, an energy
  budget estimator (enter last year's heating/cooling cost; it is converted to
  a cost per degree day, then projected for this year with a weather-risk range
  from the last 10 years, stored in the browser only), and a CSV download
  button on every chart.

### Changed

- **Climate & Energy tab**: the heating-degree-day chart now uses the calendar
  year like the others (winter is split across both ends of the chart).

## 2026-10-08

### Added

- **Official degree-day normals**: `scripts/fetch_degree_days.py` fetches NOAA's
  1991–2020 monthly HDD/CDD normals (base 65°F) from ACIS into
  `docs/data/<station>/degree_days_normals.json` (only when missing). The
  Climate & Energy monthly charts use them when present, else the derived
  values. The workflow step is `continue-on-error` since the request syntax
  could not be tested from the dev sandbox.

### Added

- **Climate & Energy tab** (`docs/geek.html`): heating, cooling and growing
  degree days (cumulative, monthly and annual with trend), a 30-day
  temperature anomaly, hot/freeze day counts, freeze dates, heat waves and
  cold snaps, and year rankings. Degree days are computed in the browser from
  daily highs and lows (base selectable: 50/55/60/65°F), so no pipeline
  changes; normal degree days are derived from the daily normal highs/lows and
  differ slightly from NOAA's published values.

## 2026-10-07

### Changed

- **Data pipeline isolates per-station failures**: a failing station no longer
  blocks the others, and the commit step still runs. The site flags data older
  than 3 days.
- **Removed Greensburg, Johnstown, Titusville and Pymatuning** (`KLBE`, `KJST`,
  `KFKL`, `KYNG`): ACIS returned "no data available" for `KLBE`, which broke
  every daily run since 2026-09-24. Re-add them with ACIS IDs that have
  1991–2020 normals.

## 2026-09-24

### Added

- **Houston, TX (`KIAH`)** and **Bradford, PA (`KBFD`)**: added as new
  tracked stations in [`config/stations.yml`](config/stations.yml) and the
  site's station picker (`docs/stations.json`). Data populates on the next
  scheduled (or manually triggered) run of the data-update workflow, same
  as Pittsburgh.
- **The other University of Pittsburgh regional campuses**: Greensburg, PA
  (`KLBE`, Latrobe), Johnstown, PA (`KJST`), Titusville, PA (`KFKL`,
  Franklin), and Pymatuning, PA (`KYNG`, Youngstown-Warren, OH) — the
  Pymatuning Laboratory of Ecology. Titusville and Pymatuning don't have
  their own long-record weather station, so they use the nearest one with
  1991–2020 normals instead.

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
