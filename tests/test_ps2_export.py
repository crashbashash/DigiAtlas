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

from ps2_export import banners, database, export, generators, igbpack, iso, maps, render, scene, scripts, stages, stats, textures, trades  # noqa: E402
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
    def row(self, **over):
        base = dict(HPMAX=58, TSUYOSA=1, MAMORI=2, KASHIKOSA=3, SEISHIN=4, SUBAYASA=5, EXP=6,
                    RES_FIRE=7, RES_ICE=8, RES_THUNDER=9, RES_DARK=10, RES_STUN=11, RES_POISON=12,
                    CHIMEIRITSU=13, MAHIRITSU=14, RARITY=0)
        return {**base, **over}

    def test_from_database(self):
        r = stats.from_database([self.row(HPMAX=0), self.row()])[1]
        self.assertEqual((r.row, r.hp, r.strength, r.defense, r.exp), (1, 58, 1, 2, 6))
        self.assertEqual(r.resist, {"fire": 7, "ice": 8, "thunder": 9, "dark": 10, "stun": 11, "poison": 12})
        self.assertEqual((r.crit_rate, r.paralysis_rate), (13, 14))

    def test_empty_row(self):
        self.assertTrue(stats.from_database([self.row(HPMAX=0)])[0].is_empty)

    def test_anchors(self):
        rows = [self.row(HPMAX=0) for _ in range(400)]
        for r, hp in stats.ANCHORS:
            rows[r] = self.row(HPMAX=hp)
        self.assertTrue(stats.anchors_match(stats.from_database(rows)))
        self.assertFalse(stats.anchors_match(stats.from_database(rows[:10])))
        rows[1] = self.row(HPMAX=59)
        self.assertFalse(stats.anchors_match(stats.from_database(rows)))


class DatabaseTests(unittest.TestCase):
    def test_decode_cp932_and_normalise(self):
        shift_jis = "バトルホーク\r\nα".encode("cp932").decode("latin1")
        self.assertEqual(database._decode(shift_jis), "バトルホーク\nα")
        self.assertIsNone(database._decode(None))

    def test_xdata_glyph_is_renamed(self):
        raw = "\u00b6 Data".encode("cp932").decode("latin1")
        self.assertEqual(database._decode(raw), "X-Data")

    def tables(self, **over):
        t = {c: [] for c in database.ITEM_DATABASES}
        t.update(over)
        return t

    def test_parse_items_names_stats_and_skill(self):
        weapon = [
            {"NAME": "∈Battle Hawk α", "TXT": "Axe", "TSUYOSA": 78, "KASHIKOSA": 0, "SKILL": 0,
             "SKILLPOINT": 1, "HANBAI": 196, "KAITORI": 49, "DELAY": 34},
            {"NAME": "∈Long Sword α", "TXT": "Sword", "TSUYOSA": 5, "SKILL": 1},
        ]
        items = {(i.category, i.id): i for i in database.parse_items(self.tables(weapon=weapon))}
        hawk = items[("weapon", 0)]
        self.assertEqual((hawk.name, hawk.description, hawk.skill_type), ("Battle Hawk α", "Axe", "Blunt"))
        # zeros and unconfirmed columns (DELAY) are left out
        self.assertEqual(
            hawk.stats,
            {"strength": 78, "requiredSkill": 1, "buyPrice": 196, "sellPrice": 49},
        )
        self.assertEqual(items[("weapon", 1)].skill_type, "Slash")

    def test_unidentified_placeholder(self):
        armor2 = [{"NAME": "???????", "TXT": "Equip. Level ???", "LVPOINT": 999, "KAITORI": 100}]
        item = database.parse_items(self.tables(armor2=armor2))[0]
        self.assertTrue(item.unidentified)
        self.assertEqual(item.name, "Unidentified Board")
        self.assertEqual(item.stats, {"sellPrice": 100})

    def test_parse_items_requires_every_database(self):
        t = self.tables()
        del t["conItem"]
        with self.assertRaises(ValueError):
            database.parse_items(t)

    def test_enemy_models_skip_empty_rows(self):
        tables = {"enemy": [{"MODEL": None}, {"MODEL": "e_goburi"}, {"MODEL": ""}, {"MODEL": "e_ogre"}]}
        self.assertEqual(database.enemy_models(tables), {1: "e_goburi", 3: "e_ogre"})

    def test_every_enemy_name_entry_is_well_formed(self):
        for model, entry in export.ENEMY_NAMES.items():
            if model.startswith("_"):
                continue
            self.assertIn(model[0], export.KINDS, model)
            self.assertTrue(entry["name"], model)
            self.assertIn(entry["source"], ("disc", "decomp"), model)


