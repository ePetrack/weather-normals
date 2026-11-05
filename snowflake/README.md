# Weather Normals — Streamlit in Snowflake

Port of the static site in `docs/` to a multipage Streamlit app that reads from Snowflake tables.

| Site page | Streamlit file |
|---|---|
| Normals | `Normals.py` |
| Extremes | `pages/1_Extremes.py` |
| Events | `pages/2_Events.py` |
| Climate & Energy | `pages/3_Climate_and_Energy.py` |

## Deploy
1. Run `setup.sql` (creates `WEATHER_NORMALS.APP` tables + stage).
2. `pip install snowflake-connector-python[pandas] pyyaml && python snowflake/load_data.py` to load the JSON data.
3. Upload this folder to `@APP_STAGE` and create the Streamlit object (commented at the bottom of `setup.sql`),
   or use Snowsight → Streamlit → upload files.

## Updating data
The app has no internet access by default, so it doesn't call ACIS. The existing GitHub Action keeps committing JSON;
re-run `load_data.py` (e.g. as an extra workflow step with Snowflake secrets) to refresh the tables. The app caches queries for 1 hour.

## Local preview (no Snowflake)
```bash
pip install streamlit plotly pandas numpy
WEATHER_DATA_DIR=docs/data streamlit run snowflake/Normals.py
```

## Differences from the site
- Plotly charts instead of D3: same data and calculations, but the "horizon chart" is a banded heatmap, and tooltips/styling differ.
- Energy-budget inputs persist for the session only (no browser localStorage); CSV export buttons are not ported.
- Streamlit's own light/dark theme applies. Adding a station = add it to `config/stations.yml` and re-run `load_data.py`.
