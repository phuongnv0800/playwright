import http from "node:http";

interface FixtureServer {
  baseUrl: string;
  deliveries: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

function html(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body>${body}</body></html>`;
}

export async function createFixtureServer(): Promise<FixtureServer> {
  const deliveries: Array<Record<string, unknown>> = [];

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const cookie = request.headers.cookie ?? "";

    if (request.method === "GET" && url.pathname === "/login") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <form id="login-form">
            <input data-field="username" name="username" />
            <input data-field="password" type="password" name="password" />
            <button type="submit">Login</button>
          </form>
          <script>
            document.getElementById("login-form").addEventListener("submit", (event) => {
              event.preventDefault();
              const username = document.querySelector('[data-field="username"]').value;
              const password = document.querySelector('[data-field="password"]').value;
              if (username === "demo" && password === "secret") {
                document.cookie = "session=ok; path=/";
                window.location.href = "/records";
              }
            });
          </script>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/records") {
      if (!cookie.includes("session=ok")) {
        response.statusCode = 302;
        response.setHeader("location", "/login");
        response.end();
        return;
      }

      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main data-authenticated="true" data-page="records">
            <article data-record>
              <span data-field="id">DOC-001</span>
              <span data-field="title">Alpha</span>
              <span data-field="status">open</span>
            </article>
            <article data-record>
              <span data-field="id">DOC-002</span>
              <span data-field="title">Beta</span>
              <span data-field="status">closed</span>
            </article>
          </main>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/login-otp") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <form id="login-form">
            <input data-field="username" name="username" />
            <input data-field="password" type="password" name="password" />
            <button type="submit">Login</button>
          </form>
          <div id="otp-step" style="display:none;">
            <input name="otpCode" autocomplete="one-time-code" />
            <button id="verify-otp" type="button">Verify</button>
          </div>
          <script>
            document.getElementById("login-form").addEventListener("submit", (event) => {
              event.preventDefault();
              const username = document.querySelector('[data-field="username"]').value;
              const password = document.querySelector('[data-field="password"]').value;
              if (username === "demo" && password === "secret") {
                document.getElementById("otp-step").style.display = "block";
              }
            });
            document.getElementById("verify-otp").addEventListener("click", () => {
              const otpCode = document.querySelector('input[name="otpCode"]').value;
              if (otpCode === "654321") {
                document.cookie = "session_otp=ok; path=/";
                window.location.href = "/records-otp";
              }
            });
          </script>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/records-otp") {
      if (!cookie.includes("session_otp=ok")) {
        response.statusCode = 302;
        response.setHeader("location", "/login-otp");
        response.end();
        return;
      }

      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main data-authenticated="true">
            <article>
              <h1>OTP Protected Records</h1>
              <p>OTP-authenticated page for fixture tests.</p>
            </article>
          </main>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/login-otp-vnpt") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <form id="login-form">
            <input data-field="username" name="username" />
            <input data-field="password" type="password" name="password" />
            <button type="submit">ĐĂNG NHẬP</button>
          </form>
          <script>
            function mountOtpStep() {
              document.body.innerHTML = \`
                <form id="loginForm">
                  <div>Xin vui lòng nhập mã xác thực OTP của bạn</div>
                  <input id="passOTP" name="validate_pass_otp" type="text" />
                  <button>ĐĂNG NHẬP</button>
                </form>
              \`;
              document.getElementById("loginForm").addEventListener("submit", (event) => {
                event.preventDefault();
                const otpCode = document.getElementById("passOTP").value;
                if (otpCode === "728989") {
                  document.cookie = "session_vnpt_otp=ok; path=/";
                  window.location.href = "/records-otp-vnpt";
                }
              });
            }

            document.getElementById("login-form").addEventListener("submit", (event) => {
              event.preventDefault();
              const username = document.querySelector('[data-field="username"]').value;
              const password = document.querySelector('[data-field="password"]').value;
              if (username === "demo" && password === "secret") {
                mountOtpStep();
              }
            });
          </script>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/records-otp-vnpt") {
      if (!cookie.includes("session_vnpt_otp=ok")) {
        response.statusCode = 302;
        response.setHeader("location", "/login-otp-vnpt");
        response.end();
        return;
      }

      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main data-authenticated="true">
            <article>
              <h1>VNPT-style OTP Protected Records</h1>
              <p>OTP step uses a text button without type="submit".</p>
            </article>
          </main>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/otp/latest") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ code: "654321" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth-protected") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main>
            <button id="oauth-trigger" type="button">Continue with Google</button>
          </main>
          <script>
            document.getElementById("oauth-trigger").addEventListener("click", () => {
              window.location.href = "/oauth-provider";
            });
          </script>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth-provider") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <form id="oauth-form">
            <input type="email" name="identifier" />
            <input type="password" name="password" />
            <button type="submit">Sign in</button>
          </form>
          <script>
            document.getElementById("oauth-form").addEventListener("submit", (event) => {
              event.preventDefault();
              const email = document.querySelector('input[name="identifier"]').value;
              const password = document.querySelector('input[name="password"]').value;
              if (email === "oauth@example.com" && password === "oauth-secret") {
                document.cookie = "session_oauth=ok; path=/";
                window.location.href = "/oauth-protected/records";
              }
            });
          </script>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth-protected/records") {
      if (!cookie.includes("session_oauth=ok")) {
        response.statusCode = 302;
        response.setHeader("location", "/oauth-protected");
        response.end();
        return;
      }

      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main data-authenticated="true">
            <article>
              <h1>OAuth Protected Records</h1>
              <p>OAuth-authenticated page for fixture tests.</p>
            </article>
          </main>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/catalog") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main>
            <section class="catalog-grid">
              <article class="card">
                <h2><a href="/catalog/item-a">Quarterly Revenue Update</a></h2>
                <p>Finance team summary for the latest quarter.</p>
              </article>
              <article class="card">
                <h2><a href="/catalog/item-b">Supplier Delivery Policy</a></h2>
                <p>Updated document about supplier lead time policy.</p>
              </article>
              <article class="card">
                <h2><a href="/catalog/item-c">Warehouse Safety Checklist</a></h2>
                <p>Checklist used by operations managers during inspections.</p>
              </article>
            </section>
            <nav><a href="/catalog/page-2">Next page</a></nav>
          </main>
        `),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/catalog/page-2") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main>
            <section class="catalog-grid">
              <article class="card">
                <h2><a href="/catalog/item-d">Office Renovation Memo</a></h2>
                <p>Memo about the office renovation schedule and seating changes.</p>
              </article>
            </section>
            <nav><a href="/catalog">Previous page</a></nav>
          </main>
        `),
      );
      return;
    }

    if (request.method === "GET" && /^\/catalog\/item-/.test(url.pathname)) {
      const titleMap: Record<string, string> = {
        "/catalog/item-a": "Quarterly Revenue Update",
        "/catalog/item-b": "Supplier Delivery Policy",
        "/catalog/item-c": "Warehouse Safety Checklist",
        "/catalog/item-d": "Office Renovation Memo",
      };
      const title = titleMap[url.pathname] ?? "Unknown document";
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        html(`
          <main>
            <article>
              <h1>${title}</h1>
              <p>This document is part of the fixture mini-site used for URL-only discovery tests.</p>
              <p>It contains enough text for the crawler to treat it like a detail page and extract content.</p>
              <p>Reference URL: ${url.pathname}</p>
            </article>
          </main>
        `),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }

      const raw = Buffer.concat(chunks).toString("utf8");
      deliveries.push(JSON.parse(raw));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.statusCode = 404;
    response.end("Not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind fixture server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    deliveries,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
