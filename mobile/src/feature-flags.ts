/**
 * 1.6.60: restore FunASR Paraformer streaming (sherpa-onnx bilingual zh-en int8).
 * 1.6.59 Zipformer2-CTC local-int8 caused Huawei native flash-out at prepare.
 * Keep overlay/MarkdownAnswer/docx/PDF/fund-open + fuzzy aliases + product-page hardenings.
 */
export const ENABLE_HOME_DARK_STATUS = true
export const ENABLE_HUAWEI_CLOUD_STT = false
/** Legacy Vosk path kept off (AAR not in APK). */
export const ENABLE_VOSK_STT = false
/** FunASR Paraformer streaming (sherpa-onnx) — known-good on device. */
export const ENABLE_FUNASR_STT = true
