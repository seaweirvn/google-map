import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const formatLine = (level, message, meta = {}) => {
  const time = new Date().toISOString();
  const payload = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `[${time}] [${level}] ${message}${payload}`;
};

export class Logger {
  constructor(logFile = config.logFile) {
    this.logFile = logFile;
  }

  async init() {
    await fs.mkdir(path.dirname(this.logFile), { recursive: true });
  }

  async write(level, message, meta = {}) {
    const line = formatLine(level, message, meta);
    console.log(line);
    await fs.appendFile(this.logFile, `${line}\n`, "utf8");
  }

  info(message, meta = {}) {
    return this.write("INFO", message, meta);
  }

  warn(message, meta = {}) {
    return this.write("WARN", message, meta);
  }

  error(message, meta = {}) {
    return this.write("ERROR", message, meta);
  }
}

export const logger = new Logger();
