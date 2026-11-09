# 把 dsh-service-hub 装进 desktop profile（离线、可回滚）
$ErrorActionPreference = 'Stop'
$pd    = "$env:USERPROFILE\.dsh\profiles\desktop"
$src   = 'F:\agent\work\service-hub'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pd)) { throw "找不到 profile: $pd" }

Copy-Item "$pd\package.json" "$pd\package.json.bak-servicehub-$stamp" -Force
Write-Host "已备份 profile/package.json -> package.json.bak-servicehub-$stamp"

$enc = New-Object System.Text.UTF8Encoding($false)
$j = [System.IO.File]::ReadAllText("$pd\package.json") | ConvertFrom-Json
if ($null -eq $j.dependencies.'dsh-service-hub') {
  $j.dependencies | Add-Member -NotePropertyName 'dsh-service-hub' -NotePropertyValue 'link:F:/agent/work/service-hub' -Force
}
if (@($j.dsh.profile.bundles | Where-Object { $_ -eq 'dsh-service-hub' }).Count -eq 0) {
  $j.dsh.profile.bundles = @($j.dsh.profile.bundles) + 'dsh-service-hub'
}
[System.IO.File]::WriteAllText("$pd\package.json", ($j | ConvertTo-Json -Depth 12), $enc)

$link = "$pd\node_modules\dsh-service-hub"
if (Test-Path $link) { Remove-Item $link -Recurse -Force }
New-Item -ItemType SymbolicLink -Path $link -Target $src | Out-Null

Write-Host "已装入: 依赖 + bundle + node_modules 链接"
Write-Host ""
Write-Host "现在请【完全关闭再重新打开】DeepSeek Harness 桌面应用。"
Write-Host "打开后右侧边栏应出现「服务」标签。"
Write-Host "如果应用起不来，运行 uninstall.ps1 回滚。"