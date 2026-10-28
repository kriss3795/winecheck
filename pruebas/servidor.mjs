// Servidor de prueba: sirve dist/ y la función /api/geo igual que Vercel.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import handler from "../api/geo.js";

const RAIZ = path.resolve("dist");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/api/geo") {
      req.query = Object.fromEntries(u.searchParams);
      res.status = (c) => ((res.statusCode = c), res);
      res.json = (o) => (res.setHeader("Content-Type", "application/json"), res.end(JSON.stringify(o)));
      res.send = (b) => res.end(b);
      try {
        await handler(req, res);
      } catch (e) {
        res.statusCode = 500;
        res.end(String(e));
      }
      return;
    }
    let f = path.join(RAIZ, decodeURIComponent(u.pathname));
    if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(RAIZ, "index.html");
    res.setHeader("Content-Type", TIPOS[path.extname(f)] || "application/octet-stream");
    fs.createReadStream(f).pipe(res);
  })
  .listen(4173, () => console.log("servidor de prueba en 4173"));
