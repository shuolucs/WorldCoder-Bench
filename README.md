# WorldCoder-Bench

## Benchmarking Physically Grounded 3D World Synthesis

[![arXiv](https://img.shields.io/badge/arXiv-2606.01869-b31b1b.svg)](https://arxiv.org/abs/2606.01869)
[![Dataset](https://img.shields.io/badge/Hugging%20Face-Dataset-FFD21E.svg)](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench)

**Can large language models build interactive 3D worlds that not only look right, but also behave correctly?**

WorldCoder-Bench evaluates autonomous, physically grounded 3D world synthesis from natural-language instructions. Generated Three.js programs must integrate 3D assets, respect spatial and physical constraints, and keep user-facing controls synchronized with the world's internal state.

This repository serves as the paper's project page and data-access guide.

> **Data download:** All publicly released WorldCoder-Bench data—including task definitions, natural-language prompts, metadata, and 3D assets—are available at **[huggingface.co/datasets/shuolucs/WorldCoder-Bench](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench)**. Use the [dataset viewer](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench) to browse tasks, or the [Files and versions tab](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench/tree/main) to access the complete current release.

## Paper

**[WorldCoder-Bench: Benchmarking Physically Grounded 3D World Synthesis](https://arxiv.org/abs/2606.01869)**

Shuo Lu, Yinuo Xu, Kecheng Yu, Siru Jiang, Yongcan Yu, Yubin Wang, Haitao Yang, Yuxiang Zhang, Bin Wang, Ran He, and Jian Liang.

[Read the paper](https://arxiv.org/abs/2606.01869) · [Download PDF](https://arxiv.org/pdf/2606.01869) · [Hugging Face paper page](https://huggingface.co/papers/2606.01869)

### Why this benchmark?

An attractive screenshot is not enough to establish that an interactive 3D world works. Physics, animation, object relationships, and interaction chains unfold inside a browser's opaque `<canvas>`, where pixel- or DOM-only evaluation cannot reliably verify the underlying mechanics.

WorldCoder-Bench moves evaluation from appearance to **executable behavior**:

- **Physically grounded world synthesis.** The paper describes 2,026 expert-curated tasks spanning Simulation, Rendering, and Application scenarios, with optional `.glb` assets and hidden behavioral contracts.
- **StateProbe.** An execution-based protocol runs generated programs in a sandboxed browser and probes runtime states and transitions to check whether interactions and constraints actually hold.
- **Mutation-hardened verification.** Behavioral checkers are calibrated against deliberately introduced faults, strengthening the reliability of verification coverage.
- **Practical automation value.** Return on Automation and Time Efficiency Multiplier measure correctness-adjusted cost and time savings alongside behavioral correctness.

### Findings reported in the paper

Across nine frontier models, the best system reaches only **27.8% verification coverage on WorldCoder-Core** and **19.9% on WorldCoder-Robust**. Failures are dominated by state-schema drift and broken interaction chains, rather than simply missing scene elements. The utility analysis also shows that inexpensive or fast models can still provide substantial value on easier domains.

## Data availability

**The Hugging Face dataset is the download location for all currently released benchmark data. No separate download from this GitHub repository is required.**

The current public release contains:

- **205 core tasks**, available both as a flattened `tasks.jsonl` file and as individual `tasks/*/task.json` definitions.
- **74 shared GLB assets**, together with task-local asset folders where provided.
- Task prompts and metadata, including task ID, title, domain, difficulty, framework, asset references, and physics constraints where specified.
- Tasks across **15 domains**, including physics, games, architecture, animation, visualization, chemistry, molecular scenes, materials, and shaders, with difficulty levels L3–L6.

**Release scope:** The paper describes a 2,026-task benchmark; the currently published Hugging Face release contains the 205-task core dataset. “All released data” refers to the complete public release, not a claim that all 2,026 paper tasks are already downloadable. See the [dataset card](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench/blob/main/README.md) for release details. The paper describes the evaluation framework; this GitHub page does not provide its implementation.

### Browse or download

- [Browse tasks in the dataset viewer](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench)
- [Browse all dataset files](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench/tree/main)
- [Download `tasks.jsonl`](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench/resolve/main/tasks.jsonl)
- [Browse canonical task folders](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench/tree/main/tasks)
- [Browse shared 3D assets](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench/tree/main/assets)

### Load task records

```bash
pip install datasets huggingface_hub
```

```python
from datasets import load_dataset

tasks = load_dataset("shuolucs/WorldCoder-Bench", split="test")
print(len(tasks))  # 205 in the current public release
print(tasks[0]["title"])
print(tasks[0]["prompt"])
```

This loads the task records, not the GLB asset files. To download the full release, use the following instead.

### Download all released files, including 3D assets

```python
from huggingface_hub import snapshot_download

dataset_dir = snapshot_download(
    repo_id="shuolucs/WorldCoder-Bench",
    repo_type="dataset",
    local_dir="WorldCoder-Bench-data",
)
print(dataset_dir)
```

The downloaded dataset includes:

```text
WorldCoder-Bench-data/
├── README.md
├── LICENSE
├── tasks.jsonl
├── assets/                 # Shared GLB models
└── tasks/
    └── <task_id>/
        ├── task.json       # Prompt and task metadata
        └── assets/         # Task-local assets, where provided
```

## License

Task definitions are released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Third-party 3D assets retain their individual original licenses and usage restrictions; consult the [dataset card and asset attribution](https://huggingface.co/datasets/shuolucs/WorldCoder-Bench/blob/main/README.md#3d-assets) before redistributing or using them.

## Citation

If you use WorldCoder-Bench in your research, please cite:

```bibtex
@article{lu2026worldcoder,
  title   = {WorldCoder-Bench: Benchmarking Physically Grounded 3D World Synthesis},
  author  = {Lu, Shuo and Xu, Yinuo and Yu, Kecheng and Jiang, Siru and Yu, Yongcan and Wang, Yubin and Yang, Haitao and Zhang, Yuxiang and Wang, Bin and He, Ran and Liang, Jian},
  journal = {arXiv preprint arXiv:2606.01869},
  year    = {2026},
  url     = {https://arxiv.org/abs/2606.01869}
}
```
