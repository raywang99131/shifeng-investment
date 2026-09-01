from __future__ import annotations

import io
import html
import smtplib
import sqlite3
from datetime import date, datetime, timedelta
from email import policy
from email.message import EmailMessage
from typing import Protocol, Sequence
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

from app.config import EtfSymbolConfig, Settings
from app.models import AlertLog, Candle


class AlertNotifier(Protocol):
    def send_alert(self, alert: AlertLog) -> None: ...

    def send_alerts(self, alerts: Sequence[AlertLog]) -> None: ...

    def send_no_anomaly(self, candle: Candle, notified_at: datetime) -> None: ...

    def send_no_anomalies(
        self, candles: Sequence[Candle], notified_at: datetime
    ) -> None: ...

    def send_daily_summary(
        self,
        summary_date: date,
        symbols: Sequence[EtfSymbolConfig],
        alerts: Sequence[AlertLog],
        notified_at: datetime,
    ) -> None: ...


class NoopAlertNotifier:
    def send_alert(self, alert: AlertLog) -> None:
        return None

    def send_alerts(self, alerts: Sequence[AlertLog]) -> None:
        return None

    def send_no_anomaly(self, candle: Candle, notified_at: datetime) -> None:
        return None

    def send_no_anomalies(
        self, candles: Sequence[Candle], notified_at: datetime
    ) -> None:
        return None

    def send_daily_summary(
        self,
        summary_date: date,
        symbols: Sequence[EtfSymbolConfig],
        alerts: Sequence[AlertLog],
        notified_at: datetime,
    ) -> None:
        return None


