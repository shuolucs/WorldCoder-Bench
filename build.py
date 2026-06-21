#!/usr/bin/env python3
import json, os, shutil, re

PILOT_DIR = "/ls/data/lushuo/code/CodingWithVision/Code/Benchmark/pilot_tasks"
OUT_DIR = "/ls/data/lushuo/code/WorldCoder-Bench/games"

MODEL_MAP = {
    "llm_gpt-5.4.html": "gpt54",
    "llm_claude-opus-4-6.html": "opus46",
    "llm_gemini-3.1-pro-preview.html": "gemini31",
}

def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    dirs = sorted([
        d for d in os.listdir(PILOT_DIR)
        if re.match(r'^P\d+_', d) and not re.search(r'_v\d+$', d)
        and os.path.isdir(os.path.join(PILOT_DIR, d))
    ], key=lambda x: int(re.match(r'P(\d+)', x).group(1)))

    manifest = []
    copied = 0

    for d in dirs:
        task_path = os.path.join(PILOT_DIR, d, "task.json")
        if not os.path.exists(task_path):
            continue

        try:
            with open(task_path, 'r', encoding='utf-8') as f:
                task = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue

        if not task.get('title'):
            continue

        models_available = {}
        for fname, short in MODEL_MAP.items():
            src = os.path.join(PILOT_DIR, d, fname)
            if os.path.exists(src):
                models_available[short] = True

        if not models_available:
            continue

        game_dir = os.path.join(OUT_DIR, d)
        os.makedirs(game_dir, exist_ok=True)

        for fname, short in MODEL_MAP.items():
            src = os.path.join(PILOT_DIR, d, fname)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(game_dir, f"{short}.html"))
                copied += 1

        manifest.append({
            "id": d,
            "title": task.get("title", d),
            "domain": task.get("domain", "other"),
            "difficulty": task.get("difficulty", "L3"),
            "tags": task.get("tags", []),
            "models": list(models_available.keys()),
        })

    manifest_path = os.path.join(OUT_DIR, "..", "games.json")
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=None)

    print(f"Done: {len(manifest)} games, {copied} HTML files copied")

if __name__ == "__main__":
    main()
