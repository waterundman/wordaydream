#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fix Stage 3 block in plan.md (only Stage 3 has _rgt_tdd: N/A and tdd_state: N/A)."""
import re
from pathlib import Path

plan_path = Path(r"D:\obsidian分2\ai引用库\项目概况\Wordaydream\bayesian\v0.3.0-harmony\plan.md")
plan = plan_path.read_text(encoding="utf-8")

# Anchor on Stage 3's unique combination (config + R2 + depends_on: [])
pattern = (
    r"(stage: 3\n"
    r"title: \"D3 Vite manualChunks \+ Brotli 压缩\"\n"
    r"task_type: config\n"
    r"round: R2\n"
    r"depends_on: \[\]\n"
    r"prior_confidence: 0\.75\n"
    r"confidence:\n"
    r"  prior: 0\.75\n"
    r"  posterior: )-(\n"
    r"  last_result: )PENDING(\n"
    r"_validated: )false(\n"
    r"_validation_run_id: )-(\n"
    r"_rgt_signal: )-(\n"
    r"_rgt_semantic: )-(\n"
    r"_rgt_tdd: )N/A(\n"
    r"_rgt_flag: null\n"
    r"tdd_state: )N/A"
)

replacement = (
    r"\g<1>0.85\g<2>PASS\g<3>true\g<4>stage3-v030-passed\g<5>GREEN\g<6>GREEN\g<7>N/A\g<8>N/A"
)

new_plan, count = re.subn(pattern, replacement, plan, count=1)
if count == 0:
    print("ERROR: Stage 3 pattern not matched")
else:
    plan_path.write_text(new_plan, encoding="utf-8")
    print(f"Stage 3 block updated, count={count}, file size={plan_path.stat().st_size}")
