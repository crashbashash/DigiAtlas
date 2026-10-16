"""Tests for the PS2 exporter. Synthetic inputs only; the disc test is opt-in.

    python3 -m unittest discover -s tests

Set DIGIATLAS_PS2_ISO to a Digimon World 4 (USA) PS2 image to also run the disc test.
"""
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from ps2_export import export, generators, iso, stats  # noqa: E402
from ps2_export.afs import Afs  # noqa: E402

try:
    import jsonschema
except ImportError:  # schema validation is optional
    jsonschema = None

SECTOR = 2048


def build_iso(path: str, files: dict[str, bytes]) -> None:
    """Write a minimal ISO9660 image: one root directory holding `files`."""
    def dir_record(name: bytes, extent: int, size: int, flags: int = 0) -> bytes:
        rec = bytearray(33 + len(name))
        rec[0] = len(rec) + (len(rec) % 2)  # records are even length
        rec = rec.ljust(rec[0], b"\0")
        struct.pack_into("<I", rec, 2, extent)
        struct.pack_into("<I", rec, 10, size)
        rec[25] = flags
        rec[32] = len(name)
        rec[33 : 33 + len(name)] = name
        return bytes(rec)

    root_extent, first_data = 18, 19
    entries, blobs, extent = [], [], first_data
    for name, data in files.items():
        entries.append(dir_record(name.encode() + b";1", extent, len(data)))
        blobs.append((extent, data))
        extent += (len(data) + SECTOR - 1) // SECTOR
    root = dir_record(b"\0", root_extent, SECTOR, 2) + dir_record(b"\1", root_extent, SECTOR, 2)
    root += b"".join(entries)
    image = bytearray(extent * SECTOR)
    pvd = bytearray(SECTOR)
    pvd[0], pvd[1:6] = 1, b"CD001"
    pvd[156 : 156 + 34] = dir_record(b"\0", root_extent, SECTOR, 2)[:34]
    image[16 * SECTOR : 17 * SECTOR] = pvd
    image[root_extent * SECTOR : root_extent * SECTOR + len(root)] = root
    for ext, data in blobs:
        image[ext * SECTOR : ext * SECTOR + len(data)] = data
    Path(path).write_bytes(bytes(image))


def build_afs(entries: list[bytes]) -> bytes:
    table_end = 8 + 8 * len(entries)
    offset = (table_end + 0x7FF) & ~0x7FF
    head, body = bytearray(b"AFS\0" + struct.pack("<I", len(entries))), bytearray()
    for data in entries:
        head += struct.pack("<II", offset + len(body), len(data))
        body += data.ljust((len(data) + 0x7FF) & ~0x7FF, b"\0")
    return bytes(head.ljust(offset, b"\0") + body)


class IsoAfsTests(unittest.TestCase):
    def test_iso_lookup_and_afs_entries(self):
        afs = build_afs([b"first", b"second entry"])
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "disc.iso")
            build_iso(path, {"SYSTEM.CNF": b"BOOT2 = cdrom0:\\SLUS_208.36;1\n", "AREA.AFS": afs})
            files = iso.list_files(path)
            self.assertEqual(set(files), {"/SYSTEM.CNF", "/AREA.AFS"})
            archive = Afs(iso.open_disc_file(path, "area.afs"))
            self.assertEqual(archive.count, 2)
            self.assertEqual(archive.entry(0), b"first")
            self.assertEqual(archive.entry(1), b"second entry")

    def test_rejects_non_iso(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "x.iso")
            Path(path).write_bytes(b"\0" * (20 * SECTOR))
            with self.assertRaises(ValueError):
                iso.list_files(path)

    def test_serial(self):
        self.assertEqual(export._serial(b"BOOT2 = cdrom0:\\SLUS_208.36;1\r\n"), "SLUS-20836")
        self.assertIsNone(export._serial(b"nothing"))


