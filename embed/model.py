import torch
from sentence_transformers import SentenceTransformer

MODEL_ID = "google/embeddinggemma-2"


def load_model() -> SentenceTransformer:
    # float16 overflows this model (silent NaNs); bfloat16 or float32 only.
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    return SentenceTransformer(
        MODEL_ID,
        device=device,
        model_kwargs={"torch_dtype": torch.float32},
        config_kwargs={"audio_config": None},
    )


def doc_text(asset: dict) -> str:
    body = ". ".join(
        part
        for part in [
            ", ".join(asset["categories"]),
            ", ".join(asset["tags"]),
            asset["description"],
        ]
        if part
    )
    return f"title: {asset['name']} | text: {body}"


def query_text(query: str) -> str:
    return f"task: search result | query: {query}"