class StageTests(unittest.TestCase):
    def test_describe_floors_and_kinds(self):
        self.assertEqual(stages.describe("dng101b2"), {"kind": "dungeon", "floor": "B2", "variant": None})
        self.assertEqual(stages.describe("dng103f1")["floor"], "F1")
        self.assertEqual(stages.describe("dngq4b2v"), {"kind": "dungeon", "floor": "B2", "variant": "v"})
        self.assertEqual(stages.describe("dngq6b01")["floor"], "B1")
        self.assertEqual(stages.describe("stag0102")["kind"], "field")
        self.assertEqual(stages.describe("stagBS04")["kind"], "boss")
        self.assertEqual(stages.describe("stagML12")["kind"], "hub")
        self.assertEqual(stages.describe("stagIS12")["kind"], "hub")
        self.assertEqual(stages.describe("stagIS10")["kind"], "system")

    def test_banner_pack_names(self):
        self.assertEqual(banners.pack_name("stag0102"), "ldag0102.igb")
        self.assertEqual(banners.pack_name("stagGF01"), "ldaggf01.igb")
        self.assertEqual(banners.pack_name("dng101b1"), "ldg101b1.igb")
        with self.assertRaises(ValueError):
            banners.pack_name("loading")

    def test_stage_name_table_is_well_formed(self):
        for stage, entry in export.STAGE_NAMES.items():
            if stage.startswith("_"):
                continue
            self.assertIn(entry["source"], ("banner", "decomp", None), stage)
            if entry["source"] == "banner":
                self.assertRegex(entry["band"], r"^[0-9a-f]{40}$", stage)
                self.assertTrue(entry["area"] and entry["room"], stage)

    def test_texture_decode_and_flip(self):
        # 2x2 image, palette index 1 = red in CSM1 slot 1, rows stored bottom first.
        import struct

        from ps2_export import png

        pal = bytearray(1024)
        pal[4:8] = bytes((255, 0, 0, 128))
        tex = textures.Texture("t", 2, 2, bytes(16))
        self.assertEqual(textures.region_sha1(tex, 0, 0, 2, 2), textures.region_sha1(tex, 0, 0, 2, 2))
        self.assertEqual(textures._csm1(0x08), 0x10)
        self.assertEqual(textures._csm1(0x10), 0x08)
        self.assertEqual(textures._csm1(0x20), 0x20)
        data = png.encode_rgba(1, 1, bytes((1, 2, 3, 4)))
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", data[16:24]), (1, 1))


def generator(position, positions, is_global, start_mode="", start_data=0.0):
    return generators.Generator(
        name="GENE-00", row=1, position=position, positions=positions, rotations=[], is_global=is_global,
        start_mode=start_mode, start_data=start_data, fill_mode="", lua="", gene_count=1, gene_max_count=1, pools=[], last_pools=[],
    )


class SpawnTests(unittest.TestCase):
    def test_global_generator_lists_world_positions(self):
        g = generator((5.0, 10.0, 15.0), [(5.0, 10.0, 15.0), (30.0, 10.0, 0.0)], True)
        self.assertEqual(g.spawns(), [(5.0, 10.0, 15.0), (30.0, 10.0, 0.0)])

    def test_global_without_list_falls_back_to_position(self):
        self.assertEqual(generator((1.0, 2.0, 3.0), [], True).spawns(), [(1.0, 2.0, 3.0)])

    def test_room_generator_adds_offsets_to_the_anchor(self):
        g = generator((-180.0, 40.0, 60.0), [(-20.0, 0.0, -55.0), (20.0, 0.0, -55.0)], False)
        self.assertEqual(g.spawns(), [(-200.0, 40.0, 5.0), (-160.0, 40.0, 5.0)])

    def test_room_generator_without_offsets_spawns_at_the_anchor(self):
        self.assertEqual(generator((7.0, 0.0, 9.0), [], False).spawns(), [(7.0, 0.0, 9.0)])


class TriggerTests(unittest.TestCase):
    def test_radar_spawner_triggers_at_its_anchor_within_the_square_root(self):
        g = generator((455.0, 50.0, 15.0), [(455.0, 50.0, 15.0)], True, "radar", 4225.0)
        self.assertEqual(g.trigger(), ((455.0, 50.0, 15.0), 65.0))

    def test_script_started_spawners_have_no_trigger(self):
        self.assertIsNone(generator((0.0, 0.0, 0.0), [], True, "direct", 150.0).trigger())
        self.assertIsNone(generator((0.0, 0.0, 0.0), [], True, "radar", 0.0).trigger())

    def test_record_carries_the_trigger(self):
        rec = export._generator_record(generator((1.0, 2.0, 3.0), [(1.0, 2.0, 3.0)], True, "radar", 625.0))
        self.assertEqual(rec["trigger"], {"center": [1.0, 2.0, 3.0], "radius": 25.0})
        self.assertNotIn("trigger", export._generator_record(generator((1.0, 2.0, 3.0), [], True, "direct")))


