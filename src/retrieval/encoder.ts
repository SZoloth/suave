import { AutoConfig, AutoModel, AutoProcessor, type Tensor } from "@huggingface/transformers";

const MODEL = "onnx-community/embeddinggemma-2-ONNX";

/**
 * Text encoder weights per device. ONNX Runtime's WASM build has no kernel for the quantized
 * graphs' embedding lookup, so WASM falls back to fp16. EmbeddingGemma activations overflow in fp16
 * on GPUs, which rules fp16 out for WebGPU.
 */
const WEIGHTS = { webgpu: "q8", wasm: "fp16" } as const;
export type Device = keyof typeof WEIGHTS;
export type Progress = { loaded: number; total: number };
export type Encoder = { device: Device; encode: (text: string) => Promise<Float32Array> };

async function pickDevice(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return (await gpu?.requestAdapter().catch(() => null)) ? "webgpu" : "wasm";
}

/** EmbeddingGemma 2's text encoder only: the image and audio encoders would add 300 to 1,000 MB a visitor never needs here. */
export async function loadEncoder(onProgress?: (p: Progress) => void, device?: Device): Promise<Encoder> {
  const on = device ?? (await pickDevice());
  if (device || on === "wasm") return loadOn(on, onProgress);
  return loadOn("webgpu", onProgress).catch((err) => {
    console.warn(`WebGPU encoder failed, using WASM: ${err instanceof Error ? err.message : String(err)}`);
    return loadOn("wasm", onProgress);
  });
}

async function loadOn(on: Device, onProgress?: (p: Progress) => void): Promise<Encoder> {
  const config = await AutoConfig.from_pretrained(MODEL);
  Object.assign(config, { vision_config: null, audio_config: null });
  const progress_callback = (info: { status: string; loaded?: number; total?: number }) => {
    if (info.status === "progress_total" && info.total) onProgress?.({ loaded: info.loaded ?? 0, total: info.total });
  };
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(MODEL, { progress_callback }),
    AutoModel.from_pretrained(MODEL, { config, device: on, dtype: { model: WEIGHTS[on] }, progress_callback }),
  ]);
  return {
    device: on,
    encode: async (text) => {
      const inputs = await processor([`task: search result | query: ${text}`]);
      const output = (await model(inputs)) as Record<string, Tensor>;
      const vector = new Float32Array(output.sentence_embedding.data as Float32Array);
      for (const t of [...Object.values(output), ...Object.values(inputs as Record<string, Tensor>)]) t?.dispose?.();
      return vector;
    },
  };
}
