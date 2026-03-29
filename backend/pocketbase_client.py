"""
PocketBase REST API client for the trading bot.

Wraps PocketBase's auto-generated REST API using httpx.
Handles CRUD operations on collections: candles, trades, signals,
strategy_configs, bot_state.
"""

import httpx
from typing import Any, Optional
from config import settings


class PocketBaseClient:
    """Lightweight client for PocketBase REST API."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.pocketbase_url).rstrip("/")
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=30.0,
            headers={"Content-Type": "application/json"},
        )

    # ── CRUD Operations ─────────────────────────────────────────

    def create_record(self, collection: str, data: dict[str, Any]) -> dict:
        """Create a new record in a PocketBase collection."""
        response = self._client.post(
            f"/api/collections/{collection}/records",
            json=data,
        )
        response.raise_for_status()
        return response.json()

    def list_records(
        self,
        collection: str,
        page: int = 1,
        per_page: int = 50,
        sort: str = "",
        filter_str: str = "",
        expand: str = "",
    ) -> dict:
        """
        List records from a PocketBase collection with pagination.

        Args:
            collection: Collection name
            page: Page number (1-indexed)
            per_page: Records per page (max 500)
            sort: Sort field (prefix with - for DESC, e.g., "-created")
            filter_str: PocketBase filter syntax, e.g., "status='OPEN'"
            expand: Relations to expand, e.g., "strategy"
        """
        params: dict[str, Any] = {
            "page": page,
            "perPage": per_page,
        }
        if sort:
            params["sort"] = sort
        if filter_str:
            params["filter"] = filter_str
        if expand:
            params["expand"] = expand

        response = self._client.get(
            f"/api/collections/{collection}/records",
            params=params,
        )
        response.raise_for_status()
        return response.json()

    def get_record(
        self,
        collection: str,
        record_id: str,
        expand: str = "",
    ) -> dict:
        """Get a single record by ID."""
        params = {}
        if expand:
            params["expand"] = expand

        response = self._client.get(
            f"/api/collections/{collection}/records/{record_id}",
            params=params,
        )
        response.raise_for_status()
        return response.json()

    def update_record(
        self,
        collection: str,
        record_id: str,
        data: dict[str, Any],
    ) -> dict:
        """Update an existing record."""
        response = self._client.patch(
            f"/api/collections/{collection}/records/{record_id}",
            json=data,
        )
        response.raise_for_status()
        return response.json()

    def delete_record(self, collection: str, record_id: str) -> bool:
        """Delete a record by ID."""
        response = self._client.delete(
            f"/api/collections/{collection}/records/{record_id}",
        )
        response.raise_for_status()
        return True

    # ── Convenience Methods ──────────────────────────────────────

    def get_all_records(
        self,
        collection: str,
        sort: str = "",
        filter_str: str = "",
        expand: str = "",
    ) -> list[dict]:
        """Fetch ALL records from a collection (handles pagination)."""
        all_items = []
        page = 1

        while True:
            result = self.list_records(
                collection,
                page=page,
                per_page=200,
                sort=sort,
                filter_str=filter_str,
                expand=expand,
            )
            all_items.extend(result.get("items", []))

            if page >= result.get("totalPages", 1):
                break
            page += 1

        return all_items

    def get_first_record(
        self,
        collection: str,
        filter_str: str = "",
        sort: str = "",
    ) -> Optional[dict]:
        """Get the first matching record, or None."""
        result = self.list_records(
            collection,
            page=1,
            per_page=1,
            sort=sort,
            filter_str=filter_str,
        )
        items = result.get("items", [])
        return items[0] if items else None

    def upsert_by_filter(
        self,
        collection: str,
        filter_str: str,
        data: dict[str, Any],
    ) -> dict:
        """Update existing record matching filter, or create new one."""
        existing = self.get_first_record(collection, filter_str=filter_str)
        if existing:
            return self.update_record(collection, existing["id"], data)
        return self.create_record(collection, data)

    # ── Lifecycle ────────────────────────────────────────────────

    def health_check(self) -> bool:
        """Check if PocketBase is running."""
        try:
            response = self._client.get("/api/health")
            return response.status_code == 200
        except httpx.ConnectError:
            return False

    def close(self):
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


# Module-level singleton
pb = PocketBaseClient()