class StatsTests(unittest.TestCase):
    def entry(self, hp: dict[int, int]) -> bytes:
        data = bytearray(stats.STATS_OFFSET + 24 * stats.ROWS)
        for row, value in hp.items():
            struct.pack_into("<i", data, stats.HP_OFFSET + 4 * row, value)
        struct.pack_into("<12h", data, stats.STATS_OFFSET + 24, *range(100, 112))
        data[stats.RATES_OFFSET + 3 : stats.RATES_OFFSET + 6] = bytes([4, 5, 6])
        return bytes(data)

    def test_read_table(self):
        rows = stats.read_table(self.entry({1: 58}))
        self.assertEqual(len(rows), stats.ROWS)
        r = rows[1]
        self.assertEqual((r.hp, r.strength, r.defense, r.exp), (58, 100, 101, 111))
        self.assertEqual(r.unmapped, [105, 106, 107, 108, 109, 110])
        self.assertEqual((r.crit_rate, r.paralysis_rate, r.rarity), (4, 5, 6))
        self.assertTrue(rows[0].is_empty)

    def test_short_entry_is_rejected(self):
        with self.assertRaises(ValueError):
            stats.read_table(b"\0" * 1000)

    def test_anchors(self):
        good = {r: hp for r, hp in stats.ANCHORS}
        self.assertTrue(stats.anchors_match(stats.read_table(self.entry(good))))
        self.assertFalse(stats.anchors_match(stats.read_table(self.entry({}))))


class PoolTests(unittest.TestCase):
    def test_pool_record_parses_name_and_totals(self):
        pool = generators.DropPool(
            "hZ1gobr3", [generators.DropEntry("weapon", 0, 0, 250), generators.DropEntry("conItem", 1, 0, 1600)]
        )
        rec = export._pool_record(pool)
        self.assertEqual(rec["totalRate"], 1850)
        self.assertEqual(
            (rec["difficulty"], rec["zone"], rec["family"], rec["variant"]),
            ("hard", "Z1", "gobr", "3"),
        )

    def test_unparsed_pool_name_keeps_entries(self):
        rec = export._pool_record(generators.DropPool("comonNOTG01"))
        self.assertEqual(rec, {"entries": [], "totalRate": 0})

    def test_drop_map_by_difficulty(self):
        pools = [generators.DropPool(n) for n in ("nZ1a1", "hZ1a1", "vZ1a1")]
        self.assertEqual(
            export._drop_map(pools), {"normal": "nZ1a1", "hard": "hZ1a1", "veryhard": "vZ1a1"}
        )


@unittest.skipUnless(os.environ.get("DIGIATLAS_PS2_ISO"), "set DIGIATLAS_PS2_ISO to run")
class DiscTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)
        cls.manifest = export.export(os.environ["DIGIATLAS_PS2_ISO"], cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def load(self, name):
        return json.loads((self.out / name).read_text())

    def test_counts_and_verification(self):
        self.assertEqual(self.manifest["serial"], "SLUS-20836")
        self.assertTrue(self.manifest["source"]["statTableVerified"])
        self.assertEqual(self.manifest["counts"]["enemyRows"], 580)
        self.assertEqual(self.manifest["counts"]["stages"], 98)
        self.assertEqual(self.manifest["counts"]["stagesWithGenerators"], 85)

    def test_documented_pool_totals(self):
        # DW4_Decomp docs/systems/drop-tables.md section 2: crate pools and the guaranteed boss drop.
        pools = self.load("drops.json")["pools"]
        self.assertEqual(pools["nZ1obje1"]["totalRate"], 4330)
        self.assertEqual(pools["hZ1obje1"]["totalRate"], 6050)
        self.assertEqual(pools["vZ1obje1"]["totalRate"], 5910)
        self.assertEqual(pools["nZ1mec41"]["totalRate"], 10000)

    def test_difficulty_packs_scale_spawn_rows(self):
        # Goblin Fortress guard room: the same spawner points at stronger rows per difficulty.
        stage = {s["id"]: s for s in self.load("stages.json")["stages"]}["stagGF01"]
        rows = {d: stage["difficulties"][d]["generators"][0]["row"] for d in stage["difficulties"]}
        self.assertEqual(rows, {"hard": 6, "normal": 2, "veryhard": 10})

    @unittest.skipUnless(jsonschema, "jsonschema not installed")
    def test_output_matches_schema(self):
        for name in ("manifest", "enemies", "drops", "stages", "items"):
            schema = json.loads((ROOT / "schema" / "v1" / f"{name}.schema.json").read_text())
            jsonschema.validate(self.load(f"{name}.json"), schema)


if __name__ == "__main__":
    unittest.main()
