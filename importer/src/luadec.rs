//! Lua 4.0.1 bytecode decompiler for the scripts inside DW4 stage packs.
//! Port of tools/ps2_export/luadec.py; must produce the same source text.

use crate::error::Result;

/// A parsed Lua function prototype.
#[derive(Debug, Clone)]
pub struct Function {
    pub numparams: i32,
    pub is_vararg: u8,
    pub kstr: Vec<Option<String>>,
    pub knum: Vec<f64>,
    pub kproto: Vec<Function>,
    pub code: Vec<u32>,
}

/// Parse the chunk starting at `off`: (main function, chunk size in bytes).
pub fn parse_chunk(_data: &[u8], _off: usize) -> Result<(Function, usize)> {
    todo!("port luadec.parse_chunk")
}

/// Decompiled source of a function (statements joined with newlines, four-space indents).
pub fn decompile_function_source(_function: &Function) -> Result<String> {
    todo!("port luadec.decompile_function_source")
}

/// Every Lua chunk in a pack as (offset, source), in file order. Unreadable chunks are skipped.
pub fn decompile_chunks(_blob: &[u8]) -> Vec<(usize, String)> {
    todo!("port luadec.decompile_chunks")
}
