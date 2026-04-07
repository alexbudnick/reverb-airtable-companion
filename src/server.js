import express from "express";
import { CFG, logger } from "./lib.js";
import { spawn } from "child_process";

const app = express();
const PORT = Number(process.env.PORT || 3000);

function requireSecret(req, res, next) {
  if (!CFG.triggerSecret) return next();
  if (req.query.secret !== CFG.triggerSecret) return res.status(401).json({ ok: false, error: "Invalid secret" });
  next();
}

function runScript(script, res) {
  const child = spawn("npm", ["run", script], { stdio: "inherit", shell: true });
  child.on("close", code => {
    if (code === 0) res.json({ ok: true, script });
    else res.status(500).json({ ok: false, script, code });
  });
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "reverb-airtable-companion-fixed-status" });
});

app.post("/jobs/reverb/orders-sync", requireSecret, (req, res) => runScript("sync-orders", res));
app.post("/jobs/reverb/listings-sync", requireSecret, (req, res) => runScript("sync-listings", res));

app.listen(PORT, () => logger("info", `Listening on port ${PORT}`));
