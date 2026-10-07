"""Fetch NOAA's official 1991-2020 monthly HDD/CDD normals (base 65F) per station.

Like fetch_normals.py these are static, so a station is only fetched when its
output file is missing (or with --force). The site falls back to degree days
derived from the daily normal highs/lows when the file is absent, so a failure
here never blocks the rest of the pipeline.
"""
import argparse
import sys

from common import acis_request, load_stations, station_data_dir, to_number, write_json

# Same arbitrary leap year as fetch_normals.py; "normal": "only" ignores the year.
NORMALS_QUERY_YEAR = 2020


def fetch_monthly_degree_day_normals(sid):
    params = {
        "sid": sid,
        "sdate": f"{NORMALS_QUERY_YEAR}-01-01",
        "edate": f"{NORMALS_QUERY_YEAR}-12-31",
        "elems": [
            {"name": "hdd", "interval": "mly", "normal": "only"},
            {"name": "cdd", "interval": "mly", "normal": "only"},
        ],
    }
    payload = acis_request(params)
    rows = payload["data"]
    if len(rows) != 12:
        raise RuntimeError(f"expected 12 monthly rows, got {len(rows)}: {rows}")
    records = []
    for date, hdd, cdd in rows:
        hdd_n, cdd_n = to_number(hdd), to_number(cdd)
        if hdd_n is None or cdd_n is None:
            raise RuntimeError(f"missing degree-day normal for {date}: hdd={hdd!r} cdd={cdd!r}")
        records.append({"month": int(date[5:7]), "hdd_normal": hdd_n, "cdd_normal": cdd_n})
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Re-fetch even if output files exist")
    args = parser.parse_args()

    failed = []
    for station in load_stations():
        path = station_data_dir(station["id"]) / "degree_days_normals.json"
        if path.exists() and not args.force:
            print(f"[{station['id']}] degree-day normals already present, skipping")
            continue
        print(f"[{station['id']}] fetching degree-day normals for station {station['sid']}")
        try:
            write_json(path, fetch_monthly_degree_day_normals(station["sid"]))
        except Exception as err:  # noqa: BLE001 - one bad station must not block the rest
            print(f"::warning::[{station['id']}] degree-day normals fetch failed: {err}")
            failed.append(station["id"])

    if failed:
        sys.exit(f"Degree-day normals fetch failed for: {', '.join(failed)}")


if __name__ == "__main__":
    main()
