"""Structured logging configuration using structlog."""

import logging
import sys
from typing import Any

import structlog

from dataforge_api.config import settings


def configure_logging() -> None:
    """Configure structured logging for the application."""

    # Configure structlog based on settings
    match settings.log_format:
        case "json":
            renderer = structlog.processors.JSONRenderer()
        case _:
            renderer = structlog.dev.ConsoleRenderer(colors=True)

    # Standard library logging configuration
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
    )

    # Configure structlog processors
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.dev.set_exc_info,
        structlog.processors.TimeStamper(fmt="iso"),
    ]

    if settings.debug:
        shared_processors.append(structlog.processors.CallsiteParameterAdder())

    structlog.configure(
        processors=shared_processors
        + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Configure formatter for standard library logging
    formatter = structlog.stdlib.ProcessorFormatter(
        processor=renderer,
    )

    # Update all existing loggers
    for handler in logging.root.handlers:
        handler.setFormatter(formatter)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Get a logger instance with the given name."""
    return structlog.get_logger(name)


def log_request_event(
    event_type: str,
    method: str,
    path: str,
    status_code: int | None = None,
    duration_ms: float | None = None,
    **kwargs: Any,
) -> None:
    """Log an HTTP request event."""
    logger = get_logger("http")
    log_data = {
        "event": event_type,
        "method": method,
        "path": path,
    }

    if status_code is not None:
        log_data["status_code"] = status_code
    if duration_ms is not None:
        log_data["duration_ms"] = round(duration_ms, 2)

    log_data.update(kwargs)

    if status_code and status_code >= 400:
        logger.error(**log_data)
    else:
        logger.info(**log_data)


def log_error(
    error: Exception,
    context: dict[str, Any] | None = None,
) -> None:
    """Log an error with context."""
    logger = get_logger("error")
    log_data = {
        "error_type": type(error).__name__,
        "error_message": str(error),
    }

    if context:
        log_data.update(context)

    logger.exception(exc_info=error, **log_data)


def log_llm_call(
    provider: str,
    model: str,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    **kwargs: Any,
) -> None:
    """Log an LLM API call."""
    logger = get_logger("llm")
    log_data = {
        "event": "llm_call",
        "provider": provider,
        "model": model,
    }

    if prompt_tokens:
        log_data["prompt_tokens"] = prompt_tokens
    if completion_tokens:
        log_data["completion_tokens"] = completion_tokens

    log_data.update(kwargs)
    logger.info(**log_data)
