import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/form-fallback/route";

/**
 * The login form POSTs here only if it is submitted before its JavaScript
 * handler is attached. The route must send the user back to /login and must
 * never touch the credentials in the body.
 */
function requestWithPoisonedBody(url: string) {
  // Any attempt to read the body throws, so a handler that reads it fails the test.
  const body = new ReadableStream({
    pull() {
      throw new Error("the fallback route read the request body");
    },
  });
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    // Required by undici for a streamed request body.
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1] & { duplex: "half" });
}

describe("POST /api/auth/form-fallback", () => {
  it("sends the user back to the login page with a retry note, as a 303", async () => {
    const res = POST(requestWithPoisonedBody("https://friendlyinvoice.co.il/api/auth/form-fallback"));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://friendlyinvoice.co.il");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("form_early");
  });

  it("never reads the body, so the credentials in it go nowhere", async () => {
    // Would throw from the poisoned stream if the handler consumed it.
    expect(() => POST(requestWithPoisonedBody("http://localhost/api/auth/form-fallback"))).not.toThrow();
  });

  it("does not echo anything from the request into the redirect", async () => {
    const res = POST(
      requestWithPoisonedBody("http://localhost/api/auth/form-fallback?next=//evil.example&email=a%40b.c"),
    );
    const location = new URL(res.headers.get("location")!);
    expect([...location.searchParams.keys()]).toEqual(["error"]);
    expect(location.host).toBe("localhost");
  });
});
