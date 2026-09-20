'use strict';

// lx 自定义音源宿主与 preload 共用的 IPC 事件名
// (移植自 lx-music-desktop src/main/modules/userApi/rendererEvent/name.js)
module.exports = {
  initEnv: 'lxSource-initEnv',
  init: 'lxSource-init',
  request: 'lxSource-request',
  response: 'lxSource-response',
  openDevTools: 'lxSource-openDevTools',
  showUpdateAlert: 'lxSource-showUpdateAlert',
  getProxy: 'lxSource-getProxy',
  proxyUpdate: 'lxSource-proxyUpdate',
};
