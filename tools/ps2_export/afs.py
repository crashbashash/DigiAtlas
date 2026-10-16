"""CRI AFS archive reader (entries addressed by index)."""
from __future__ import annotations

import struct

from .iso import Source


class Afs:
    def __init__(self, source: Source):
        self.source = source
        head = source.read(0, 8)
        if head[:3] != b"AFS":
            raise ValueError(f"{source.path} is not an AFS archive")
        self.count = struct.unpack_from("<I", head, 4)[0]
        table = source.read(8, self.count * 8)
        self.entries = [struct.unpack_from("<II", table, 8 * i) for i in range(self.count)]

    def entry(self, index: int) -> bytes:
        offset, size = self.entries[index]
        return self.source.read(offset, size)
