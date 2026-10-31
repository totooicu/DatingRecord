// 轨迹提取（两步路截图 → 有序轨迹点）。
//
// 这不是「取红色像素导坐标」，而是一条完整的 提取 → 校准 → 插值 流水线：
//
//   ① 红色掩码：HSV 双端色相（红 0~hueHi / 品红 hueLo~180）+ 饱和度明度下限
//      + **R 通道优势**（r > ratio·g 且 r > ratio·b）。后者是关键：两步路底图里
//      橙黄色道路（h≈25~40）和蓝色水面（h≈200）在 HSV 上离红不远，光靠色相会把
//      「奉桐线」那种黄色道路吃进来，加一条 RGB 上的红优势判据就干净了。
//   ② 形态学闭运算补 1~3px 的细断口（截图缩放会把手绘线打散）。
//   ③ 连通域 + 形状校准：轨迹是**细长弯曲的线**，而 UI 上的红圈「终」、红色 POI
//      图标、左上关闭按钮都是**圆形/实心块**。判据是「骨架长 / bbox 对角线」——
//      一条线的骨架长必然明显超过 bbox 对角线；圆环只有对角线的 0.5~0.6 倍。
//      这一条能把红圈按钮从轨迹里踢出去，是原版工具（只按面积过滤）做不到的。
//   ④ 每段骨架化（Zhang-Suen）→ 修剪成 1px → 在分叉/端点处切成若干「简单链」，
//      这样分叉处的每条支线都会被走到，不会被抄近路画成假直线。
//   ⑤ 自动画路径（见 trackAuto.ts）：按连通簇分组后，在「点 + 邻接」图上找最长测地线
//      当主干；主轴之外的短枝丢掉、长枝按往返写回点列。**跨簇不连**、**不跨 gapPx 硬接**。
//   ⑥ 插值：弧长参数化 → 等距重采样（resamplePx）→ 移动平均平滑（smoothWin），
//      输出的点间距均匀，可直接喂给地图/绘图，也可按需加密。
//   ⑦ 校准：截图里有人眼一看就有的「官方里程」。给一个里程，就把整条路径换算成
//      米制（mPerPx = 里程米 / 路径像素长），同时算出「提取覆盖率」——这才是可
//      量化的精度指标：覆盖率 100% 说明一条红线都没漏。
//
// 纯函数、不碰 DOM：输入 ImageData 的 data 数组，输出点列。UI 只负责画和导出。
//
// 流水线按阶段拆在 ./trackExtract/ 下（types / mask / components / skeleton /
// geometry / scan / pipeline），本文件只做转出，调用方的 import 路径不变。

export type { TrackPoint, TrackSegment, ExtractOptions, Calibration, ExtractResult, SkeletonPath, ExtractPointsResult } from './trackExtract/types';
export { DEFAULT_OPTIONS } from './trackExtract/types';

export { buildRedMask, closeMask } from './trackExtract/mask';
export { labelComponents, type Component } from './trackExtract/components';
export {
  thinZhangSuen,
  pruneSkeleton,
  skeletonChains,
  type SkeletonChain,
} from './trackExtract/skeleton';
export { pathLength, resampleByArcLength, smoothMoving } from './trackExtract/geometry';
export { scanSkeleton, type ScanResult } from './trackExtract/scan';
export { extractPoints, buildTrack, extractTrack, toCsv } from './trackExtract/pipeline';