class SMTPAlertNotifier:
    def __init__(self, settings: Settings):
        self.settings = settings

    def send_alert(self, alert: AlertLog) -> None:
        if not self._should_send():
            return

        self._deliver(self._message(alert))

    def send_alerts(self, alerts: Sequence[AlertLog]) -> None:
        if not alerts or not self._should_send():
            return

        self._deliver(self._alerts_message(alerts))

    def send_no_anomaly(self, candle: Candle, notified_at: datetime) -> None:
        if not self._should_send():
            return

        self._deliver(self._no_anomaly_message(candle, notified_at))

    def send_no_anomalies(
        self, candles: Sequence[Candle], notified_at: datetime
    ) -> None:
        if not candles or not self._should_send():
            return

        self._deliver(self._no_anomalies_message(candles, notified_at))

    def send_daily_summary(
        self,
        summary_date: date,
        symbols: Sequence[EtfSymbolConfig],
        alerts: Sequence[AlertLog],
        notified_at: datetime,
    ) -> None:
        if not self._should_send():
            return

        self._deliver(
            self._daily_summary_message(summary_date, symbols, alerts, notified_at)
        )

    def _deliver(self, message: EmailMessage) -> None:
        if self.settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(
                self.settings.smtp_host,
                self.settings.smtp_port,
                timeout=self.settings.smtp_timeout_seconds,
            ) as client:
                self._send_message(client, message)
            return

        with smtplib.SMTP(
            self.settings.smtp_host,
            self.settings.smtp_port,
            timeout=self.settings.smtp_timeout_seconds,
        ) as client:
            if self.settings.smtp_starttls:
                client.starttls()
            self._send_message(client, message)

    def _should_send(self) -> bool:
        return (
            self.settings.email_enabled
            and bool(self.settings.smtp_host)
            and bool(self.settings.smtp_from)
            and bool(_recipients(self.settings.smtp_to))
        )

    def _send_message(self, client, message: EmailMessage) -> None:
        if self.settings.smtp_username and self.settings.smtp_password:
            client.login(self.settings.smtp_username, self.settings.smtp_password)
        client.send_message(message)

    def _message(self, alert: AlertLog) -> EmailMessage:
        recipients = _recipients(self.settings.smtp_to)
        message = EmailMessage(policy=policy.SMTP)
        message["Subject"] = _subject(alert)
        message["From"] = self.settings.smtp_from
        message["To"] = ", ".join(recipients)
        message.set_content(
            _body(alert, self.settings), charset="utf-8", cte="base64"
        )
        _add_alert_table_html(message, [alert], self.settings)
        return message

    def _alerts_message(self, alerts: Sequence[AlertLog]) -> EmailMessage:
        recipients = _recipients(self.settings.smtp_to)
        message = EmailMessage(policy=policy.SMTP)
        message["Subject"] = _alerts_subject(alerts)
        message["From"] = self.settings.smtp_from
        message["To"] = ", ".join(recipients)
        message.set_content(
            _alerts_body(alerts, self.settings), charset="utf-8", cte="base64"
        )
        _add_alert_table_html(message, alerts, self.settings)
        return message

    def _no_anomaly_message(
        self, candle: Candle, notified_at: datetime
    ) -> EmailMessage:
        recipients = _recipients(self.settings.smtp_to)
        message = EmailMessage(policy=policy.SMTP)
        message["Subject"] = _no_anomaly_subject(candle)
        message["From"] = self.settings.smtp_from
        message["To"] = ", ".join(recipients)
        message.set_content(
            _no_anomaly_body(candle, notified_at, self.settings.timezone),
            charset="utf-8",
            cte="base64",
        )
        return message

    def _no_anomalies_message(
        self, candles: Sequence[Candle], notified_at: datetime
    ) -> EmailMessage:
        recipients = _recipients(self.settings.smtp_to)
        message = EmailMessage(policy=policy.SMTP)
        message["Subject"] = _no_anomalies_subject(candles)
        message["From"] = self.settings.smtp_from
        message["To"] = ", ".join(recipients)
        message.set_content(
            _no_anomalies_body(candles, notified_at, self.settings.timezone),
            charset="utf-8",
            cte="base64",
        )
        return message

    def _daily_summary_message(
        self,
        summary_date: date,
        symbols: Sequence[EtfSymbolConfig],
        alerts: Sequence[AlertLog],
        notified_at: datetime,
    ) -> EmailMessage:
        recipients = _recipients(self.settings.smtp_to)
        message = EmailMessage(policy=policy.SMTP)
        message["Subject"] = _daily_summary_subject(summary_date, alerts)
        message["From"] = self.settings.smtp_from
        message["To"] = ", ".join(recipients)
        message.set_content(
            _daily_summary_body(
                summary_date,
                symbols,
                alerts,
                notified_at,
                self.settings,
            ),
            charset="utf-8",
            cte="base64",
        )
        if alerts:
            _add_daily_summary_html(message, summary_date, symbols, alerts, notified_at, self.settings)
        return message


def _recipients(raw_value: str) -> list[str]:
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def _subject(alert: AlertLog) -> str:
    return (
        f"ETF Monitor 告警 | {alert.severity} | {alert.name} ({alert.symbol}) | "
        f"{_alert_type_label(alert.alert_type)} | {alert.candle_time:%Y-%m-%d %H:%M}"
    )


def _alerts_subject(alerts: Sequence[AlertLog]) -> str:
    first_time = min(alert.candle_time for alert in alerts)
    return f"ETF Monitor 告警 | {len(alerts)} 个异动 | {first_time:%Y-%m-%d %H:%M}"


def _body(alert: AlertLog, settings: Settings) -> str:
    return _alerts_body([alert], settings)


def _alerts_body(alerts: Sequence[AlertLog], settings: Settings) -> str:
    first_time = min(alert.candle_time for alert in alerts)
    latest_time = max(alert.candle_time for alert in alerts)
    symbol_text = "、".join(
        f"{alert.name} ({alert.symbol})"
        for alert in sorted(alerts, key=lambda item: (item.candle_time, item.symbol))
    )
    lines = [
        "ETF Monitor 告警通知",
        f"交易日：{first_time:%Y-%m-%d}",
        f"监控标的：{symbol_text}",
        "",
    ]
    if len(alerts) > 1:
        lines.extend([f"共 {len(alerts)} 个异动", ""])
    for index, alert in enumerate(
        sorted(alerts, key=lambda item: (item.candle_time, item.symbol))
    ):
        if len(alerts) > 1:
            lines.append(f"{alert.name} ({alert.symbol})")
        lines.extend(_plain_alert_table(alert, settings))
        if index != len(alerts) - 1:
            lines.append("")
    lines.extend(["", f"告警触发时间：{_alert_time_text(first_time, latest_time)}"])
    latest_created_at = max(alert.created_at for alert in alerts)
    lines.append(f"记录时间：{_format_record_time(latest_created_at, settings.timezone)}")
    return "\n".join(lines)


