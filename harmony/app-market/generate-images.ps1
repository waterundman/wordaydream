# Use $PSScriptRoot to avoid Chinese path encoding issues in PS 5.1
$scriptDir = $PSScriptRoot
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$outDir = Join-Path $scriptDir "screenshots"
$mediaDir = Join-Path $projectRoot "entry\src\main\resources\base\media"

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
if (-not (Test-Path $mediaDir)) { New-Item -ItemType Directory -Path $mediaDir -Force | Out-Null }

$base = "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image"

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
  $dest = Join-Path $outDir $s.name
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 300
    $size = (Get-Item $dest).Length
    $results += "OK $($s.name) ($size bytes)"
  } catch {
    $results += "FAIL $($s.name): $($_.Exception.Message)"
  }
}

$bgPrompt = "Solid warm amber gradient background, subtle paper texture, cream color transitioning to amber orange, no content, no text, just smooth gradient, suitable for app icon background layer"
$bgUrl = "$base`?prompt=$([uri]::EscapeDataString($bgPrompt))&image_size=square"
$bgDest = Join-Path $mediaDir "icon_background.png"
try {
  Invoke-WebRequest -Uri $bgUrl -OutFile $bgDest -UseBasicParsing -TimeoutSec 300
  $size = (Get-Item $bgDest).Length
  $results += "OK icon_background.png ($size bytes)"
} catch {
  $results += "FAIL icon_background: $($_.Exception.Message)"
}

$fgPrompt = "Minimalist app icon foreground layer, open book with stylized letter W merging into small flame, warm amber and cream color, centered, clean modern flat design, suitable for adaptive icon foreground"
$fgUrl = "$base`?prompt=$([uri]::EscapeDataString($fgPrompt))&image_size=square"
$fgDest = Join-Path $mediaDir "icon_foreground.png"
try {
  Invoke-WebRequest -Uri $fgUrl -OutFile $fgDest -UseBasicParsing -TimeoutSec 300
  $size = (Get-Item $fgDest).Length
  $results += "OK icon_foreground.png ($size bytes)"
} catch {
  $results += "FAIL icon_foreground: $($_.Exception.Message)"
}

$results -join "`n"
