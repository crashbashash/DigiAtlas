//! Detect MSI registration for this exact executable location; portable copies
//! elsewhere must use the browser even if another copy is installed by MSI.
use std::{
    ffi::OsString,
    os::windows::ffi::OsStringExt,
    path::{Path, PathBuf},
};
use windows_sys::Win32::System::{
    ApplicationInstallationAndServicing::{MsiEnumRelatedProductsW, MsiGetProductInfoW},
    SystemInformation::GetSystemDirectoryW,
};
const UPGRADE_CODE: &str = "{D4CF3C5F-C19D-418C-8202-9E4BFCDC0897}";
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
pub(super) fn is_msi_install() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let code = wide(UPGRADE_CODE);
    let property = wide("InstallLocation");
    for index in 0..128 {
        let mut product = [0u16; 39];
        // Safety: MSI receives a terminated GUID and its required 39-word buffer.
        let result = unsafe { MsiEnumRelatedProductsW(code.as_ptr(), 0, index, product.as_mut_ptr()) };
        if result != 0 {
            break;
        }
        let mut value = vec![0u16; 32768];
        let mut length = value.len() as u32;
        // Safety: both inputs are terminated; output capacity matches length.
        if unsafe { MsiGetProductInfoW(product.as_ptr(), property.as_ptr(), value.as_mut_ptr(), &mut length) } != 0 {
            continue;
        }
        value.truncate(length as usize);
        if value.is_empty() {
            continue;
        }
        let path = PathBuf::from(OsString::from_wide(&value));
        if super::same_install_location(&exe, &path) {
            return true;
        }
    }
    false
}
pub(super) fn launch_installer(path: &Path) -> Result<(), String> {
    let mut directory = vec![0u16; 32768];
    // Safety: the output buffer is valid for the advertised capacity.
    let count = unsafe { GetSystemDirectoryW(directory.as_mut_ptr(), directory.len() as u32) } as usize;
    if count == 0 || count >= directory.len() {
        return Err("Couldn't locate Windows Installer. Open the GitHub release page to update manually.".into());
    }
    directory.truncate(count);
    let command = PathBuf::from(OsString::from_wide(&directory)).join("msiexec.exe");
    std::process::Command::new(command)
        .arg("/i")
        .arg(path)
        .arg("/norestart")
        .spawn()
        .map(|_| ())
        .map_err(|_| "Couldn't start Windows Installer. Try again, or update from the GitHub release page.".into())
}
