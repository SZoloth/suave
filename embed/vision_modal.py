"""
Runs an open vision model on Modal over every thumbnail, with the same one-or-several question as grouped.mjs.
Writes embed/vision/modal-<model>.json in the same shape as vision-grouped.mjs: { [assetId]: { several, objects } }.
Usage: modal run embed/vision_modal.py [--model Qwen/Qwen3-VL-8B-Instruct]
"""

import base64
import json
import re
import time
from pathlib import Path

import modal

HERE = Path(__file__).parent
QUESTION = (
    "Is this asset several separate objects modelled together as one asset, like a pile of rocks, a stack of books, "
    "a set of tools or a cluster of mushrooms? A single object with several parts, like a chair or a lamp, is not. "
    "Nor is one object shown in several finishes or states, like clean and rusted or open and closed."
)
REPLY = 'Reply with JSON only, like {"objects": 1, "several": false}, where objects is how many separate objects the thumbnail shows.'

app = modal.App("suave-vision-grouped")
# vLLM compiles kernels at startup, so the image needs nvcc, not just the CUDA runtime.
image = modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu24.04", add_python="3.12").uv_pip_install("vllm")
weights = modal.Volume.from_name("hf-cache", create_if_missing=True)


@app.function(image=image, gpu="L40S", volumes={"/root/.cache/huggingface": weights}, timeout=1800)
def ask(model: str, assets: list[dict]) -> list[str]:
    from vllm import LLM, SamplingParams

    llm = LLM(model=model, max_model_len=4096, limit_mm_per_prompt={"image": 1})
    conversations = [
        [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{a['png']}"}},
                    {"type": "text", "text": f"Asset name: {a['name']}. {QUESTION} {REPLY}"},
                ],
            }
        ]
        for a in assets
    ]
    outputs = llm.chat(conversations, SamplingParams(temperature=0, max_tokens=40))
    weights.commit()
    return [o.outputs[0].text for o in outputs]


@app.local_entrypoint()
def main(model: str = "Qwen/Qwen3-VL-8B-Instruct"):
    index = HERE / "index"
    assets = json.loads((index / "assets.json").read_text())
    payload = [
        {"name": a["name"].replace("_", " "), "png": base64.b64encode((index / "thumbs" / f"{a['id']}.png").read_bytes()).decode()}
        for a in assets
    ]
    started = time.time()
    replies = ask.remote(model, payload)
    seconds = time.time() - started
    answers, unparsed = {}, []
    for a, text in zip(assets, replies):
        match = re.search(r"\{.*\}", text, re.S)
        try:
            parsed = json.loads(match[0]) if match else None
            answers[a["id"]] = {"objects": int(parsed["objects"]), "several": bool(parsed["several"])}
        except (TypeError, KeyError, ValueError):
            answers[a["id"]] = None
            unparsed.append(f"{a['id']}: {text[:80]!r}")
    out = HERE / "vision" / f"modal-{model.split('/')[-1]}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(answers, indent=1))
    several = sum(1 for x in answers.values() if x and x["several"])
    print(f"wrote {out.relative_to(HERE.parent)}, {several} of {len(assets)} read as several, {len(unparsed)} unparsed")
    # L40S at $0.000542/s; the wall clock includes container start and model load, so this overstates GPU time slightly.
    print(f"{seconds:.0f}s on the L40S, about ${seconds * 0.000542:.2f} of GPU")
    for line in unparsed[:10]:
        print("  unparsed", line)
