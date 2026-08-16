"""Fetch observed daily weather data for each configured station.

On first run, backfills from BACKFILL_START_YEAR through today. On later
runs, only fetches days after the most recent recorded observation and
merges them into the existing file, so re-running is cheap and idempotent.
"""
import datetime as dt
import json

from common import acis_request, load_stations, station_data_dir, to_number, write_json

BACKFILL_START_YEAR = 1991  # matches the 1991-2020 normals base period


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
            last_date = max(r["date"] for r in existing)
            sdate = (dt.date.fromisoformat(last_date) + dt.timedelta(days=1)).isoformat()
        else:
            sdate = f"{BACKFILL_START_YEAR}-01-01"

        if sdate > today:
            print(f"[{station['id']}] already up to date through {existing[-1]['date']}")
            continue

        print(f"[{station['id']}] fetching observed data {sdate}..{today}")
        new_records = fetch_observed(station["sid"], sdate, today)

        by_date = {r["date"]: r for r in existing}
        for r in new_records:
            by_date[r["date"]] = r

        merged = [by_date[d] for d in sorted(by_date)]
        write_json(obs_path, merged)


if __name__ == "__main__":
    main()
