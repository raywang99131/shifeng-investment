from datetime import datetime
import smtplib

import pytest

from app import service as service_module
from app.config import EtfSymbolConfig, Settings
from app.models import AlertCreate
from app.notifier import SMTPAlertNotifier
from app.service import MonitorService
from test_api import RecordingNotifier, SymbolAwareMarketDataClient, candle
from test_notifier import FakeSMTP, alert_log


class RecoveryNotifier(RecordingNotifier):
    def __init__(self):
        super().__init__()
        self.recovered = []

    def send_recovery_alerts(self, alerts):
        self.recovered.append(list(alerts))


@pytest.fixture
def clock(monkeypatch):
    class Clock(datetime):
        current = datetime(2026, 9, 16, 14, 5)

        @classmethod
        def now(cls, tz=None):
            return cls.current.replace(tzinfo=tz)

    monkeypatch.setattr(service_module, 'datetime', Clock)
    return Clock


def monitor(tmp_path, notifier):
    settings = Settings(symbols=[EtfSymbolConfig(symbol='159915.SZ', name='ETF A')],
                        volume_ratio_threshold=1.3)
    client = SymbolAwareMarketDataClient({'159915.SZ': [
        candle('2026-09-16T13:45:00', 1000),
        candle('2026-09-16T14:00:00', 2000),
    ]})
    return MonitorService(settings, client, tmp_path / 'monitor.db', notifier)


def test_smtp_failure_does_not_mark_sent_and_survives_restart(tmp_path, clock):
    class OfflineNotifier(RecoveryNotifier):
        def send_alerts(self, alerts):
            raise OSError('SMTP unavailable')

    service = monitor(tmp_path, OfflineNotifier())
    service.poll_all()
    assert not service.alert_store.notification_event_exists(
        datetime(2026, 9, 16, 14), 'alert_batch'
    ), 'Failed SMTP attempts must remain pending, not become deduplication records'
    assert service.notification_health()['failed'] == 1

    recovered = RecoveryNotifier()
    restarted = monitor(tmp_path, recovered)
    # Advancing the durable queue's clock makes the scheduled retry due.
    restarted.outbox.now = lambda: datetime(2026, 9, 17).timestamp() + 10**9
    restarted.retry_notifications()
    restarted.retry_notifications()
    assert len(recovered.alert_batches) == 1
    assert restarted.alert_store.notification_event_exists(datetime(2026, 9, 16, 14), 'alert_batch')
    assert restarted.notification_health()['pending'] == 0


def test_recovery_sends_missed_intraday_alerts_once_with_original_times(tmp_path, clock):
    notifier = RecoveryNotifier()
    service = monitor(tmp_path, notifier)
    for minute in ('10:45', '11:00'):
        service.candle_cache.upsert_candles([candle('2026-09-16T'+minute, 2000)])
        service.alert_store.save_alert(AlertCreate(
            symbol='159915.SZ', name='ETF A', candle_time=datetime.fromisoformat('2026-09-16T'+minute),
            volume=2000, prev_volume=1000, ratio=2, threshold=1.3,
            severity='warning', message='放量异动',
        ))
    service.poll_all()
    service.poll_all()
    assert len(notifier.recovered) == 1
    assert [a.candle_time.strftime('%H:%M') for a in notifier.recovered[0]] == ['10:45', '11:00']
    assert len(notifier.alert_batches) == 1


def test_disabled_email_keeps_notifications_pending(tmp_path, clock):
    service = monitor(tmp_path, SMTPAlertNotifier(Settings(email_enabled=False)))
    service.poll_all()
    assert not service.alert_store.notification_event_exists(datetime(2026, 9, 16, 14), 'alert_batch')
    assert service.notification_health()['pending'] == 1


def test_partial_recipient_refusal_is_reported(monkeypatch):
    class PartialSMTP(FakeSMTP):
        def send_message(self, message):
            return {'second@example.com': (450, b'temporarily unavailable')}

    monkeypatch.setattr(smtplib, 'SMTP_SSL', PartialSMTP)
    settings = Settings(email_enabled=True, smtp_host='smtp.example.com', smtp_from='sender@example.com',
                        smtp_to='first@example.com,second@example.com', smtp_username='', smtp_password='')
    with pytest.raises(smtplib.SMTPRecipientsRefused):
        SMTPAlertNotifier(settings).send_alert(alert_log())


def test_partial_delivery_retries_only_refused_recipient(tmp_path, monkeypatch, clock):
    delivered_to = []
    class PartialSMTP(FakeSMTP):
        def send_message(self, message):
            delivered_to.append(str(message['To']))
            if len(delivered_to) == 1:
                return {'second@example.com': (450, b'try later')}
            return {}
    monkeypatch.setattr(smtplib, 'SMTP_SSL', PartialSMTP)
    settings = Settings(email_enabled=True, smtp_host='smtp.example.com', smtp_from='sender@example.com',
                        smtp_to='first@example.com,second@example.com', smtp_username='', smtp_password='')
    service = monitor(tmp_path, SMTPAlertNotifier(settings))
    service.poll_all()
    assert service.notification_health()['failed'] == 1
    assert not service.alert_store.notification_event_exists(datetime(2026, 9, 16, 14), 'alert_batch')
    service.outbox.now = lambda: 10**10
    service.retry_notifications()
    assert delivered_to == ['first@example.com, second@example.com', 'second@example.com']
    assert service.notification_health()['pending'] == 0


