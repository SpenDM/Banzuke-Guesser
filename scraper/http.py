"""Shared HTTP session: browser-like headers and simple retries."""
from __future__ import annotations

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
TIMEOUT = 30


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
    })
    retry = Retry(total=3, backoff_factor=1.5, status_forcelist=(500, 502, 503, 504))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        _session = make_session()
    return _session
