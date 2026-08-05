$ErrorActionPreference = "Stop"
$planPath = "D:\obsidian分2\ai引用库\项目概况\Wordaydream\bayesian\v0.3.0-harmony\plan.md"
$plan = Get-Content -Path $planPath -Raw -Encoding UTF8

# Use single-line replacements with -replace (regex) to avoid here-string terminator issues

# 1. Stage overview table - Stage 2-5 rows
$plan = $plan -replace '\| 2 \| D1 Web SpeechSynthesis 双路径 \+ ReadingSessionPage 改造 \| R1 \| PENDING \| 0\.60 \| - \| false \| - \| - \| - \| null \|',
    '| 2 | D1 Web SpeechSynthesis 双路径 + ReadingSessionPage 改造 | R1 | PASS | 0.60 | 0.82 | true | GREEN | GREEN | GREEN | null |'

$plan = $plan -replace '\| 3 \| D3 Vite manualChunks \+ Brotli 压缩 \| R2 \| PENDING \| 0\.75 \| - \| false \| - \| - \| N/A \| null \|',
    '| 3 | D3 Vite manualChunks + Brotli 压缩 | R2 | PASS | 0.75 | 0.85 | true | GREEN | GREEN | N/A | null |'

$plan = $plan -replace '\| 4 \| D3 IndexedDB 索引优化 \+ 鸿蒙 relationalStore 索引 \| R2 \| PENDING \| 0\.75 \| - \| false \| - \| - \| - \| null \|',
    '| 4 | D3 IndexedDB 索引优化 + 鸿蒙 relationalStore 索引 | R2 | PASS | 0.75 | 0.85 | true | GREEN | GREEN | GREEN | null |'

$plan = $plan -replace '\| 5 \| 验证 \+ 文档 \+ Vault 同步 \| R3 \| PENDING \| 0\.80 \| - \| false \| - \| - \| - \| null \|',
    '| 5 | 验证 + 文档 + Vault 同步 | R3 | PASS | 0.80 | 0.85 | true | GREEN | GREEN | GREEN | null |'

# 2. Stage 2-5 yaml block field updates - replace each field individually within each stage block
# Strategy: only replace the first occurrence after each stage marker

# For Stage 2: find block starting with "stage: 2" and update fields
function Update-StageBlock {
    param([string]$content, [string]$stageNum, [string]$posterior, [string]$runId, [string]$rgtTdd)

    # Match the stage block by locating stage: N and updating fields within
    # We need to be careful to only modify fields in this stage's block
    # Use regex with single-line mode and capture the block

    $pattern = "(stage: $stageNum\r?\ntitle:[^\r\n]*\r?\ntask_type:[^\r\n]*\r?\nround:[^\r\n]*\r?\ndepends_on:[^\r\n]*\r?\nprior_confidence:[^\r\n]*\r?\nconfidence:\r?\n  prior:[^\r\n]*\r?\n  posterior: )-([^\r\n]*\r?\n  last_result: )PENDING([^\r\n]*\r?\n_validated: )false([^\r\n]*\r?\n_validation_run_id: )-([^\r\n]*\r?\n_rgt_signal: )-([^\r\n]*\r?\n_rgt_semantic: )-([^\r\n]*\r?\n_rgt_tdd: )-([^\r\n]*\r?\n_rgt_flag: null\r?\ntdd_state: )RED"

    $replacement = "`${1}$posterior`${2}PASS`${3}true`${4}$runId`${5}GREEN`${6}GREEN`${7}$rgtTdd`${8}GREEN"

    return [regex]::Replace($content, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

$plan = Update-StageBlock -content $plan -stageNum "2" -posterior "0.82" -runId "stage2-v030-passed" -rgtTdd "GREEN"
$plan = Update-StageBlock -content $plan -stageNum "4" -posterior "0.85" -runId "stage4-v030-passed" -rgtTdd "GREEN"
$plan = Update-StageBlock -content $plan -stageNum "5" -posterior "0.85" -runId "stage5-v030-passed" -rgtTdd "GREEN"

# Stage 3 has _rgt_tdd: N/A and tdd_state: N/A (not RED)
$pattern3 = "(stage: 3\r?\ntitle:[^\r\n]*\r?\ntask_type:[^\r\n]*\r?\nround:[^\r\n]*\r?\ndepends_on:[^\r\n]*\r?\nprior_confidence:[^\r\n]*\r?\nconfidence:\r?\n  prior:[^\r\n]*\r?\n  posterior: )-([^\r\n]*\r?\n  last_result: )PENDING([^\r\n]*\r?\n_validated: )false([^\r\n]*\r?\n_validation_run_id: )-([^\r\n]*\r?\n_rgt_signal: )-([^\r\n]*\r?\n_rgt_semantic: )-([^\r\n]*\r?\n_rgt_tdd: )N/A([^\r\n]*\r?\n_rgt_flag: null\r?\ntdd_state: )N/A"
$replacement3 = "`${1}0.85`${2}PASS`${3}true`${4}stage3-v030-passed`${5}GREEN`${6}GREEN`${7}N/A`${8}N/A"
$plan = [regex]::Replace($plan, $pattern3, $replacement3, [System.Text.RegularExpressions.RegexOptions]::Singleline)

# 3. Update last modified line
$plan = $plan -replace '2026-07-27 v0\.3\.0-harmony bayesian-plan\.md 生成 \(Phase 1 完成, 等待 Phase 2 版本预览 → Phase 3 执行\)',
    '2026-07-27 v0.3.0-harmony COMPLETE (5/5 Stages PASS, 953+21 tests, posterior 0.85, Phase 5 Vault 同步完成)'

# 4. Update Pre-Advance Guard section
$plan = $plan -replace '## Pre-Advance Guard 初始状态', '## Pre-Advance Guard 完成状态'
$plan = $plan -replace '□ _validated: false \(Stage 1 未执行\)', '[x] _validated: true (5/5 Stages PASS)'
$plan = $plan -replace '□ L1 状态文件 bayesian/v0\.3\.0-harmony/status\.md 未创建 \(Phase 5 创建\)', '[x] L1 状态文件 bayesian/v0.3.0-harmony/status.md 已创建'
$plan = $plan -replace '□ L2 计划文件 bayesian/v0\.3\.0-harmony/plan\.md 已创建 \(本文件\)', '[x] L2 计划文件 bayesian/v0.3.0-harmony/plan.md 已更新 (本文件)'
$plan = $plan -replace '□ L3 历史文件 bayesian/v0\.3\.0-harmony/history\.md 未创建 \(Phase 5 创建\)', '[x] L3 历史文件 bayesian/v0.3.0-harmony/history.md 已创建'
$plan = $plan -replace '□ INDEX\.md 待更新 \(Phase 5 更新\)', '[x] INDEX.md 已更新 (v0.3.0-harmony 条目新增)'
$plan = $plan -replace '□ Phase 5\.5 Hook 待执行 \(Phase 5 后\)', '[x] Phase 5.5 Hook 已执行 (NEXT-VERSION-DIRECTION.md 已生成)'

Set-Content -Path $planPath -Value $plan -Encoding UTF8 -NoNewline
Write-Output "plan.md updated successfully"
Write-Output "File size: $((Get-Item $planPath).Length) bytes"
