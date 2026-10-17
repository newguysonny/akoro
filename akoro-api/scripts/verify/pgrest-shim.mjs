// supabase-js calls <SUPABASE_URL>/rest/v1/… — PostgREST serves at /. Strip the prefix.
import http from "node:http";
const PORT = Number(process.env.SHIM_PORT || 3998), UP = Number(process.env.PGRST_PORT || 3999);
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, "") || "/";
  const p = http.request({ host: "127.0.0.1", port: UP, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${UP}` } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}).listen(PORT, () => console.log(`[shim] :${PORT} → PostgREST :${UP}`));