def _no_anomaly_subject(candle: Candle) -> str:
    return (
        f"ETF Monitor 更新 | 无异动 | {candle.name} ({candle.symbol}) | "
        f"{candle.time:%Y-%m-%d %H:%M}"
    )


def _no_anomalies_subject(candles: Sequence[Candle]) -> str:
    latest_time = max(candle.time for candle in candles)
    return f"ETF Monitor 更新 | 无异动 | {len(candles)} 个标的 | {latest_time:%Y-%m-%d %H:%M}"


def _no_anomaly_body(candle: Candle, notified_at: datetime, timezone_name: str) -> str:
    return "\n".join(
        [
            "ETF Monitor K线更新通知",
            "",
            f"标的: {candle.name} ({candle.symbol})",
            "状态: 无异动",
            f"K线时间: {candle.time:%Y-%m-%d %H:%M:%S}",
            f"成交额: {_format_amount(candle.amount)}",
            f"收盘价: {candle.close}",
            "",
            "说明: 本次K线更新未检测到异动。",
            f"记录时间: {_format_record_time(notified_at, timezone_name)}",
        ]
    )


def _no_anomalies_body(
    candles: Sequence[Candle], notified_at: datetime, timezone_name: str
) -> str:
    lines = ["ETF Monitor K线更新通知", "", "状态: 无异动"]
    for candle in candles:
        lines.extend(
            [
                "",
                f"标的: {candle.name} ({candle.symbol})",
                f"K线时间: {candle.time:%Y-%m-%d %H:%M:%S}",
                f"成交额: {_format_amount(candle.amount)}",
                f"收盘价: {candle.close}",
            ]
        )
    lines.extend(
        [
            "",
            "说明: 本次K线更新未检测到异动。",
            f"记录时间: {_format_record_time(notified_at, timezone_name)}",
        ]
    )
    return "\n".join(lines)


def _daily_summary_subject(summary_date: date, alerts: Sequence[AlertLog]) -> str:
    status = f"{len(alerts)} 个异动" if alerts else "无异动"
    return f"ETF Monitor 收盘总结 | {status} | {summary_date:%Y-%m-%d}"


def _daily_summary_body(
    summary_date: date,
    symbols: Sequence[EtfSymbolConfig],
    alerts: Sequence[AlertLog],
    notified_at: datetime,
    settings: Settings,
) -> str:
    symbol_text = ", ".join(f"{item.name} ({item.symbol})" for item in symbols)
    lines = [
        "ETF Monitor 收盘总结",
        "",
        f"交易日：{summary_date:%Y-%m-%d}",
        f"监控标的：{symbol_text}",
    ]
    if alerts:
        lines.extend(["", "今日异动："])
        for index, alert in enumerate(
            sorted(alerts, key=lambda item: (item.candle_time, item.symbol))
        ):
            if len(alerts) > 1:
                lines.append(f"{alert.name} ({alert.symbol})")
            lines.extend(_plain_alert_table(alert, settings))
            if index != len(alerts) - 1:
                lines.append("")
    else:
        lines.extend(["", "今日异动: 无"])
    lines.extend(
        [
            "",
            f"记录时间: {_format_record_time(notified_at, settings.timezone)}",
        ]
    )
    return "\n".join(lines)


def _format_record_time(value, timezone_name: str) -> str:
    if value.tzinfo is None:
        return f"{value:%Y-%m-%d %H:%M:%S}"
    local_value = value.astimezone(ZoneInfo(timezone_name))
    return f"{local_value:%Y-%m-%d %H:%M:%S} ({timezone_name})"


def _alert_type_label(_alert_type: str) -> str:
    return "成交额"


