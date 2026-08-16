"""Fetch 1991-2020 climate normals (daily + monthly) for each configured station.

Normals are static (NOAA republishes the 30-year base period roughly once a
decade), so this only (re)fetches when the output files don't already exist
unless --force is passed.
"""
import argparse
import calendar

from common import acis_request, load_stations, station_data_dir, to_number, write_json

# An arbitrary leap year, so the daily-normals query includes Feb 29. ACIS's
# "normal": "only" mode returns the climatological normal for each calendar
# date in range, independent of the year requested.
NORMALS_QUERY_YEAR = 2020


def fetch_daily_normals(sid):
    params = {
        "sid": sid,
        "sdate": f"{NORMALS_QUERY_YEAR}-01-01",
        "edate": f"{NORMALS_QUERY_YEAR}-12-31",
        "elems": [
            {"name": "maxt", "interval": "dly", "normal": "only"},
            {"name": "mint", "interval": "dly", "normal": "only"},
            {"name": "pcpn", "interval": "dly", "normal": "only"},
        ],
    }
    payload = acis_request(params)
    records = []
    for row in payload["data"]:
        date, tmax_n, tmin_n, precip_n = row
        records.append(
            {
                "date": date[5:],  # "MM-DD"
                "tmax_normal": to_number(tmax_n),
                "tmin_normal": to_number(tmin_n),
                "precip_normal": to_number(precip_n),
            }
        )
    return records


def fetch_monthly_normals(sid):
    params = {
        "sid": sid,
        "sdate": f"{NORMALS_QUERY_YEAR}-01-01",
        "edate": f"{NORMALS_QUERY_YEAR}-12-31",
        "elems": [
            {"name": "maxt", "interval": "mly", "normal": "only"},
            {"name": "mint", "interval": "mly", "normal": "only"},
            {"name": "pcpn", "interval": "mly", "normal": "only", "reduce": "sum"},
        ],
    }
    payload = acis_request(params)
    records = []
    for row in payload["data"]:
        date, tmax_n, tmin_n, precip_n = row
        month = int(date[5:7])
        records.append(
            {
                "month": month,
                "month_name": calendar.month_abbr[month],
                "tmax_normal": to_number(tmax_n),
                "tmin_normal": to_number(tmin_n),
                "precip_normal_total": to_number(precip_n),
            }
        )
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true", help="Re-fetch even if output files already exist"
    )
    args = parser.parse_args()

    for station in load_stations():
        out_dir = station_data_dir(station["id"])
        daily_path = out_dir / "normals_daily.json"
        monthly_path = out_dir / "normals_monthly.json"

        if daily_path.exists() and monthly_path.exists() and not args.force:
            print(f"[{station['id']}] normals already present, skipping (use --force to refetch)")
            continue

        print(f"[{station['id']}] fetching 1991-2020 normals for station {station['sid']}")
        write_json(daily_path, fetch_daily_normals(station["sid"]))
        write_json(monthly_path, fetch_monthly_normals(station["sid"]))


if __name__ == "__main__":
    main()
