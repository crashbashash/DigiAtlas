param(
  [Parameter(Mandatory)][string]$SourceRoot,
  [Parameter(Mandatory)][string]$Repository,
  [Parameter(Mandatory)][string]$FromVersion,
  [Parameter(Mandatory)][string]$ToVersion
)
$ErrorActionPreference = 'Stop'
if ($FromVersion -notmatch '^v\d+\.\d+\.\d+$' -or $ToVersion -notmatch '^v\d+\.\d+\.\d+$') {
  throw 'Use stable release tags such as v0.1.0.'
}
$from = $FromVersion.Substring(1)
$to = $ToVersion.Substring(1)
$work = Join-Path $env:RUNNER_TEMP 'digiatlas-update-smoke'
New-Item -ItemType Directory -Force $work | Out-Null
$headers = @{ 'User-Agent' = 'DigiAtlas-update-smoke'; Accept = 'application/vnd.github+json' }
# Intentionally anonymous: this is the same public access required by installed apps.
$release = Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/tags/$FromVersion" -Headers $headers
$asset = @($release.assets | Where-Object name -eq "digiatlas-$from-windows-x86_64.msi")
if ($asset.Count -ne 1) { throw 'Expected one released Windows installer.' }
$initialMsi = Join-Path $work 'initial.msi'
Invoke-WebRequest $asset[0].browser_download_url -OutFile $initialMsi -Headers $headers
$hash = (Get-FileHash $initialMsi -Algorithm SHA256).Hash.ToLowerInvariant()
if ($asset[0].digest -ne "sha256:$hash" -or (Get-Item $initialMsi).Length -ne $asset[0].size) {
  throw 'Initial release installer failed verification.'
}
function Install-Msi([string]$path, [string]$log) {
  $arguments = @('/i', "`"$path`"", '/qn', '/norestart', '/l*v', "`"$log`"")
  $process = Start-Process "$env:WINDIR/System32/msiexec.exe" -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) { throw "Windows Installer failed with code $($process.ExitCode)." }
}
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class MsiSmokeProduct {
  public string Code;
  public string Version;
  public string Location;
}
public static class MsiSmoke {
  [DllImport("msi.dll", CharSet=CharSet.Unicode)]
  static extern uint MsiEnumRelatedProducts(string code, uint reserved, uint index, StringBuilder product);
  [DllImport("msi.dll", CharSet=CharSet.Unicode)]
  static extern uint MsiGetProductInfo(string code, string property, StringBuilder value, ref uint length);
  static string Info(string code, string property) {
    var b = new StringBuilder(32768); uint length=32768;
    uint result=MsiGetProductInfo(code,property,b,ref length);
    if(result!=0) throw new Exception("MSI property query failed: "+result);
    return b.ToString();
  }
  public static MsiSmokeProduct[] Related() {
    var products=new List<MsiSmokeProduct>();
    for(uint i=0;i<128;i++) {
      var code=new StringBuilder(39);
      uint result=MsiEnumRelatedProducts("{D4CF3C5F-C19D-418C-8202-9E4BFCDC0897}",0,i,code);
      if(result==259) break;
      if(result!=0) throw new Exception("MSI enumeration failed: "+result);
      products.Add(new MsiSmokeProduct {Code=code.ToString(), Version=Info(code.ToString(),"VersionString"), Location=Info(code.ToString(),"InstallLocation")});
    }
    return products.ToArray();
  }
}
'@
Install-Msi $initialMsi (Join-Path $work 'initial-install.log')
$installed = @([MsiSmoke]::Related())
if ($installed.Count -ne 1 -or $installed[0].Version -ne $from -or !$installed[0].Location) {
  throw 'The initial MSI did not register its version and installation location.'
}
$updateSource = Join-Path $SourceRoot 'src-tauri/src/updates.rs'
$source = [IO.File]::ReadAllText($updateSource)
# This test runs the old release's actual fetch, installation detection and download verifier.
# Its executable is placed beside the registered app so portable-copy detection is exercised.
$test = @'
    #[test]
    #[ignore = "requires the installed previous release and public GitHub releases"]
    fn public_update_smoke() {
        assert!(windows::is_msi_install(), "registered installation was not detected");
        let current = Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
        let expected = std::env::var("DIGIATLAS_UPDATE_SMOKE_VERSION").unwrap();
        let prepared = fetch(&current, true).unwrap().expect("no newer update was offered");
        assert_eq!(prepared.offer.current_version, current.to_string());
        assert_eq!(prepared.offer.version, expected);
        assert_eq!(prepared.offer.method, "msi");
        assert!(!prepared.offer.releases.is_empty());
        assert!(prepared.offer.releases.iter().all(|r| !r.notes.trim().is_empty()));
        let asset = prepared.installer.expect("verified MSI asset was not selected");
        assert_eq!(asset.name, format!("digiatlas-{}-windows-x86_64.msi", expected));
        let destination = std::path::PathBuf::from(std::env::var("DIGIATLAS_UPDATE_SMOKE_MSI").unwrap());
        download(&asset, &destination).unwrap();
    }
'@
$end = $source.LastIndexOf('}')
if ($end -lt 0) { throw 'Updater test module was not found.' }
[IO.File]::WriteAllText($updateSource, $source.Insert($end, $test))
$buildLines = & cargo test --manifest-path (Join-Path $SourceRoot 'src-tauri/Cargo.toml') --locked --no-run --message-format=json
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the released updater test.' }
$testExecutables = @($buildLines | ForEach-Object {
  try { $entry = $_ | ConvertFrom-Json -ErrorAction Stop } catch { return }
  if ($entry.reason -eq 'compiler-artifact' -and $entry.target.name -eq 'digiatlas' -and $entry.profile.test -and $entry.executable) { $entry.executable }
})
if ($testExecutables.Count -ne 1) { throw 'Expected one native updater test executable.' }
$testExe = Join-Path $installed[0].Location 'updater-smoke.exe'
Copy-Item $testExecutables[0] $testExe
$downloaded = Join-Path $work 'update.msi'
$env:DIGIATLAS_UPDATE_SMOKE_VERSION = $to
$env:DIGIATLAS_UPDATE_SMOKE_MSI = $downloaded
& $testExe --exact updates::tests::public_update_smoke --ignored --nocapture
if ($LASTEXITCODE -ne 0) { throw 'The installed updater failed its public check or verified download.' }
Install-Msi $downloaded (Join-Path $work 'upgrade-install.log')
$upgraded = @([MsiSmoke]::Related())
if ($upgraded.Count -ne 1 -or $upgraded[0].Version -ne $to) { throw 'The MSI upgrade did not replace the previous product registration.' }
$exe = Join-Path $upgraded[0].Location 'digiatlas.exe'
$version = (Get-Item $exe).VersionInfo.ProductVersion
if (!$version.StartsWith($to)) { throw "Installed executable has the wrong version: $version" }
@{ from=$from; to=$to; anonymousUpdateCheck=$true; msiInstallDetected=$true; verifiedUpdaterDownload=$true; msiUpgrade=$true; installedVersion=$version } |
  ConvertTo-Json | Set-Content (Join-Path $work 'result.json')
Write-Output "Verified installed updater download and Windows MSI upgrade from $from to $to."
