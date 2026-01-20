"""Common error definitions and user-friendly error messages."""

from typing import Any


class DataForgeError(Exception):
    """Base exception for DataForge errors."""

    def __init__(
        self,
        message: str,
        details: dict[str, Any] | None = None,
        user_message: str | None = None,
        status_code: int = 500,
    ):
        self.message = message
        self.details = details or {}
        self.user_message = user_message or self._generate_user_message()
        self.status_code = status_code
        super().__init__(self.message)

    def _generate_user_message(self) -> str:
        """Generate a user-friendly error message."""
        return "An unexpected error occurred. Please try again."

    def to_dict(self) -> dict[str, Any]:
        """Convert error to dictionary for API responses."""
        return {
            "error": self.__class__.__name__,
            "message": self.user_message,
            "details": self.details,
        }


class ValidationError(DataForgeError):
    """Validation error for user input."""

    def __init__(
        self,
        field: str,
        message: str,
        details: dict[str, Any] | None = None,
    ):
        self.field = field
        super().__init__(
            message=f"Validation error for {field}: {message}",
            details=details,
            user_message=self._generate_user_message(),
            status_code=422,
        )

    def _generate_user_message(self) -> str:
        return f"Invalid {self.field}: {self.message}"


class FileUploadError(DataForgeError):
    """Error during file upload."""

    def __init__(
        self,
        message: str,
        filename: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.filename = filename
        super().__init__(
            message=f"File upload error: {message}",
            details=details,
            user_message=self._generate_user_message(),
            status_code=400,
        )

    def _generate_user_message(self) -> str:
        if self.filename:
            return f"Failed to upload '{self.filename}': {self.message}"
        return f"Failed to upload file: {self.message}"


class ImportError(DataForgeError):
    """Error during dataset import."""

    def __init__(
        self,
        message: str,
        format_type: str | None = None,
        line_number: int | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.format_type = format_type
        self.line_number = line_number
        super().__init__(
            message=f"Import error: {message}",
            details=details,
            user_message=self._generate_user_message(),
            status_code=400,
        )

    def _generate_user_message(self) -> str:
        msg = "Failed to import dataset"
        if self.format_type:
            msg += f" ({self.format_type})"
        if self.line_number:
            msg += f" at line {self.line_number}"
        msg += f": {self.message}"
        return msg


class ExportError(DataForgeError):
    """Error during dataset export."""

    def __init__(
        self,
        message: str,
        format_type: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.format_type = format_type
        super().__init__(
            message=f"Export error: {message}",
            details=details,
            user_message=self._generate_user_message(),
            status_code=400,
        )

    def _generate_user_message(self) -> str:
        msg = "Failed to export dataset"
        if self.format_type:
            msg += f" to {self.format_type}"
        msg += f": {self.message}"
        return msg


class LLMError(DataForgeError):
    """Error during LLM operations."""

    def __init__(
        self,
        message: str,
        provider: str | None = None,
        model: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.provider = provider
        self.model = model
        super().__init__(
            message=f"LLM error: {message}",
            details=details,
            user_message=self._generate_user_message(),
            status_code=500,
        )

    def _generate_user_message(self) -> str:
        msg = "AI enhancement failed"
        if self.provider:
            msg += f" using {self.provider}"
        if self.model:
            msg += f" ({self.model})"
        msg += f": {self.message}"
        return msg


class NotFoundError(DataForgeError):
    """Resource not found error."""

    def __init__(
        self,
        resource_type: str,
        resource_id: str,
        details: dict[str, Any] | None = None,
    ):
        self.resource_type = resource_type
        self.resource_id = resource_id
        super().__init__(
            message=f"{resource_type} not found: {resource_id}",
            details=details,
            user_message=self._generate_user_message(),
            status_code=404,
        )

    def _generate_user_message(self) -> str:
        return f"Could not find {self.resource_type} '{self.resource_id}'"


class RateLimitError(DataForgeError):
    """Rate limit exceeded error."""

    def __init__(
        self,
        limit: str,
        retry_after: int | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.limit = limit
        self.retry_after = retry_after
        super().__init__(
            message=f"Rate limit exceeded: {limit}",
            details=details,
            user_message=self._generate_user_message(),
            status_code=429,
        )

    def _generate_user_message(self) -> str:
        msg = "You've made too many requests"
        if self.retry_after:
            msg += f". Please wait {self.retry_after} seconds before trying again"
        else:
            msg += ". Please slow down and try again later"
        return msg


def format_validation_errors(errors: list[tuple[str, str]]) -> str:
    """Format multiple validation errors into a user-friendly message."""
    if len(errors) == 1:
        return errors[0][1]

    messages = [f"• {field}: {msg}" for field, msg in errors]
    return "Multiple errors occurred:\n" + "\n".join(messages)


def sanitize_for_user(message: str) -> str:
    """Sanitize technical error messages for end users."""
    # Remove file paths
    import re

    sanitized = re.sub(r"[a-zA-Z]:\\[^\\]*\\|/[^/\s]*/[^/\s]*", "", message)

    # Remove stack traces
    sanitized = re.sub(
        r"Traceback \(most recent call last\):.*?^\w", "", sanitized, flags=re.MULTILINE
    )

    # Remove Python module paths
    sanitized = re.sub(r"<module>|<[^>]+>", "", sanitized)

    return sanitized.strip()