def _plain_alert_table(alert: AlertLog, settings: Settings) -> list[str]:
    header = f"时间\t标的代码\t标的名称\t成交额\t{_change_column_label(alert)}"
    previous_time = _comparison_time(alert, settings)
    return [
        header,
        (
            f"{_short_datetime(previous_time)}\t{_display_symbol(alert.symbol)}\t"
            f"{alert.name}\t{_format_amount(alert.prev_volume)}\t——"
        ),
        (
            f"{_short_datetime(alert.candle_time)}\t{_display_symbol(alert.symbol)}\t"
            f"{alert.name}\t{_format_amount(alert.volume)}\t"
            f"{_percentage_change(alert)}"
        ),
    ]


def _add_alert_table_html(
    message: EmailMessage, alerts: Sequence[AlertLog], settings: Settings
) -> None:
    sorted_alerts = sorted(alerts, key=lambda item: (item.candle_time, item.symbol))
    message.add_alternative(_alerts_html_body(sorted_alerts, settings), subtype="html")
    html_part = message.get_payload()[-1]
    if not isinstance(html_part, EmailMessage):
        return
    for alert in sorted_alerts:
        html_part.add_related(
            _render_alert_table_image(alert, settings),
            maintype="image",
            subtype="png",
            cid=f"<{_alert_table_cid(alert)}>",
            filename=(
                f"{_display_symbol(alert.symbol)}_{alert.candle_time:%H%M}"
                "_volume_change.png"
            ),
            disposition="inline",
        )


def _alerts_html_body(alerts: Sequence[AlertLog], settings: Settings) -> str:
    first_time = min(alert.candle_time for alert in alerts)
    latest_time = max(alert.candle_time for alert in alerts)
    symbol_text = "、".join(f"{alert.name} ({alert.symbol})" for alert in alerts)
    latest_created_at = max(alert.created_at for alert in alerts)
    parts = [
        "<html><body>",
        "<p>ETF Monitor 告警通知<br>",
        f"交易日：{first_time:%Y-%m-%d}<br>",
        f"监控标的：{_html_escape(symbol_text)}</p>",
    ]
    if len(alerts) > 1:
        parts.append(f"<p>共 {len(alerts)} 个异动</p>")
    for alert in sorted(alerts, key=lambda item: (item.candle_time, item.symbol)):
        if len(alerts) > 1:
            parts.append(f"<p>{_html_escape(alert.name)} ({_html_escape(alert.symbol)})</p>")
        parts.append(
            (
                f'<p><img src="cid:{_alert_table_cid(alert)}" '
                f'alt="{_html_escape(alert.name)} volume change table"></p>'
            )
        )
    parts.extend(
        [
            f"<p>告警触发时间：{_alert_time_text(first_time, latest_time)}<br>",
            f"记录时间：{_format_record_time(latest_created_at, settings.timezone)}</p>",
            "</body></html>",
        ]
    )
    return "\n".join(parts)


def _add_daily_summary_html(
    message: EmailMessage,
    summary_date: date,
    symbols: Sequence[EtfSymbolConfig],
    alerts: Sequence[AlertLog],
    notified_at: datetime,
    settings: Settings,
) -> None:
    sorted_alerts = sorted(alerts, key=lambda item: (item.candle_time, item.symbol))
    message.add_alternative(
        _daily_summary_html_body(
            summary_date, symbols, sorted_alerts, notified_at, settings
        ),
        subtype="html",
    )
    html_part = message.get_payload()[-1]
    if not isinstance(html_part, EmailMessage):
        return
    for alert in sorted_alerts:
        html_part.add_related(
            _render_alert_table_image(alert, settings),
            maintype="image",
            subtype="png",
            cid=f"<{_alert_table_cid(alert)}>",
            filename=(
                f"{_display_symbol(alert.symbol)}_{alert.candle_time:%H%M}"
                "_volume_change.png"
            ),
            disposition="inline",
        )