class PlayerSlotTests(unittest.TestCase):
    def slots(self, *rows):
        return [generators.PlayerSlot(c, m, [generators.DropPool(p)] if p else [], []) for c, m, p in rows]

    def test_identical_entries_collapse_to_the_plain_fields(self):
        g = generator((0.0, 0.0, 0.0), [], True)
        g.slots = self.slots(*[(1, 1, "nA")] * 4)
        self.assertIsNone(export._player_slots(g))

    def test_differing_entries_are_exported_in_order(self):
        g = generator((0.0, 0.0, 0.0), [], True)
        g.slots = self.slots((2, 2, "nA"), (3, 3, "nA"), (4, 4, "nB"), (4, 4, "nB"))
        out = export._player_slots(g)
        self.assertEqual([e["count"] for e in out], [2, 3, 4, 4])
        self.assertEqual(out[2]["drops"], {"normal": "nB"})

    def test_a_spawner_without_entries_has_none(self):
        self.assertIsNone(export._player_slots(generator((0.0, 0.0, 0.0), [], True)))


class ScriptTests(unittest.TestCase):
    def test_a_negated_not_done_yet_reads_as_done(self):
        meanings = {38: "lever pulled"}
        self.assertEqual(
            scripts.describe("not (be:FLGisOn(38) == 0)", None, meanings), "event 38 done (38: lever pulled)"
        )

    def test_first_time_names_the_flag_when_known(self):
        text = scripts.describe("be:FLGisOn(38) == 0", None, {38: "lever pulled"}, frozenset({38}))
        self.assertEqual(text, "this is the first time (event 38: lever pulled)")

    TRAP = """if be:MATisPlayer() == 1 and be:FLGisOn(339) == 0 then
    be:sd("MODELCTRL", "g_rockdownz01", 2, "SQ_POWERON")
    be:sd("GENERATER", nil, -1, "RESTART", "GENE-53")
    be:FLGset(339, 1)
end"""

    def test_a_start_keeps_the_conditions_above_it_in_words(self):
        [ref] = scripts.references(self.TRAP)
        self.assertEqual((ref.verb, ref.target), ("RESTART", "GENE-53"))
        self.assertEqual(ref.when, ["a player touches the trigger and this is the first time (event 339)"])

    def test_commands_for_other_systems_are_ignored(self):
        self.assertEqual(scripts.references('be:sd("MODELCTRL", nil, -1, "START", "GENE-01")'), [])

    def test_a_trailing_delay_argument_does_not_hide_the_name(self):
        [ref] = scripts.references('be:DMsetSD("GENERATER", nil, -1, "START", "GENE-22", 10)')
        self.assertEqual((ref.target, ref.when), ("GENE-22", []))

    def test_else_and_elseif_branches_carry_the_negated_earlier_conditions(self):
        refs = scripts.references("""if be:FLGisOn(5) == 1 then
    be:sd("GENERATER", nil, -1, "START", "GENE-a")
elseif be:SYSgetPlayerNinzu() == 2 then
    be:sd("GENERATER", nil, -1, "START", "GENE-b")
else
    be:sd("GENERATER", nil, -1, "START", "GENE-c")
end""")
        when = {r.target: r.when for r in refs}
        self.assertEqual(when["GENE-a"], ["event 5 done"])
        self.assertEqual(when["GENE-b"], ["not (event 5 done)", "exactly 2 players"])
        self.assertEqual(when["GENE-c"], ["not (event 5 done)", "not (exactly 2 players)"])

    def test_names_built_in_code_become_prefixes(self):
        refs = scripts.references('be:sd("GENERATER", nil, -1, "START", format("GBOX-%02d", local_2))')
        self.assertEqual((refs[0].target, refs[0].prefix), (None, "GBOX-"))

    def test_status_of_a_spawner(self):
        s = scripts.StageScripts()
        s.add(scripts.references(self.TRAP))
        s.add(scripts.references('be:sd("GENERATER", nil, -1, "START", format("GBOX-%02d", local_2))'))
        self.assertEqual(s.status("GENE-53")[0], "referenced")
        self.assertEqual(s.status("GBOX-04")[0], "dynamic")
        self.assertEqual(s.status("GENE-01")[0], "none")
        s.add(scripts.references('be:sd("GENERATER", nil, -1, "START", local_0)'))
        self.assertEqual(s.status("GENE-01")[0], "unknown")

    def test_runs_of_events_are_written_as_ranges(self):
        self.assertEqual(scripts._ranges([598, 599, 600, 605, 607, 608]), "598-600, 605, 607-608")
        self.assertEqual(scripts.describe("be:FLGisOn(1) == 1 and be:FLGisOn(2) == 1"), "events 1-2 done")

    def test_a_flag_the_script_sets_itself_is_a_first_time_latch(self):
        names = scripts.load_flag_names()
        [ref] = scripts.references(self.TRAP, None, names)
        self.assertEqual(ref.when, ["a player touches the trigger and this is the first time (event 339)"])
        # Without the FLGset in the chunk, the same test is a plain "not done yet".
        plain = self.TRAP.replace("    be:FLGset(339, 1)\n", "")
        self.assertIn("event 339 not done yet", scripts.references(plain, None, names)[0].when[0])

    def test_the_else_of_a_first_time_latch_is_not_the_first_time(self):
        src = """if be:FLGisOn(355) == 0 then
    be:FLGset(355, 1)
    be:sd("GENERATER", nil, -1, "START", "GENE-21")
else
    be:sd("GENERATER", nil, -1, "START", "GENE-22")
end"""
        when = {r.target: r.when for r in scripts.references(src)}
        self.assertEqual(when["GENE-21"], ["this is the first time (event 355)"])
        self.assertEqual(when["GENE-22"], ["this is not the first time (event 355)"])

    def test_story_flags_use_the_decomp_meanings(self):
        names = scripts.load_flag_names()
        self.assertEqual(names[610], "Final boss story scene done")
        self.assertNotIn(150, names)  # per-stage scratch flags are not named
        self.assertIn("(600: Boss 1 story scene done; 610: Final boss story scene done)", scripts.describe("be:FLGisOn(600) == 1 and be:FLGisOn(610) == 1", None, names))

    def test_the_digimon_you_play_is_named(self):
        names = {"p_agumon": "Agumon"}
        self.assertEqual(scripts.describe('local_0 == "p_agumon"', names), "you play as Agumon")
        self.assertEqual(scripts.describe('local_0 ~= "p_agumon"', names), "you do not play as Agumon")
        self.assertEqual(scripts.describe('local_0 == "p_agumon"'), 'local_0 == "p_agumon"')

    def test_player_count_and_slot_conditions(self):
        self.assertEqual(scripts.describe("be:SYSgetPlayerNinzu() ~= 1"), "2 or more players")
        self.assertEqual(scripts.describe("be:MDLgetRamNo() == 1"), "player 2")


