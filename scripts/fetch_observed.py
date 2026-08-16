"""Fetch observed daily weather data for each configured station.

On first run, backfills from BACKFILL_START_YEAR through today. On later
runs, only re-fetches a trailing window of recent days plus anything new,
and merges the result into the existing file.

The trailing re-fetch matters because ACIS often returns a day's data as
missing ("M") if queried before that day's observation has been finalized
(commonly the case for "today", occasionally for the last couple of days).
Re-fetching a small window each run heals those placeholder nulls once the
real values become available, instead of leaving them stuck forever.
"""
import datetime as dt
import json

from common import acis_request, load_stations, station_data_dir, to_number, write_json

BACKFILL_START_YEAR = 1991  # matches the 1991-2020 normals base period
REFETCH_WINDOW_DAYS = 5  # re-check this many trailing days for late-finalized data


def fetch_observed(sid, sdate, edate):
    params = {
        "sid": sid,
        "sdate": sdate,
        "edate": edate,
        "elems": [
            {"name": "maxt", "interval": "dly"},
            {"name": "mint", "interval": "dly"},
            {"name": "pcpn", "interval": "dly"},
        ],
    }
    payload = acis_request(params)
    records = []
    for row in payload["data"]:
        date, tmax, tmin, precip = row
        records.append(
            {
                "date": date,
                "tmax": to_number(tmax),
                "tmin": to_number(tmin),
                "precip": to_number(precip),
            }
        )
    return records


def main():
    today = dt.date.today().isoformat()

    for station in load_stations():
        out_dir = station_data_dir(station["id"])
        obs_path = out_dir / "observed_daily.json"

        existing = json.loads(obs_path.read_text()) if obs_path.exists() else []

        if existing:
            last_date = dt.date.fromisoformat(max(r["date"] for r in existing))
            sdate = (last_date - dt.timedelta(days=REFETCH_WINDOW_DAYS)).isoformat()
        else:
            sdate = f"{BACKFILL_START_YEAR}-01-01"

        print(f"[{station['id']}] fetching observed data {sdate}..{today}")
        new_records = fetch_observed(station["sid"], sdate, today)

        by_date = {r["date"]: r for r in existing}
        for r in new_records:
            by_date[r["date"]] = r

        merged = [by_date[d] for d in sorted(by_date)]
        write_json(obs_path, merged)


if __name__ == "__main__":
    main()