def _daily_summary_html_body(
    summary_date: date,
    symbols: Sequence[EtfSymbolConfig],
    alerts: Sequence[AlertLog],
    notified_at: datetime,
    settings: Settings,
) -> str:
    symbol_text = ", ".join(f"{item.name} ({item.symbol})" for item in symbols)
    parts = [
        "<html><body>",
        "<p>ETF Monitor 收盘总结<br>",
        f"交易日：{summary_date:%Y-%m-%d}<br>",
        f"监控标的：{_html_escape(symbol_text)}</p>",
        "<p>今日异动：</p>",
    ]
    for alert in alerts:
        if len(alerts) > 1:
            parts.append(f"<p>{_html_escape(alert.name)} ({_html_escape(alert.symbol)})</p>")
        parts.append(
            (
                f'<p><img src="cid:{_alert_table_cid(alert)}" '
                f'alt="{_html_escape(alert.name)} volume change table"></p>'
            )
        )
    parts.extend(
        [
            f"<p>记录时间：{_format_record_time(notified_at, settings.timezone)}</p>",
            "</body></html>",
        ]
    )
    return "\n".join(parts)


def _render_alert_table_image(alert: AlertLog, settings: Settings) -> bytes:
    headers = ["时间", "标的代码", "标的名称", "成交额", _change_column_label(alert)]
    previous_time = _comparison_time(alert, settings)
    rows = [
        [
            _short_datetime(previous_time),
            _display_symbol(alert.symbol),
            alert.name,
            _format_amount(alert.prev_volume),
            "——",
        ],
        [
            _short_datetime(alert.candle_time),
            _display_symbol(alert.symbol),
            alert.name,
            _format_amount(alert.volume),
            _percentage_change(alert),
        ],
    ]
    return _draw_table_png(headers, rows)


def _draw_table_png(headers: list[str], rows: list[list[str]]) -> bytes:
    font = _font(13)
    bold_font = _font(13, bold=True)
    widths = [120, 86, 168, 112, 76]
    row_height = 32
    width = sum(widths) + 1
    height = row_height * (len(rows) + 1) + 1
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    x = 0
    for index, header in enumerate(headers):
        draw.rectangle([x, 0, x + widths[index], row_height], fill="#f2f2f2")
        _draw_cell_text(draw, header, x, 0, widths[index], row_height, bold_font)
        x += widths[index]

    for row_index, row in enumerate(rows, start=1):
        y = row_height * row_index
        x = 0
        for col_index, value in enumerate(row):
            cell_font = bold_font if row_index == 2 and col_index == 4 else font
            color = "#ff0000" if row_index == 2 and col_index == 4 else "#000000"
            _draw_cell_text(
                draw,
                value,
                x,
                y,
                widths[col_index],
                row_height,
                cell_font,
                color=color,
                align="right" if col_index in {3, 4} else "center",
            )
            x += widths[col_index]

    x = 0
    for col_width in widths:
        draw.line([(x, 0), (x, height)], fill="#000000", width=1)
        x += col_width
    draw.line([(width - 1, 0), (width - 1, height)], fill="#000000", width=1)
    for row_index in range(len(rows) + 2):
        y = min(row_index * row_height, height - 1)
        draw.line([(0, y), (width, y)], fill="#000000", width=1)

    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _draw_cell_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: int,
    y: int,
    width: int,
    height: int,
    font: ImageFont.ImageFont,
    color: str = "#000000",
    align: str = "center",
) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    if align == "right":
        text_x = x + width - text_width - 8 - bbox[0]
    else:
        text_x = x + (width - text_width) / 2 - bbox[0]
    text_y = y + (height - text_height) / 2 - bbox[1]
    draw.text((text_x, text_y), text, font=font, fill=color)


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        (
            "/System/Library/Fonts/STHeiti Medium.ttc"
            if bold
            else "/System/Library/Fonts/STHeiti Light.ttc"
        ),
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _alerts_table(alerts: Sequence[AlertLog]) -> list[str]:
    lines = [
        "| K线时间 | 标的 | 类型 | 级别 | 成交额 | 对比口径 | 对比成交额 | 放大倍数 | 阈值 |",
    ]
    for alert in sorted(alerts, key=lambda item: (item.candle_time, item.symbol)):
        lines.append(
            "| "
            f"{alert.candle_time:%H:%M} | "
            f"{alert.name} ({alert.symbol}) | "
            f"{_alert_type_label(alert.alert_type)}异动 | "
            f"{alert.severity} | "
            f"{_format_amount(alert.volume)} | "
            f"{_comparison_label(alert)} | "
            f"{_format_amount(alert.prev_volume)} | "
            f"{alert.ratio:.2f} 倍 | "
            f"{alert.threshold} |"
        )
    return lines


