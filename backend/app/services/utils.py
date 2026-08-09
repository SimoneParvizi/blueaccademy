import time
from datetime import datetime
from enum import Enum

MILLISECONDS = 1000
SECONDS_IN_MINUTE = 60
MINUTES_IN_HOUR = 60
HOURS_IN_DAYS = 24
MINUTES_IN_DAY = MINUTES_IN_HOUR * HOURS_IN_DAYS
DAYS_IN_MONTH = 30
DAYS_IN_YEAR = 365


class TimeUnits(Enum):
    MINUTES = "m"
    HOURS = "h"
    DAYS = "d"

    def to_minutes(self, value: int) -> int:
        if self == TimeUnits.MINUTES:
            return value
        elif self == TimeUnits.HOURS:
            return value * MINUTES_IN_HOUR
        elif self == TimeUnits.DAYS:
            return value * MINUTES_IN_DAY
        else:
            raise ValueError(f"Unknown time unit: {self}")


def format_result(value: int, result: str) -> str:
    singular = result
    plural = f"{result}s"
    label = singular if value == 1 else plural
    return f"{value} {label}"


def display_time(total_minutes: int) -> str:
    if total_minutes < MINUTES_IN_HOUR:
        minutes = max(1, round(total_minutes))
        return format_result(minutes, "min")

    if total_minutes < MINUTES_IN_DAY:
        hours = max(1, round(total_minutes / MINUTES_IN_HOUR))
        return format_result(hours, "hour")

    days = max(1, round(total_minutes / MINUTES_IN_DAY))
    if days < DAYS_IN_MONTH:
        return format_result(days, "day")

    if days < DAYS_IN_YEAR:
        months = max(1, round(days / DAYS_IN_MONTH))
        return format_result(months, "month")

    years = round(days / DAYS_IN_YEAR)
    return format_result(years, "year")


def format_days(days: int) -> str:
    return display_time(days * MINUTES_IN_DAY)


def now_ms() -> int:
    return round(time.time() * 1000)


def datetime_start_of_day_ms() -> int:
    current = datetime.now()
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    return round(start.timestamp() * 1000)


def to_ms(time: int) -> int:
    """Minutes to milliseconds"""
    return time * SECONDS_IN_MINUTE * MILLISECONDS


def in_between(a: int, b: int) -> int:
    return max(1, round((a + b) / 2))


def abs_timestamp_ms(minutes):
    return now_ms() + to_ms(minutes)
