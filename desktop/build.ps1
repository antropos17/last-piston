param([switch]$Models)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$out = Join-Path $root 'dist/Last Piston'
$app = Join-Path $out 'app'
New-Item $app -ItemType Directory -Force | Out-Null
Push-Location $PSScriptRoot
try {
    if (!(Test-Path 'node_modules/esbuild')) { npm ci --no-fund --no-audit; if ($LASTEXITCODE) { throw 'npm ci' } }
    if ($Models -or (1..4 | Where-Object { !(Test-Path "$app/motor-$_.glb") })) {
        node models.cjs; if ($LASTEXITCODE) { throw 'Exporting motors' }
    }
    node bundle.cjs
    if ($LASTEXITCODE) { throw 'Bundling simulator' }
    $version = '1.0.3296.44'
    $sdk = Join-Path ([IO.Path]::GetTempPath()) "last-piston-webview-$version"
    if (!(Test-Path "$sdk/lib/net462/Microsoft.Web.WebView2.WinForms.dll")) {
        $archive = "$sdk.zip"
        Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg" -OutFile $archive
        Expand-Archive -LiteralPath $archive -DestinationPath $sdk -Force
    }
    foreach ($name in 'Core','WinForms') { Copy-Item "$sdk/lib/net462/Microsoft.Web.WebView2.$name.dll" $out -Force }
    Copy-Item "$sdk/runtimes/win-x64/native/WebView2Loader.dll" $out -Force
    Copy-Item "$sdk/LICENSE.txt" "$out/WebView2-LICENSE.txt" -Force
    Copy-Item "$sdk/NOTICE.txt" "$out/WebView2-NOTICE.txt" -Force
    $csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $csc /nologo /target:winexe /platform:x64 "/out:$out/Last Piston.exe" /win32manifest:workshop.manifest /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/reference:$out/Microsoft.Web.WebView2.WinForms.dll" "/reference:$out/Microsoft.Web.WebView2.Core.dll" Program.cs
    if ($LASTEXITCODE) { throw 'Compiling desktop host' }
} finally { Pop-Location }
