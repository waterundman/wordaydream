# Use $PSScriptRoot to avoid Chinese path encoding issues in PS 5.1
$scriptDir = $PSScriptRoot
# harmony/app-market -> harmony, 只上溯一次。
# 此前是两次上溯 (Split-Path -Parent (Split-Path -Parent $scriptDir)), 解析到仓库根,
# 于是 icon_* 被写进 <repo>/entry/src/main/resources/base/media/ —— 在仓库根生成了一个
# 与真实模块 harmony/entry 同名的幽灵目录 (345 KB, 无任何构建引用)。见
# docs/vault/v1.6.3-HARMONY-TECHDEBT-AUDIT.md §3.2。
$projectRoot = Split-Path -Parent $scriptDir
$outDir = Join-Path $scriptDir "screenshots"
$mediaDir = Join-Path $projectRoot "entry\src\main\resources\base\media"

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
if (-not (Test-Path $mediaDir)) { New-Item -ItemType Directory -Path $mediaDir -Force | Out-Null }

$base = "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image"

# 落盘守卫: 该端点对尚未生成完的请求会返回一张 1832x1832 的 "The image is generating...
# Please refresh page to preview." 占位图 —— 且是 JPEG 流套 .png 扩展名。历史上脚本直接
# 把它当产物保存, 导致 app-market/ 下 9 个素材字节完全相同 (md5 19a0b822…), 素材就绪度为 0。
# 这里校验 PNG magic; 不合格即删除并报 FAIL, 避免占位图再次污染素材目录。
function Invoke-ImageDownload {
  param([string]$Url, [string]$Dest)
  $tmp = "$Dest.download"
  try {
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -TimeoutSec 300
    $head = Get-Content -Path $tmp -Encoding Byte -TotalCount 8
    $isPng = ($head.Count -eq 8) -and ($head[0] -eq 0x89) -and ($head[1] -eq 0x50) `
      -and ($head[2] -eq 0x4E) -and ($head[3] -eq 0x47)
    if (-not $isPng) {
      Remove-Item $tmp -Force
      return "FAIL $(Split-Path $Dest -Leaf): 返回的不是 PNG (疑似 'image is generating' 占位图), 已丢弃"
    }
    Move-Item -Path $tmp -Destination $Dest -Force
    return "OK $(Split-Path $Dest -Leaf) ($((Get-Item $Dest).Length) bytes)"
  } catch {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    return "FAIL $(Split-Path $Dest -Leaf): $($_.Exception.Message)"
  }
}

$shots = @(
  @{ name='screenshot_01_home_mockup.png'; prompt="Screenshot of Wordaydream vocabulary learning app home page on HarmonyOS phone, hero section with large German greeting Guten Tag, reading streak badge with flame icon, today reading card, progress ring showing 70 percent, achievement section with unlocked badges, warm cream paper background, refined typography, clean modern mobile UI" },
  @{ name='screenshot_02_reading_mockup.png'; prompt="Screenshot of Wordaydream app reading page on HarmonyOS phone, a German language passage with highlighted vocabulary tokens in orange underline, inline answer panel below showing input field, grammar tooltip popup, scroll progress bar at top, warm paper texture background, mobile UI" },
  @{ name='screenshot_03_review_mockup.png'; prompt="Screenshot of Wordaydream app review page on HarmonyOS phone, a flip card showing German word Haus with English definition, FSRS spaced repetition rating buttons at bottom labeled Again Hard Good Easy, progress indicator 3 of 10, warm paper background, mobile UI" },
  @{ name='screenshot_04_widget_mockup.png'; prompt="Screenshot of HarmonyOS phone home screen with Wordaydream 2x2 service card widget showing 5 words due today with flame icon, next to a 2x4 widget with circular progress ring, clean minimal phone wallpaper background, mobile UI" },
  @{ name='screenshot_05_settings_mockup.png'; prompt="Screenshot of Wordaydream app settings page on HarmonyOS phone, LLM provider selector showing DeepSeek option, theme switcher with light dark sepia options, notifications section with enable toggle and time window 8 to 22, warm paper background, mobile UI" },
  @{ name='screenshot_06_achievements_mockup.png'; prompt="Screenshot of Wordaydream app achievements page on HarmonyOS phone, grid of achievement badges some unlocked with orange flame glow, progress bars, German titles like Erste Schritte and Wortmeister, warm paper background, mobile UI" }
)

$results = @()
foreach ($s in $shots) {
  $url = "$base`?prompt=$([uri]::EscapeDataString($s.prompt))&image_size=portrait_16_9"
  $results += Invoke-ImageDownload -Url $url -Dest (Join-Path $outDir $s.name)
}

$bgPrompt = "Solid warm amber gradient background, subtle paper texture, cream color transitioning to amber orange, no content, no text, just smooth gradient, suitable for app icon background layer"
$bgUrl = "$base`?prompt=$([uri]::EscapeDataString($bgPrompt))&image_size=square"
$results += Invoke-ImageDownload -Url $bgUrl -Dest (Join-Path $mediaDir "icon_background.png")

$fgPrompt = "Minimalist app icon foreground layer, open book with stylized letter W merging into small flame, warm amber and cream color, centered, clean modern flat design, suitable for adaptive icon foreground"
$fgUrl = "$base`?prompt=$([uri]::EscapeDataString($fgPrompt))&image_size=square"
$results += Invoke-ImageDownload -Url $fgUrl -Dest (Join-Path $mediaDir "icon_foreground.png")

$results -join "`n"