# weather-normals

Automated tracker that compares current-year temperature and precipitation
against 1991–2020 NOAA/NWS climate normals and past years — built because the
official [NWS NOWData](https://www.weather.gov/wrh/climate) charts are hard to
read.

**Live site:** https://epetrack.github.io/weather-normals/

## How it works

- A [GitHub Actions workflow](.github/workflows/update-data.yml) runs daily
  (and can be triggered manually) to fetch fresh climate data from the
  [ACIS Web Services API](https://www.rcc-acis.org/) — the same public data
  source behind the NWS's own NOWData tool, but returned as clean JSON
  instead of scraped HTML.
- Fetched data is committed straight into `docs/data/<station>/` as JSON.
- `docs/` is a plain static site (no build step) served by GitHub Pages,
  which reads that JSON client-side and renders the comparison charts.

## Tracked stations

Configured in [`config/stations.yml`](config/stations.yml). Currently:

- Pittsburgh, PA (`KPIT`)

Add another station by adding an entry there — the pipeline and site both
pick it up automatically on the next data run.

## Running the pipeline locally

```bash
pip install -r requirements.txt
python scripts/fetch_normals.py   # 1991-2020 daily & monthly normals (once)
python scripts/fetch_observed.py  # backfill + incremental daily observations
```

Then serve `docs/` locally to preview the site:

```bash
python -m http.server -d docs 8000
```

## Data

- `docs/data/<station>/normals_daily.json` — 366 rows of 1991–2020 daily
  normal high/low temperature and precipitation, keyed by `MM-DD`.
- `docs/data/<station>/normals_monthly.json` — 12 rows of monthly normals.
- `docs/data/<station>/observed_daily.json` — actual daily observations
  since 1991, updated incrementally.