def _short_datetime(value: datetime) -> str:
    return f"{value.month}/{value.day}/{value:%y %H:%M}"


def _display_symbol(symbol: str) -> str:
    return symbol.split(".", 1)[0]


def _percentage_change(alert: AlertLog) -> str:
    return f"{round((alert.ratio - 1) * 100):.0f}%"


def _format_volume(volume: int) -> str:
    lots = volume / 100
    if volume % 100 == 0:
        return f"{int(lots):,}"
    return f"{lots:,.2f}".rstrip("0").rstrip(".")


def _format_amount(amount: float) -> str:
    if amount >= 100_000_000:
        return f"{amount / 100_000_000:.2f}亿元"
    if amount >= 10_000:
        return f"{amount / 10_000:.2f}万元"
    return f"{amount:,.2f}元".rstrip("0").rstrip(".")


def _alert_time_text(first_time: datetime, latest_time: datetime) -> str:
    if first_time == latest_time:
        return f"{first_time:%Y-%m-%d %H:%M}"
    return f"{first_time:%Y-%m-%d %H:%M} - {latest_time:%Y-%m-%d %H:%M}"


def _alert_table_cid(alert: AlertLog) -> str:
    return f"alert-table-{_display_symbol(alert.symbol)}-{alert.candle_time:%H%M}"


def _comparison_label(alert: AlertLog) -> str:
    if _uses_previous_trading_day_same_slot(alert):
        return "同比：前一交易日同时间段"
    return "环比：前一根15分钟K线"


def _change_column_label(alert: AlertLog) -> str:
    if _uses_previous_trading_day_same_slot(alert):
        return "日同比"
    return "日内环比"


def _comparison_time(alert: AlertLog, settings: Settings) -> datetime:
    db_time = _comparison_time_from_db(alert, settings)
    if db_time is not None:
        return db_time
    if _uses_previous_trading_day_same_slot(alert):
        return alert.candle_time - timedelta(days=1)
    return alert.candle_time - timedelta(minutes=15)


def _comparison_time_from_db(alert: AlertLog, settings: Settings) -> datetime | None:
    if not settings.db_path.exists():
        return None
    kline_period = settings.kline_period_for(alert.candle_time)
    if _uses_previous_trading_day_same_slot(alert):
        sql = """
            SELECT candle_time FROM candles
            WHERE symbol = ? AND kline_period = ? AND candle_time < ?
            AND substr(candle_time, 12, 5) = ?
            ORDER BY candle_time DESC
            LIMIT 1
        """
        params = (
            alert.symbol,
            kline_period,
            alert.candle_time.isoformat(),
            f"{alert.candle_time:%H:%M}",
        )
    else:
        sql = """
            SELECT candle_time FROM candles
            WHERE symbol = ? AND kline_period = ? AND candle_time < ?
            ORDER BY candle_time DESC
            LIMIT 1
        """
        params = (alert.symbol, kline_period, alert.candle_time.isoformat())
    try:
        with sqlite3.connect(settings.db_path) as connection:
            row = connection.execute(sql, params).fetchone()
    except sqlite3.Error:
        return None
    if row is None:
        return None
    return datetime.fromisoformat(row[0])


def _uses_previous_trading_day_same_slot(alert: AlertLog) -> bool:
    if "前一交易日" in alert.message:
        return True
    return (alert.candle_time.hour, alert.candle_time.minute) in {
        (9, 45),
        (13, 15),
    }


def _html_escape(value: str) -> str:
    return html.escape(value, quote=True)
