Use your actual bucket name `datagonein60-rawdata-837132623653` in every LOCATION. In Athena, run:

```sql
-- 1) Drop old metadata
DROP DATABASE IF EXISTS my_athena_database CASCADE;

-- 2) Recreate pointing at the new raw prefix
CREATE DATABASE my_athena_database
  LOCATION 's3://datagonein60-rawdata-837132623653/raw/';

-- 3) Define the table with date-only partitions
CREATE EXTERNAL TABLE my_athena_database.my_raw_data_table (
  sensorid       STRING,
  rawtemperature DOUBLE,
  rawhumidity    DOUBLE,
  timestamp      STRING,
  objectkey      STRING
)
PARTITIONED BY (
  year  STRING,
  month STRING,
  day   STRING
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES (
  'ignore.malformed.json' = 'true'
)
STORED AS TEXTFILE
LOCATION 's3://datagonein60-rawdata-837132623653/raw/';

-- 4) Register all existing partitions
MSCK REPAIR TABLE my_athena_database.my_raw_data_table;

-- 5) Verify
SHOW PARTITIONS my_athena_database.my_raw_data_table;
SELECT * 
  FROM my_athena_database.my_raw_data_table 
 LIMIT 10;
```