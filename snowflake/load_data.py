"""Load the repo's docs/data JSON + config/stations.yml into the Snowflake tables from setup.sql.

Usage: python snowflake/load_data.py [--connection NAME]   (uses ~/.snowflake/connections.toml)
Re-run after each data update (e.g. from the daily GitHub Actions workflow) — tables are fully replaced.
"""
import argparse
import json
from pathlib import Path

import pandas as pd
import snowflake.connector
import yaml
from snowflake.connector.pandas_tools import write_pandas

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
DB, SCHEMA = "WEATHER_NORMALS", "APP"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--connection", default=None)
    args = ap.parse_args()
    conn = snowflake.connector.connect(connection_name=args.connection, database=DB, schema=SCHEMA)
    stations = yaml.safe_load((ROOT / "config" / "stations.yml").read_text())["stations"]
    frames = {"STATIONS": pd.DataFrame(stations)[["id", "name", "sid"]].rename(columns=str.upper)}
    spec = {"NORMALS_DAILY": ("normals_daily", {"date": "mmdd"}), "NORMALS_MONTHLY": ("normals_monthly", {}),
            "DEGREE_DAYS_NORMALS": ("degree_days_normals", {}), "OBSERVED_DAILY": ("observed_daily", {"date": "obs_date"})}
    for table, (fname, rename) in spec.items():
        parts = []
        for s in stations:
            f = DATA / s["id"] / f"{fname}.json"
            if f.exists():
                parts.append(pd.DataFrame(json.loads(f.read_text())).rename(columns=rename).assign(station_id=s["id"]))
        if parts:
            frames[table] = pd.concat(parts).rename(columns=str.upper)
    for table, df in frames.items():
        conn.cursor().execute(f"TRUNCATE TABLE {table}")
        ok, _, n, _ = write_pandas(conn, df, table, database=DB, schema=SCHEMA)
        print(f"{table}: {n} rows ({'ok' if ok else 'FAILED'})")


if __name__ == "__main__":
    main()
