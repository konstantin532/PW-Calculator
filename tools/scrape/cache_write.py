"""Publish complete cache files without replacing a concurrent writer's file."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def publish_bytes(target: Path, data: bytes) -> bool:
    """Atomically create target, or leave an existing target untouched.

    A temporary file on the same filesystem is fully closed before publication.
    Windows rename and POSIX hard-link creation both fail if the name exists, so
    readers never see a partial file and the crawler's page is never replaced.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return False
    descriptor, temporary = tempfile.mkstemp(prefix=".pwcalc-publish-", dir=target.parent)
    staging = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        try:
            if os.name == "nt":
                os.rename(staging, target)
            else:
                os.link(staging, target)
        except FileExistsError:
            return False
        return True
    finally:
        staging.unlink(missing_ok=True)


def publish_text(target: Path, text: str) -> bool:
    return publish_bytes(target, text.encode("utf-8"))
