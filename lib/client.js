window.__ModuleLoader__.load({
  id: "dsh-service-hub",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const CONSOLE_URL = "http://127.0.0.1:3999/";
    const API_URL = "http://127.0.0.1:3999/api/state";
    const TAB_ID = "servicehub";
    const TAB_KIND = "servicehub";
    const ADDRESS = "dsh-resource://servicehub/panel";
    const h = react.createElement;

    const C = {
      bar: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", borderBottom: "1px solid var(--dsw-alias-border-l1, #2a2f3a)", flex: "0 0 auto", fontSize: "12px" },
      dot: { width: "8px", height: "8px", borderRadius: "50%", flex: "0 0 auto" },
      grow: { flex: "1 1 auto" },
      btn: { background: "transparent", border: "1px solid var(--dsw-alias-border-l1, #2a2f3a)", color: "inherit", borderRadius: "6px", padding: "2px 8px", fontSize: "12px", cursor: "pointer" },
      frame: { flex: "1 1 auto", width: "100%", border: 0, minHeight: 0, background: "#0b0e14" },
      offline: { flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "24px", textAlign: "center", fontSize: "12px", color: "var(--dsw-alias-label-secondary, #9aa4b2)" },
      code: { fontFamily: "ui-monospace, Consolas, monospace", background: "rgba(255,255,255,.06)", padding: "2px 6px", borderRadius: "4px" },
    };

    function StatusDot(color) {
      return h("span", { style: Object.assign({}, C.dot, { background: color }) });
    }

    function ServiceHubView() {
      const [status, setStatus] = react.useState("checking");
      const [nonce, setNonce] = react.useState(0);

      react.useEffect(() => {
        let alive = true;
        const check = () => {
          fetch(API_URL, { cache: "no-store" })
            .then((r) => { if (alive) setStatus(r.ok ? "up" : "down"); })
            .catch(() => { if (alive) setStatus("down"); });
        };
        check();
        const timer = setInterval(check, 5000);
        return () => { alive = false; clearInterval(timer); };
      }, [nonce]);

      const label = status === "up" ? "已连接" : status === "down" ? "未连接" : "检测中…";
      const color = status === "up" ? "#3fb950" : status === "down" ? "#f85149" : "#d29922";

      const toolbar = h("div", { style: C.bar },
        StatusDot(color),
        h("span", null, label),
        h("span", { style: C.grow }),
        h("button", { style: C.btn, onClick: () => setNonce((n) => n + 1) }, "刷新"),
        h("button", { style: C.btn, onClick: () => window.open(CONSOLE_URL, "_blank", "noopener") }, "在浏览器打开")
      );

      const body = status === "down"
        ? h("div", { style: C.offline },
            h("div", null, "本地控制台未就绪。"),
            h("div", null, "插件会在后台自动启动它（首次约需 2-3 秒）；仍未连上时点「刷新」重试。"),
            h("div", null, "若持续未连接：检查端口 ", h("span", { style: C.code }, "3999"), " 是否被占用，或查看日志 ", h("span", { style: C.code }, "~/.dsh-service-hub/logs/console.log"), "。"),
            h("div", null, "已启动的服务不受影响；控制台只是管理界面。")
          )
        : h("iframe", {
            key: nonce,
            src: CONSOLE_URL,
            title: "本地控制台",
            style: C.frame,
            allow: "clipboard-write",
          });

      return h("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, toolbar, body);
    }

    function TabTitle() {
      return h("span", null, "\u2699 服务");
    }

    function OpenButton() {
      const open = () => {
        try {
          if (ctxRef.sidebarRight && typeof ctxRef.sidebarRight.openResource === "function") {
            ctxRef.sidebarRight.openResource(ADDRESS, { kind: TAB_KIND });
          }
        } catch (error) {
          console.error("[dsh-service-hub] open tab failed:", error);
        }
      };
      return h("button", {
        type: "button",
        title: "服务面板：启停本机服务",
        "aria-label": "打开服务面板",
        onClick: open,
        style: C.btn,
      }, "\u2699 服务");
    }

    let ctxRef = null;

    /**
     * 注册策略（不强依赖任何第三方插件）：
     *  1) 官方：右栏标签类型 + body + 标题 + 会话头部入口按钮（始终注册）
     *  2) 可选：若安装了 dsh-better-sidebar，额外在左侧栏注册一个同名标签
     */
    function apply(ctx) {
      ctxRef = ctx;

      // ---- 官方通道（不依赖任何第三方插件）----
      // 每一段独立 try/catch：任一 API 缺失只降级该入口，不影响其他入口。
      if (ctx.sidebarRightTabs && typeof ctx.sidebarRightTabs.register === "function") {
        try {
          ctx.effect(() => ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            patterns: ["dsh-resource://servicehub/**"],
            canOpen: (address) => typeof address === "string" && address.indexOf("dsh-resource://servicehub/") === 0,
            title: () => "服务",
          }), "service-hub: sidebar-right tab type");
        } catch (error) {
          console.error("[dsh-service-hub] sidebarRightTabs.register failed:", error);
        }
      }

      if (ctx.slots && typeof ctx.slots.inject === "function") {
        const reg = (slot, options, component, label) => {
          try {
            ctx.slots.inject(slot, () => ctx.slots.register(options, component));
          } catch (error) {
            console.error("[dsh-service-hub] slots.inject failed for " + slot + ":", error);
          }
        };
        reg("sidebar.right.pane.tab", { name: "sidebar.right.pane.tab", key: TAB_ID }, ServiceHubView);
        reg("sidebar.right.pane.tab.title", { name: "sidebar.right.pane.tab.title", key: TAB_ID }, TabTitle);
        reg("conversation.session.header.actions", { name: "conversation.session.header.actions", id: "service-hub-open", order: 30 }, OpenButton);
      }

      // ---- 可选通道：装了 dsh-better-sidebar 就额外给左侧栏一个标签 ----
      let sidebar;
      try {
        sidebar = typeof ctx.get === "function" ? ctx.get("betterSidebar") : undefined;
      } catch (error) {
        sidebar = undefined;
      }
      if (sidebar && typeof sidebar.registerTab === "function") {
        try {
          ctx.effect(() => sidebar.registerTab({
            id: "service-hub",
            title: () => "服务",
            description: () => "本地控制台：启停本机的服务与脚本",
            icon: (size) => h("span", { style: { fontSize: (size || 16) * 0.9, lineHeight: 1 } }, "\u2699"),
            order: 60,
            hidden: false,
            component: () => h(ServiceHubView, null),
          }), "service-hub: betterSidebar tab");
        } catch (error) {
          console.error("[dsh-service-hub] betterSidebar.registerTab failed:", error);
        }
      }
    }

    const inject = ["slots", "sidebarRight", "sidebarRightTabs"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});