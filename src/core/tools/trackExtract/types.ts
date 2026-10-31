// 轨迹提取的类型与默认参数。
//
// 流水线本身在同级目录下按阶段拆开（掩码 → 连通域 → 骨架 → 几何 → 扫描 → 串联），
// 这里只放它们共用的形状与一份默认阈值。

export interface TrackPoint {
  x: number;
  y: number;
}

/** 一段连续轨迹（断口切开后的一段） */
export interface TrackSegment {
  /** 已平滑、等距重采样的点（图像像素坐标，原点左上，y 向下） */
  points: TrackPoint[];
  /** 段内累计长度（像素） */
  lengthPx: number;
  /** 原始骨架像素数，用于报告 */
  skelPx: number;
  /** 原始连通域面积（像素） */
  area: number;
}

export interface ExtractOptions {
  /** 饱和度下限 0~255 */
  redSat: number;
  /** 明度下限 0~255 */
  redVal: number;
  /** 红色色相上界（°），通常 10~18 */
  hueHi: number;
  /** 品红色相下界（°），通常 160~172 */
  hueLo: number;
  /** R 相对 G/B 的优势倍数，1.0 = 不做判据，1.3~1.5 较稳 */
  rDominance: number;
  /** 连通域最小面积（像素），小于此视为噪点 */
  minArea: number;
  /** 骨架最短长度（像素），小于此视为图标/碎片 */
  minSkelPx: number;
  /** 毛刺阈值（像素）：短于此且一端连着分叉点的链视为细化毛刺，丢弃 */
  spurPx: number;
  /** 闭运算迭代次数（3x3），0 = 不做 */
  closeIter: number;
  /** 允许串联的最大段间距（像素），超过则断成两段 */
  gapPx: number;
  /** 平滑窗口（奇数，点数），1 = 不平滑 */
  smoothWin: number;
  /** 重采样点间距（像素） */
  resamplePx: number;
  /** 最终成段后的最小长度（像素），短于此视为噪点碎片丢弃（几米量级，无意义） */
  minFinalPx: number;
  /** 骨架计算的降采样倍数（1 = 原分辨率，2 = 快 4 倍、误差 <=2px） */
  skeletonScale: number;
  /** 官方里程（公里）：用于输出米制坐标，或（与比例尺同给时）验收覆盖率 */
  mileageKm: number;
  /** 截图比例尺代表的米数（如 500m 那条 = 500）；与 scalePx 同时 >0 才生效 */
  scaleMeter: number;
  /** 比例尺条在截图上的像素宽度 */
  scalePx: number;
}

export const DEFAULT_OPTIONS: ExtractOptions = {
  redSat: 75,
  redVal: 45,
  hueHi: 12,
  hueLo: 165,
  rDominance: 1.15,
  minArea: 300,
  minSkelPx: 24,
  spurPx: 16,
  closeIter: 2,
  gapPx: 60,
  smoothWin: 9,
  resamplePx: 2,
  minFinalPx: 45,
  // 必须 1：2x max-pool 会把 4~6px 的线拍成 2px 偶数宽，Zhang-Suen 细化不了
  // 偶数宽线（每个点都是关键点），骨架变成一片双排像素，切链时炸成几百条碎片。
  skeletonScale: 1,
  mileageKm: 0,
  scaleMeter: 0,
  scalePx: 0,
};

export interface Calibration {
  /** 每像素多少米；0 表示没校准 */
  mPerPx: number;
  /**
   * 比例尺来源：
   * - `scale`   用截图比例尺独立定标（最可信，可用来验收里程）
   * - `mileage` 用官方里程反推（能出米制坐标，但没有独立精度指标）
   * - `none`    没给任何校准信息，只输出像素
   */
  source: 'scale' | 'mileage' | 'none';
  /** 路径总像素长 */
  totalPx: number;
  /** 按 mPerPx 换算的路径总长（米） */
  totalM: number;
  /** 官方里程（米），没填为 0 */
  officialM: number;
  /**
   * 覆盖率 = 提取米数 / 官方里程。只有 `source === 'scale'` 且填了里程时才有效，
   * 否则为 -1（不适用）——这是本工具的精度指标：1.0 = 一条红线都没漏。
   */
  coverage: number;
}

export interface ExtractResult {
  /** 断口切开的各段（顺序即行走顺序），首段是主段 */
  segments: TrackSegment[];
  /** 断口记录：在哪两段之间、间距多少像素（被 gapPx 判为「不接」的） */
  gaps: { afterSegment: number; distPx: number }[];
  calibration: Calibration;
  stats: {
    /** 红色掩码像素数 */
    redPx: number;
    /** 通过校准的段数 */
    keptSegments: number;
    /** 被丢弃的段数 */
    droppedSegments: number;
    /** 丢弃原因统计 */
    droppedBy: Record<string, number>;
    /** 输出总点数 */
    outPoints: number;
    /** 耗时（毫秒） */
    ms: number;
  };
}

/** 骨架切出来的一段简单链（还没串联成「轨迹」，也没有整体顺序） */
export interface SkeletonPath {
  path: TrackPoint[];
  len: number;
  skelPx: number;
  area: number;
}

/**
 * 第一步「只提取点」的结果。
 *
 * 与 `ExtractResult` 的区别是「不串联、不排序、不重采样」——输出的是骨架点云，
 * 页面上就是一片点，还谈不上一条轨迹。轨迹留到第二步：自动连线（buildTrack）、
 * 手动点 A/B、或交给模型优化。
 */
export interface ExtractPointsResult {
  /** 保留下来的骨架链（只是短链，没有整体顺序；自动连线要用） */
  chains: SkeletonPath[];
  /** 去重后的骨架点：画在图上就是点云，也是「有多少点」的答案 */
  points: TrackPoint[];
  stats: {
    /** 红色掩码像素数 */
    redPx: number;
    /** 留下的骨架链数 */
    keptChains: number;
    /** 被丢弃的色块数 */
    droppedSegments: number;
    /** 丢弃原因统计 */
    droppedBy: Record<string, number>;
    /** 输出的点数 */
    outPoints: number;
    /** 耗时（毫秒） */
    ms: number;
  };
}
