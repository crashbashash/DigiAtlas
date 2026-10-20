//! DigiAtlas importer: reads a Digimon World 4 PS2 or GameCube disc image and writes DigiAtlas data
//! (schema v1, see docs/schema.md). It began as a port of a Python exporter and was checked to
//! write the same data, byte for byte and pixel for pixel; comments that mention Python explain
//! details of the output that come from it.

pub mod error;
pub mod pyfmt;

pub mod afs;
pub mod banners;
pub mod database;
pub mod gamecube;
pub mod generators;
pub mod igb;
pub mod iso;
pub mod manifest;
pub mod png;
pub mod stages;
pub mod stats;
pub mod textures;

pub mod appraisal;
pub mod attack_profiles;
pub mod crown_signature;
pub mod landmarks;
pub mod luadec;
pub mod maps;
pub mod mp_techs;
pub mod power_spells;
pub mod regions;
pub mod render;
pub mod scene;
pub mod scripts;
pub mod services;
pub mod trades;

pub mod export;
pub mod names;

pub use error::{Error, Result};
pub use export::{export, Progress, IMPORTER_VERSION, STACK_SIZE};