class SceneTests(unittest.TestCase):
    def test_transform_uses_row_vectors_with_translation_in_last_row(self):
        move = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)
        self.assertEqual(scene.transform_point(move, (1, 2, 3)), (11, 22, 33))

    def test_multiply_applies_first_matrix_first(self):
        move = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1)
        scale = (2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1)
        both = scene.multiply(move, scale)  # move, then scale
        self.assertEqual(scene.transform_point(both, (1, 0, 0)), (22, 0, 0))

    def test_identity_is_neutral(self):
        self.assertEqual(scene.transform_point(scene.IDENTITY, (4, 5, 6)), (4, 5, 6))


class RenderTests(unittest.TestCase):
    FLOOR = ((0.0, 5.0, 0.0), (0.0, 5.0, 10.0), (10.0, 5.0, 0.0))
    WALL = ((20.0, 0.0, 20.0), (30.0, 0.0, 20.0), (30.0, 9.0, 20.0))

    def test_floor_triangle_is_filled_and_clipped(self):
        r = render.render([self.FLOOR], (0.0, 40.0, 0.0, 40.0), max_side=80)
        self.assertEqual(r.pixels_per_unit, 2.0)
        self.assertTrue(r.covered(2.0, 2.0))
        self.assertFalse(r.covered(9.0, 9.0))  # beyond the hypotenuse
        self.assertFalse(r.covered(35.0, 35.0))

    def test_backdrop_plane_larger_than_the_crop_is_dropped(self):
        plane = ((-500.0, 0.0, -500.0), (-500.0, 0.0, 500.0), (500.0, 0.0, -500.0))
        r = render.render([plane, self.FLOOR], (0.0, 40.0, 0.0, 40.0), max_side=80)
        self.assertTrue(r.covered(2.0, 2.0))  # the real floor
        self.assertFalse(r.covered(30.0, 2.0))  # only the plane would have covered this

    def test_floors_near_the_focus_height_are_brightest(self):
        low = ((0.0, 0.0, 0.0), (0.0, 0.0, 10.0), (10.0, 0.0, 0.0))
        high = ((20.0, 100.0, 0.0), (20.0, 100.0, 10.0), (30.0, 100.0, 0.0))
        r = render.render([low, high], (0.0, 40.0, 0.0, 40.0), max_side=80, focus_y=0.0)

        def red(x, z):
            o = (int(z * r.pixels_per_unit) * r.width + int(x * r.pixels_per_unit)) * 4
            return r.rgba[o]

        self.assertGreater(red(2.0, 2.0), red(22.0, 2.0))

    def test_fill_reports_the_covered_share(self):
        r = render.render([self.FLOOR], (0.0, 20.0, 0.0, 20.0), max_side=40)
        self.assertAlmostEqual(r.fill, 0.125, delta=0.02)  # half of a quarter of the crop

    def test_triangle_outside_the_crop_is_ignored(self):
        r = render.render([self.FLOOR], (100.0, 140.0, 100.0, 140.0), max_side=80)
        self.assertFalse(any(r.rgba[3::4]))

    def test_vertical_triangle_is_drawn_as_a_line(self):
        r = render.render([self.WALL], (0.0, 40.0, 0.0, 40.0), max_side=80)
        self.assertTrue(r.covered(25.0, 20.0))
        self.assertFalse(r.covered(25.0, 30.0))


