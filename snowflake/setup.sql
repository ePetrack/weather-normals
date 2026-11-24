-- One-time setup for the Weather Normals Streamlit app. Run as a role that can create databases.
CREATE DATABASE IF NOT EXISTS WEATHER_NORMALS;
CREATE SCHEMA IF NOT EXISTS WEATHER_NORMALS.APP;
USE SCHEMA WEATHER_NORMALS.APP;

CREATE TABLE IF NOT EXISTS STATIONS (id STRING, name STRING, sid STRING);
CREATE TABLE IF NOT EXISTS NORMALS_DAILY (station_id STRING, mmdd STRING, tmax_normal FLOAT, tmin_normal FLOAT, precip_normal FLOAT);
CREATE TABLE IF NOT EXISTS NORMALS_MONTHLY (station_id STRING, month INT, month_name STRING, tmax_normal FLOAT, tmin_normal FLOAT, precip_normal_total FLOAT);
CREATE TABLE IF NOT EXISTS DEGREE_DAYS_NORMALS (station_id STRING, month INT, hdd_normal FLOAT, cdd_normal FLOAT);
CREATE TABLE IF NOT EXISTS OBSERVED_DAILY (station_id STRING, obs_date DATE, tmax FLOAT, tmin FLOAT, precip FLOAT, snow FLOAT);

-- Stage for the app files, then the app itself (upload files with `snow streamlit deploy` or PUT).
CREATE STAGE IF NOT EXISTS APP_STAGE DIRECTORY = (ENABLE = TRUE);
-- After uploading Normals.py, common.py, enso.py, environment.yml and pages/*.py to @APP_STAGE:
-- CREATE OR REPLACE STREAMLIT WEATHER_NORMALS.APP.WEATHER_NORMALS
--   ROOT_LOCATION = '@WEATHER_NORMALS.APP.APP_STAGE' MAIN_FILE = 'Normals.py' QUERY_WAREHOUSE = <your_warehouse>;
