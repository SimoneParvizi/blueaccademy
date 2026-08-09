import json
import logging
import sys
from datetime import datetime


class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "asctime": datetime.fromtimestamp(record.created).strftime("%d-%m-%Y %H:%M:%S"),
            "levelname": record.levelname,
            "func_name": f"{record.funcName}::{record.lineno}",
            "message": record.getMessage(),
        }
        return json.dumps(log_entry)


def configure_logging():
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    logging.basicConfig(
        level=logging.INFO,
        handlers=[handler],
    )
