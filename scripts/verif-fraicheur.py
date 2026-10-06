"""Âge des 3 horodatages surveillés par aguilaradar-verif-fraicheur-quotidien (lecture seule)."""
import datetime as dt
import json
import re

now = dt.datetime.now(dt.timezone.utc)
with open("js/config.js", encoding="utf-8") as config:
    match = re.search(r"deepCycleHours:\s*(\d+(?:\.\d+)?)", config.read())
cycle_h = float(match.group(1)) if match else None

# Jamais news.last_updated_at ni opportunities.last_checked_at : voir docs/routines/verif-fraicheur-quotidien.md
CHECKS = [
    ("cycle profond", "data/engine-history.json", ("routine_health", "last_success_at"), 8),
    ("actualites", "data/news.json", ("last_checked_at",), 1.5 * cycle_h if cycle_h else None),
    ("opportunites", "data/opportunities.json", ("last_scan_at",), 36),
]

for label, path, keys, limit_h in CHECKS:
    field = f"{path} {'.'.join(keys)}"
    try:
        with open(path, encoding="utf-8") as source:
            value = json.load(source)
        for key in keys:
            value = value.get(key) if isinstance(value, dict) else None
        if not value:
            print(f"{label} : {field} ABSENT")
            continue
        stamp = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (OSError, ValueError) as error:
        print(f"{label} : {field} ILLISIBLE ({error.__class__.__name__} : {error})")
        continue
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=dt.timezone.utc)
    minutes = int((now - stamp).total_seconds() // 60)
    age = f"{minutes // 60}h{minutes % 60:02d}"
    if limit_h is None:
        print(f"{label} : {field} = {value} -> il y a {age} (seuil inconnu : deepCycleHours introuvable dans js/config.js)")
        continue
    verdict = "ATTENTION" if minutes / 60 > limit_h else "OK"
    print(f"{label} : {field} = {value} -> il y a {age} (seuil {limit_h:g} h) {verdict}")
