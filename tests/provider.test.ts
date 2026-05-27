import { afterEach, describe, expect, test, mock } from "bun:test";

import { AzureDevOpsProvider } from "../src/provider.js";

function setupMockFetch(
  handler: (url: string) => { status?: number; body?: unknown },
) {
  const original = globalThis.fetch;
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const r = handler(url);
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const stubHost = {
  storage: {
    get: async () => null,
    set: async () => {},
    delete: async () => true,
  },
} as never;

describe("AzureDevOpsProvider", () => {
  let restore = () => {};
  afterEach(() => restore());

  test("requires meta.organization in saveCredentials", async () => {
    const p = new AzureDevOpsProvider(stubHost);
    await expect(
      p.saveCredentials({ kind: "pat", token: "xxx" }),
    ).rejects.toThrow();
  });

  test("validates via connectionData", async () => {
    restore = setupMockFetch((url) => {
      if (url.includes("connectionData")) {
        return {
          body: { authenticatedUser: { providerDisplayName: "vignesh" } },
        };
      }
      return { body: {} };
    });
    const p = new AzureDevOpsProvider(stubHost);
    await p.saveCredentials({
      kind: "pat",
      token: "xxx",
      meta: { organization: "my-org" },
    });
    const v = await p.validateCredentials();
    expect(v.ok).toBe(true);
    expect(v.account).toBe("vignesh");
  });

  test("listRepos resolves project -> repos", async () => {
    restore = setupMockFetch((url) => {
      if (url.includes("connectionData")) {
        return {
          body: { authenticatedUser: { providerDisplayName: "vignesh" } },
        };
      }
      if (url.includes("/_apis/git/repositories")) {
        return {
          body: {
            value: [
              {
                id: "r1",
                name: "myrepo",
                url: "",
                webUrl: "https://dev.azure.com/my-org/my-project/_git/myrepo",
                project: { id: "p1", name: "my-project" },
                defaultBranch: "refs/heads/main",
              },
            ],
          },
        };
      }
      return { body: {} };
    });
    const p = new AzureDevOpsProvider(stubHost);
    await p.saveCredentials({
      kind: "pat",
      token: "xxx",
      meta: { organization: "my-org" },
    });
    const page = await p.listRepos({ org: "my-project", limit: 5 });
    expect(page.items[0]?.fqn).toBe("my-org/my-project/myrepo");
    expect(page.items[0]?.defaultBranch).toBe("main");
  });
});
