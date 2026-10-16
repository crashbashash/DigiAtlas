"""Minimal ISO9660 reader: locate files on the disc and open them as random-access sources."""
from __future__ import annotations

import struct
from dataclasses import dataclass

SECTOR = 2048


@dataclass(frozen=True)
class IsoFile:
    path: str
    offset: int
    size: int


class Source:
    """Random-access byte source over a file region (disc image or extracted file)."""

    def __init__(self, path: str, offset: int = 0, size: int | None = None):
        self.path = path
        self.offset = offset
        self._size = size

    @property
    def size(self) -> int:
        if self._size is None:
            import os

            self._size = os.path.getsize(self.path) - self.offset
        return self._size

    def read(self, pos: int, length: int) -> bytes:
        if pos < 0 or length < 0 or pos + length > self.size:
            raise ValueError(f"read {pos}+{length} outside {self.path} (size {self.size})")
        with open(self.path, "rb") as f:
            f.seek(self.offset + pos)
            return f.read(length)


def _walk(f, extent: int, size: int, prefix: str, out: dict[str, IsoFile]) -> None:
    f.seek(extent * SECTOR)
    data = f.read(size)
    pos = 0
    while pos < len(data):
        n = data[pos]
        if n == 0:  # records never straddle sectors
            pos = (pos // SECTOR + 1) * SECTOR
            continue
        rec = data[pos : pos + n]
        pos += n
        loc, sz = struct.unpack_from("<I", rec, 2)[0], struct.unpack_from("<I", rec, 10)[0]
        flags = rec[25]
        name = rec[33 : 33 + rec[32]]
        if name in (b"\x00", b"\x01"):
            continue
        name = name.decode("latin1").split(";")[0]
        path = f"{prefix}/{name}"
        if flags & 2:
            _walk(f, loc, sz, path, out)
        else:
            out[path.upper()] = IsoFile(path, loc * SECTOR, sz)


def list_files(iso_path: str) -> dict[str, IsoFile]:
    """Map upper-cased ``/NAME`` paths to their disc location."""
    out: dict[str, IsoFile] = {}
    with open(iso_path, "rb") as f:
        f.seek(16 * SECTOR)
        pvd = f.read(SECTOR)
        if pvd[1:6] != b"CD001":
            raise ValueError(f"{iso_path} is not an ISO9660 image")
        root = pvd[156:190]
        _walk(f, struct.unpack_from("<I", root, 2)[0], struct.unpack_from("<I", root, 10)[0], "", out)
    return out


def open_disc_file(iso_path: str, name: str) -> Source:
    files = list_files(iso_path)
    key = "/" + name.upper()
    if key not in files:
        raise FileNotFoundError(f"{name} not found on {iso_path}")
    entry = files[key]
    return Source(iso_path, entry.offset, entry.size)
