#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Update plan.md to mark Stage 2-5 as PASS for v0.3.0-harmony."""
import re
from pathlib import Path

plan_path = Path(r"D:\obsidian分2\ai引用库\项目概况\Wordaydream\bayesian\v0.3.0-harmony\plan.md")
plan = plan_path.read_text(encoding="utf-8")

# 1. Stage overview table - update Stage 2-5 rows
table_replacements = [
    ("| 2 | D1 Web SpeechSynthesis 双路径 + ReadingSessionPage 改造 | R1 | PENDING | 0.60 | - | false | - | - | - | null |",
     "| 2 | D1 Web SpeechSynthesis 双路径 + ReadingSessionPage 改造 | R1 | PASS | 0.60 | 0.82 | true | GREEN | GREEN | GREEN | null |"),
    ("| 3 | D3 Vite manualChunks + Brotli 压缩 | R2 | PENDING | 0.75 | - | false | - | - | N/A | null |",
     "| 3 | D3 Vite manualChunks + Brotli 压缩 | R2 | PASS | 0.75 | 0.85 | true | GREEN | GREEN | N/A | null |"),
    ("| 4 | D3 IndexedDB 索引优化 + 鸿蒙 relationalStore 索引 | R2 | PENDING | 0.75 | - | false | - | - | - | null |",
     "| 4 | D3 IndexedDB 索引优化 + 鸿蒙 relationalStore 索引 | R2 | PASS | 0.75 | 0.85 | true | GREEN | GREEN | GREEN | null |"),
    ("| 5 | 验证 + 文档 + Vault 同步 | R3 | PENDING | 0.80 | - | false | - | - | - | null |",
     "| 5 | 验证 + 文档 + Vault 同步 | R3 | PASS | 0.80 | 0.85 | true | GREEN | GREEN | GREEN | null |"),
]
for old, new in table_replacements:
    if old not in plan:
        print(f"WARN: table row not found: {old[:60]}...")
    plan = plan.replace(old, new)


# 2. Stage yaml block field updates
def update_stage_block(content, stage_num, posterior, run_id, rgt_tdd, initial_tdd="RED"):
    """Update fields within a stage's yaml block using regex."""
    # Pattern matches the full block from "stage: N" through "tdd_state: ..."
    pattern = (
        r"(stage: " + stage_num + r"\n"
        r"title: [^\n]*\n"
        r"task_type: [^\n]*\n"
        r"round: [^\n]*\n"
        r"depends_on: [^\n]*\n"
        r"prior_confidence: [^\n]*\n"
        r"confidence:\n"
        r"  prior: [^\n]*\n"
        r"  posterior: )-(\n"
        r"  last_result: )PENDING(\n"
        r"_validated: )false(\n"
        r"_validation_run_id: )-(\n"
        r"_rgt_signal: )-(\n"
        r"_rgt_semantic: )-(\n"
        r"_rgt_tdd: )-("  # capture the dash
        r"\n_rgt_flag: null\n"
        r"tdd_state: )" + initial_tdd
    )
    replacement = (
        r"\g<1>" + posterior + r"\g<2>PASS\g<3>true\g<4>" + run_id +
        r"\g<5>GREEN\g<6>GREEN\g<7>" + rgt_tdd + r"\g<8>"
    )
    if rgt_tdd == "N/A":
        replacement = (
            r"\g<1>" + posterior + r"\g<2>PASS\g<3>true\g<4>" + run_id +
            r"\g<5>GREEN\g<6>GREEN\g<7>N/A\g<8>"
        )
    new_content, count = re.subn(pattern, replacement, content, count=1)
    if count == 0:
        print(f"WARN: stage {stage_num} block not updated")
    return new_content


plan = update_stage_block(plan, "2", "0.82", "stage2-v030-passed", "GREEN", "RED")
plan = update_stage_block(plan, "4", "0.85", "stage4-v030-passed", "GREEN", "RED")
plan = update_stage_block(plan, "5", "0.85", "stage5-v030-passed", "GREEN", "RED")
# Stage 3 has _rgt_tdd: N/A and tdd_state: N/A
plan = update_stage_block(plan, "3", "0.85", "stage3-v030-passed", "N/A", "N/A")

# 3. Update last modified line
old_last = "2026-07-27 v0.3.0-harmony bayesian-plan.md 生成 (Phase 1 完成, 等待 Phase 2 版本预览 → Phase 3 执行)"
new_last = "2026-07-27 v0.3.0-harmony COMPLETE (5/5 Stages PASS, 953+21 tests, posterior 0.85, Phase 5 Vault 同步完成)"
if old_last in plan:
    plan = plan.replace(old_last, new_last)
else:
    print("WARN: last modified line not found")

# 4. Update Pre-Advance Guard section
plan = plan.replace("## Pre-Advance Guard 初始状态", "## Pre-Advance Guard 完成状态")
guard_replacements = [
    ("□ _validated: false (Stage 1 未执行)", "[x] _validated: true (5/5 Stages PASS)"),
    ("□ L1 状态文件 bayesian/v0.3.0-harmony/status.md 未创建 (Phase 5 创建)",
     "[x] L1 状态文件 bayesian/v0.3.0-harmony/status.md 已创建"),
    ("□ L2 计划文件 bayesian/v0.3.0-harmony/plan.md 已创建 (本文件)",
     "[x] L2 计划文件 bayesian/v0.3.0-harmony/plan.md 已更新 (本文件)"),
    ("□ L3 历史文件 bayesian/v0.3.0-harmony/history.md 未创建 (Phase 5 创建)",
     "[x] L3 历史文件 bayesian/v0.3.0-harmony/history.md 已创建"),
    ("□ INDEX.md 待更新 (Phase 5 更新)", "[x] INDEX.md 已更新 (v0.3.0-harmony 条目新增)"),
    ("□ Phase 5.5 Hook 待执行 (Phase 5 后)", "[x] Phase 5.5 Hook 已执行 (NEXT-VERSION-DIRECTION.md 已生成)"),
]
for old, new in guard_replacements:
    if old not in plan:
        print(f"WARN: guard line not found: {old[:60]}...")
    plan = plan.replace(old, new)

plan_path.write_text(plan, encoding="utf-8")
print(f"plan.md updated successfully, file size: {plan_path.stat().st_size} bytes")
