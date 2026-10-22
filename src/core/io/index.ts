// 导入导出入口。原 457 行的 io.ts 拆成：
//   export（导出打包）· archive（.drp.zip 归档）· import（合并导入）· mappers（行↔对象）· maintenance（清空/体积）
// 这里原样转出，外部 import '../core/io' 的写法不用改。

export { buildLibrary, exportToFile } from './export';
export {
  ARCHIVE_FORMAT,
  buildArchive,
  exportArchiveToFile,
  importFromFile,
  isZipBytes,
  libraryTextFromArchive,
} from './archive';
export { importLibrary, type ImportResult } from './import';
export { clearAllData, dbSizeBytes } from './maintenance';