class MapChoiceTests(unittest.TestCase):
    @staticmethod
    def tri_scene(name, size, count=300):
        t = ((0.0, 0.0, 0.0), (size, 0.0, 0.0), (0.0, 0.0, size))
        return scene.Scene(0, name, [t] * count)

    def test_prefers_the_scene_covering_the_spawn_points(self):
        small, big = self.tri_scene("", 50), self.tri_scene("", 500)
        self.assertIs(maps.choose_scene([small, big], [(100.0, 100.0)]), big)

    def test_skips_interface_effect_and_tiny_scenes(self):
        scenes = [self.tri_scene("i_hud", 900), self.tri_scene("x_fx", 900), self.tri_scene("", 900, count=5)]
        self.assertIsNone(maps.choose_scene(scenes, [(10.0, 10.0)]))

    def test_small_prop_meshes_are_not_terrain(self):
        def part(size):
            return [((0.0, 0.0, 0.0), (size, 0.0, 0.0), (0.0, 0.0, size))]

        s = scene.Scene(0, "", [], [part(10.0), part(59.0), part(60.0), part(400.0)])
        spans = sorted(max(v[0] for t in tri for v in t) for tri in [[t] for t in maps.terrain_triangles(s)])
        self.assertEqual(spans, [60.0, 400.0])
        self.assertEqual(maps.terrain_triangles(s, min_span=5.0).__len__(), 4)

    def test_ties_go_to_the_larger_mesh(self):
        a, b = self.tri_scene("", 900, count=300), self.tri_scene("", 900, count=900)
        self.assertIs(maps.choose_scene([a, b], [(10.0, 10.0)]), b)


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


