// 跨设备操作（数据路由器）入口。

export * from './types';
export * from './url';
export {
  getRemoteState,
  subscribeRemote,
  savedClientConfig,
  savedHostConfig,
  prepareClientBoot,
  bootClient,
  leaveRemoteAndReload,
  takeRemoteTip,
  startHost,
  stopHost,
  relayInfo,
  ensureRelayListener,
  probeRemote,
  connectClient,
  type RemoteState,
  type RemoteMode,
  type RelayInfo,
} from './router';
