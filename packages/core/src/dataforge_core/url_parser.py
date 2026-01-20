"""URL parsing for HuggingFace datasets and generic URLs."""

import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qs, urlparse


@dataclass
class HuggingFaceURL:
    """Parsed HuggingFace dataset URL."""

    dataset_id: str  # e.g., "tatsu-lab/alpaca"
    config: Optional[str] = None  # dataset configuration/subset
    split: str = "train"  # train/validation/test
    revision: Optional[str] = None  # branch or commit

    @property
    def full_id(self) -> str:
        """Get full dataset identifier with optional config."""
        if self.config:
            return f"{self.dataset_id}/{self.config}"
        return self.dataset_id


@dataclass
class GenericDataURL:
    """Parsed generic data URL (JSON/JSONL)."""

    url: str
    format: str  # json, jsonl
    filename: Optional[str] = None


@dataclass
class ParsedURL:
    """Result of URL parsing."""

    url_type: str  # "huggingface", "generic_json", "generic_jsonl", "unknown"
    huggingface: Optional[HuggingFaceURL] = None
    generic: Optional[GenericDataURL] = None
    error: Optional[str] = None


def parse_dataset_url(url: str) -> ParsedURL:
    """
    Parse a URL to determine its type and extract relevant information.

    Supports:
    - HuggingFace dataset URLs: https://huggingface.co/datasets/{org}/{name}
    - Direct JSON/JSONL file URLs

    Examples:
        >>> parse_dataset_url("https://huggingface.co/datasets/tatsu-lab/alpaca")
        ParsedURL(url_type="huggingface", huggingface=HuggingFaceURL(dataset_id="tatsu-lab/alpaca", ...))

        >>> parse_dataset_url("https://example.com/data.jsonl")
        ParsedURL(url_type="generic_jsonl", generic=GenericDataURL(url="...", format="jsonl"))
    """
    url = url.strip()

    if not url:
        return ParsedURL(url_type="unknown", error="Empty URL")

    # Try HuggingFace URL
    hf_result = _parse_huggingface_url(url)
    if hf_result:
        return ParsedURL(url_type="huggingface", huggingface=hf_result)

    # Try generic JSON/JSONL URL
    generic_result = _parse_generic_url(url)
    if generic_result:
        return ParsedURL(url_type=f"generic_{generic_result.format}", generic=generic_result)

    return ParsedURL(url_type="unknown", error="Unrecognized URL format")


def _parse_huggingface_url(url: str) -> Optional[HuggingFaceURL]:
    """
    Parse HuggingFace dataset URL.

    Supported formats:
    - https://huggingface.co/datasets/{org}/{name}
    - https://huggingface.co/datasets/{org}/{name}/viewer/{config}/{split}
    - https://huggingface.co/datasets/{org}/{name}?split={split}
    - hf://{org}/{name}
    """
    parsed = urlparse(url)

    # Check for hf:// shorthand
    if url.startswith("hf://"):
        parts = url[5:].split("/")
        if len(parts) >= 2:
            return HuggingFaceURL(
                dataset_id=f"{parts[0]}/{parts[1]}",
                config=parts[2] if len(parts) > 2 else None,
                split=parts[3] if len(parts) > 3 else "train",
            )
        return None

    # Check for huggingface.co domain
    if "huggingface.co" not in parsed.netloc:
        return None

    # Parse path: /datasets/{org}/{name}[/viewer/{config}/{split}]
    path_parts = [p for p in parsed.path.split("/") if p]

    if len(path_parts) < 3 or path_parts[0] != "datasets":
        return None

    org = path_parts[1]
    name = path_parts[2]
    dataset_id = f"{org}/{name}"

    config = None
    split = "train"
    revision = None

    # Check for viewer path: /datasets/{org}/{name}/viewer/{config}/{split}
    if len(path_parts) >= 5 and path_parts[3] == "viewer":
        config = path_parts[4]
        if len(path_parts) >= 6:
            split = path_parts[5]

    # Check for tree path: /datasets/{org}/{name}/tree/{revision}
    if len(path_parts) >= 5 and path_parts[3] == "tree":
        revision = path_parts[4]

    # Parse query params
    query = parse_qs(parsed.query)
    if "split" in query:
        split = query["split"][0]
    if "config" in query:
        config = query["config"][0]
    if "revision" in query:
        revision = query["revision"][0]

    return HuggingFaceURL(
        dataset_id=dataset_id,
        config=config,
        split=split,
        revision=revision,
    )


def _parse_generic_url(url: str) -> Optional[GenericDataURL]:
    """
    Parse generic JSON/JSONL URL.

    Supports:
    - Direct .json file URLs
    - Direct .jsonl file URLs
    - GitHub raw URLs
    """
    parsed = urlparse(url)

    # Check for valid scheme
    if parsed.scheme not in ("http", "https"):
        return None

    path_lower = parsed.path.lower()

    # Determine format from extension
    if path_lower.endswith(".jsonl") or path_lower.endswith(".jsonlines"):
        format_type = "jsonl"
    elif path_lower.endswith(".json"):
        format_type = "json"
    else:
        # Unknown format
        return None

    # Extract filename
    filename = parsed.path.split("/")[-1] if "/" in parsed.path else None

    return GenericDataURL(
        url=url,
        format=format_type,
        filename=filename,
    )


def construct_huggingface_url(dataset_id: str, config: Optional[str] = None, split: str = "train") -> str:
    """
    Construct a HuggingFace dataset URL from components.

    Args:
        dataset_id: Dataset identifier (e.g., "tatsu-lab/alpaca")
        config: Optional dataset configuration
        split: Dataset split (default: "train")

    Returns:
        Full HuggingFace dataset URL
    """
    base_url = f"https://huggingface.co/datasets/{dataset_id}"

    if config:
        return f"{base_url}/viewer/{config}/{split}"

    return base_url
