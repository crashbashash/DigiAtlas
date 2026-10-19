//! Supported PS2 boot executables, GameCube game IDs and nominal timer rates.
use std::sync::OnceLock;

use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Release {
    pub platform: &'static str,
    pub executable: &'static str,
    pub serial: &'static str,
    pub region: &'static str,
    pub frames_per_second: u32,
}

pub const RELEASES: [Release; 3] = [
    Release { platform: "ps2", executable: "SLUS_208.36", serial: "SLUS-20836", region: "usa", frames_per_second: 60 },
    Release {
        platform: "ps2",
        executable: "SLES_534.05",
        serial: "SLES-53405",
        region: "europe",
        frames_per_second: 50,
    },
    Release {
        platform: "ps2",
        executable: "SLPS_254.53",
        serial: "SLPS-25453",
        region: "japan",
        frames_per_second: 60,
    },
];

pub const GAMECUBE_RELEASES: [Release; 2] = [
    Release { platform: "gc", executable: "MAIN.DOL", serial: "GDJEB2", region: "usa", frames_per_second: 60 },
    Release { platform: "gc", executable: "MAIN.DOL", serial: "GDJJB2", region: "japan", frames_per_second: 60 },
];

pub fn from_gamecube_header(header: &[u8]) -> Result<Release> {
    GAMECUBE_RELEASES
        .iter()
        .copied()
        .find(|r| header.starts_with(r.serial.as_bytes()))
        .ok_or_else(|| Error("unsupported GameCube game ID; choose a Digimon World 4 or Digimon World X disc".into()))
}

pub fn from_system_cnf(system_cnf: &[u8]) -> Result<Release> {
    static RE: OnceLock<regex::bytes::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::bytes::Regex::new(r"(?i-u)BOOT2\s*=\s*cdrom0:\\?([A-Z]{4}_\d{3}\.\d{2})(?:;1)?").unwrap()
    });
    let captures =
        re.captures(system_cnf).ok_or_else(|| Error("SYSTEM.CNF has no supported PS2 boot executable".into()))?;
    let executable = String::from_utf8_lossy(&captures[1]);
    RELEASES.iter().copied().find(|r| r.executable.eq_ignore_ascii_case(&executable)).ok_or_else(|| {
        Error(format!("unsupported PS2 release {executable}; choose a USA, European or Japanese Digimon World 4 disc"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_gamecube_ids_and_refuses_other_games() {
        for release in GAMECUBE_RELEASES {
            assert_eq!(from_gamecube_header(release.serial.as_bytes()).unwrap(), release);
        }
        assert!(from_gamecube_header(b"GZLE01").is_err());
    }

    #[test]
    fn detects_each_supported_release_from_its_boot_path() {
        for release in RELEASES {
            let cnf = format!("BOOT2 = cdrom0:\\{};1\r\nVER = 1.00\r\nVMODE = NTSC", release.executable);
            assert_eq!(from_system_cnf(cnf.as_bytes()).unwrap(), release);
        }
        assert_eq!(from_system_cnf(b"boot2 = cdrom0:sles_534.05;1").unwrap().frames_per_second, 50);
        assert!(from_system_cnf(b"BOOT2 = cdrom0:\\SLES_000.00;1").is_err());
        assert!(from_system_cnf(b"not a PS2 boot configuration").is_err());
    }
}