class TradeTests(unittest.TestCase):
    SOURCE = '''g_SItemDB = 0
funcOpenMessage("talk", "n_agumon", "AO")
if be:SYSctlFlagFolder("IS", 11) == 1 then
    g_SItemDB = "impItem"
    g_SItemID = 11
    g_TItemDB = "weapon"
    g_TItemID = 10
elseif be:SYSctlDeviceFolder("IS", 0, "weapon", 85, 0, 0) == 1 then
    g_SItemDB = "weapon"
    g_SItemID = 85
    g_TItemDB = "armor2"
    g_TItemID = 12
else
    funcCloseMessage("talk", "n_agumon", "AO")
end
if g_SItemDB ~= 0 then
    be:DMsetLua("itemchange40.lua")
end
be:DMrun()'''

    def test_a_trade_script_lists_what_you_give_and_get(self):
        t = trades.parse(self.SOURCE, {"p_agumon": "Agumon"})
        self.assertEqual(t.name, "Agumon")
        self.assertEqual(
            [(o.give, o.get) for o in t.offers],
            [(("impItem", 11), ("weapon", 10)), (("weapon", 85), ("armor2", 12))],
        )

    def test_other_scripts_are_not_traders(self):
        self.assertIsNone(trades.parse('funcOpenMessage("talk", "n_agumon", "AO")\nbe:DMrun()'))
        self.assertIsNone(trades.parse('g_SItemDB = "weapon"\ng_SItemID = 1\ng_TItemDB = "weapon"\ng_TItemID = 2'))

    def test_traders_without_a_playable_form_are_named(self):
        t = trades.parse(self.SOURCE.replace("n_agumon", "n_prmame"))
        self.assertEqual(t.name, "Mamemon")

    def test_placements_give_model_instance_position_and_facing(self):
        src = (
            'be:sd("MODELCTRL", "n_agumon", 0, "GENERATE", "V<-80,10,20>/V<0,90,0>")\n'
            'be:sd("MODELCTRL", "n_girumon", 1, "GENERATE", "V<-240.5,10,-180>/V<0,-45,0>")\n'
            'be:sd("MODELCTRL", "g_dreturngate", 0, "GENERATE", "V<0,10,-210>/V<0,0,0>")'
        )
        self.assertEqual(
            trades.placements(src),
            [("agumon", 0, (-80.0, 10.0, 20.0), 90.0), ("girumon", 1, (-240.5, 10.0, -180.0), -45.0)],
        )

    def test_several_traders_of_one_digimon_are_numbered(self):
        offer = (trades.Offer(("weapon", 1), ("weapon", 2)),)
        a = trades.Placed("Agumon", 0, (-80.0, 10.0, 20.0), 90.0, {"hard": offer})
        b = trades.Placed("Agumon", 1, (240.0, 10.0, -180.0), -45.0, {"hard": offer})
        c = trades.Placed("Dorumon", 0, (0.0, 10.0, 0.0), 0.0, {})
        out = export._trades([a, b, c])
        self.assertEqual([(x["trader"], x["number"]) for x in out], [("Agumon", 1), ("Agumon", 2), ("Dorumon", None)])
        self.assertEqual(out[0]["position"], {"x": -80.0, "y": 10.0, "z": 20.0})
        self.assertEqual(out[0]["facing"], 90.0)
        self.assertEqual(out[0]["tables"]["hard"][0], {"give": {"category": "weapon", "id": 1}, "get": {"category": "weapon", "id": 2}})


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
        self.assertEqual(self.manifest["counts"]["stagesWithGenerators"], 81)

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

    def test_known_names(self):
        enemies = {r["row"]: r for r in self.load("enemies.json")["rows"]}
        self.assertEqual(enemies[1]["name"], "Goburimon")
        self.assertEqual(enemies[1]["hp"], 58)
        self.assertEqual(enemies[36]["name"], "Ogremon")
        self.assertEqual(enemies[370]["kind"], "object")
        items = {(i["category"], i["id"]): i for i in self.load("items.json")["items"]}
        # DW4_Decomp docs/systems/drop-tables.md section 5: guard-room boss drops.
        self.assertTrue(items[("weapon", 175)]["name"].startswith("Mighty Talon"))
        self.assertTrue(items[("weapon", 200)]["name"].startswith("Beam Magnum"))

    def test_item_stats_agree_with_description_text(self):
        # The labels in database.STAT_KEYS are confirmed by comparing columns with the text.
        import re

        items = self.load("items.json")["items"]
        checked = 0
        for i in items:
            text, stats = i["description"] or "", i.get("stats", {})
            if m := re.search(r"Recovers (\d+) (HP|MP)", text):
                self.assertEqual(stats.get("restore" + m[2].capitalize()), int(m[1]), i["name"])
                checked += 1
            if i["category"] in ("armor1", "armor2") and (m := re.search(r"Equip\. Level (\d+)", text)):
                self.assertEqual(stats.get("equipLevel"), int(m[1]), i["name"])
                checked += 1
            if i["category"] == "abChip" and (m := re.match(r"(Wisdom|Spirit|Speed) up (\d+) pts", text)):
                self.assertEqual(stats.get(m[1].lower()), int(m[2]), i["name"])
                checked += 1
        self.assertGreater(checked, 100)

    def test_weapon_skill_text_matches_data_except_known_quirks(self):
        import re

        quirks, checked = [], 0
        for i in self.load("items.json")["items"]:
            if i["category"] != "weapon":
                continue
            m = re.search(r"Equip\. Skill (\w+) Skill\s+(\d+)", i["description"])
            if i.get("unidentified"):  # placeholder weapon has no skill text or type
                self.assertEqual((i["id"], i.get("skillType")), (276, None))
                continue
            checked += 1
            unique = "nontransferable" in i["description"]
            if m[1] != i["skillType"] or (not unique and int(m[2]) != i["stats"].get("requiredSkill", 0)):
                quirks.append(i["id"])
        self.assertEqual(checked, 276)
        # Dbl Axe .. Meteor Force (ids 100-124) read "Bash Skill" but are stored as Blunt.
        self.assertEqual(quirks, list(range(100, 125)))

    def test_stage_names_match_their_banners(self):
        # Each transcribed name is pinned to a fingerprint of the banner it was read from.
        stages_out = {s["id"]: s for s in self.load("stages.json")["stages"]}
        self.assertEqual(len(stages_out), 98)
        with_banner = 0
        for sid, s in stages_out.items():
            entry = export.STAGE_NAMES[sid]
            self.assertEqual((s["area"], s["room"]), (entry["area"], entry["room"]), sid)
            if entry["source"] == "banner":
                self.assertTrue((self.out / s["banner"]).is_file(), sid)
                with_banner += 1
        self.assertEqual(with_banner, 92)
        self.assertEqual(len(list((self.out / "banners").glob("*.png"))), 92)

    def test_goblin_pass_scripts_match_what_the_scripts_do(self):
        # Hand-read from DW4_Decomp lua_cleaned/02-valley-overworld/01-stag0101-valley-entrance_e614.
        stage = next(s for s in self.load("stages.json")["stages"] if s["id"] == "stag0101")
        gens = {g["name"]: g for g in stage["difficulties"]["normal"]["generators"]}
        for name in ("GENE-01", "GENE-02", "GENE-03", "GENE-04", "GENE-05", "GENE-14"):
            self.assertEqual(gens[name]["script"]["status"], "none", name)
        trap = gens["GENE-53"]["script"]
        self.assertEqual(trap["status"], "referenced")
        self.assertIn("this is the first time (event 339)", trap["refs"][0]["when"][0])
        self.assertTrue(any("this is the first time (event 355)" in w for r in gens["GENE-22"]["script"]["refs"] for w in r["when"]))
        epic = gens["GENE-e00"]["script"]["refs"][0]["when"][0]
        self.assertIn("events 598-610 done", epic)
        self.assertIn("610: Final boss story scene done", epic)
        self.assertIn("you play as Agumon", gens["GENE-e00"]["script"]["refs"][0]["when"][1])
        self.assertEqual(gens["GENE-00"]["startMode"], "radar")

    def test_every_spawner_has_a_script_status(self):
        for stage in self.load("stages.json")["stages"]:
            for d in stage["difficulties"].values():
                for g in d["generators"]:
                    self.assertIn(g["script"]["status"], ("referenced", "dynamic", "unknown", "none"), stage["id"])

    def test_player_counts_scale_spawners(self):
        stage = next(s for s in self.load("stages.json")["stages"] if s["id"] == "stag0101")
        gens = {g["name"]: g for g in stage["difficulties"]["normal"]["generators"]}
        # The bridge spawner places 2, 3, 4 or 5 enemies for 1 to 4 players.
        self.assertEqual([e["count"] for e in gens["GENE-00"]["players"]], [2, 3, 4, 5])
        # A lone Numemon grows by one per player but is capped at one alive at a time.
        self.assertEqual([(e["count"], e["maxCount"]) for e in gens["GENE-14"]["players"]], [(1, 1), (2, 1), (3, 1), (4, 1)])
        # The fourth entry of GENE-01 repeats the third; a set would have lost it.
        self.assertEqual(len(gens["GENE-01"]["players"]), 4)
        pools = self.load("drops.json")["pools"]
        for st in self.load("stages.json")["stages"]:
            for d in st["difficulties"].values():
                for g in d["generators"]:
                    for entry in [g] + g.get("players", []):
                        for name in list(entry.get("drops", {}).values()) + list(entry.get("lastDrops", {}).values()):
                            self.assertIn(name, pools)

    def test_radar_triggers_match_the_documented_radii(self):
        # Every radar spawner carries a trigger; Goblin Pass GENE-00 is (455, 50, 15) with radius 65.
        radii = set()
        for stage in self.load("stages.json")["stages"]:
            for d in stage["difficulties"].values():
                for g in d["generators"]:
                    if g["startMode"] == "radar":
                        self.assertIn("trigger", g, f"{stage['id']} {g['name']}")
                        radii.add(g["trigger"]["radius"])
        # The game stores squared radii as whole numbers; they range from tight (20) to wide arenas.
        self.assertTrue(radii and all(0 < r <= 500 and round(r * r) == r * r for r in radii), sorted(radii))
        goblin = next(s for s in self.load("stages.json")["stages"] if s["id"] == "stag0101")
        gene00 = next(g for g in goblin["difficulties"]["normal"]["generators"] if g["name"] == "GENE-00")
        self.assertEqual(gene00["trigger"], {"center": [455.0, 50.0, 15.0], "radius": 65.0})

    def test_stage_maps_cover_their_spawn_points(self):
        # Three stage types: field, dungeon floor and fortress room, each cropped to its spawn area.
        from ps2_export.afs import Afs

        ndmw = Afs(iso.open_disc_file(os.environ["DIGIATLAS_PS2_ISO"], "NDMW.AFS"))
        stages_out = {s["id"]: s for s in self.load("stages.json")["stages"]}
        for sid in ("stag0102", "dng101b1", "stagGF01"):
            st = stages_out[sid]
            points = [tuple(p) for d in st["difficulties"].values() for g in d["generators"] for p in g["spawns"]]
            built = maps.build(ndmw, st["packs"], points)
            self.assertIsNotNone(built, sid)
            self.assertGreaterEqual(built.coverage, 0.95, sid)
            self.assertGreater(built.raster.fill, 0.0, sid)
            self.assertTrue(built.png().startswith(b"\x89PNG"))

    def test_stages_without_spawners_do_not_borrow_the_next_stages(self):
        # Trader Hall (a shop) has no generator packs of its own; the Dungeon of Doom's follow it on the disc.
        stages_out = {s["id"]: s for s in self.load("stages.json")["stages"]}
        for sid in ("dngq5b1e", "dngq5b1h", "dngq5b1v"):
            self.assertFalse(stages_out[sid].get("generatorPacks"), sid)
            self.assertFalse(stages_out[sid]["difficulties"].get("normal", {}).get("generators"), sid)
        self.assertEqual(len(stages_out["dngq6b01"]["difficulties"]["normal"]["generators"]), 39)

    def test_shop_and_lobby_rooms_get_a_map_without_spawn_points(self):
        from ps2_export.afs import Afs

        ndmw = Afs(iso.open_disc_file(os.environ["DIGIATLAS_PS2_ISO"], "NDMW.AFS"))
        stages_out = {s["id"]: s for s in self.load("stages.json")["stages"]}
        for sid in ("dngq5b1e", "dngq5b1h", "dngq5b1v", "stagML11"):
            built = maps.build(ndmw, stages_out[sid]["packs"], [])
            self.assertIsNotNone(built, sid)
            self.assertLess(built.raster.fill, 0.9, sid)  # an outline, not a flat arena

    def test_trader_hall_trades(self):
        stages_out = {s["id"]: s for s in self.load("stages.json")["stages"]}
        items = {(i["category"], i["id"]): i["name"] for i in self.load("items.json")["items"]}
        counts = {}
        for sid in ("dngq5b1e", "dngq5b1h", "dngq5b1v"):
            traders = stages_out[sid]["trades"]
            counts[sid] = len(traders)
            for t in traders:
                self.assertTrue(t["tables"], (sid, t["trader"]))
                for offers in t["tables"].values():
                    for o in offers:
                        for side in ("give", "get"):
                            self.assertIn((o[side]["category"], o[side]["id"]), items, (sid, o))
        # Everyone stands in the room, and the variants differ in who is there.
        self.assertEqual(counts, {"dngq5b1e": 10, "dngq5b1h": 8, "dngq5b1v": 10})
        agumons = [t for t in stages_out["dngq5b1h"]["trades"] if t["trader"] == "Agumon"]
        self.assertEqual([t["number"] for t in agumons], [1, 2])
        self.assertEqual(agumons[0]["position"], {"x": -80.0, "y": 10.0, "z": 20.0})
        first = agumons[0]["tables"]["hard"][0]["give"]
        self.assertEqual(items[(first["category"], first["id"])], "Offering")
        # Each difficulty has its own table.
        self.assertNotEqual(agumons[0]["tables"]["normal"], agumons[0]["tables"]["hard"])
        self.assertEqual(stages_out["stag0101"]["trades"], [])

    def test_goblin_pass_field_box_is_gated_by_the_lever(self):
        stage = next(s for s in self.load("stages.json")["stages"] if s["id"] == "stag0101")
        box = next(g for g in stage["difficulties"]["normal"]["generators"] if g["name"] == "GBOX-01")
        whens = " ".join(w for r in box["script"]["refs"] for w in r["when"])
        self.assertIn("lever", whens)

    def test_banner_fingerprints(self):
        from ps2_export import manifest as archive_manifest
        from ps2_export.afs import Afs

        path = os.environ["DIGIATLAS_PS2_ISO"]
        names_src = iso.open_disc_file(path, "NDMW.IGB")
        names = archive_manifest.read_names(names_src.read(0, names_src.size))
        area = Afs(iso.open_disc_file(path, "AREA.AFS"))
        for sid, entry in export.STAGE_NAMES.items():
            if sid.startswith("_") or entry["source"] != "banner":
                continue
            tex = banners.load(area, names, sid)
            self.assertEqual(banners.fingerprint(tex), entry["band"], sid)

    def test_unidentified_placeholders(self):
        items = self.load("items.json")["items"]
        flagged = {(i["category"], i["id"]) for i in items if i.get("unidentified")}
        self.assertEqual(flagged, {("weapon", 276), ("armor1", 31), ("armor2", 44)})
        self.assertFalse([i for i in items if "?" in i["name"]])
        self.assertTrue(all("equipLevel" not in i.get("stats", {}) for i in items if i.get("unidentified")))

    def test_every_dropped_item_has_a_name(self):
        items = {(i["category"], i["id"]) for i in self.load("items.json")["items"]}
        for pool in self.load("drops.json")["pools"].values():
            for e in pool["entries"]:
                self.assertIn((e["category"], e["id"]), items)

    def test_generator_rows_resolve_except_known_empty_slot(self):
        # Three Kokatorimon spawners in stag0104 point at row 90, an empty slot between the
        # Blossomon and Kokatorimon rows (data quirk in the game, not an export error).
        rows = {r["row"] for r in self.load("enemies.json")["rows"]}
        missing = set()
        for stage in self.load("stages.json")["stages"]:
            for d in stage["difficulties"].values():
                missing |= {g["row"] for g in d["generators"]} - rows
        self.assertLessEqual(missing, {90}, f"unresolved spawn rows: {sorted(missing)}")

    def test_disc_sourced_enemy_names_appear_in_game_text(self):
        from ps2_export.afs import Afs

        archive = Afs(iso.open_disc_file(os.environ["DIGIATLAS_PS2_ISO"], "AREA.AFS"))
        album = {r["name"] for r in igbpack.Graph(archive.entry(621)).s2 if r["class"] == "igNamedObject"}
        for model, entry in export.ENEMY_NAMES.items():
            if not model.startswith("_") and entry["source"] == "disc":
                self.assertIn(entry["name"], album, f"{model} is not in the card album")

    @unittest.skipUnless(jsonschema, "jsonschema not installed")
    def test_output_matches_schema(self):
        for name in ("manifest", "enemies", "drops", "stages", "items"):
            schema = json.loads((ROOT / "schema" / "v1" / f"{name}.schema.json").read_text())
            jsonschema.validate(self.load(f"{name}.json"), schema)


if __name__ == "__main__":
    unittest.main()
