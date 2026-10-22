// 头像显示组件
//
// 显示优先级：自定义图标（与事件集图标同一套：单文字 / 双字母 / SVG / 图片 + 配色）
//   → 老头像图片（`file:<id>`，为老数据保留）
//   → 姓名首字。
import { useEffect, useState } from 'react';
import { urlForFile } from '../../core/repo/files';
import type { CollectionIcon } from '../../core/types';
import { CollectionIconView } from '../collections/CollectionIcon';

interface AvatarProps {
  name: string;
  avatar?: string | null;
  icon?: CollectionIcon | null;
  size?: 'sm' | 'lg';
  className?: string;
  onClick?: () => void;
}

export function Avatar({ name, avatar, icon, size = 'sm', className = '', onClick }: AvatarProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fileId = avatar?.startsWith('file:') ? avatar.slice(5) : null;
    if (fileId) {
      urlForFile(fileId).then((url) => {
        if (alive) setSrc(url);
      });
    } else {
      setSrc(null);
    }
    return () => {
      alive = false;
    };
  }, [avatar]);

  const sizeClass = size === 'lg' ? 'avatar-lg' : '';
  const clickable = onClick ? 'avatar-clickable' : '';
  const handlers = {
    onClick,
    role: onClick ? ('button' as const) : undefined,
    tabIndex: onClick ? 0 : undefined,
    onKeyDown: onClick ? (e: React.KeyboardEvent) => e.key === 'Enter' && onClick() : undefined,
  };

  // 自定义图标优先：直接复用事件集图标的渲染，配色/字体/图片规则不用再写一遍
  if (icon) {
    return (
      <span className={`avatar avatar-icon ${sizeClass} ${clickable} ${className}`} {...handlers}>
        <CollectionIconView icon={icon} size={size === 'lg' ? 'lg' : 'sm'} fallback={name} />
      </span>
    );
  }

  if (src) {
    return (
      <span className={`avatar ${sizeClass} ${clickable} ${className}`} {...handlers}>
        <img src={src} alt={name} />
      </span>
    );
  }

  // 默认外观与事件集一致：文字颜色头像（首字 + 按名字散列的配色），只是外形保持圆形
  return (
    <span className={`avatar avatar-icon ${sizeClass} ${clickable} ${className}`} {...handlers}>
      <CollectionIconView icon={null} size={size === 'lg' ? 'lg' : 'sm'} fallback={name} />
    </span>
  );
}
