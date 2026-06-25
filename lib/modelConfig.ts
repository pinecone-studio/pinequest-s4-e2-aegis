export const ACTIVE_MODEL =
  (process.env.NEXT_PUBLIC_ACTIVE_MODEL as "pretrained" | "finetuned") ??
  "pretrained";

export const SMOKING_MODEL_PATH = `/models/${ACTIVE_MODEL}.onnx`;
export const LITTER_MODEL_PATH = `/models/litter.onnx`;

export const SMOKING_THRESHOLD = 0.6;
export const LITTER_THRESHOLD = 0.8;
export const ALERT_THRESHOLD = 0.7;

export const INPUT_SIZE = 640;
