/**
 * 1.6.59: FunASR streaming via sherpa-onnx Zipformer2-CTC multi-zh int8 (~70MB).
 * Smaller than Paraformer bilingual (~237MB) with comparable CN quality for hold-to-talk.
 * Keep overlay/MarkdownAnswer/docx/PDF/fund-open + fuzzy aliases.
 */
export const ENABLE_HOME_DARK_STATUS = true
export const ENABLE_HUAWEI_CLOUD_STT = false
/** Legacy Vosk path kept in tree but off (AAR removed from APK). */
export const ENABLE_VOSK_STT = false
/** FunASR / sherpa-onnx streaming (Zipformer2 CTC Chinese int8). */
export const ENABLE_FUNASR_STT = true
