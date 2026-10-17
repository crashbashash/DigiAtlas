//! Number handling that matches the original Python exporter exactly, so both write the same data.

/// Python's `round(x, digits)`: the exact binary value rounded to `digits` decimals, ties to even.
/// Rust's fixed-precision formatting rounds the same way.
pub fn round(x: f64, digits: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    format!("{x:.digits$}").parse().unwrap_or(x)
}

/// Python's `round(x)`: to the nearest integer, ties to even.
pub fn round_int(x: f64) -> i64 {
    round(x, 0) as i64
}

/// Python's `repr(float)`: the shortest digits that round-trip, in fixed notation for exponents
/// from -4 to 15 and scientific notation (`1e-05`, `1.5e+16`) otherwise.
pub fn repr(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "inf".into() } else { "-inf".into() };
    }
    if x == 0.0 {
        return if x.is_sign_negative() { "-0.0".into() } else { "0.0".into() };
    }
    // `{:e}` gives the shortest round-trip digits as d[.ddd]e<exp>.
    let sci = format!("{x:e}");
    let (mantissa, exp) = sci.split_once('e').expect("scientific format");
    let exp: i32 = exp.parse().expect("exponent");
    let negative = mantissa.starts_with('-');
    let digits: String = mantissa.chars().filter(|c| c.is_ascii_digit()).collect();
    let sign = if negative { "-" } else { "" };
    if (-4..16).contains(&exp) {
        let point = exp + 1; // digits before the decimal point
        let body = if point <= 0 {
            format!("0.{}{}", "0".repeat((-point) as usize), digits)
        } else if point as usize >= digits.len() {
            format!("{}{}.0", digits, "0".repeat(point as usize - digits.len()))
        } else {
            format!("{}.{}", &digits[..point as usize], &digits[point as usize..])
        };
        format!("{sign}{body}")
    } else {
        let tail = if digits.len() > 1 { format!(".{}", &digits[1..]) } else { String::new() };
        let esign = if exp < 0 { '-' } else { '+' };
        format!("{sign}{}{tail}e{esign}{:02}", &digits[..1], exp.abs())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_like_python() {
        assert_eq!(round(0.125, 2), 0.12);
        assert_eq!(round(0.375, 2), 0.38);
        assert_eq!(round(2.675, 2), 2.67);
        assert_eq!(round(123.45675, 4), 123.4567);
        assert_eq!(round_int(2.5), 2);
        assert_eq!(round_int(1.5), 2);
        assert_eq!(round_int(-0.125), 0);
    }

    #[test]
    fn prints_floats_like_python_repr() {
        assert_eq!(repr(0.1), "0.1");
        assert_eq!(repr(1e-5), "1e-05");
        assert_eq!(repr(1.5e16), "1.5e+16");
        assert_eq!(repr(1e15), "1000000000000000.0");
        assert_eq!(repr(-0.3333333432674408), "-0.3333333432674408");
        assert_eq!(repr(0.0001), "0.0001");
        assert_eq!(repr(123.0), "123.0");
        assert_eq!(repr(-2.5e-7), "-2.5e-07");
    }
}
