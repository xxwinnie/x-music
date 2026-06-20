import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { MusicFreeService } from "../dist/services/musicfree-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePluginPath = join(__dirname, "fixtures", "mock-plugin.js");

test("installs a local MusicFree plugin and downloads a resolved candidate", async (t) => {
  const workspace = await createWorkspace(t);
  const server = await createMediaServer(t);
  const service = new MusicFreeService({
    dataDir: workspace.dataDir,
    downloadDir: workspace.downloadDir,
    defaultQuality: "standard"
  });

  const installed = await service.installPlugin({ source: fixturePluginPath });
  assert.equal(installed.platform, "MockSource");
  assert.equal(installed.version, "1.0.0");

  await service.setPluginVariables(installed.id, { baseUrl: server.url, ignored: "value" });

  const search = await service.search({ query: "Needle", page: 2 });
  assert.equal(search.errors.length, 0);
  assert.equal(search.candidates.length, 1);
  assert.equal(search.candidates[0].title, "Needle Song");

  const candidateId = search.candidates[0].candidateId;
  const resolved = await service.resolve({ candidateId, quality: "standard" });
  assert.equal(resolved.source.hasHeaders, true);
  assert.equal(resolved.source.hasUserAgent, true);

  const lyrics = await service.lyrics(candidateId);
  assert.equal(lyrics.lyric.rawLrc, "[00:00.00]Needle Song");

  const download = await service.download({
    resolvedId: resolved.resolvedId,
    includeLyrics: true
  });

  assert.match(download.path, /Mock Artist - Needle Song\.mp3$/);
  assert.equal(await readFile(download.path, "utf8"), "mock audio bytes");
  assert.equal(await readFile(download.lyricPath, "utf8"), "[00:00.00]Needle Song");

  const sidecar = JSON.parse(await readFile(download.sidecarPath, "utf8"));
  assert.equal(sidecar.candidate.item.title, "Needle Song");
  assert.equal(server.requests[0].headers["x-musicfree-test"], "yes");
  assert.equal(server.requests[0].headers["user-agent"], "OpenClawMusicFreeBridgeTest/1.0");

  const secondDownload = await service.download({
    resolvedId: resolved.resolvedId
  });
  assert.match(secondDownload.path, /Mock Artist - Needle Song \(2\)\.mp3$/);
  assert.equal(await readFile(download.path, "utf8"), "mock audio bytes");
  assert.equal(await readFile(secondDownload.path, "utf8"), "mock audio bytes");
});

test("installs from a MusicFree subscription and honors enabled state", async (t) => {
  const workspace = await createWorkspace(t);
  const fixtureCode = await readFile(fixturePluginPath, "utf8");
  const server = await createSubscriptionServer(t, fixtureCode);
  const service = new MusicFreeService({
    dataDir: workspace.dataDir,
    downloadDir: workspace.downloadDir,
    allowRemotePluginInstall: true
  });

  const result = await service.subscribe(`${server.url}/plugins.json`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.installed.length, 1);
  const subscriptions = await service.listSubscriptions();
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].desc, "Mock subscription");

  const [plugin] = await service.listPlugins();
  await service.setPluginEnabled(plugin.id, false);
  const disabledSearch = await service.search({ query: "Quiet" });
  assert.equal(disabledSearch.candidates.length, 0);

  await service.setPluginEnabled(plugin.id, true);
  await service.setPluginVariables(plugin.id, { baseUrl: server.url });
  const enabledSearch = await service.search({ query: "Loud" });
  assert.equal(enabledSearch.candidates.length, 1);

  const refreshed = await service.refreshSubscriptions(true);
  assert.equal(refreshed.count, 1);
  assert.equal(refreshed.errors.length, 0);

  const removedSubscription = await service.removeSubscription(subscriptions[0].id);
  assert.equal(removedSubscription.url, subscriptions[0].url);
  assert.equal((await service.listSubscriptions()).length, 0);
});

test("times out remote subscription fetches", async (t) => {
  const workspace = await createWorkspace(t);
  const server = await createHangingServer(t);
  const service = new MusicFreeService({
    dataDir: workspace.dataDir,
    downloadDir: workspace.downloadDir,
    allowRemotePluginInstall: true,
    pluginFetchTimeoutMs: 30
  });

  await assert.rejects(
    service.subscribe(`${server.url}/plugins.json`),
    /HTTP fetch timed out after 30ms/
  );
});

test("removes plugins from the registry and deletes stored files", async (t) => {
  const workspace = await createWorkspace(t);
  const service = new MusicFreeService({
    dataDir: workspace.dataDir,
    downloadDir: workspace.downloadDir
  });

  const installed = await service.installPlugin({ source: fixturePluginPath });
  await stat(installed.filePath);

  const removed = await service.removePlugin(installed.id, true);
  assert.equal(removed.id, installed.id);
  assert.equal((await service.listPlugins()).length, 0);

  await assert.rejects(stat(installed.filePath), /ENOENT/);
});

async function createWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), "openclaw-musicfree-test-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    dataDir: join(root, "data"),
    downloadDir: join(root, "downloads")
  };
}

async function createMediaServer(t) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      headers: request.headers
    });

    if (request.url?.startsWith("/audio/")) {
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end("mock audio bytes");
      return;
    }

    response.writeHead(404);
    response.end("not found");
  });

  return listen(t, server, requests);
}

async function createSubscriptionServer(t, pluginCode) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      headers: request.headers
    });

    if (request.url === "/plugins.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          desc: "Mock subscription",
          plugins: [
            {
              name: "MockSource",
              url: `http://${request.headers.host}/mock-plugin.js`,
              version: "1.0.0"
            }
          ]
        })
      );
      return;
    }

    if (request.url === "/mock-plugin.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(pluginCode);
      return;
    }

    if (request.url?.startsWith("/audio/")) {
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end("mock audio bytes");
      return;
    }

    response.writeHead(404);
    response.end("not found");
  });

  return listen(t, server, requests);
}

async function createHangingServer(t) {
  const requests = [];
  const server = createServer((request) => {
    requests.push({
      url: request.url,
      headers: request.headers
    });
  });

  return listen(t, server, requests);
}

async function listen(t, server, requests) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests
  };
}
