import sys
from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture(autouse=True)
def disable_real_email_in_tests(monkeypatch):
    monkeypatch.setenv("EMAIL_ENABLED", "false")
    monkeypatch.setenv("BATCH_NOTIFICATION_MAX_LAG_SECONDS", "1000000000")
