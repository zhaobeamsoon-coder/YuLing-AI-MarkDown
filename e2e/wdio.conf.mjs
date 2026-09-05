import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const application = process.env.YULING_E2E_APP;

if (!application || !path.isAbsolute(application)) {
  throw new Error("YULING_E2E_APP must be an absolute executable path");
}

export const config = {
  runner: "local",
  specs: [path.join(configDirectory, "specs/**/*.e2e.mjs")],
  maxInstances: 1,
  logLevel: "warn",
  hostname: "127.0.0.1",
  port: 4_445,
  path: "/",
  bail: 0,
  waitforTimeout: 5_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 3,
  capabilities: [{
    browserName: "tauri",
    "tauri:options": { application },
  }],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
