// Stands in for scripts/app-server-broker.mjs in tests: records its pid and listens on the endpoint.
import fs from "node:fs";
import net from "node:net";

const args = process.argv.slice(2);
const endpoint = args[args.indexOf("--endpoint") + 1];
const pidFile = args[args.indexOf("--pid-file") + 1];
fs.writeFileSync(pidFile, `${process.pid}\n`);
net.createServer((socket) => socket.on("error", () => {})).listen(endpoint.slice("unix:".length));
