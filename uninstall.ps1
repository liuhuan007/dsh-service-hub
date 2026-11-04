# 回滚 dsh-service-hub 的安装（恢复最近一次备份）
$ErrorActionPreference = 'Continue'
$pd  = "$env:USERPROFILE\.dsh\profiles\desktop"
$bak = Get-ChildItem "$pd\package.json.bak-servicehub-*" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($bak) {
  Copy-Item $bak.FullName "$pd\package.json" -Force
  Write-Host "已恢复 profile/package.json <- $($bak.Name)"
} else {
  Write-Host "没有找到备份，改为手工移除条目"
}

$link = "$pd\node_modules\dsh-service-hub"
if (Test-Path $link) { Remove-Item $link -Recurse -Force; Write-Host "已移除 node_modules 链接" }

$j = [System.IO.File]::ReadAllText("$pd\package.json") | ConvertFrom-Json
$deps = $j.dependencies.PSObject.Properties.Name -notcontains 'dsh-service-hub'
$bund = @($j.dsh.profile.bundles | Where-Object { $_ -eq 'dsh-service-hub' }).Count -eq 0
Write-Host "依赖已清除: $deps    bundle 已清除: $bund"
Write-Host "请重启 DeepSeek Harness 桌面应用。"