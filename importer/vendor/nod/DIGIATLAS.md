# DigiAtlas compatibility patch

Upstream: nod 1.4.4, https://github.com/encounter/nod, commit
`df8ab228c8a8e8f906048daddc3ea07f43f18a5c` (crate directory `nod/`).
The source and normalized Cargo manifest come from the published crate. Original
MIT and Apache-2.0 license texts are retained alongside this file.

Only `src/io/wia.rs` differs from upstream:

- Permit a raw range to end within a 32 KiB processing sector when it ends
  exactly at the declared logical disc size. Other misaligned ends stay rejected.
- Include the final partial sector in range lookup.
- Read only the valid bytes of that sector, zeroing the unused internal-buffer
  tail. Short decoded data still returns an error; logical size is unchanged.

This supports RVZ/WIA images made from extended Crown Mod discs without modifying
or extracting the user's image. Synthetic regressions in `../../tests/rvz.rs`
exercise this through DigiAtlas's real source reader, including compressed data,
seeks across the final boundary, short data and invalid interior ranges.
