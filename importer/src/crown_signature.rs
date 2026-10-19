//! Crown Mod's v1 logical-disc footer. Format: DW4_Crown_Mod/docs/image-signature.md.
use crate::{iso::Source, Error, Result};
use serde_json::Value;
const SIZE: usize = 2048;
const MAGIC: &[u8; 32] = b"DW4_CROWN_MOD_SIGNATURE\0\0\0\0\0\0\0\0\0";

pub fn read(disc: &Source) -> Result<Option<Value>> {
    let start = disc.size().saturating_sub((2 * 1024 * 1024 + SIZE) as u64) / SIZE as u64 * SIZE as u64;
    let tail = disc.read(start, disc.size() - start)?;
    decode_tail(&tail)
}

fn decode_tail(tail: &[u8]) -> Result<Option<Value>> {
    for sector in (0..tail.len() / SIZE).rev() {
        let at = sector * SIZE;
        let b = &tail[at..at + SIZE];
        if &b[..32] != MAGIC {
            continue;
        }
        let fail = || Error("Crown Mod identification data is damaged or unsupported".into());
        if u32::from_le_bytes(b[32..36].try_into().unwrap()) != 1 {
            return Err(fail());
        }
        let len = u32::from_le_bytes(b[36..40].try_into().unwrap()) as usize;
        if len == 0 || len > SIZE - 64 {
            return Err(fail());
        }
        let payload = &b[64..64 + len];
        if sha1_smol::Sha1::from(payload).digest().bytes() != b[40..60] {
            return Err(fail());
        }
        let value: Value = serde_json::from_slice(payload).map_err(|_| fail())?;
        if value["formatVersion"] != 1
            || value["id"] != "dw4-crown-mod"
            || !value["version"].is_string()
            || !value["options"].is_object()
        {
            return Err(fail());
        }
        let ps2 =
            value["platform"] == "ps2" && crate::regions::RELEASES.iter().any(|r| value["release"] == r.executable);
        let gc = value["platform"] == "gc"
            && crate::regions::GAMECUBE_RELEASES.iter().any(|r| value["release"] == r.serial[..4]);
        if !ps2 && !gc {
            return Err(Error("Crown Mod signature does not identify a supported PS2 or GameCube image".into()));
        }
        return Ok(Some(value));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn block() -> Vec<u8> {
        block_for("SLUS_208.36")
    }
    fn block_for(release: &str) -> Vec<u8> {
        block_for_platform("ps2", release)
    }
    fn block_for_platform(platform: &str, release: &str) -> Vec<u8> {
        let value = serde_json::json!({"formatVersion":1,"id":"dw4-crown-mod","version":"0.11.0","platform":platform,"release":release,"options":{"randomCrownColours":true}});
        let json = serde_json::to_vec(&value).unwrap();
        let mut b = vec![0; SIZE];
        b[..32].copy_from_slice(MAGIC);
        b[32..36].copy_from_slice(&1u32.to_le_bytes());
        b[36..40].copy_from_slice(&(json.len() as u32).to_le_bytes());
        b[40..60].copy_from_slice(&sha1_smol::Sha1::from(&json).digest().bytes());
        b[64..64 + json.len()].copy_from_slice(&json);
        b
    }
    #[test]
    fn reads_version_options_and_padding() {
        let mut data = vec![0; SIZE];
        data.extend(block());
        data.extend(vec![0; SIZE * 2]);
        let value = decode_tail(&data).unwrap().unwrap();
        assert_eq!(value["version"], "0.11.0");
        assert_eq!(value["options"]["randomCrownColours"], true);
        assert_eq!(decode_tail(&vec![0; SIZE]).unwrap(), None);
    }
    #[test]
    fn accepts_signatures_for_each_supported_ps2_release() {
        for release in crate::regions::RELEASES {
            assert_eq!(decode_tail(&block_for(release.executable)).unwrap().unwrap()["release"], release.executable);
        }
        assert!(decode_tail(&block_for("SLES_000.00")).is_err());
    }
    #[test]
    fn accepts_signatures_for_supported_gamecube_releases() {
        for release in crate::regions::GAMECUBE_RELEASES {
            let value = decode_tail(&block_for_platform("gc", &release.serial[..4])).unwrap().unwrap();
            assert_eq!(value["platform"], "gc");
        }
    }
    #[test]
    fn refuses_corruption_and_unknown_formats() {
        let mut data = block();
        data[90] ^= 1;
        assert!(decode_tail(&data).is_err());
        let mut data = block();
        data[32] = 2;
        assert!(decode_tail(&data).is_err());
        let mut data = block();
        data[36..40].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode_tail(&data).is_err());
    }
}
