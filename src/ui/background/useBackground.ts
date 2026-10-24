// React hook：订阅服务/任务中心。

import { useSyncExternalStore } from 'react';
import { subscribe, getServices, getTasks } from '../../core/background/center';

export function useBackground() {
  const services = useSyncExternalStore(subscribe, getServices);
  const tasks = useSyncExternalStore(subscribe, getTasks);
  return { services, tasks };
}
