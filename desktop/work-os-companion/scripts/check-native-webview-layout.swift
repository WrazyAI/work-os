// Real macOS WKWebView, production-built CSS/React, no employee session.
import AppKit
import WebKit

final class Probe: NSObject, WKNavigationDelegate {
    let window: NSWindow
    let webview: WKWebView
    var tries = 0
    override init() {
        webview = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 760))
        window = NSWindow(contentRect: webview.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        super.init()
        window.contentView = webview
        window.center()
        window.makeKeyAndOrderFront(nil)
        webview.navigationDelegate = self
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { check() }
    func check() {
        tries += 1
        webview.evaluateJavaScript("""
        (() => {
          const selectors=['.guided-onboarding','.onboarding-workspace','.phase-content','.phase-actions'];
          const result={viewport:{width:innerWidth,height:innerHeight},userAgent:navigator.userAgent};
          for(const selector of selectors){
            const e=document.querySelector(selector);if(!e)return null;
            const r=e.getBoundingClientRect(),s=getComputedStyle(e);
            result[selector]={top:r.top,bottom:r.bottom,height:r.height,display:s.display,overflow:s.overflow,scrollHeight:e.scrollHeight};
          }
          const f=result['.phase-actions']; result.footerVisible=f.top>=0&&f.bottom<=innerHeight+1&&f.height>0;
          result.cards=document.querySelectorAll('.archetype-grid>button').length;
          return JSON.stringify(result);
        })()
        """) { value, error in
            guard error == nil, let output = value as? String else {
                if self.tries < 30 { DispatchQueue.main.asyncAfter(deadline: .now()+1) {self.check()}; return }
                fputs("WKWebView fixture did not render: \(String(describing: error))\n", stderr); exit(1)
            }
            print(output)
            let parsed = try? JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String:Any]
            self.webview.takeSnapshot(with: nil) { image, _ in
                if let image = image, let tiff = image.tiffRepresentation,
                   let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using:.png, properties:[:]),
                   let temp = ProcessInfo.processInfo.environment["RUNNER_TEMP"] {
                    try? png.write(to: URL(fileURLWithPath: temp+"/native-window-webview.png"))
                }
                exit(parsed?["footerVisible"] as? Bool == true && parsed?["cards"] as? Int == 9 ? 0 : 1)
            }
        }
    }
}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let probe=Probe()
probe.webview.load(URLRequest(url:URL(string:"http://127.0.0.1:1437/native-layout-audit.html")!))
DispatchQueue.main.asyncAfter(deadline:.now()+60) { fputs("Native layout probe timed out\n",stderr);exit(1) }
app.run()
