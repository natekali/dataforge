"""Tests for file importers."""

import json
import pytest

from dataforge_core.importers import (
    detect_format,
    import_file,
    _import_jsonl,
    _import_json,
    _import_csv,
)


class TestDetectFormat:
    """Tests for format detection."""

    def test_detect_jsonl_by_extension(self):
        """Should detect JSONL by extension."""
        assert detect_format("data.jsonl", b"{}") == "jsonl"
        assert detect_format("data.ndjson", b"{}") == "jsonl"

    def test_detect_json_by_extension(self):
        """Should detect JSON by extension."""
        assert detect_format("data.json", b"{}") == "json"

    def test_detect_csv_by_extension(self):
        """Should detect CSV by extension."""
        assert detect_format("data.csv", b"a,b,c") == "csv"
        assert detect_format("data.tsv", b"a\tb\tc") == "csv"

    def test_detect_parquet_by_extension(self):
        """Should detect Parquet by extension."""
        assert detect_format("data.parquet", b"PAR1") == "parquet"
        assert detect_format("data.pq", b"PAR1") == "parquet"

    def test_detect_markdown_by_extension(self):
        """Should detect Markdown by extension."""
        assert detect_format("readme.md", b"# Title") == "markdown"

    def test_detect_txt_by_extension(self):
        """Should detect text by extension."""
        assert detect_format("notes.txt", b"Hello") == "txt"

    def test_detect_pdf_by_magic_bytes(self):
        """Should detect PDF by magic bytes."""
        assert detect_format("unknown", b"%PDF-1.4...") == "pdf"

    def test_detect_json_by_content(self):
        """Should detect JSON from content."""
        content = b'{"key": "value"}'
        assert detect_format("unknown.dat", content) == "json"

    def test_detect_jsonl_by_content(self):
        """Should detect JSONL from content."""
        content = b'{"a": 1}\n{"b": 2}\n{"c": 3}'
        assert detect_format("unknown.dat", content) == "jsonl"

    def test_detect_html_by_content(self):
        """Should detect HTML from content."""
        content = b"<!DOCTYPE html><html><body></body></html>"
        assert detect_format("unknown.dat", content) == "html"


class TestImportJsonl:
    """Tests for JSONL import."""

    def test_import_basic_jsonl(self):
        """Should import basic JSONL."""
        content = b'{"a": 1}\n{"a": 2}\n{"a": 3}'
        result = _import_jsonl(content)

        assert len(result) == 3
        assert result[0]["a"] == 1
        assert result[2]["a"] == 3

    def test_import_jsonl_with_empty_lines(self):
        """Should skip empty lines."""
        content = b'{"a": 1}\n\n{"a": 2}\n'
        result = _import_jsonl(content)

        assert len(result) == 2

    def test_import_jsonl_with_invalid_lines(self):
        """Should skip invalid JSON lines."""
        content = b'{"a": 1}\ninvalid\n{"a": 2}'
        result = _import_jsonl(content)

        assert len(result) == 2

    def test_import_jsonl_messages_format(self):
        """Should import ChatML format."""
        data = [
            {"messages": [{"role": "user", "content": "Hi"}]},
            {"messages": [{"role": "user", "content": "Hello"}]},
        ]
        content = "\n".join(json.dumps(d) for d in data).encode()
        result = _import_jsonl(content)

        assert len(result) == 2
        assert "messages" in result[0]


class TestImportJson:
    """Tests for JSON import."""

    def test_import_json_array(self):
        """Should import JSON array."""
        content = b'[{"a": 1}, {"a": 2}]'
        result = _import_json(content)

        assert len(result) == 2

    def test_import_json_object(self):
        """Should import single JSON object."""
        content = b'{"a": 1}'
        result = _import_json(content)

        assert len(result) == 1
        assert result[0]["a"] == 1

    def test_import_json_with_data_key(self):
        """Should extract data from HuggingFace format."""
        content = b'{"data": [{"a": 1}, {"a": 2}]}'
        result = _import_json(content)

        assert len(result) == 2


class TestImportCsv:
    """Tests for CSV import."""

    def test_import_basic_csv(self):
        """Should import basic CSV."""
        content = b"name,value\nalice,1\nbob,2"
        result = _import_csv(content)

        assert len(result) == 2
        assert result[0]["name"] == "alice"
        assert result[1]["value"] == "2"

    def test_import_tsv(self):
        """Should import TSV (tab-separated)."""
        content = b"name\tvalue\nalice\t1\nbob\t2"
        result = _import_csv(content)

        assert len(result) == 2

    def test_import_csv_with_quotes(self):
        """Should handle quoted fields."""
        content = b'name,value\n"alice, jr",1\nbob,2'
        result = _import_csv(content)

        assert result[0]["name"] == "alice, jr"


class TestImportFile:
    """Tests for import_file dispatcher."""

    def test_import_jsonl_file(self):
        """Should dispatch to JSONL importer."""
        content = b'{"x": 1}\n{"x": 2}'
        result = import_file(content, "jsonl")

        assert len(result) == 2

    def test_import_json_file(self):
        """Should dispatch to JSON importer."""
        content = b'[{"x": 1}]'
        result = import_file(content, "json")

        assert len(result) == 1

    def test_import_csv_file(self):
        """Should dispatch to CSV importer."""
        content = b"x,y\n1,2"
        result = import_file(content, "csv")

        assert len(result) == 1

    def test_import_unsupported_format(self):
        """Should raise for unsupported format."""
        with pytest.raises(ValueError, match="Unsupported format"):
            import_file(b"data", "unsupported")