def test_interrupted_delivery_is_recovered_after_lease_expires(tmp_path, clock):
    service = monitor(tmp_path, SMTPAlertNotifier(Settings(email_enabled=False)))
    service.poll_all()
    abandoned = service.outbox.claim()
    assert abandoned is not None
    notifier = RecoveryNotifier()
    restarted = monitor(tmp_path, notifier)
    restarted.retry_notifications()
    assert notifier.alert_batches == []
    restarted.outbox.now = lambda: 10**10
    restarted.retry_notifications()
    assert len(notifier.alert_batches) == 1
    assert restarted.notification_health()['pending'] == 0


def test_health_reports_persisted_mail_failure(tmp_path, clock):
    from app.main import create_app
    from fastapi.testclient import TestClient
    class OfflineNotifier(RecoveryNotifier):
        def send_alerts(self, alerts):
            raise OSError('SMTP unavailable')
    service = monitor(tmp_path, OfflineNotifier())
    service.poll_all()
    app = create_app(db_path=tmp_path / 'monitor.db', settings=service.settings,
                     market_data_client=service.market_data_client, notifier=RecoveryNotifier(),
                     scheduler_enabled=False)
    health = TestClient(app).get('/api/health').json()
    assert health['status'] == 'degraded'
    assert health['notifications']['failed'] == 1
    assert '邮件' in health['error']


@pytest.mark.parametrize('kind', ['normal', 'summary'])
def test_non_alert_mail_failures_are_retried(tmp_path, clock, kind):
    class OfflineNotifier(RecoveryNotifier):
        def send_no_anomalies(self, candles, notified_at):
            raise OSError('offline')
        def send_daily_summary(self, *args):
            raise OSError('offline')
    service = monitor(tmp_path, OfflineNotifier())
    if kind == 'normal':
        service._send_no_anomaly_notifications([candle('2026-09-16T14:00:00', 1000)])
    else:
        service._send_daily_summary_if_market_closed([candle('2026-09-16T15:00:00', 1000)])
    service.retry_notifications()
    assert service.notification_health()['failed'] == 1
    notifier = RecoveryNotifier()
    restarted = monitor(tmp_path, notifier)
    restarted.outbox.now = lambda: 10**10
    restarted.retry_notifications()
    assert restarted.notification_health()['pending'] == 0
    assert len(notifier.no_anomaly_batches if kind == 'normal' else notifier.daily_summaries) == 1


def test_concurrent_workers_cannot_claim_the_same_email(tmp_path, clock):
    from concurrent.futures import ThreadPoolExecutor
    from app.notification_outbox import NotificationOutbox
    service = monitor(tmp_path, SMTPAlertNotifier(Settings(email_enabled=False)))
    service.poll_all()
    workers = [NotificationOutbox(tmp_path / 'monitor.db') for _ in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(lambda worker: worker.claim(), workers))
    assert sum(job is not None for job in claims) == 1


def test_recovery_email_is_clearly_labelled_with_original_time_range(monkeypatch):
    messages = []
    class CaptureSMTP(FakeSMTP):
        def send_message(self, message):
            messages.append(message)
            return {}
    monkeypatch.setattr(smtplib, 'SMTP_SSL', CaptureSMTP)
    settings = Settings(email_enabled=True, smtp_host='smtp.example.com', smtp_from='sender@example.com',
                        smtp_to='desk@example.com', smtp_username='', smtp_password='')
    first = alert_log().model_copy(update={'candle_time': datetime(2026, 9, 16, 10, 45)})
    last = alert_log().model_copy(update={'candle_time': datetime(2026, 9, 16, 13, 45)})
    SMTPAlertNotifier(settings).send_recovery_alerts([first, last])
    assert '延迟补发' in messages[0]['Subject']
    assert '10:45' in messages[0]['Subject'] and '13:45' in messages[0]['Subject']


@pytest.mark.parametrize('use_ssl', [True, False])
@pytest.mark.parametrize('partial', [False, True])
def test_smtp_quit_failure_does_not_retry_accepted_recipients(tmp_path, monkeypatch, clock, use_ssl, partial):
    delivered_to = []

    class QuitFailureSMTP(FakeSMTP):
        def send_message(self, message):
            delivered_to.append(str(message['To']))
            if partial and len(delivered_to) == 1:
                return {'second@example.com': (450, b'try later')}
            return {}

        def starttls(self):
            pass

        def quit(self):
            raise smtplib.SMTPResponseException(421, b'connection closing')

        def close(self):
            pass

        def __exit__(self, *args):
            self.quit()

    monkeypatch.setattr(smtplib, 'SMTP_SSL' if use_ssl else 'SMTP', QuitFailureSMTP)
    settings = Settings(email_enabled=True, smtp_host='smtp.example.com', smtp_from='sender@example.com',
                        smtp_to='first@example.com,second@example.com', smtp_username='', smtp_password='',
                        smtp_use_ssl=use_ssl, smtp_starttls=not use_ssl)
    service = monitor(tmp_path, SMTPAlertNotifier(settings))
    service.poll_all()
    service.outbox.now = lambda: 10**10
    service.retry_notifications()
    assert delivered_to == (['first@example.com, second@example.com', 'second@example.com']
                            if partial else ['first@example.com, second@example.com'])
    assert service.notification_health()['pending'] == 0
    assert service.alert_store.notification_event_exists(datetime(2026, 9, 16, 14), 'alert_batch')
