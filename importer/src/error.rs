use std::fmt;

/// An import failure, with a message a person can act on.
#[derive(Debug, Clone, PartialEq)]
pub struct Error(pub String);

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error(e.to_string())
    }
}

/// `Err(Error(...))` with `format!` arguments.
#[macro_export]
macro_rules! fail {
    ($($arg:tt)*) => {
        return Err($crate::error::Error(format!($($arg)*)))
    };
}
