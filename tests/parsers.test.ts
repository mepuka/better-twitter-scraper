import { afterEach, describe, expect, it, vi } from "vitest";

import { parseTimelinePageResponse } from "../src/parsers";
import { tweetsPageOneFixture } from "./fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Timeline parsers", () => {
  it("parses tweets when user core is present without user legacy", () => {
    const fixture = structuredClone(tweetsPageOneFixture) as any;
    const result =
      fixture.data.user.result.timeline.timeline.instructions[0]?.entries[0]
        ?.content?.itemContent?.tweet_results?.result;

    delete result.core.user_results.result.legacy;

    const page = parseTimelinePageResponse(fixture);

    expect(page.items[0]).toMatchObject({
      id: "tweet-1",
      name: "Nomadic",
      username: "nomadic_ua",
    });
  });

  it("warns when tweet-like entries are skipped while parsing a timeline", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = structuredClone(tweetsPageOneFixture) as any;
    const result =
      fixture.data.user.result.timeline.timeline.instructions[0]?.entries[0]
        ?.content?.itemContent?.tweet_results?.result;

    delete result.legacy;

    const page = parseTimelinePageResponse(fixture);

    expect(page.items.map((tweet) => tweet.id)).toEqual(["tweet-2"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("UserTweets skipped 1 tweet candidate"),
      expect.objectContaining({
        endpointId: "UserTweets",
        reasons: {
          missing_legacy: 1,
        },
        sampleEntryIds: ["tweet-tweet-1"],
        skippedCount: 1,
      }),
    );
  });
});
