#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fix Stage 1 block in plan.md (posterior 0.85, PASS, GREEN)."""
import re
from pathlib import Path

plan_path = Path(r"D:\obsidian分2\ai引用库\项目概况\Wordaydream\bayesian\v0.3.0-harmony\plan.md")
plan = plan_path.read_text(encoding="utf-8")

pattern = (
    r"(stage: 1\n"
    r"title: \"D1 鸿蒙 TTS 引擎 \+ HarmonyBridge 扩展\"\n"
    r"task_type: algorithm\n"
    r"round: R1\n"
    r"depends_on: \[\]\n"
    r"prior_confidence: 0\.65\n"
    r"confidence:\n"
    r"  prior: 0\.65\n"
    r"  posterior: )-(\n"
    r"  last_result: )PENDING(\n"
    r"_validated: )false(\n"
    r"_validation_run_id: )-(\n"
    r"_rgt_signal: )-(\n"
    r"_rgt_semantic: )-(\n"
    r"_rgt_tdd: )-(\n"
    r"_rgt_flag: null\n"
    r"tdd_state: )RED"
)

replacement = (
    r"\g<1>0.85\g<2>PASS\g<3>true\g<4>stage1-v030-passed\g<5>GREEN\g<6>GREEN\g<7>GREEN\g<8>GREEN"
)

new_plan, count = re.subn(pattern, replacement, plan, count=1)
if count == 0:
    print("ERROR: Stage 1 pattern not matched")
else:
    plan_path.write_text(new_plan, encoding="utf-8")
    print(f"Stage 1 block updated, count={count}, file size={plan_path.stat().st_size}")
