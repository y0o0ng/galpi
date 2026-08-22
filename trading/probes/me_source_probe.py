"""버리는 spike. 본구현에서 재사용하지 않는다."""
import json, sys, time, urllib.request, urllib.error

UA = "galpi-research chanyongs2005@gmail.com"
_last = [0.0]

def get(url):
    wait = 0.15 - (time.monotonic() - _last[0])
    if wait > 0: time.sleep(wait)
    try:
        r = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(r, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"__http_error__": e.code}
    finally:
        _last[0] = time.monotonic()

def concept(cik, taxonomy, tag):
    return get(f"https://data.sec.gov/api/xbrl/companyconcept/CIK{int(cik):010d}/{taxonomy}/{tag}.json")
