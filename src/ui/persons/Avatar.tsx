// 头像显示组件：优先显示图片，没有图片时显示姓名首字
import { useEffect, useState } from 'react';
import { urlForFile } from '../../core/repo/files';

interface AvatarProps {
  name: string;
  avatar?: string | null;
  size?: 'sm' | 'lg';
  className?: string;
  onClick?: () => void;
}

export function Avatar({ name, avatar, size = 'sm', className = '', onClick }: AvatarProps) {
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

  const initials = name.slice(0, 1);
  const sizeClass = size === 'lg' ? 'avatar-lg' : '';
  const clickable = onClick ? 'avatar-clickable' : '';

  if (src) {
    return (
      <span
        className={`avatar ${sizeClass} ${clickable} ${className}`}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      >
        <img src={src} alt={name} />
      </span>
    );
  }

  return (
    <span
      className={`avatar ${sizeClass} ${clickable} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {initials}
    </span>
  );
}
