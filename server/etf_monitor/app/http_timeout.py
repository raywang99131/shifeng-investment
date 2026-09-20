"""Bound AkShare's requests, including providers that omit a timeout."""

from functools import wraps
from inspect import signature

import requests


def install_http_timeout(seconds: float) -> None:
    # This policy is confined to the dedicated ETF backend process. Reinstalling
    # it replaces the default instead of stacking wrappers (e.g. in app tests).
    current = requests.sessions.Session.request
    original = getattr(current, "_etf_original_request", current)
    parameters = signature(original)

    @wraps(original)
    def request(*args, **kwargs):
        bound = parameters.bind(*args, **kwargs)
        if bound.arguments.get("timeout") is None:
            bound.arguments["timeout"] = (min(5.0, seconds), seconds)
        return original(*bound.args, **bound.kwargs)

    request._etf_original_request = original
    requests.sessions.Session.request = request
