/**
 * dsh-service-hub — Host 侧。
 *
 * 本插件是纯 UI bundle：侧栏面板内嵌本地控制台（http://127.0.0.1:3999），
 * 进程启停与登记表都由那个独立守护进程负责，因此 Host 侧不注册任何资源、
 * 不改变 Harness 行为。签名保留 ctx/config 以便将来扩展（例如兜底拉起控制台）。
 */
export const name = 'service-hub';

export function apply(_ctx, _config) {
  // 故意为空：无 Host 侧贡献
}