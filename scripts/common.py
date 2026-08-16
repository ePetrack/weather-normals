"""Shared helpers for fetching climate data from the ACIS Web Services API."""
import json
import time
from pathlib import Path

import requests
import yaml

ACIS_STNDATA_URL = "http://data.rcc-acis.org/StnData"
REPO_ROOT = Path(__file__).resolve().parent.parent
STATIONS_CONFIG = REPO_ROOT / "config" / "stations.yml"
DATA_DIR = REPO_ROOT / "docs" / "data"


def load_stations():
    with open(STATIONS_CONFIG) as f:
        cfg = yaml.safe_load(f)
    return cfg["stations"]


def acis_request(params, retries=3, backoff=5):
    """POST a query to ACIS StnData, retrying on transient failures.

    Raises on a persistent failure so the GitHub Actions run fails loudly
    (and the raw params/response get printed to the job log) rather than
    silently writing bad data.
    """
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.post(ACIS_STNDATA_URL, json=params, timeout=60)
            resp.raise_for_status()
            payload = resp.json()
            if "error" in payload:
                raise RuntimeError(f"ACIS returned an error: {payload['error']}")
            return payload
        except Exception as err:  # noqa: BLE001 - want to retry+report any failure mode
            last_err = err
            print(f"ACIS request failed (attempt {attempt + 1}/{retries}): {err}")
            print(f"  params={json.dumps(params)}")
            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"ACIS request failed after {retries} attempts: {last_err}")


def to_number(value):
    """Coerce an ACIS value to float, mapping missing/trace/flagged values to None."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def station_data_dir(station_id):
    path = DATA_DIR / station_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Wrote {path} ({len(data)} records)")
