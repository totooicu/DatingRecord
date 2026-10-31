// 顶部的「1 导入图片 → 5 地图对齐」步骤条。
//
// 它自己不做任何决定：哪些步能点（canPickDots / hasDots / hasPath）由父组件算好传进来，
// 点了之后要做什么（onPickImage / onRunPoints / …）也是父组件的回调——
// 因为那些动作要同时动 tab、mode、status 好几个状态，留在组件里就是散落的 setState。

import { STEPS } from './model';

export interface TrackStepsProps {
  stage: 1 | 2 | 3 | 4 | 5;
  /** 已经导入图且没在忙：才允许「自动取点」 */
  canPickDots: boolean;
  /** 点云里有东西：才允许修点 / 画路径 */
  hasDots: boolean;
  /** 已经出路径（算法或手动）：才允许去地图 */
  hasPath: boolean;
  onPickImage: () => void;
  onRunPoints: () => void;
  onFixDots: () => void;
  onAutoLink: () => void;
  onGotoMap: () => void;
}

export function TrackSteps({
  stage,
  canPickDots,
  hasDots,
  hasPath,
  onPickImage,
  onRunPoints,
  onFixDots,
  onAutoLink,
  onGotoMap,
}: TrackStepsProps) {
  return (
    <div className="lab-track-steps">
      {STEPS.map(({ n, label }) => {
        const disabled =
          (n === 2 && !canPickDots) ||
          ((n === 3 || n === 4) && !hasDots) ||
          (n === 5 && !hasPath);
        const onClick =
          n === 1 ? onPickImage
          : n === 2 ? onRunPoints
          : n === 3 ? onFixDots
          : n === 4 ? onAutoLink
          : onGotoMap;
        return (
          <button
            key={n}
            type="button"
            className={`lab-track-step${stage === n ? ' on' : ''}${n < stage ? ' done' : ''}`}
            aria-current={stage === n ? 'step' : undefined}
            disabled={disabled}
            onClick={onClick}
          >
            <i>{n}</i>
            {label}
          </button>
        );
      })}
    </div>
  );
}
