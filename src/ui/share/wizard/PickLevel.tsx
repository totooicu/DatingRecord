// 第 3 步：分享程度——人物资料留多少、要不要带附件。
// 事件集和事件固定就是前两步圈定的那些，这一步只决定人物资料。

import { SHARE_LEVELS, type AttributeDef, type ShareLevel } from '../../../core/types';

export function PickLevel({
  level,
  attrKeys,
  withAttachments,
  levelDefs,
  onLevel,
  onAttrKeys,
  onAttachments,
}: {
  level: ShareLevel;
  /** custom 程度下勾选要带走的属性 key */
  attrKeys: string[];
  withAttachments: boolean;
  levelDefs: AttributeDef[];
  onLevel: (lv: ShareLevel) => void;
  onAttrKeys: (keys: string[]) => void;
  onAttachments: (v: boolean) => void;
}) {
  return (
    <div className="share-levels">
      <p className="muted small">事件集和事件固定就是前两步圈定的那些，这里只决定人物资料留多少。</p>
      {SHARE_LEVELS.map((lv) => (
        <label key={lv.key} className={level === lv.key ? 'share-level share-level-on' : 'share-level'}>
          <input
            type="radio"
            name="share-level"
            checked={level === lv.key}
            onChange={() => onLevel(lv.key)}
          />
          <span className="share-level-text">
            <strong>{lv.title}</strong>
            <span className="muted small">{lv.desc}</span>
          </span>
        </label>
      ))}

      {level === 'custom' && (
        <div className="share-attrs">
          <div className="share-attrs-title">带哪些属性</div>
          {levelDefs.length === 0 && <p className="muted small">属性字典还是空的，只能带走姓名。</p>}
          <div className="share-attr-list">
            {levelDefs.map((d) => (
              <label key={d.key} className="checkbox">
                <input
                  type="checkbox"
                  checked={attrKeys.includes(d.key)}
                  onChange={(e) =>
                    onAttrKeys(e.target.checked ? [...attrKeys, d.key] : attrKeys.filter((k) => k !== d.key))
                  }
                />
                {d.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="checkbox share-attach-toggle">
        <input
          type="checkbox"
          checked={withAttachments}
          onChange={(e) => onAttachments(e.target.checked)}
        />
        带上正文引用的图片与附件
      </label>

      {level !== 'full' && <p className="muted small">这个程度下，标记为隐私的事件整条不带走。</p>}
    </div>
  );
}
