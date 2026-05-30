import csv
import io
import json
import re
from datetime import datetime
from pathlib import Path

MASTER = Path('Govee Thermometer Raw Data.csv')

COLUMNS = [
    'Source File',
    'Source Row',
    'Timestamp',
    'Date',
    'Time',
    'Temperature (C)',
    'Relative Humidity (%)',
]

def read_master(path: Path):
    existing_timestamps = set()
    existing_source_files = set()
    rows = []
    if not path.exists():
        return existing_timestamps, existing_source_files, rows
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        for r in reader:
            ts = (r.get('Timestamp') or '').strip()
            sf = (r.get('Source File') or '').strip()
            if ts:
                existing_timestamps.add(ts)
            if sf:
                existing_source_files.add(sf)
            rows.append(r)
    return existing_timestamps, existing_source_files, rows

def normalize_master(path: Path):
    # Ensure exact header columns even if file existed with other columns
    if not path.exists():
        with path.open('w', encoding='utf-8', newline='') as f:
            w = csv.writer(f)
            w.writerow(COLUMNS)
        return
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        text = f.read()
    # If header already correct, keep
    first_line = text.splitlines()[0] if text else ''
    if [c.strip() for c in first_line.split(',')] == COLUMNS:
        return
    # Rewrite keeping intersection of columns
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    with path.open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: (r.get(k) or '').strip() for k in COLUMNS})

def parse_attachment_parsed_text(parsed_text: str):
    """Extract CSV table from the Gmail tool 'PARSED TEXT FOR SHEET' wrapper."""
    # Find the header line that starts with 'index,'
    m = re.search(r'(?m)^index\s*,.*$', parsed_text)
    if not m:
        raise ValueError('Could not find CSV header line starting with index,')
    csv_text = parsed_text[m.start():].strip()
    # Normalize weird NBSP and stray spaces after commas
    csv_text = csv_text.replace('\u00a0', ' ')
    return csv_text

def parse_govee_rows(csv_text: str):
    f = io.StringIO(csv_text)
    reader = csv.DictReader(f)
    # Expect columns like: index, Timestamp for sample frequency every 15 min min,  Temperature_Celsius, Relative_Humidity
    # Normalize header keys
    fieldnames = reader.fieldnames or []
    key_map = {}
    for k in fieldnames:
        nk = k.strip().lower()
        key_map[nk] = k
    idx_key = key_map.get('index')
    ts_key = None
    temp_key = None
    rh_key = None
    for nk, orig in key_map.items():
        if 'timestamp' in nk:
            ts_key = orig
        elif 'temperature' in nk:
            temp_key = orig
        elif 'humidity' in nk:
            rh_key = orig
    if not (idx_key and ts_key and temp_key and rh_key):
        raise ValueError(f'Unexpected columns: {fieldnames}')

    out = []
    for row in reader:
        idx = (row.get(idx_key) or '').strip()
        ts = (row.get(ts_key) or '').strip()
        temp = (row.get(temp_key) or '').strip()
        rh = (row.get(rh_key) or '').strip()
        if not ts:
            continue
        # Ensure timestamp parses and normalize to 'YYYY-MM-DD HH:MM:SS'
        dt = datetime.strptime(ts, '%Y-%m-%d %H:%M:%S')
        ts_norm = dt.strftime('%Y-%m-%d %H:%M:%S')
        date_norm = dt.strftime('%Y-%m-%d 00:00:00')
        time_norm = dt.strftime('%H:%M:%S')
        out.append((idx, ts_norm, date_norm, time_norm, temp, rh))
    return out

def append_rows(master: Path, source_filename: str, source_rows):
    normalize_master(master)
    existing_timestamps, existing_source_files, _ = read_master(master)

    if source_filename in existing_source_files:
        return 0, 0, True  # added_rows, skipped_dupe_ts, skipped_whole_file

    added = 0
    skipped_ts = 0
    with master.open('a', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        for (src_row, ts, date, time, temp, rh) in source_rows:
            if ts in existing_timestamps:
                skipped_ts += 1
                continue
            writer.writerow({
                'Source File': source_filename,
                'Source Row': src_row,
                'Timestamp': ts,
                'Date': date,
                'Time': time,
                'Temperature (C)': temp,
                'Relative Humidity (%)': rh,
            })
            existing_timestamps.add(ts)
            added += 1
    return added, skipped_ts, False

if __name__ == '__main__':
    # Read attachments from stdin as JSON list: [{filename, parsed_text}]
    payload = json.load(sys.stdin)
