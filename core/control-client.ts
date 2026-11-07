import { request } from "node:http";
import type { Command } from "./state.ts";
export function control(socket: string, command: Command): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: socket,
        path: "/",
        method: "POST",
        headers: { "content-type": "application/json" },
        timeout: command.kind === "preview" ? 960000 : 15000,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) reject(new Error(text));
            else resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Supervisor unavailable")));
    req.on("error", reject);
    req.end(JSON.stringify(command));
  });
}
