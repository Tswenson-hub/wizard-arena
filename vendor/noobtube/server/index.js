import { Worker } from "node:worker_threads";
import { WebSocketServer } from "ws";
// server/index.js
const WORKER = new URL("./worker.js", import.meta.url);
function attach(httpServer, opts = {}) {
	const path = opts.path ?? "/nt";
	const log = opts.quiet ? () => {} : (...a) => console.log(...a);
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: 65536
	});
	const sockets = /* @__PURE__ */ new Map();
	let nextCid = 1, worker = null, ready = false, restarts = 0, stopped = false;
	let lastPerf = null;
	function startWorker() {
		ready = false;
		worker = new Worker(WORKER, { workerData: {
			maxRooms: opts.maxRooms,
			maxBots: opts.maxBots,
			emptyTtl: opts.emptyTtl,
			quiet: opts.quiet,
			testHooks: opts.testHooks,
			domOpts: opts.domOpts,
			perfEvery: opts.perfEvery
		} });
		worker.on("message", (m) => {
			if (m.k === "send") for (const cid of m.cids) {
				const ws = sockets.get(cid);
				if (ws && ws.readyState === 1) ws.send(m.data);
			}
			else if (m.k === "drop") sockets.get(m.cid)?.close(m.code ?? 1e3, m.reason ?? "");
			else if (m.k === "perf") lastPerf = m.perf;
			else if (m.k === "ready") {
				ready = true;
				for (const cid of sockets.keys()) worker.postMessage({
					k: "open",
					cid
				});
			}
		});
		worker.on("error", (e) => console.error("[nt] worker error", e));
		worker.on("exit", (code) => {
			if (stopped) return;
			console.error(`[nt] worker exited (${code}); restarting`);
			for (const ws of sockets.values()) ws.close(1012, "server restart");
			sockets.clear();
			if (++restarts > (opts.maxRestarts ?? 20)) {
				console.error("[nt] too many worker restarts; giving up");
				return;
			}
			setTimeout(startWorker, Math.min(5e3, 200 * restarts));
		});
	}
	startWorker();
	wss.on("connection", (ws) => {
		const cid = nextCid++;
		sockets.set(cid, ws);
		ws.isAlive = true;
		ws.on("pong", () => {
			ws.isAlive = true;
		});
		if (ready) worker.postMessage({
			k: "open",
			cid
		});
		ws.on("message", (raw) => {
			if (ready) worker.postMessage({
				k: "msg",
				cid,
				data: String(raw)
			});
		});
		ws.on("close", () => {
			if (sockets.delete(cid) && ready) worker.postMessage({
				k: "close",
				cid
			});
		});
		ws.on("error", () => {});
	});
	const claims = (req) => {
		let pathname;
		try {
			pathname = new URL(req.url, "http://x").pathname;
		} catch {
			return false;
		}
		return pathname === path || pathname === path + "/";
	};
	const onUpgrade = (req, socket, head) => {
		if (!claims(req)) return;
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
	};
	httpServer.on("upgrade", onUpgrade);
	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			if (ws.isAlive === false) {
				ws.terminate();
				continue;
			}
			ws.isAlive = false;
			ws.ping();
		}
	}, opts.heartbeatMs ?? 15e3);
	log(`[nt] Noob Tube attached on ${path}`);
	return {
		wss,
		claims,
		get worker() {
			return worker;
		},
		healthz: () => `ok nt sockets=${sockets.size} rooms=${lastPerf?.rooms ?? 0} humans=${lastPerf?.humans ?? 0} bots=${lastPerf?.bots ?? 0} restarts=${restarts}`,
		perf: () => lastPerf ?? { pending: "the first perf window" },
		sockets: () => sockets.size,
		async close() {
			stopped = true;
			clearInterval(heartbeat);
			httpServer.off("upgrade", onUpgrade);
			for (const ws of sockets.values()) ws.terminate();
			sockets.clear();
			wss.close();
			await worker.terminate();
		}
	};
}
export { attach };
