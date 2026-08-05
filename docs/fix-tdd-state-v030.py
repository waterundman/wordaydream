#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fix empty tdd_state values in Stage 2/4/5 yaml blocks."""
import re
from pathlib import Path

plan_path = Path(r"D:\obsidian分2\ai引用库\项目概况\Wordaydream\bayesian\v0.3.0-harmony\plan.md")
plan = plan_path.read_text(encoding="utf-8")
lines = plan.split("\n")

stage_starts = {}
for i, line in enumerate(lines):
    m = re.match(r"^stage: (\d+)$", line)
    if m:
        stage_starts[m.group(1)] = i

for stage_num in ["2", "4", "5"]:
    start = stage_starts[stage_num]
    next_stage_idx = len(lines)
    for s, idx in stage_starts.items():
        if idx > start and idx < next_stage_idx:
            next_stage_idx = idx
    for i in range(start, next_stage_idx):
        if re.match(r"^tdd_state:\s*$", lines[i]):
            lines[i] = "tdd_state: GREEN"
            print(f"Stage {stage_num}: line {i+1} fixed")
            break
    else:
        print(f"Stage {stage_num}: no empty tdd_state found")

plan_path.write_text("\n".join(lines), encoding="utf-8")
print(f"Done, size={plan_path.stat().st_size}")
