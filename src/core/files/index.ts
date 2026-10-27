// core/files 的对外出口。
//
// 上层只从这里拿：上传判重、体检/迁移、合并、引用改写、命名工具。
// 具体实现分散在同目录若干文件里，各自只负责一件事。

export {
  DEFAULT_SMALL_LIMIT,
  HASH_NAME_PREFIX,
  LINK_NAME_PREFIX,
  extFor,
  linkStem,
  sha256Text,
  extOf,
  hashStem,
  quickFingerprint,
  sameBytes,
  sha256Hex,
  stemOf,
} from './naming';
export { uploadFile, uploadFileQuiet, type CollisionPrompt, type UploadOutcome } from './upload';
export { auditFiles, hashMissingFiles, type AuditResult, type HashGroup } from './audit';
export {
  normalizeLink,
  fileNameFromLink,
  fileNameFromDisposition,
  guessMime,
  probeLink,
  downloadLink,
  linkStoredId,
  saveAsMapping,
  findMappingByUrl,
  schemeOf,
  isAppLink,
  isScriptLink,
  type LinkProbe,
  type DownloadedLink,
  type SaveMappingInput,
} from './mapping';
export { commitMerge, previewMerge, type MergePreview } from './merge';
export {
  rewriteRefEverywhere,
  rewriteRefs,
  transferRefsInEvents,
  replaceRef,
  hasRef,
} from './rewrite';
export {
  planMigration,
  planSummary,
  runMigration,
  type MigrateMode,
  type MigratePlan,
  type MigrateResult,
} from './migrate';
