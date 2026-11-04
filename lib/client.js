window.__ModuleLoader__.load({
  id: "dsh-service-hub",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const CONSOLE_URL = "http://127.0.0.1:3999/";
    const API_URL = "http://127.0.0.1:3999/api/state";
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
            h("div", null, "本地控制台没有在运行。"),
            h("div", null, "双击 ", h("span", { style: C.code }, "F:\\agent\\local-console\\start.cmd"), " 启动后再点「刷新」。"),
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

    const inject = ["betterSidebar"];

    function apply(ctx) {
      ctx.effect(() => ctx.betterSidebar.registerTab({
        id: "service-hub",
        title: () => "服务",
        description: () => "本地控制台：启停本机的服务与脚本",
        icon: (size) => h("span", { style: { fontSize: (size || 16) * 0.9, lineHeight: 1 } }, "\u2699"),
        order: 60,
        hidden: false,
        component: () => h(ServiceHubView, null),
      }), "service-hub: tab");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});