// 跨设备操作（数据路由器）入口。

export * from './types';
export * from './url';
export { createDirectHost, createDirectClient, parseStun } from './direct';
export type { DirectClientSession, DirectHostSession, DirectChannel } from './direct';
export {
  getRemoteState,
  subscribeRemote,
  savedClientConfig,
  savedHostConfig,
  saveClientConfig,
  prepareClientBoot,
  bootClient,
  adoptDirectClient,
  adoptDirectHost,
  leaveRemoteAndReload,
  takeRemoteTip,
  startHost,
  stopHost,
  broadcastAppearance,
  initRemoteResilience,
  localDeviceName,
  relayInfo,
  ensureRelayListener,
  probeRemote,
  connectClient,
  type RemoteState,
  type RemoteMode,
  type RelayInfo,
} from './router';
